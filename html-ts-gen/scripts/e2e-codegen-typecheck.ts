/**
 * E2E codegen type-check: for each target entity, assemble the main interface +
 * transitive dependency subtypes (mirroring the schema viewer's Copy button),
 * write to /tmp/<Type>.ts, and verify it type-checks with tsc.
 */

import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  generateRootDefBlock,
  generateSubTypesBlock,
  type NetexLibrary,
} from "./lib/codegens.js";
import { makeInlineCodeBlock } from "./lib/to-xml-shape.js";
import { loadNetexLibrary } from "./lib/__tests__/test-helpers.js";

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

function runPass(
  lib: NetexLibrary,
  name: string,
  suffix: string,
  label: string,
  opts?: { excludeOmni?: boolean },
): boolean {
  const root = generateRootDefBlock(lib, name, opts);
  const subs = generateSubTypesBlock(lib, name, opts);
  const src = (subs ? root + "\n\n" + subs : root) + "\n";
  const path = `/tmp/${name}${suffix}.ts`;
  writeFileSync(path, src);
  return typeCheck(path, label);
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

  allPassed = runPass(netexLibrary, name, "", name) && allPassed;
  allPassed = runPass(netexLibrary, name, "-no-omni", `${name} (no-omni)`, { excludeOmni: true }) && allPassed;

  // Mapping tab: serialize functions
  const mappingCode = makeInlineCodeBlock(netexLibrary, name, { html: false });
  const mappingPath = `/tmp/${name}-mapping.ts`;
  writeFileSync(mappingPath, mappingCode + "\n");
  allPassed = typeCheck(mappingPath, `${name} (mapping)`) && allPassed;
}

process.exit(allPassed ? 0 : 1);
