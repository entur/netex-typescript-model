/** Load a NetexLibrary from a generated-src dir or schema-json file. */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { NetexLibrary } from "./types.js";

const generatedRoot = resolve(import.meta.dirname, "../../../generated-src");

/**
 * Pick a default schema directory under generated-src/. Prefers `base` for
 * deterministic test fixtures; falls back to any single assembly available
 * (CI release builds may only ship the full assembly).
 */
function defaultDir(): string {
  const base = resolve(generatedRoot, "base");
  if (existsSync(base)) return base;
  if (!existsSync(generatedRoot)) return base;
  const sub = readdirSync(generatedRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => resolve(generatedRoot, d.name))
    .filter((p) => readdirSync(p).some((n) => n.endsWith(".schema.json")));
  return sub[0] ?? base;
}

/**
 * Load a NetexLibrary from a schema JSON file or directory.
 * @param dirOrFile Optional path. If a directory, the first *.schema.json inside is loaded.
 *                  If a file, that file is loaded. Defaults to generated-src/base
 *                  (or the first assembly directory containing a schema if base is absent).
 * @returns Parsed definitions map as a NetexLibrary.
 */
export function loadNetexLibrary(dirOrFile?: string): NetexLibrary {
  const target = dirOrFile ?? defaultDir();
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
