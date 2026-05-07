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
    "tarball-name": { type: "string" },
  },
});

const assembly = values.assembly!;
const version = values.version!;
const outDir = values["out-dir"]!;
const tarballName = values["tarball-name"] ?? `netex-${assembly}-v${version}.tgz`;

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

const readme = `# @entur/netex-typescript-model-${slug}

NeTEx 2.0 JSON Schema (assembly: \`${assembly}\`) plus a self-contained codegen CLI.

## Install

\`\`\`bash
npm install https://github.com/entur/netex-typescript-model/releases/download/v${version}/${tarballName}
\`\`\`

## Use the CLI

\`\`\`bash
# Generate Vehicle.ts and Vehicle-mapping.ts from the bundled schema:
npx netex-ts-gen --dest-dir ./gen --overwrite Vehicle

# Collapse refs and one-child collections (recommended for ergonomic types):
npx netex-ts-gen --collapse-refs --collapse-collections \\\\
    --dest-dir ./gen --overwrite VehicleType DeckPlan

# Use a different schema (e.g. another assembly's tarball):
npx netex-ts-gen --schema ./other.schema.json --dest-dir ./gen Vehicle
\`\`\`

## Use the JSON Schema directly

\`${assembly}.schema.json\` is the standard JSON Schema (Draft 07) for this assembly.
Open \`netex-schema.html\` in a browser for the offline schema explorer.

## License

EUPL-1.2.
`;

writeFileSync(join(outDir, "README.md"), readme);
console.log(`Wrote ${outDir}/README.md`);
