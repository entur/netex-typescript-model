/**
 * Emit package.json + README into a staging dir for the generator-only tarball.
 *
 * The generator tarball is schema-agnostic: it ships the bundled `ts-gen.mjs`
 * CLI plus a package.json exposing it as `bin: netex-ts-gen`. Consumers pair
 * it with a separately-downloaded netex-jsonschema-full-<NV>-v<TAG>.json file
 * via the CLI's --schema flag.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    version: { type: "string" },
    "out-dir": { type: "string" },
  },
});

const version = values.version!;
const outDir = values["out-dir"]!;

const pkg = {
  name: "@entur/netex-ts-gen",
  version,
  description: "Codegen CLI: emit per-entity TypeScript from a NeTEx JSON Schema",
  type: "module",
  bin: { "netex-ts-gen": "./ts-gen.mjs" },
  files: ["ts-gen.mjs", "README.md"],
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

const readme = `# @entur/netex-ts-gen

Codegen CLI for NeTEx 2.0. Reads a JSON Schema, emits per-entity TypeScript
(interface + XML mapping) on demand. Schema-agnostic — bring your own.

## Install

\`\`\`bash
# Schema (raw JSON file, not an npm package)
curl -L -O https://github.com/entur/netex-typescript-model/releases/latest/download/netex-jsonschema-full-2.0.json

# CLI (npm package)
npm install https://github.com/entur/netex-typescript-model/releases/latest/download/netex-ts-gen.tgz
\`\`\`

## Usage

\`\`\`bash
npx netex-ts-gen --schema ./netex-jsonschema-full-2.0.json --dest-dir ./gen VehicleType Vehicle
\`\`\`

Each target \`<Name>\` produces \`<Name>.ts\` (interface + transitive types) and
\`<Name>-mapping.ts\` (XML serialization). Both are type-checked with
\`tsc --strict\` before being written.

See the [project README](https://github.com/entur/netex-typescript-model#readme)
for the full demo and CLI reference.

## License

EUPL-1.2.
`;

writeFileSync(join(outDir, "README.md"), readme);
console.log(`Wrote ${outDir}/README.md`);
