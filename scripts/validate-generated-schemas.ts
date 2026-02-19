/**
 * Validates all generated JSON Schema files against the Draft 07 meta-schema using ajv.
 * Scans src/generated/ for jsonschema directories.
 *
 * Usage: npx tsx scripts/validate-generated-schemas.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import Ajv from "ajv";

const ROOT = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(resolve(ROOT, "inputs/config.json"), "utf-8"));
const generatedBase = resolve(ROOT, config.paths.generated);

const ajv = new Ajv({ allErrors: true });

let checked = 0;
let failed = 0;

for (const slug of readdirSync(generatedBase, { withFileTypes: true })) {
  if (!slug.isDirectory()) continue;
  const schemaDir = join(generatedBase, slug.name, "jsonschema");
  let files: string[];
  try {
    files = readdirSync(schemaDir).filter((f) => f.endsWith(".json"));
  } catch {
    continue;
  }

  for (const file of files) {
    const filePath = join(schemaDir, file);
    const schema = JSON.parse(readFileSync(filePath, "utf-8"));
    checked++;

    const valid = ajv.validateSchema(schema);
    if (valid) {
      console.log(`  ✓ ${slug.name}/jsonschema/${file}`);
    } else {
      failed++;
      console.error(`  ✗ ${slug.name}/jsonschema/${file}`);
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
