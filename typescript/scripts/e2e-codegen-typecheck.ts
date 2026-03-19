/**
 * E2E codegen type-check: for each target entity, assemble the main interface +
 * transitive dependency subtypes (mirroring the schema viewer's Copy button),
 * write to /tmp/<Type>.ts, and verify it type-checks with tsc.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import {
  collectDependencyTree,
  resolveDefType,
  flattenAllOf,
  defRole,
  type Defs,
} from "./lib/fns.js";
import { generateInterface } from "./lib/codegens.js";

// ── Schema loading ──────────────────────────────────────────────────────────

const jsonschemaDir = resolve(import.meta.dirname, "../../generated-src/base");

function loadDefs(): Defs {
  if (!existsSync(jsonschemaDir)) {
    throw new Error(`Base jsonschema dir not found at ${jsonschemaDir}.\nRun "make all" first.`);
  }
  const schemaFile = readdirSync(jsonschemaDir).find((f) => f.endsWith(".schema.json"));
  if (!schemaFile) {
    throw new Error(`No *.schema.json found in ${jsonschemaDir}.\nRun "make all" first.`);
  }
  return JSON.parse(readFileSync(join(jsonschemaDir, schemaFile), "utf-8")).definitions;
}

// ── Dep filtering (mirrors schema-viewer-host-app.js lines 570–582) ─────────

function filterRenderableDeps(defs: Defs, rootName: string): string[] {
  const depNodes = collectDependencyTree(defs, rootName);

  // Deduplicate
  const seen: Record<string, boolean> = {};
  const allUniqueNames: string[] = [];
  for (const node of depNodes) {
    if (!node.duplicate && !seen[node.name]) {
      seen[node.name] = true;
      allUniqueNames.push(node.name);
    }
  }

  // Filter to renderable deps
  const renderableNames: string[] = [];
  for (const depName of allUniqueNames) {
    const depResolved = resolveDefType(defs, depName);
    // Skip primitive aliases (already shown as inline atom comments)
    if (!depResolved.complex && defRole(defs[depName]) !== "enumeration") continue;
    // Skip transparent wrappers (e.g. KeyListStructure → KeyValueStructure[])
    if (depResolved.complex && depResolved.ts !== depName) continue;
    // Skip empty interfaces (no properties, resolves to self)
    const depFlat = flattenAllOf(defs, depName);
    if (depFlat.length === 0 && depResolved.complex && depResolved.ts === depName) continue;
    renderableNames.push(depName);
  }
  return renderableNames;
}

// ── Main ────────────────────────────────────────────────────────────────────

const TARGETS = ["VehicleType", "Vehicle", "DeckPlan"];

const defs = loadDefs();
let allPassed = true;

for (const name of TARGETS) {
  if (!defs[name]) {
    console.error(`SKIP ${name}: not found in schema`);
    allPassed = false;
    continue;
  }

  // Main interface
  const main = generateInterface(defs, name, { html: false });

  // Transitive deps
  const depNames = filterRenderableDeps(defs, name);
  const depBlocks = depNames.map(
    (depName) => generateInterface(defs, depName, { html: false, compact: true }).text,
  );

  const fullSource = [main.text, ...depBlocks].join("\n\n") + "\n";
  const outPath = `/tmp/${name}.ts`;
  writeFileSync(outPath, fullSource);

  // Type-check
  try {
    execSync(`npx tsc --noEmit --strict --target ES2022 ${outPath}`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log(`PASS ${name} (${depNames.length} deps)`);
  } catch (err: unknown) {
    allPassed = false;
    const e = err as { stdout?: string; stderr?: string };
    console.error(`FAIL ${name}`);
    if (e.stdout) console.error(e.stdout);
    if (e.stderr) console.error(e.stderr);
  }
}

process.exit(allPassed ? 0 : 1);
