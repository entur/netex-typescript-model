/**
 * Assembles a docs-site/ directory for GitHub Pages deployment.
 *
 * 1. Copies each assembly's TypeDoc output into docs-site/<assembly>/
 * 2. Generates a welcome index.html listing all assemblies with descriptions.
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

// Descriptions for each assembly, derived from config parts
const ASSEMBLY_DESCRIPTIONS: Record<string, string> = {
  base: "Framework types, SIRI, GML, and service definitions — the required foundation for all NeTEx profiles.",
  network:
    "Part 1 — Network topology: routes, lines, stop places, scheduled stop points, timing patterns.",
  timetable:
    "Part 2 — Timetables: service journeys, vehicle services, dated calls, passing times.",
  fares:
    "Part 3 — Fares: fare products, pricing, distribution, sales transactions.",
  "new-modes":
    "Part 5 — New modes: mobility services, vehicle meeting points, shared mobility.",
};

interface AssemblyInfo {
  name: string;
  description: string;
  moduleCount: number;
  definitionCount: number;
  hasSchemaHtml: boolean;
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

  // Count definitions from JSON Schema
  let definitionCount = 0;
  const assemblyDir = join(generatedBase, entry.name);
  const schemaFile = readdirSync(assemblyDir).find((f) => f.endsWith(".schema.json"));
  if (schemaFile) {
    try {
      const schema = JSON.parse(readFileSync(join(assemblyDir, schemaFile), "utf-8"));
      definitionCount = Object.keys(schema.definitions ?? {}).length;
    } catch {
      // ignore parse errors
    }
  }

  assemblies.push({
    name: entry.name,
    description: ASSEMBLY_DESCRIPTIONS[entry.name] ?? "",
    moduleCount,
    definitionCount,
    hasSchemaHtml: false,
  });
}

if (assemblies.length === 0) {
  console.error("No assembly docs found. Run 'npm run docs' first.");
  process.exit(1);
}

// Sort: base first, then alphabetically
assemblies.sort((a, b) => {
  if (a.name === "base") return -1;
  if (b.name === "base") return 1;
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
    const stats = [
      s.definitionCount > 0 ? `${s.definitionCount.toLocaleString()} types` : "",
      s.moduleCount > 0 ? `${s.moduleCount} modules` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const schemaLink = s.hasSchemaHtml
      ? `<a href="./${s.name}/netex-schema.html" class="card-link">JSON Schema</a>`
      : "";

    return `      <div class="card">
        <h2>${s.name}</h2>
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
    @media (prefers-color-scheme: dark) {
      .chip-experimental {
        color: #ffb74d;
        background: rgba(255,167,38,0.12);
        border-color: rgba(255,167,38,0.3);
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
