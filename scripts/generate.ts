/**
 * Generates TypeScript interfaces and Zod schemas from downloaded NeTEx XSDs.
 * Only processes the subset defined in inputs/config.json.
 *
 * Usage: npx tsx scripts/generate.ts
 *
 * Pipeline:
 *   1. Collect XSD files matching config.subset (includeParts + includeRootXsds)
 *   2. Run cxsd to produce TypeScript interfaces
 *   3. Run ts-to-zod to produce Zod schemas from those interfaces
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(resolve(ROOT, "inputs/config.json"), "utf-8"));

const xsdRoot = resolve(ROOT, config.paths.xsdRoot, config.netex.version);
const { includeParts, includeRootXsds } = config.subset;

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

console.log("=== NeTEx TypeScript Model Generator ===\n");
console.log(`XSD root: ${xsdRoot}`);
console.log(`NeTEx version: ${config.netex.version}\n`);

console.log("Configured subset:");

let totalFiles = 0;
for (const part of includeParts) {
  const dir = resolve(xsdRoot, part);
  try {
    const n = countXsdFiles(dir);
    totalFiles += n;
    console.log(`  ${part}/  (${n} XSD files)`);
  } catch {
    console.log(`  ${part}/  (not found — run 'npm run download' first)`);
  }
}

for (const xsd of includeRootXsds) {
  const file = resolve(xsdRoot, xsd);
  try {
    statSync(file);
    totalFiles++;
    console.log(`  ${xsd}`);
  } catch {
    console.log(`  ${xsd}  (not found)`);
  }
}

console.log(`\nTotal XSD files in subset: ${totalFiles}`);

// TODO: Step 2 — invoke cxsd on the subset
console.log("\n[stub] cxsd generation not yet wired up");
console.log(`  Would output to: ${config.paths.generatedInterfaces}/`);

// TODO: Step 3 — invoke ts-to-zod on generated interfaces
console.log("\n[stub] ts-to-zod generation not yet wired up");
console.log(`  Would output to: ${config.paths.generatedZod}/`);
