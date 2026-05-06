/** Bundle ts-gen.ts + lib/* + fast-xml-parser into a single .mjs CLI. */

import { build } from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    out: { type: "string", default: "dist/ts-gen.mjs" },
  },
});

const outFile = resolve(process.cwd(), values.out!);
mkdirSync(resolve(outFile, ".."), { recursive: true });

await build({
  entryPoints: [resolve(import.meta.dirname, "ts-gen.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: outFile,
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  minify: false,
  // fast-xml-parser is ESM/CJS hybrid — bundle it. Node built-ins are auto-external.
});

chmodSync(outFile, 0o755);
console.log(`Bundled CLI → ${outFile}`);
