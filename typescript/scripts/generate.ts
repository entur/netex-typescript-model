/**
 * Generates TypeScript interfaces and Zod schemas from downloaded NeTEx XSDs.
 * Only processes the parts enabled in inputs/config.json.
 *
 * Usage: npx tsx scripts/generate.ts [--schema-source <path>]
 *
 * Options:
 *   --schema-source <path>  Use a pre-generated JSON Schema file instead of running
 *                           the XSD converter. The schema must contain an
 *                           "x-netex-assembly" field identifying the assembly name.
 *                           Skips the category split (no typeSourceMap).
 *
 * Pipeline:
 *   1. Collect and parse all XSD files (cross-references need full set)
 *   2. Convert XSD → JSON Schema via custom converter (xsd-to-jsonschema.ts)
 *   3. Filter JSON Schema definitions to enabled parts only
 *   4. Convert JSON Schema → TypeScript interfaces via json-schema-to-typescript
 *   5. (Future) Generate Zod schemas from TypeScript interfaces
 */

import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import type { JSONSchema4 } from "json-schema";
import { compile } from "json-schema-to-typescript";
import { XsdToJsonSchema } from "./xsd-to-jsonschema.js";
import type { JsonSchema } from "./xsd-to-jsonschema.js";
import { splitTypeScript } from "./split-output.js";
import { Config, resolveAssembly } from "./lib/config.js";

const DOCS_BASE_URL = "https://entur.github.io/netex-typescript-model";

function parseCliArgs(): { schemaSource?: string } {
  const args: { schemaSource?: string } = {};
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--schema-source" && argv[i + 1]) {
      args.schemaSource = argv[++i];
    }
  }
  return args;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Walk all definitions and verify every $ref target resolves.
 * Returns broken refs as [source definition, $ref target] pairs.
 */
function validateRefs(schema: JsonSchema): [string, string][] {
  const defs = schema.definitions ?? {};
  const defNames = new Set(Object.keys(defs));
  const broken: [string, string][] = [];

  function walk(obj: unknown, source: string): void {
    if (typeof obj !== "object" || obj === null) return;
    const record = obj as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      const target = record.$ref.replace("#/definitions/", "");
      if (!defNames.has(target)) {
        broken.push([source, target]);
      }
    }
    for (const v of Object.values(record)) {
      if (typeof v === "object" && v !== null) walk(v, source);
    }
  }

  for (const [name, def] of Object.entries(defs)) {
    walk(def, name);
  }
  return broken;
}

/** Count export declarations in a TypeScript string. */
function countExports(ts: string): number {
  return [...ts.matchAll(/^export (?:type|interface) /gm)].length;
}

/**
 * Deep-clone the schema and append @see links to each definition's description.
 * The persisted JSON stays clean — only the TypeScript JSDoc gets the links.
 */
function injectSchemaLinks(schema: JsonSchema, assembly: string): JsonSchema {
  const clone: JsonSchema = JSON.parse(JSON.stringify(schema));
  const defs = clone.definitions ?? {};
  const schemaUrl = `${DOCS_BASE_URL}/${assembly}/netex-schema.html`;

  for (const [name, def] of Object.entries(defs)) {
    if (typeof def === "object" && def !== null) {
      const seeTag = `@see {@link ${schemaUrl}#${name} | JSON Schema definition}`;
      const record = def as Record<string, unknown>;
      if (typeof record.description === "string") {
        record.description = `${record.description}\n\n${seeTag}`;
      } else {
        record.description = seeTag;
      }
    }
  }

  return clone;
}

// ── External schema loading ─────────────────────────────────────────────────

/**
 * Load a pre-generated JSON Schema from disk and validate $ref integrity.
 * The schema must contain an "x-netex-assembly" field.
 */
function loadExternalSchema(path: string): JsonSchema {
  const absPath = resolve(path);
  if (!existsSync(absPath)) {
    console.error(`Schema source not found: ${absPath}`);
    process.exit(1);
  }

  console.log(`\nLoading external JSON Schema: ${absPath}`);
  const schema: JsonSchema = JSON.parse(readFileSync(absPath, "utf-8"));

  if (!schema["x-netex-assembly"]) {
    console.error(`\n  ERROR: External schema is missing "x-netex-assembly" field.`);
    console.error(`  Generate the schema with xsd-to-jsonschema.ts to include it.`);
    process.exit(1);
  }

  const defCount = Object.keys(schema.definitions || {}).length;
  console.log(`  ${defCount} definitions`);
  console.log(`  Assembly: ${schema["x-netex-assembly"]}`);

  const brokenRefs = validateRefs(schema);
  if (brokenRefs.length > 0) {
    console.error(`\n  ERROR: ${brokenRefs.length} broken $ref targets in external schema:`);
    for (const [source, target] of brokenRefs.slice(0, 10)) {
      console.error(`    ${source} → $ref "#/definitions/${target}" (missing)`);
    }
    if (brokenRefs.length > 10) {
      console.error(`    ... and ${brokenRefs.length - 10} more`);
    }
    process.exit(1);
  }
  console.log(`  $ref integrity: all references resolve`);

  return schema;
}

// ── Generation pipeline ───────────────────────────────────────────────────────

function cleanDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
}

function generateJsonSchema(config: Config): { schema: JsonSchema; converter: XsdToJsonSchema } {
  if (!existsSync(config.xsdRoot)) {
    console.error(`XSD directory not found: ${config.xsdRoot}`);
    console.error("Run 'npm run download' first.");
    process.exit(1);
  }

  console.log("\nStep 1: Parsing XSD files...");
  const converter = new XsdToJsonSchema(config.xsdRoot);

  // Load from publication entry point — recursively resolves all includes/imports
  const entryXsd = "NeTEx_publication.xsd";
  converter.loadFile(entryXsd);

  const stats = converter.stats;
  console.log(`  Parsed ${stats.files} XSD files`);
  console.log(`  Found ${stats.types} types, ${stats.elements} elements, ${stats.groups} groups`);

  const warnings = converter.getWarnings();
  if (warnings.length > 0) {
    console.log(`  ${warnings.length} warnings:`);
    for (const w of warnings.slice(0, 10)) {
      console.log(`    - ${w}`);
    }
    if (warnings.length > 10) {
      console.log(`    ... and ${warnings.length - 10} more`);
    }
  }

  console.log("\nStep 2: Generating JSON Schema (filtered to enabled parts)...");
  const schema = converter.toJsonSchema((sourceFile) => config.isEnabledPath(sourceFile));
  const defCount = Object.keys(schema.definitions || {}).length;
  console.log(`  ${defCount} definitions in filtered schema`);

  // Validate: every $ref must resolve to an existing definition
  const brokenRefs = validateRefs(schema);
  if (brokenRefs.length > 0) {
    console.error(`\n  ERROR: ${brokenRefs.length} broken $ref targets in JSON Schema:`);
    for (const [source, target] of brokenRefs.slice(0, 10)) {
      console.error(`    ${source} → $ref "#/definitions/${target}" (missing)`);
    }
    if (brokenRefs.length > 10) {
      console.error(`    ... and ${brokenRefs.length - 10} more`);
    }
    process.exit(1);
  }
  console.log(`  $ref integrity: all references resolve`);

  return { schema, converter };
}

function persistJsonSchema(schema: JsonSchema, jsonSchemaDir: string, assembly: string): void {
  cleanDir(jsonSchemaDir);
  const outPath = resolve(jsonSchemaDir, `${assembly}.schema.json`);
  writeFileSync(outPath, JSON.stringify(schema, null, 2));
  console.log(`  Written to ${outPath}`);
}


async function generateTypeScript(schema: JsonSchema, interfacesDir: string): Promise<string> {
  console.log("\nStep 3: Generating TypeScript interfaces...");
  cleanDir(interfacesDir);

  try {
    // We produce Draft 07 (JSONSchema7 from @types/json-schema) but
    // json-schema-to-typescript's public API is typed as JSONSchema4 — a legacy
    // signature it never updated. Internally it handles Draft 07 features
    // (if/then/else, $defs, const, etc.) fine. The cast is safe.
    const ts = await compile(schema as unknown as JSONSchema4, "NeTEx", {
      bannerComment: [
        "/* eslint-disable */",
        "/**",
        " * This file was automatically generated from NeTEx XSD schemas.",
        " * Do not edit manually.",
        " *",
        " * @see https://github.com/NeTEx-CEN/NeTEx",
        " */",
      ].join("\n"),
      additionalProperties: false,
      unknownAny: true,
      strictIndexSignatures: false,
      unreachableDefinitions: true,
      format: false, // skip prettier for speed on large output
    });

    const outPath = resolve(interfacesDir, "netex.ts");
    writeFileSync(outPath, ts);

    const lineCount = ts.split("\n").length;
    console.log(`  Generated ${lineCount} lines of TypeScript`);
    console.log(`  Written to ${outPath}`);
    return ts;
  } catch (e: any) {
    console.error(`  TypeScript generation failed: ${e.message}`);
    console.error("  JSON Schema was persisted — you can inspect it for issues.");
    process.exit(1);
  }
}

// ###################################
//
//            --- main ---
//
// ###################################

const ROOT = resolve(import.meta.dirname, "..");
const config = new Config(resolve(ROOT, "inputs/config.json"));

const cliArgs = parseCliArgs();

console.log("=== NeTEx TypeScript Model Generator ===\n");
console.log(`XSD root: ${config.xsdRoot}`);
console.log(`NeTEx version: ${config.netexVersion}\n`);

config.printParts();
config.printRootXsds();

let schema: JsonSchema;
let typeSourceMap: Map<string, string> | undefined;

if (cliArgs.schemaSource) {
  // External schema — skip XSD parsing, skip subset summary
  schema = loadExternalSchema(cliArgs.schemaSource);
} else {
  // Standard pipeline — XSD → JSON Schema
  config.printSubsetSummary();
  const result = generateJsonSchema(config);
  schema = result.schema;
  schema["x-netex-assembly"] = resolveAssembly(config.parts);
  typeSourceMap = result.converter.getTypeSourceMap();
}

// Derive output paths from the assembly embedded in the schema
const assembly = schema["x-netex-assembly"]!;
const generatedJsonSchema = resolve(config.generatedBase, assembly, "jsonschema");
const generatedInterfaces = resolve(config.generatedBase, assembly, "interfaces");
const generatedZod = resolve(config.generatedBase, assembly, "zod");

console.log(`\nOutput assembly: ${assembly}`);

persistJsonSchema(schema, generatedJsonSchema, assembly);

const linkedSchema = injectSchemaLinks(schema, assembly);
const ts = await generateTypeScript(linkedSchema, generatedInterfaces);

// Step 4: Split into per-category modules (only when we have source mapping)
if (typeSourceMap) {
  console.log("\nStep 4: Splitting into category modules...");
  const splitResult = splitTypeScript(ts, typeSourceMap, generatedInterfaces);
  for (const [cat, count] of [...splitResult.counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}.ts: ${count} declarations`);
  }
  console.log(`  index.ts: barrel re-export (${splitResult.files.size} modules)`);

  // Validate: split modules should account for all monolithic declarations
  const monolithicCount = countExports(ts);
  let splitCount = 0;
  for (const [, filePath] of splitResult.files) {
    splitCount += countExports(readFileSync(filePath, "utf-8"));
  }
  if (splitCount < monolithicCount) {
    console.warn(
      `\n  WARNING: split produced ${splitCount} declarations but monolithic file has ${monolithicCount}` +
        ` — ${monolithicCount - splitCount} declarations were lost during splitting`,
    );
  } else {
    console.log(`  Split completeness: ${splitCount}/${monolithicCount} declarations accounted for`);
  }
} else {
  console.log("\nStep 4: Skipping category split (no type source map from external schema)");
}

// Step 5: Type-check the generated output
console.log("\nStep 5: Type-checking generated output...");
try {
  execSync("npx tsc --noEmit", { cwd: ROOT, stdio: "pipe" });
  console.log("  Type-check passed (zero errors)");
} catch (e: any) {
  const stderr = e.stderr?.toString() || "";
  const stdout = e.stdout?.toString() || "";
  const output = (stdout + stderr).trim();
  const errorCount = output.split("\n").filter((l: string) => l.includes("error TS")).length;
  console.error(`\n  ERROR: Type-check failed with ${errorCount} error(s):`);
  for (const line of output.split("\n").slice(0, 20)) {
    console.error(`    ${line}`);
  }
  process.exit(1);
}

// TODO: Step 6 — invoke ts-to-zod on generated interfaces
console.log("\n[stub] Zod schema generation not yet wired up");
console.log(`  Would output to: ${generatedZod}/`);

console.log("\nDone.");
