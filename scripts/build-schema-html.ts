/**
 * Generates a self-contained HTML page per slug from the JSON Schema.
 *
 * For each slug in src/generated/<slug>/jsonschema/netex.json, produces
 * src/generated/<slug>/netex-schema.html with:
 * - Sidebar with alphabetical definition index and search/filter
 * - Per-definition sections with permalink anchors
 * - Pretty-printed JSON with syntax highlighting and clickable $ref links
 * - Dark/light mode support
 * - Responsive layout (sidebar collapses on mobile)
 *
 * Usage: npx tsx scripts/build-schema-html.ts
 */

import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(resolve(ROOT, "inputs/config.json"), "utf-8"));
const generatedBase = resolve(ROOT, config.paths.generated);

if (!existsSync(generatedBase)) {
  console.error(`Generated directory not found: ${generatedBase}`);
  process.exit(1);
}

let built = 0;

for (const entry of readdirSync(generatedBase, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const schemaPath = join(generatedBase, entry.name, "jsonschema", "netex.json");
  if (!existsSync(schemaPath)) continue;

  const slug = entry.name;
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  const defs = schema.definitions ?? {};
  const defNames = Object.keys(defs).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  if (defNames.length === 0) {
    console.log(`  ${slug}: no definitions, skipping`);
    continue;
  }

  const html = buildHtml(slug, defs, defNames, config.netex.version);
  const outPath = join(generatedBase, slug, "netex-schema.html");
  writeFileSync(outPath, html);
  console.log(`  ${slug}: ${defNames.length} definitions → netex-schema.html`);
  built++;
}

if (built === 0) {
  console.error("No JSON Schema files found. Run 'npm run generate' first.");
  process.exit(1);
}

console.log(`\nBuilt ${built} schema HTML page(s).`);

// ── HTML builder ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Pretty-print a JSON value with syntax highlighting and clickable $ref links.
 * Returns an HTML string meant for use inside a <pre><code>.
 */
function highlightJson(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (obj === null) return `<span class="jv-null">null</span>`;
  if (typeof obj === "boolean") return `<span class="jv-bool">${obj}</span>`;
  if (typeof obj === "number") return `<span class="jv-num">${obj}</span>`;

  if (typeof obj === "string") {
    const escaped = escapeHtml(obj);
    // Render $ref targets as clickable links
    const refMatch = obj.match(/^#\/definitions\/(.+)$/);
    if (refMatch) {
      const target = escapeHtml(refMatch[1]);
      return `<span class="jv-str">"<a href="#${target}" class="ref-link">${escaped}</a>"</span>`;
    }
    return `<span class="jv-str">"${escaped}"</span>`;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    const items = obj.map((v) => `${pad}  ${highlightJson(v, indent + 1)}`);
    return `[\n${items.join(",\n")}\n${pad}]`;
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([k, v]) => {
      const key = `<span class="jv-key">"${escapeHtml(k)}"</span>`;
      // If key is "$ref", make the value a link
      if (k === "$ref" && typeof v === "string") {
        return `${pad}  ${key}: ${highlightJson(v, indent + 1)}`;
      }
      return `${pad}  ${key}: ${highlightJson(v, indent + 1)}`;
    });
    return `{\n${lines.join(",\n")}\n${pad}}`;
  }

  return escapeHtml(String(obj));
}

function buildSidebarItems(defNames: string[]): string {
  return defNames
    .map((name) => `        <li><a href="#${escapeHtml(name)}" class="sidebar-link" data-name="${escapeHtml(name.toLowerCase())}">${escapeHtml(name)}</a></li>`)
    .join("\n");
}

function buildDefinitionSections(defs: Record<string, unknown>, defNames: string[]): string {
  return defNames
    .map((name) => {
      const def = defs[name] as Record<string, unknown>;
      const desc = typeof def.description === "string" ? def.description : "";
      // Show the definition without the top-level description (it's shown separately)
      const displayDef = { ...def };
      delete displayDef.description;
      const jsonHtml = highlightJson(displayDef);

      return `    <section id="${escapeHtml(name)}" class="def-section">
      <h2><a href="#${escapeHtml(name)}" class="permalink">#</a> ${escapeHtml(name)}<button class="explore-btn" data-def="${escapeHtml(name)}" title="Explore type hierarchy">Explore</button></h2>
      ${desc ? `<p class="def-desc">${escapeHtml(desc)}</p>` : ""}
      <pre><code>${jsonHtml}</code></pre>
    </section>`;
    })
    .join("\n\n");
}

function buildHtml(
  slug: string,
  defs: Record<string, unknown>,
  defNames: string[],
  version: string,
): string {
  const sidebarItems = buildSidebarItems(defNames);
  const sections = buildDefinitionSections(defs, defNames);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NeTEx JSON Schema — ${escapeHtml(slug)}</title>
  <style>
    :root {
      --bg: #fafafa;
      --fg: #1a1a1a;
      --sidebar-bg: #f0f0f0;
      --sidebar-border: #ddd;
      --card-bg: #fff;
      --card-border: #e0e0e0;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --muted: #666;
      --code-bg: #f5f5f5;
      --key-color: #0550ae;
      --str-color: #0a3069;
      --num-color: #0550ae;
      --bool-color: #cf222e;
      --null-color: #cf222e;
      --link-color: #2563eb;
      --search-bg: #fff;
      --search-border: #ccc;
      --highlight-bg: #fef3c7;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111;
        --fg: #e0e0e0;
        --sidebar-bg: #1a1a1a;
        --sidebar-border: #333;
        --card-bg: #1e1e1e;
        --card-border: #333;
        --accent: #60a5fa;
        --accent-hover: #93bbfd;
        --muted: #999;
        --code-bg: #161616;
        --key-color: #79c0ff;
        --str-color: #a5d6ff;
        --num-color: #79c0ff;
        --bool-color: #ff7b72;
        --null-color: #ff7b72;
        --link-color: #60a5fa;
        --search-bg: #222;
        --search-border: #444;
        --highlight-bg: #3b2e00;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; scroll-padding-top: 1rem; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      width: 280px;
      min-width: 280px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--sidebar-border);
      padding: 1rem;
      overflow-y: auto;
      position: sticky;
      top: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .sidebar h1 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .sidebar .subtitle {
      font-size: 0.8rem;
      color: var(--muted);
      margin-bottom: 0.75rem;
    }
    .search-box {
      width: 100%;
      padding: 0.4rem 0.6rem;
      font-size: 0.85rem;
      border: 1px solid var(--search-border);
      border-radius: 0.25rem;
      background: var(--search-bg);
      color: var(--fg);
      margin-bottom: 0.5rem;
    }
    .search-box:focus { outline: 2px solid var(--accent); border-color: transparent; }
    .sidebar-count {
      font-size: 0.75rem;
      color: var(--muted);
      margin-bottom: 0.5rem;
    }
    .sidebar-list {
      list-style: none;
      overflow-y: auto;
      flex: 1;
    }
    .sidebar-list li { margin: 0; }
    .sidebar-link {
      display: block;
      padding: 0.15rem 0.4rem;
      font-size: 0.8rem;
      font-family: ui-monospace, monospace;
      color: var(--fg);
      text-decoration: none;
      border-radius: 0.2rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sidebar-link:hover { background: var(--card-border); }
    .sidebar-link.active { background: var(--accent); color: #fff; }
    .sidebar-link.hidden { display: none; }

    /* Main content */
    main {
      flex: 1;
      padding: 1.5rem 2rem;
      max-width: 64rem;
      min-width: 0;
    }
    .def-section {
      margin-bottom: 2rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 1.25rem;
    }
    .def-section:target {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .def-section h2 {
      font-size: 1.1rem;
      font-weight: 600;
      font-family: ui-monospace, monospace;
      margin-bottom: 0.5rem;
    }
    .permalink {
      color: var(--muted);
      text-decoration: none;
      margin-right: 0.25rem;
    }
    .permalink:hover { color: var(--accent); }
    .def-desc {
      font-size: 0.9rem;
      color: var(--muted);
      margin-bottom: 0.75rem;
      max-width: 60rem;
    }
    pre {
      background: var(--code-bg);
      border-radius: 0.35rem;
      padding: 0.75rem 1rem;
      overflow-x: auto;
      font-size: 0.8rem;
      line-height: 1.5;
    }
    code { font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace; }
    .jv-key { color: var(--key-color); }
    .jv-str { color: var(--str-color); }
    .jv-num { color: var(--num-color); }
    .jv-bool { color: var(--bool-color); }
    .jv-null { color: var(--null-color); font-style: italic; }
    .ref-link { color: var(--link-color); text-decoration: underline; text-decoration-style: dotted; }
    .ref-link:hover { text-decoration-style: solid; }

    /* Mobile: collapse sidebar */
    .sidebar-toggle { display: none; }
    @media (max-width: 768px) {
      .sidebar {
        position: fixed;
        left: -280px;
        z-index: 10;
        transition: left 0.2s;
      }
      .sidebar.open { left: 0; }
      .sidebar-toggle {
        display: block;
        position: fixed;
        top: 0.5rem;
        left: 0.5rem;
        z-index: 11;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 0.25rem;
        padding: 0.3rem 0.6rem;
        font-size: 0.85rem;
        cursor: pointer;
      }
      main { padding: 1rem; padding-top: 2.5rem; }
      .explore-btn { display: none; }
    }

    /* Explore button */
    .explore-btn {
      float: right;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 0.25rem;
      padding: 0.15rem 0.5rem;
      font-size: 0.75rem;
      cursor: pointer;
      font-family: system-ui, sans-serif;
      font-weight: 500;
    }
    .explore-btn:hover { background: var(--accent-hover); }

    /* Explorer panel */
    .explorer-panel {
      width: 0;
      overflow: hidden;
      transition: width 0.2s, min-width 0.2s, padding 0.2s;
      border-left: 1px solid var(--sidebar-border);
      background: var(--sidebar-bg);
      position: sticky;
      top: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 0;
      min-width: 0;
    }
    body.explorer-open .explorer-panel {
      width: 380px;
      min-width: 380px;
      padding: 1rem;
      overflow-y: auto;
    }
    .explorer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.25rem;
    }
    .explorer-header h2 {
      font-size: 1rem;
      font-family: ui-monospace, monospace;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .explorer-close {
      background: none;
      border: none;
      font-size: 1.4rem;
      cursor: pointer;
      color: var(--muted);
      padding: 0 0.25rem;
      line-height: 1;
    }
    .explorer-close:hover { color: var(--fg); }
    .explorer-subtitle {
      font-size: 0.75rem;
      color: var(--muted);
      margin-bottom: 0.75rem;
    }
    .explorer-body { flex: 1; min-height: 0; }
    .origin-group { margin-bottom: 0.75rem; }
    .origin-heading {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--accent);
      font-family: ui-monospace, monospace;
      padding: 0.25rem 0;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 0.25rem;
    }
    .origin-heading a {
      color: inherit;
      text-decoration: none;
    }
    .origin-heading a:hover { text-decoration: underline; }
    .prop-row {
      padding: 0.3rem 0.4rem;
      border-radius: 0.2rem;
      font-size: 0.8rem;
    }
    .prop-row:nth-child(even) { background: var(--code-bg); }
    .prop-name {
      font-family: ui-monospace, monospace;
      font-weight: 600;
      color: var(--fg);
    }
    .prop-type {
      font-family: ui-monospace, monospace;
      color: var(--accent);
      font-size: 0.75rem;
    }
    .prop-type a { color: inherit; text-decoration: underline dotted; }
    .prop-type a:hover { text-decoration-style: solid; }
    .prop-pdesc {
      font-size: 0.7rem;
      color: var(--muted);
      margin-top: 0.1rem;
    }
  </style>
</head>
<body>
  <button class="sidebar-toggle" id="sidebarToggle">Definitions</button>

  <nav class="sidebar" id="sidebar">
    <h1>NeTEx JSON Schema</h1>
    <p class="subtitle">${escapeHtml(slug)} · v${escapeHtml(version)}</p>
    <input type="text" class="search-box" id="search" placeholder="Filter definitions…" autocomplete="off">
    <p class="sidebar-count"><span id="visibleCount">${defNames.length}</span> / ${defNames.length} definitions</p>
    <ul class="sidebar-list" id="sidebarList">
${sidebarItems}
    </ul>
  </nav>

  <main id="main">
${sections}
  </main>

  <aside class="explorer-panel" id="explorerPanel">
    <div class="explorer-header">
      <h2 id="explorerTitle"></h2>
      <button class="explorer-close" id="explorerClose">&times;</button>
    </div>
    <p class="explorer-subtitle" id="explorerSubtitle"></p>
    <div class="explorer-body" id="explorerBody"></div>
  </aside>

  <script id="schema-data" type="application/json">${JSON.stringify(defs)}</script>

  <script>
    // Search / filter
    const search = document.getElementById('search');
    const links = document.querySelectorAll('.sidebar-link');
    const visibleCount = document.getElementById('visibleCount');
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      let count = 0;
      links.forEach(a => {
        const match = !q || a.dataset.name.includes(q);
        a.classList.toggle('hidden', !match);
        if (match) count++;
      });
      visibleCount.textContent = count;
    });

    // Highlight active on scroll
    const sections = document.querySelectorAll('.def-section');
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          links.forEach(a => a.classList.remove('active'));
          const id = e.target.id;
          const link = document.querySelector('.sidebar-link[href="#' + CSS.escape(id) + '"]');
          if (link) {
            link.classList.add('active');
            link.scrollIntoView({ block: 'nearest' });
          }
        }
      }
    }, { rootMargin: '-10% 0px -80% 0px' });
    sections.forEach(s => observer.observe(s));

    // Mobile sidebar toggle
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    sidebar.addEventListener('click', e => {
      if (e.target.classList.contains('sidebar-link')) sidebar.classList.remove('open');
    });

    // Explorer panel
    const defs = JSON.parse(document.getElementById('schema-data').textContent);
    const explorerPanel = document.getElementById('explorerPanel');
    const explorerTitle = document.getElementById('explorerTitle');
    const explorerSubtitle = document.getElementById('explorerSubtitle');
    const explorerBody = document.getElementById('explorerBody');
    let currentExplored = null;

    function resolveType(prop) {
      if (!prop || typeof prop !== 'object') return 'unknown';
      if (prop.$ref) return prop.$ref.replace('#/definitions/', '');
      if (prop.allOf) {
        for (const entry of prop.allOf) {
          if (entry.$ref) return entry.$ref.replace('#/definitions/', '');
        }
      }
      if (prop.enum) return prop.enum.join(' | ');
      if (prop.type === 'array' && prop.items) {
        if (prop.items.$ref) return prop.items.$ref.replace('#/definitions/', '') + '[]';
        return (prop.items.type || 'any') + '[]';
      }
      if (prop.type) return Array.isArray(prop.type) ? prop.type.join(' | ') : prop.type;
      return 'object';
    }

    function isRefType(prop) {
      if (!prop || typeof prop !== 'object') return false;
      if (prop.$ref) return true;
      if (prop.allOf) return prop.allOf.some(e => e.$ref);
      if (prop.type === 'array' && prop.items && prop.items.$ref) return true;
      return false;
    }

    function refTarget(prop) {
      if (prop.$ref) return prop.$ref.replace('#/definitions/', '');
      if (prop.allOf) {
        for (const e of prop.allOf) { if (e.$ref) return e.$ref.replace('#/definitions/', ''); }
      }
      if (prop.type === 'array' && prop.items && prop.items.$ref)
        return prop.items.$ref.replace('#/definitions/', '');
      return null;
    }

    function flattenAllOf(defsMap, name) {
      const results = [];
      const visited = new Set();
      function walk(n) {
        if (visited.has(n)) return;
        visited.add(n);
        const def = defsMap[n];
        if (!def) return;
        // Follow $ref alias (e.g. VehicleType -> VehicleType_VersionStructure)
        if (def.$ref) {
          walk(def.$ref.replace('#/definitions/', ''));
          return;
        }
        // Process allOf entries (inheritance chain)
        if (def.allOf) {
          for (const entry of def.allOf) {
            if (entry.$ref) {
              walk(entry.$ref.replace('#/definitions/', ''));
            } else if (entry.properties) {
              for (const [pn, pv] of Object.entries(entry.properties)) {
                results.push({ prop: pn, type: resolveType(pv), desc: pv.description || '', origin: n, schema: pv });
              }
            }
          }
        }
        // Direct properties
        if (def.properties) {
          for (const [pn, pv] of Object.entries(def.properties)) {
            if (!results.some(r => r.prop === pn && r.origin === n)) {
              results.push({ prop: pn, type: resolveType(pv), desc: pv.description || '', origin: n, schema: pv });
            }
          }
        }
      }
      walk(name);
      return results;
    }

    function esc(s) {
      const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    }

    function renderExplorer(name) {
      const props = flattenAllOf(defs, name);
      explorerTitle.textContent = name;
      const origins = [...new Set(props.map(p => p.origin))];
      explorerSubtitle.textContent = props.length + ' properties from ' + origins.length + ' type' + (origins.length !== 1 ? 's' : '');

      let html = '';
      let lastOrigin = null;
      for (const p of props) {
        if (p.origin !== lastOrigin) {
          if (lastOrigin !== null) html += '</div>';
          html += '<div class="origin-group"><div class="origin-heading"><a href="#' + esc(p.origin) + '" class="explorer-type-link">' + esc(p.origin) + '</a></div>';
          lastOrigin = p.origin;
        }
        const typeHtml = isRefType(p.schema)
          ? '<a href="#' + esc(refTarget(p.schema)) + '" class="explorer-type-link">' + esc(p.type) + '</a>'
          : esc(p.type);
        html += '<div class="prop-row"><div class="prop-name">' + esc(p.prop) + ' <span class="prop-type">' + typeHtml + '</span></div>';
        if (p.desc) html += '<div class="prop-pdesc">' + esc(p.desc) + '</div>';
        html += '</div>';
      }
      if (lastOrigin !== null) html += '</div>';
      if (props.length === 0) html = '<p style="color:var(--muted);font-size:0.85rem;">No properties found.</p>';

      explorerBody.innerHTML = html;
      currentExplored = name;
    }

    document.addEventListener('click', e => {
      // Explore button click
      const btn = e.target.closest('.explore-btn');
      if (btn) {
        e.preventDefault();
        const name = btn.dataset.def;
        if (document.body.classList.contains('explorer-open') && currentExplored === name) {
          document.body.classList.remove('explorer-open');
          currentExplored = null;
        } else {
          renderExplorer(name);
          document.body.classList.add('explorer-open');
        }
        return;
      }
      // Type link click inside explorer panel
      const typeLink = e.target.closest('.explorer-type-link');
      if (typeLink && explorerPanel.contains(typeLink)) {
        const href = typeLink.getAttribute('href');
        if (href && href.startsWith('#')) {
          const targetName = decodeURIComponent(href.slice(1));
          if (defs[targetName]) {
            renderExplorer(targetName);
          }
        }
      }
    });

    document.getElementById('explorerClose').addEventListener('click', () => {
      document.body.classList.remove('explorer-open');
      currentExplored = null;
    });
  </script>
</body>
</html>`;
}
