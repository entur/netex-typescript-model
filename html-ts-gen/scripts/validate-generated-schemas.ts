/**
 * Validates all generated JSON Schema files against the Draft 07 meta-schema using ajv.
 * Scans generated-src/<assembly>/ for *.schema.json files.
 *
 * Usage: npx tsx scripts/validate-generated-schemas.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import Ajv from "ajv";

const CONFIG_PATH = resolve(import.meta.dirname, "../../assembly-config.json");
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
const configDir = dirname(CONFIG_PATH);
const generatedBase = resolve(configDir, config.paths.generated);

const ajv = new Ajv({ allErrors: true });

let checked = 0;
let failed = 0;

for (const dir of readdirSync(generatedBase, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const assemblyDir = join(generatedBase, dir.name);
  let files: string[];
  try {
    files = readdirSync(assemblyDir).filter((f) => f.endsWith(".schema.json"));
  } catch {
    continue;
  }

  for (const file of files) {
    const filePath = join(assemblyDir, file);
    const schema = JSON.parse(readFileSync(filePath, "utf-8"));
    checked++;

    const valid = ajv.validateSchema(schema);
    if (valid) {
      console.log(`  ✓ ${dir.name}/${file}`);
    } else {
      failed++;
      console.error(`  ✗ ${dir.name}/${file}`);
      for (const err of ajv.errors?.slice(0, 10) ?? []) {
        console.error(`    ${err.instancePath} ${err.message}`);
      }
    }
  }
}

if (checked === 0) {
  console.error("No JSON Schema files found in generated output.");
  process.exit(1);
}

console.log(`\nValidated ${checked} schema(s), ${failed} failed.`);
if (failed > 0) process.exit(1);
