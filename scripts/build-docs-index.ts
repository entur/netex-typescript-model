/**
 * Assembles a docs-site/ directory for GitHub Pages deployment.
 *
 * 1. Copies each slug's TypeDoc output into docs-site/<slug>/
 * 2. Generates a welcome index.html listing all slugs with descriptions.
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
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(resolve(ROOT, "inputs/config.json"), "utf-8"));
const generatedBase = resolve(ROOT, config.paths.generated);
const siteDir = resolve(ROOT, "docs-site");

// Descriptions for each slug, derived from config parts
const SLUG_DESCRIPTIONS: Record<string, string> = {
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

interface SlugInfo {
  name: string;
  description: string;
  moduleCount: number;
  definitionCount: number;
}

// Discover slugs that have docs/ output
const slugs: SlugInfo[] = [];

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
  const schemaPath = join(generatedBase, entry.name, "jsonschema", "netex.json");
  if (existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
      definitionCount = Object.keys(schema.definitions ?? {}).length;
    } catch {
      // ignore parse errors
    }
  }

  slugs.push({
    name: entry.name,
    description: SLUG_DESCRIPTIONS[entry.name] ?? "",
    moduleCount,
    definitionCount,
  });
}

if (slugs.length === 0) {
  console.error("No slug docs found. Run 'npm run docs' first.");
  process.exit(1);
}

// Sort: base first, then alphabetically
slugs.sort((a, b) => {
  if (a.name === "base") return -1;
  if (b.name === "base") return 1;
  return a.name.localeCompare(b.name);
});

// Create site directory and copy each slug's docs
mkdirSync(siteDir, { recursive: true });

for (const slug of slugs) {
  const src = join(generatedBase, slug.name, "docs");
  const dest = join(siteDir, slug.name);
  cpSync(src, dest, { recursive: true });
  console.log(`  Copied ${slug.name}/docs → docs-site/${slug.name}/`);
}

// Build index.html
const version = config.netex.version;
const branch = config.netex.branch;

const slugCards = slugs
  .map((s) => {
    const stats = [
      s.definitionCount > 0 ? `${s.definitionCount.toLocaleString()} types` : "",
      s.moduleCount > 0 ? `${s.moduleCount} modules` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return `      <a href="./${s.name}/" class="card">
        <h2>${s.name}</h2>
        <p>${s.description}</p>
        ${stats ? `<span class="stats">${stats}</span>` : ""}
      </a>`;
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
      display: block;
      text-decoration: none;
      color: inherit;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 1.25rem;
      transition: background 0.15s, border-color 0.15s;
    }
    .card:hover {
      background: var(--card-hover);
      border-color: var(--accent);
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
    <h1>NeTEx TypeScript Model</h1>
    <p class="subtitle">Generated from <a href="https://github.com/NeTEx-CEN/NeTEx">NeTEx</a> XSD v${version} (branch <code>${branch}</code>)</p>
  </header>

  <main>
    <div class="grid">
${slugCards}
    </div>
  </main>

  <footer>
    <p>Generated by <a href="https://github.com/entur/netex-typescript-model">@entur/netex-typescript-model</a></p>
  </footer>
</body>
</html>
`;

writeFileSync(join(siteDir, "index.html"), html);
console.log(`\nWrote docs-site/index.html with ${slugs.length} slug(s).`);
