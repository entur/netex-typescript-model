/**
 * Generates TypeScript interfaces from a pre-generated NeTEx JSON Schema.
 *
 * Usage: npx tsx scripts/generate.ts <schema.json>
 *
 * The schema must contain an "x-netex-assembly" field identifying the assembly name.
 * Per-definition "x-netex-source" annotations are used to build the source map for
 * splitting into per-category modules.
 *
 * Pipeline:
 *   1. Load JSON Schema from positional argument
 *   2. Build typeSourceMap from per-definition x-netex-source annotations
 *   3. Inject @see links into a clone (persisted JSON stays clean)
 *   4. Convert JSON Schema → TypeScript interfaces via json-schema-to-typescript
 *   5. Split into per-category modules (using source map from step 2)
 *   6. Type-check with tsc --noEmit
 */

import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import type { JSONSchema4 } from "json-schema";
import { compile } from "json-schema-to-typescript";
import { splitTypeScript } from "./split-output.js";
import type { JSONSchema7 } from "json-schema";

type JsonSchema = JSONSchema7 & {
  "x-netex-source"?: string;
  "x-netex-assembly"?: string;
};

const DOCS_BASE_URL = "https://entur.github.io/netex-typescript-model";

// ── CLI ─────────────────────────────────────────────────────────────────────

const schemaPath = process.argv[2];
if (!schemaPath) {
  console.error("Usage: npx tsx scripts/generate.ts <schema.json>");
  process.exit(1);
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

// ── Schema loading ──────────────────────────────────────────────────────────

function loadSchema(path: string): JsonSchema {
  const absPath = resolve(path);
  if (!existsSync(absPath)) {
    console.error(`Schema not found: ${absPath}`);
    process.exit(1);
  }

  console.log(`\nLoading JSON Schema: ${absPath}`);
  const schema: JsonSchema = JSON.parse(readFileSync(absPath, "utf-8"));

  if (!schema["x-netex-assembly"]) {
    console.error(`\n  ERROR: Schema is missing "x-netex-assembly" field.`);
    console.error(`  Generate the schema with xsd-to-jsonschema to include it.`);
    process.exit(1);
  }

  const defCount = Object.keys(schema.definitions || {}).length;
  console.log(`  ${defCount} definitions`);
  console.log(`  Assembly: ${schema["x-netex-assembly"]}`);

  const brokenRefs = validateRefs(schema);
  if (brokenRefs.length > 0) {
    console.error(`\n  ERROR: ${brokenRefs.length} broken $ref targets:`);
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

async function generateTypeScript(schema: JsonSchema, interfacesDir: string): Promise<string> {
  console.log("\nGenerating TypeScript interfaces...");
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
    process.exit(1);
  }
}

// ###################################
//
//            --- main ---
//
// ###################################

const REPO_ROOT = resolve(import.meta.dirname, "../..");

console.log("=== NeTEx TypeScript Interface Generator ===");

const schema = loadSchema(schemaPath);
const assembly = schema["x-netex-assembly"]!;

// Derive output directory from schema path:
// Schema lives at generated-src/<assembly>/<assembly>.schema.json
// Output goes to sibling interfaces/ dir
const generatedInterfaces = resolve(dirname(schemaPath), "interfaces");

console.log(`\nOutput assembly: ${assembly}`);
console.log(`Interfaces dir: ${generatedInterfaces}`);

// Build typeSourceMap from per-definition x-netex-source annotations
const typeSourceMap = new Map<string, string>();
for (const [name, def] of Object.entries(schema.definitions ?? {})) {
  const d = def as Record<string, unknown>;
  if (typeof d["x-netex-source"] === "string") {
    typeSourceMap.set(name, d["x-netex-source"]);
  }
}

if (typeSourceMap.size > 0) {
  console.log(`  Source map: ${typeSourceMap.size} definitions with provenance`);
} else {
  console.log(`  Source map: none (no x-netex-source annotations)`);
}

const linkedSchema = injectSchemaLinks(schema, assembly);
const ts = await generateTypeScript(linkedSchema, generatedInterfaces);

// Split into per-category modules (only when we have source mapping)
if (typeSourceMap.size > 0) {
  console.log("\nSplitting into category modules...");
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
  console.log("\nSkipping category split (no x-netex-source annotations in schema)");
}

// Type-check the generated output
console.log("\nType-checking generated output...");
try {
  execSync("npx --prefix typescript tsc --noEmit -p tsconfig.generated.json", { cwd: REPO_ROOT, stdio: "pipe" });
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

console.log("\nDone.");
