/**
 * ts-gen: assemble codegen output for target entities and verify with tsc.
 * Usage: npx tsx scripts/ts-gen.ts [flags] <Target> [...]
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { generateInterface, generateSubTypesBlock } from "./lib/codegens.js";
import { flattenAllOf, buildExclSet } from "./lib/schema-nav.js";
import { makeInlineCodeBlock } from "./lib/to-xml-shape.js";
import { loadNetexLibrary } from "./lib/loader.js";
import { type CollapseOpts, buildTypeOverrides, REF_PREAMBLE } from "./lib/collapse.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function guardWrite(path: string, content: string): boolean {
  if (!overwrite && existsSync(path)) {
    console.error(`ABORT ${path} already exists (use --overwrite)`);
    return false;
  }
  writeFileSync(path, content);
  return true;
}

function typeCheck(path: string): boolean {
  try {
    execFileSync("npx", ["tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", path], {
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log(`PASS ${path}`);
    return true;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    console.error(`FAIL ${path}`);
    if (e.stdout) console.error(e.stdout);
    if (e.stderr) console.error(e.stderr);
    return false;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const { values, positionals: TARGETS } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dest-dir": { type: "string", default: "/tmp" },
    overwrite: { type: "boolean", default: false },
    exclude: { type: "string" },
    suffix: { type: "string", default: "" },
    "collapse-refs": { type: "boolean", default: false },
    "collapse-collections": { type: "boolean", default: false },
  },
  allowPositionals: true,
});

if (!TARGETS.length) {
  console.error("Usage: npx tsx scripts/ts-gen.ts [--dest-dir <path>] [--overwrite] [--exclude a,b,...]");
  console.error("       [--suffix s] [--collapse-refs] [--collapse-collections] <Target> [...]");
  process.exit(1);
}

const destDir = values["dest-dir"]!;
mkdirSync(destDir, { recursive: true });
const overwrite = values.overwrite!;
const suffix = values.suffix!;
const explicit = values.exclude
  ? new Set(values.exclude.split(",").map((s) => s.trim()).filter((s) => s.length > 0))
  : undefined;
const collapse: CollapseOpts | undefined =
  values["collapse-refs"] || values["collapse-collections"]
    ? { collapseRefs: values["collapse-refs"], collapseCollections: values["collapse-collections"] }
    : undefined;
const netexLibrary = loadNetexLibrary();
let allPassed = true;

for (const name of TARGETS) {
  if (!netexLibrary[name]) {
    console.error(`SKIP ${name}: not found in schema`);
    allPassed = false;
    continue;
  }

  const allProps = flattenAllOf(netexLibrary, name);
  const exclSet = buildExclSet(allProps, { explicit });

  // 1. TARGET[suffix].ts — interface + subtypes
  const overrides = collapse ? buildTypeOverrides(netexLibrary, name, collapse) : undefined;
  const root = generateInterface(netexLibrary, name, { html: false, excludeProps: exclSet, typeOverrides: overrides }).text;
  const subs = generateSubTypesBlock(netexLibrary, name, { excludeProps: exclSet, collapse });
  const parts = [root];
  if (subs) parts.push(subs);
  if (collapse?.collapseRefs || collapse?.collapseCollections) parts.push(REF_PREAMBLE);
  const src = parts.join("\n\n") + "\n";
  const ifPath = `${destDir}/${name}${suffix}.ts`;
  allPassed = guardWrite(ifPath, src) && typeCheck(ifPath) && allPassed;

  // 2. TARGET-mapping.ts — serialize functions
  const mapping = makeInlineCodeBlock(netexLibrary, name, { html: false, excludeProps: exclSet, props: allProps, collapse });
  const mapPath = `${destDir}/${name}-mapping.ts`;
  allPassed = guardWrite(mapPath, mapping + "\n") && typeCheck(mapPath) && allPassed;
}

process.exit(allPassed ? 0 : 1);
