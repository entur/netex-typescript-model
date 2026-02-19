/**
 * Generates TypeScript interfaces and Zod schemas from downloaded NeTEx XSDs.
 * Only processes the parts enabled in inputs/config.json.
 *
 * Usage: npx tsx scripts/generate.ts [--part <key>]
 *
 * Options:
 *   --part <key>  Enable one additional non-required part for this run
 *                 (e.g. --part part1_network). Does not modify config.json.
 *
 * Pipeline:
 *   1. Collect and parse all XSD files (cross-references need full set)
 *   2. Convert XSD → JSON Schema via custom converter (xsd-to-jsonschema.ts)
 *   3. Filter JSON Schema definitions to enabled parts only
 *   4. Convert JSON Schema → TypeScript interfaces via json-schema-to-typescript
 *   5. (Future) Generate Zod schemas from TypeScript interfaces
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import type { JSONSchema4 } from "json-schema";
import { compile } from "json-schema-to-typescript";
import { XsdToJsonSchema } from "./xsd-to-jsonschema.js";
import type { JsonSchema } from "./xsd-to-jsonschema.js";
import { splitTypeScript } from "./split-output.js";

interface PartConfig {
  enabled?: boolean;
  required?: boolean;
  dirs: string[];
  description: string;
}

interface RootXsdConfig {
  enabled?: boolean;
  required?: boolean;
  file: string;
  description: string;
}

// Hardwired required parts/rootXsds — NeTEx 2.0 structural assumptions.
// These are always enabled regardless of what config.json says.
const REQUIRED_PARTS = ["framework", "gml", "siri", "service"] as const;
const REQUIRED_ROOT_XSDS = ["publication"] as const;

/** Short filesystem-friendly names for optional parts. */
const NATURAL_SLUGS: Record<string, string> = {
  part1_network: "network",
  part2_timetable: "timetable",
  part3_fares: "fares",
  part5_new_modes: "new-modes",
};

/**
 * Resolve a directory name from enabled optional parts.
 * Required parts are always present and don't differentiate the output.
 * Falls back to stripping `partN_` prefix if no natural slug is defined.
 */
function resolveOutputSlug(parts: Record<string, PartConfig>): string {
  const enabled = Object.entries(parts)
    .filter(([k, p]) => !k.startsWith("_") && !p.required && p.enabled)
    .map(([k]) => NATURAL_SLUGS[k] ?? k.replace(/^part\d+_/, "").replace(/_/g, "-"))
    .sort();

  return enabled.length === 0 ? "base" : enabled.join("+");
}

class Config {
  readonly netexVersion: string;
  readonly xsdRoot: string;
  private readonly generatedBase: string;
  readonly parts: Record<string, PartConfig>;
  readonly rootXsds: Record<string, RootXsdConfig>;

  constructor(configPath: string) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const root = resolve(configPath, "../..");

    this.netexVersion = raw.netex.version;
    this.xsdRoot = resolve(root, raw.paths.xsdRoot, this.netexVersion);
    this.generatedBase = resolve(root, raw.paths.generated);
    this.parts = raw.parts;
    this.rootXsds = raw.rootXsds;

    this.enforceRequiredParts();
  }

  get outputSlug(): string {
    return resolveOutputSlug(this.parts);
  }

  get generatedJsonSchema(): string {
    return resolve(this.generatedBase, this.outputSlug, "jsonschema");
  }

  get generatedInterfaces(): string {
    return resolve(this.generatedBase, this.outputSlug, "interfaces");
  }

  get generatedZod(): string {
    return resolve(this.generatedBase, this.outputSlug, "zod");
  }

  private enforceRequiredParts(): void {
    // required implies enabled — set both unconditionally
    for (const key of REQUIRED_PARTS) {
      const part = this.parts[key];
      if (!part) {
        console.warn(
          `WARNING: required part '${key}' missing from config.json — generation may fail`,
        );
        continue;
      }
      if (part.enabled === false) {
        console.warn(
          `WARNING: required part '${key}' was explicitly disabled in config.json — forcing enabled`,
        );
      }
      part.required = true;
      part.enabled = true;
    }
    for (const key of REQUIRED_ROOT_XSDS) {
      const xsd = this.rootXsds[key];
      if (!xsd) {
        console.warn(
          `WARNING: required root XSD '${key}' missing from config.json — generation may fail`,
        );
        continue;
      }
      if (xsd.enabled === false) {
        console.warn(
          `WARNING: required root XSD '${key}' was explicitly disabled in config.json — forcing enabled`,
        );
      }
      xsd.required = true;
      xsd.enabled = true;
    }
  }

  applyCliPart(cliPart: string): void {
    const part = this.parts[cliPart];
    if (!part || cliPart.startsWith("_")) {
      const optional = Object.keys(this.parts).filter(
        (k) => !k.startsWith("_") && !this.parts[k].required,
      );
      console.error(`Unknown part: ${cliPart}`);
      console.error(`Available optional parts: ${optional.join(", ")}`);
      process.exit(1);
    }
    if (part.required) {
      console.error(`Part '${cliPart}' is already required and always enabled.`);
      process.exit(1);
    }
    part.enabled = true;
  }

  enabledDirs(): string[] {
    return Object.entries(this.parts)
      .filter(([k, p]) => !k.startsWith("_") && p.enabled)
      .flatMap(([, p]) => p.dirs);
  }

  enabledRootXsdFiles(): string[] {
    return Object.entries(this.rootXsds)
      .filter(([k, x]) => !k.startsWith("_") && x.enabled)
      .map(([, x]) => x.file);
  }

  /** Returns true if a source file path belongs to an enabled part or root XSD. */
  isEnabledPath(sourceFile: string): boolean {
    const enabledDirs = this.enabledDirs();
    for (const dir of enabledDirs) {
      if (sourceFile.startsWith(dir + "/") || sourceFile.startsWith(dir + "\\")) {
        return true;
      }
    }
    // Root-level XSD files
    for (const xsd of this.enabledRootXsdFiles()) {
      if (sourceFile === xsd) return true;
    }
    return false;
  }

  printParts(): void {
    console.log("Parts:");
    for (const [key, part] of Object.entries(this.parts)) {
      if (key.startsWith("_")) continue;
      const status = part.enabled ? "enabled" : "disabled";
      const tag = part.required ? " (required)" : "";
      console.log(`  ${key}: ${status}${tag}`);
    }
  }

  printRootXsds(): void {
    console.log("\nRoot XSDs:");
    for (const [key, xsd] of Object.entries(this.rootXsds)) {
      if (key.startsWith("_")) continue;
      const status = xsd.enabled ? "enabled" : "disabled";
      const tag = xsd.required ? " (required)" : "";
      console.log(`  ${xsd.file}: ${status}${tag}`);
    }
  }

  printSubsetSummary(): void {
    const enabledDirs = this.enabledDirs();
    const enabledRootXsds = this.enabledRootXsdFiles();

    console.log("\nIncluded XSD directories:");

    let totalFiles = 0;
    for (const dir of enabledDirs) {
      const fullPath = resolve(this.xsdRoot, dir);
      try {
        const n = countXsdFiles(fullPath);
        totalFiles += n;
        console.log(`  ${dir}/  (${n} XSD files)`);
      } catch {
        console.log(`  ${dir}/  (not found — run 'npm run download' first)`);
      }
    }

    for (const xsd of enabledRootXsds) {
      const file = resolve(this.xsdRoot, xsd);
      try {
        statSync(file);
        totalFiles++;
        console.log(`  ${xsd}`);
      } catch {
        console.log(`  ${xsd}  (not found)`);
      }
    }

    console.log(`\nTotal XSD files in subset: ${totalFiles}`);
  }
}

function parseCliPart(): string | undefined {
  const i = process.argv.indexOf("--part");
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function countXsdFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countXsdFiles(full);
    } else if (entry.name.endsWith(".xsd")) {
      count++;
    }
  }
  return count;
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

function persistJsonSchema(schema: JsonSchema, config: Config): void {
  cleanDir(config.generatedJsonSchema);
  const outPath = resolve(config.generatedJsonSchema, "netex.json");
  writeFileSync(outPath, JSON.stringify(schema, null, 2));
  console.log(`  Written to ${outPath}`);
}


async function generateTypeScript(schema: JsonSchema, config: Config): Promise<string> {
  console.log("\nStep 3: Generating TypeScript interfaces...");
  cleanDir(config.generatedInterfaces);

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

    const outPath = resolve(config.generatedInterfaces, "netex.ts");
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

const cliPart = parseCliPart();
if (cliPart) config.applyCliPart(cliPart);

console.log("=== NeTEx TypeScript Model Generator ===\n");
console.log(`XSD root: ${config.xsdRoot}`);
console.log(`NeTEx version: ${config.netexVersion}`);
console.log(`Output slug: ${config.outputSlug}\n`);

config.printParts();
config.printRootXsds();
config.printSubsetSummary();

// Pipeline
const { schema, converter } = generateJsonSchema(config);
persistJsonSchema(schema, config);
const ts = await generateTypeScript(schema, config);

// Step 4: Split into per-category modules
console.log("\nStep 4: Splitting into category modules...");
const splitResult = splitTypeScript(ts, converter.getTypeSourceMap(), config.generatedInterfaces);
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

// Step 5: Type-check the split modules
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
console.log(`  Would output to: ${config.generatedZod}/`);

console.log("\nDone.");
