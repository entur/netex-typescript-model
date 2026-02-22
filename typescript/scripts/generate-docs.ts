/**
 * Generates TypeDoc HTML documentation for each generated assembly.
 * Discovers assemblies by listing directories in generated-src/.
 * Creates an assembly-specific README for the TypeDoc landing page.
 *
 * Usage: npx tsx scripts/generate-docs.ts
 */

import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execSync } from "node:child_process";

const CONFIG_PATH = resolve(import.meta.dirname, "../../assembly-config.json");
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
const configDir = dirname(CONFIG_PATH);
const generatedBase = resolve(configDir, config.paths.generated);

if (!existsSync(generatedBase)) {
  console.error(`Generated directory not found: ${generatedBase}`);
  console.error("Run 'npm run generate' first.");
  process.exit(1);
}

const assemblies = readdirSync(generatedBase, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (assemblies.length === 0) {
  console.error("No assemblies found in generated directory.");
  process.exit(1);
}

/** Derive package name from config: @entur/netex-model-VERSION-BRANCH-ASSEMBLY */
function packageName(assembly: string): string {
  return `@entur/netex-model-${config.netex.version}-${config.netex.branch}-${assembly}`;
}

/** Build an assembly-specific README describing the generated output. */
function buildReadme(assembly: string, interfacesDir: string): string {
  const lines: string[] = [
    `# NeTEx TypeScript Interfaces — \`${assembly}\``,
    "",
    `Generated from [NeTEx](https://github.com/NeTEx-CEN/NeTEx) XSD schemas (version ${config.netex.version}, branch \`${config.netex.branch}\`).`,
    "",
  ];

  // List the module files in this assembly
  const tsFiles = readdirSync(interfacesDir)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "netex.ts")
    .sort();

  if (tsFiles.length > 0) {
    lines.push("## Modules", "");
    lines.push("| Module | Description |");
    lines.push("|--------|-------------|");
    for (const f of tsFiles) {
      const name = f.replace(".ts", "");
      const lineCount = readFileSync(join(interfacesDir, f), "utf-8").split("\n").length;
      lines.push(`| \`${name}\` | ${lineCount} lines |`);
    }
    lines.push("");
  }

  lines.push("## Usage", "");
  lines.push("```typescript");
  lines.push(`// Import everything`);
  const pkg = packageName(assembly);
  lines.push(`import type { PublicationDeliveryStructure } from '${pkg}';`);
  lines.push("");
  lines.push("// Import from a specific module");
  if (tsFiles.length > 0) {
    const example = tsFiles[0].replace(".ts", "");
    lines.push(
      `import type { ... } from '${pkg}/interfaces/${example}.js';`,
    );
  }
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

let generated = 0;

for (const assembly of assemblies) {
  const interfacesDir = join(generatedBase, assembly, "interfaces");
  const indexFile = join(interfacesDir, "index.ts");
  if (!existsSync(indexFile)) {
    // Fall back to monolithic netex.ts
    if (!existsSync(join(interfacesDir, "netex.ts"))) {
      console.log(`  Skipping ${assembly} — no interfaces found`);
      continue;
    }
  }

  const outDir = join(generatedBase, assembly, "docs");
  console.log(`Generating docs for '${assembly}'...`);

  // Collect entry points: all split .ts files (excluding netex.ts monolith and index.ts)
  const entryPoints = readdirSync(interfacesDir)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "netex.ts")
    .map((f) => join(interfacesDir, f));

  // Fall back to netex.ts if no split files
  if (entryPoints.length === 0) {
    entryPoints.push(join(interfacesDir, "netex.ts"));
  }

  // Write assembly-specific README
  const readmePath = join(generatedBase, assembly, "README.md");
  writeFileSync(readmePath, buildReadme(assembly, interfacesDir));

  try {
    execSync(
      [
        "npx typedoc",
        ...entryPoints.map((ep) => `--entryPoints ${ep}`),
        `--out ${outDir}`,
        `--readme ${readmePath}`,
        `--name "${packageName(assembly)}"`,
        "--skipErrorChecking",
      ].join(" "),
      { cwd: configDir, stdio: "pipe" },
    );
    console.log(`  Written to ${outDir}`);
    generated++;
  } catch (e: any) {
    const stderr = e.stderr?.toString() || "";
    const stdout = e.stdout?.toString() || "";
    console.error(`  TypeDoc failed for '${assembly}':`);
    if (stderr) console.error(`  ${stderr.trim().split("\n").join("\n  ")}`);
    if (stdout) console.error(`  ${stdout.trim().split("\n").join("\n  ")}`);
  }
}

console.log(`\nGenerated docs for ${generated}/${assemblies.length} assembly(ies).`);
