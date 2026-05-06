/** Emit a per-assembly package.json into a staging dir for tarball assembly. */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    assembly: { type: "string" },
    version: { type: "string" },
    "out-dir": { type: "string" },
  },
});

const assembly = values.assembly!;
const version = values.version!;
const outDir = values["out-dir"]!;

const slug = assembly.toLowerCase().replace(/[+@]/g, "-");

const pkg = {
  name: `@entur/netex-typescript-model-${slug}`,
  version,
  description: `NeTEx 2.0 JSON Schema and codegen CLI for assembly '${assembly}'`,
  type: "module",
  bin: { "netex-ts-gen": "./ts-gen.mjs" },
  files: ["ts-gen.mjs", "*.schema.json", "netex-schema.html", "README.md"],
  dependencies: { typescript: "^5.5" },
  engines: { node: ">=22" },
  repository: {
    type: "git",
    url: "git+https://github.com/entur/netex-typescript-model.git",
  },
  license: "EUPL-1.2",
};

writeFileSync(join(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`Wrote ${outDir}/package.json (${pkg.name}@${version})`);
