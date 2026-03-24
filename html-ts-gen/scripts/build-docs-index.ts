/**
 * Assembles a docs-site/ directory for GitHub Pages deployment.
 *
 * 1. Copies each assembly's TypeDoc output into docs-site/<assembly>/
 * 2. Generates a welcome index.html listing all assemblies with descriptions.
 *
 * Descriptions and metadata are derived from root-level stamps in each
 * assembly's JSON Schema file (x-netex-assembly, x-netex-sub-graph-root,
 * x-netex-collapsed) and from assembly-config.json part descriptions.
 *
 * Usage: npx tsx scripts/build-docs-index.ts
 */

import {
  readdirSync,
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";

const CONFIG_PATH = resolve(import.meta.dirname, "../../assembly-config.json");
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
const configDir = dirname(CONFIG_PATH);
const generatedBase = resolve(configDir, config.paths.generated);
const siteDir = resolve(configDir, "docs-site");

// Natural names for config part keys (same as xsd-to-jsonschema.js)
const NATURAL_NAMES: Record<string, string> = {
  part1_network: "network",
  part2_timetable: "timetable",
  part3_fares: "fares",
  part5_new_modes: "new-modes",
};

// Reverse: natural name → config key
const REVERSE_NAMES: Record<string, string> = {};
for (const [key, name] of Object.entries(NATURAL_NAMES)) {
  REVERSE_NAMES[name] = key;
}

/** Build a description from the assembly name by looking up config parts. */
function describeAssembly(assemblyName: string): string {
  if (assemblyName === "base") {
    return "Framework types, SIRI, GML, and service definitions — the required foundation for all NeTEx profiles.";
  }
  const partNames = assemblyName.split("+");
  const descriptions: string[] = [];
  for (const name of partNames) {
    const configKey = REVERSE_NAMES[name] ?? name;
    const part = config.parts[configKey];
    if (part?.description) {
      descriptions.push(part.description);
    }
  }
  if (descriptions.length > 0) return descriptions.join(" ");
  return "";
}

interface SchemaStamps {
  assembly: string;
  subGraphRoot: string | null;
  collapsed: number | null;
  rootDescription: string | null;
}

/** Extract root-level stamps and root definition description from a schema. */
function extractSchemaStamps(schemaPath: string): SchemaStamps | null {
  try {
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    const assembly = schema["x-netex-assembly"] ?? "";
    const subGraphRoot = schema["x-netex-sub-graph-root"] ?? null;
    const collapsed = schema["x-netex-collapsed"] ?? null;

    let rootDescription: string | null = null;
    if (subGraphRoot && schema.definitions?.[subGraphRoot]) {
      rootDescription = schema.definitions[subGraphRoot].description ?? null;
    }

    return { assembly, subGraphRoot, collapsed, rootDescription };
  } catch {
    return null;
  }
}

interface AssemblyInfo {
  name: string;
  description: string;
  moduleCount: number;
  definitionCount: number;
  hasSchemaHtml: boolean;
  stamps: SchemaStamps | null;
}

// Discover assemblies that have docs/ output
const assemblies: AssemblyInfo[] = [];

if (!existsSync(generatedBase)) {
  console.error(`Generated directory not found: ${generatedBase}`);
  process.exit(1);
}

for (const entry of readdirSync(generatedBase, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const docsDir = join(generatedBase, entry.name, "docs");
  if (!existsSync(docsDir)) continue;

  // Count modules from the interfaces dir
  const interfacesDir = join(generatedBase, entry.name, "interfaces");
  let moduleCount = 0;
  if (existsSync(interfacesDir)) {
    moduleCount = readdirSync(interfacesDir).filter(
      (f) => f.endsWith(".ts") && f !== "index.ts" && f !== "netex.ts",
    ).length;
  }

  // Find schema file and extract stamps + definition count
  const assemblyDir = join(generatedBase, entry.name);
  const schemaFile = readdirSync(assemblyDir).find((f) => f.endsWith(".schema.json"));
  let definitionCount = 0;
  let stamps: SchemaStamps | null = null;

  if (schemaFile) {
    const schemaPath = join(assemblyDir, schemaFile);
    stamps = extractSchemaStamps(schemaPath);
    try {
      const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
      definitionCount = Object.keys(schema.definitions ?? {}).length;
    } catch {
      // ignore parse errors
    }
  }

  // Build description: sub-graph → root definition description, else → config parts
  let description: string;
  if (stamps?.subGraphRoot && stamps.rootDescription) {
    description = stamps.rootDescription;
  } else if (stamps?.assembly) {
    description = describeAssembly(stamps.assembly);
  } else {
    description = describeAssembly(entry.name);
  }

  assemblies.push({
    name: entry.name,
    description,
    moduleCount,
    definitionCount,
    hasSchemaHtml: false,
    stamps,
  });
}

if (assemblies.length === 0) {
  console.error("No assembly docs found. Run 'npm run docs' first.");
  process.exit(1);
}

// Sort: base first, then full assemblies, then sub-graphs alphabetically
assemblies.sort((a, b) => {
  if (a.name === "base") return -1;
  if (b.name === "base") return 1;
  const aIsSub = a.stamps?.subGraphRoot != null;
  const bIsSub = b.stamps?.subGraphRoot != null;
  if (aIsSub !== bIsSub) return aIsSub ? 1 : -1;
  return a.name.localeCompare(b.name);
});

// Create site directory and copy each assembly's docs
mkdirSync(siteDir, { recursive: true });

for (const asm of assemblies) {
  const src = join(generatedBase, asm.name, "docs");
  const dest = join(siteDir, asm.name);
  cpSync(src, dest, { recursive: true });
  console.log(`  Copied ${asm.name}/docs → docs-site/${asm.name}/`);

  // Copy schema HTML if it exists
  const schemaHtml = join(generatedBase, asm.name, "netex-schema.html");
  if (existsSync(schemaHtml)) {
    cpSync(schemaHtml, join(dest, "netex-schema.html"));
    asm.hasSchemaHtml = true;
    console.log(`  Copied ${asm.name}/netex-schema.html → docs-site/${asm.name}/`);
  }
}

// Build index.html
const version = config.netex.version;
const branch = config.netex.branch;

const assemblyCards = assemblies
  .map((s) => {
    const statParts: string[] = [];
    if (s.definitionCount > 0) statParts.push(`${s.definitionCount.toLocaleString()} types`);
    if (s.moduleCount > 0) statParts.push(`${s.moduleCount} modules`);
    if (s.stamps?.collapsed != null) statParts.push(`${s.stamps.collapsed} collapsed`);
    const stats = statParts.join(" · ");

    const schemaLink = s.hasSchemaHtml
      ? `<a href="./${s.name}/netex-schema.html" class="card-link">JSON Schema</a>`
      : "";

    // Chips for sub-graph and collapsed
    let chips = "";
    if (s.stamps?.subGraphRoot) {
      chips += `<span class="chip-subgraph">sub-graph: ${s.stamps.subGraphRoot}</span>`;
    }
    if (s.stamps?.collapsed != null) {
      chips += `<span class="chip-collapsed">collapsed</span>`;
    }

    return `      <div class="card">
        <h2>${s.name}${chips}</h2>
        <p>${s.description}</p>
        ${stats ? `<span class="stats">${stats}</span>` : ""}
        <div class="card-links">
          <a href="./${s.name}/" class="card-link">TypeDoc</a>
          ${schemaLink}
        </div>
      </div>`;
  })
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NeTEx TypeScript Model — API Docs</title>
  <style>
    :root {
      --bg: #fafafa;
      --fg: #1a1a1a;
      --card-bg: #fff;
      --card-border: #e0e0e0;
      --card-hover: #f0f4ff;
      --accent: #2563eb;
      --muted: #666;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111;
        --fg: #e0e0e0;
        --card-bg: #1a1a1a;
        --card-border: #333;
        --card-hover: #1e293b;
        --accent: #60a5fa;
        --muted: #999;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      padding: 2rem;
      max-width: 54rem;
      margin: 0 auto;
    }
    header { margin-bottom: 2.5rem; }
    h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.25rem; }
    .subtitle { color: var(--muted); font-size: 0.95rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: 1rem;
    }
    .card {
      display: flex;
      flex-direction: column;
      color: inherit;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 1.25rem;
      transition: border-color 0.15s;
    }
    .card:hover {
      border-color: var(--accent);
    }
    .card-links {
      display: flex;
      gap: 0.75rem;
      margin-top: auto;
      padding-top: 0.75rem;
    }
    .card-link {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--accent);
      text-decoration: none;
    }
    .card-link:hover {
      text-decoration: underline;
    }
    .card h2 {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 0.4rem;
      font-family: ui-monospace, monospace;
      color: var(--accent);
    }
    .card p {
      font-size: 0.875rem;
      color: var(--muted);
      margin-bottom: 0.5rem;
    }
    .stats {
      font-size: 0.8rem;
      color: var(--muted);
      opacity: 0.8;
    }
    .chip-experimental {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: #e65100;
      background: #fff3e0;
      border: 1px solid #ffcc80;
      border-radius: 1rem;
      padding: 0.15rem 0.65rem;
      margin-left: 0.5rem;
      vertical-align: middle;
    }
    .chip-subgraph {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 500;
      color: #1565c0;
      background: #e3f2fd;
      border: 1px solid #90caf9;
      border-radius: 1rem;
      padding: 0.1rem 0.55rem;
      margin-left: 0.4rem;
      vertical-align: middle;
      font-family: system-ui, sans-serif;
    }
    .chip-collapsed {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 500;
      color: #2e7d32;
      background: #e8f5e9;
      border: 1px solid #a5d6a7;
      border-radius: 1rem;
      padding: 0.1rem 0.55rem;
      margin-left: 0.4rem;
      vertical-align: middle;
      font-family: system-ui, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      .chip-experimental {
        color: #ffb74d;
        background: rgba(255,167,38,0.12);
        border-color: rgba(255,167,38,0.3);
      }
      .chip-subgraph {
        color: #90caf9;
        background: rgba(33,150,243,0.12);
        border-color: rgba(33,150,243,0.3);
      }
      .chip-collapsed {
        color: #81c784;
        background: rgba(76,175,80,0.12);
        border-color: rgba(76,175,80,0.3);
      }
    }
    footer {
      margin-top: 3rem;
      font-size: 0.8rem;
      color: var(--muted);
    }
    footer a { color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <h1>NeTEx TypeScript Model <span class="chip-experimental">EXPERIMENTAL</span></h1>
    <p class="subtitle">Generated from <a href="https://github.com/NeTEx-CEN/NeTEx">NeTEx</a> XSD v${version} (branch <code>${branch}</code>)</p>
  </header>

  <main>
    <div class="grid">
${assemblyCards}
    </div>
  </main>

  <footer>
    <p>Generated by <a href="https://github.com/entur/netex-typescript-model">@entur/netex-typescript-model</a></p>
  </footer>
</body>
</html>
`;

writeFileSync(join(siteDir, "index.html"), html);
console.log(`\nWrote docs-site/index.html with ${assemblies.length} assembly(ies).`);
