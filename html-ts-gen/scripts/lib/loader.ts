/** Load the base assembly's NetexLibrary from generated-src. Node-only. */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { NetexLibrary } from "./types.js";

const baseDir = resolve(import.meta.dirname, "../../../generated-src/base");

export function loadNetexLibrary(): NetexLibrary {
  if (!existsSync(baseDir)) {
    throw new Error(`Base jsonschema dir not found at ${baseDir}.\nRun "make all" first.`);
  }
  const f = readdirSync(baseDir).find((f) => f.endsWith(".schema.json"));
  if (!f) {
    throw new Error(`No *.schema.json found in ${baseDir}.\nRun "make all" first.`);
  }
  return JSON.parse(readFileSync(join(baseDir, f), "utf-8")).definitions;
}
