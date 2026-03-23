/**
 * E2E codegen type-check: for each target entity, assemble the main interface +
 * transitive dependency subtypes (mirroring the schema viewer's Copy button),
 * write to /tmp/<Type>.ts, and verify it type-checks with tsc.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import {
  generateRootDefBlock,
  generateSubTypesBlock,
  type NetexLibrary,
} from "./lib/codegens.js";

// ── Schema loading ──────────────────────────────────────────────────────────

const jsonschemaDir = resolve(import.meta.dirname, "../../generated-src/base");

function loadNetexLibrary(): NetexLibrary {
  if (!existsSync(jsonschemaDir)) {
    throw new Error(`Base jsonschema dir not found at ${jsonschemaDir}.\nRun "make all" first.`);
  }
  const schemaFile = readdirSync(jsonschemaDir).find((f) => f.endsWith(".schema.json"));
  if (!schemaFile) {
    throw new Error(`No *.schema.json found in ${jsonschemaDir}.\nRun "make all" first.`);
  }
  return JSON.parse(readFileSync(join(jsonschemaDir, schemaFile), "utf-8")).definitions;
}

// ── Main ────────────────────────────────────────────────────────────────────

const TARGETS = ["VehicleType", "Vehicle", "DeckPlan"];

const netexLibrary = loadNetexLibrary();
let allPassed = true;

for (const name of TARGETS) {
  if (!netexLibrary[name]) {
    console.error(`SKIP ${name}: not found in schema`);
    allPassed = false;
    continue;
  }

  const root = generateRootDefBlock(netexLibrary, name);
  const subs = generateSubTypesBlock(netexLibrary, name);
  const fullSource = (subs ? root + "\n\n" + subs : root) + "\n";
  const outPath = `/tmp/${name}.ts`;
  writeFileSync(outPath, fullSource);

  // Type-check
  try {
    execSync(`npx tsc --noEmit --strict --skipLibCheck --target ES2022 ${outPath}`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log(`PASS ${name}`);
  } catch (err: unknown) {
    allPassed = false;
    const e = err as { stdout?: string; stderr?: string };
    console.error(`FAIL ${name}`);
    if (e.stdout) console.error(e.stdout);
    if (e.stderr) console.error(e.stderr);
  }
}

process.exit(allPassed ? 0 : 1);
