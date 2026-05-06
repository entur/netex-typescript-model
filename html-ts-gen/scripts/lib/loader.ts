/** Load a NetexLibrary from a generated-src dir or schema-json file. */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { NetexLibrary } from "./types.js";

const defaultDir = resolve(import.meta.dirname, "../../../generated-src/base");

/**
 * Load a NetexLibrary from a schema JSON file or directory.
 * @param dirOrFile Optional path. If a directory, the first *.schema.json inside is loaded.
 *                  If a file, that file is loaded. Defaults to generated-src/base.
 * @returns Parsed definitions map as a NetexLibrary.
 */
export function loadNetexLibrary(dirOrFile?: string): NetexLibrary {
  const target = dirOrFile ?? defaultDir;
  if (!existsSync(target)) {
    throw new Error(`Schema path not found: ${target}.\nRun "make all" first.`);
  }
  const file = statSync(target).isDirectory() ? findSchemaFile(target) : target;
  return JSON.parse(readFileSync(file, "utf-8")).definitions;
}

function findSchemaFile(dir: string): string {
  const f = readdirSync(dir).find((n) => n.endsWith(".schema.json"));
  if (!f) throw new Error(`No *.schema.json found in ${dir}.`);
  return join(dir, f);
}
