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

// ── Helpers ─────────────────────────────────────────────────────────────────

function typeCheck(path: string, label: string): boolean {
  try {
    execSync(`npx tsc --noEmit --strict --skipLibCheck --target ES2022 ${path}`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log(`PASS ${label}`);
    return true;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    console.error(`FAIL ${label}`);
    if (e.stdout) console.error(e.stdout);
    if (e.stderr) console.error(e.stderr);
    return false;
  }
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

  // Full output
  const root = generateRootDefBlock(netexLibrary, name);
  const subs = generateSubTypesBlock(netexLibrary, name);
  const fullSource = (subs ? root + "\n\n" + subs : root) + "\n";
  const outPath = `/tmp/${name}.ts`;
  writeFileSync(outPath, fullSource);
  allPassed = typeCheck(outPath, name) && allPassed;

  // Without omnipresent base props
  const rootOmni = generateRootDefBlock(netexLibrary, name, { excludeOmni: true });
  const subsOmni = generateSubTypesBlock(netexLibrary, name, { excludeOmni: true });
  const omniSrc = (subsOmni ? rootOmni + "\n\n" + subsOmni : rootOmni) + "\n";
  const omniPath = `/tmp/${name}-no-omni.ts`;
  writeFileSync(omniPath, omniSrc);
  allPassed = typeCheck(omniPath, `${name} (no-omni)`) && allPassed;
}

process.exit(allPassed ? 0 : 1);
