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
      background: var(--sidebar-bg);
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
      background: var(--sidebar-bg);
      position: sticky;
      top: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 0;
    }
    body.explorer-open .explorer-panel {
      width: 380px;
      padding: 1rem;
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

    /* Explorer tabs */
    .explorer-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 0.75rem;
      flex-shrink: 0;
    }
    .explorer-tab {
      flex: 1;
      padding: 0.35rem 0;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--muted);
      cursor: pointer;
      font-family: system-ui, sans-serif;
    }
    .explorer-tab:hover { color: var(--fg); }
    .explorer-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
    .explorer-tab-content { display: none; flex: 1; min-height: 0; overflow-y: auto; }
    .explorer-tab-content.active { display: block; }
    .graph-container { width: 100%; }
    .graph-container svg { display: block; }
    .graph-node { cursor: pointer; }
    .graph-node:hover rect { opacity: 0.8; }

    /* Interface tab */
    .interface-block {
      position: relative;
      background: var(--code-bg);
      border-radius: 0.35rem;
      padding: 0.75rem 1rem;
      overflow-x: auto;
      font-size: 0.78rem;
      line-height: 1.6;
      font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace;
      white-space: pre;
    }
    .if-kw { color: var(--bool-color); font-weight: 600; }
    .if-prop { color: var(--fg); }
    .if-prim { color: var(--num-color); }
    .if-lit { color: var(--str-color); }
    .if-cmt { color: var(--muted); font-style: italic; }
    .if-ref { color: var(--link-color); text-decoration: underline dotted; cursor: pointer; }
    .if-ref:hover { text-decoration-style: solid; }
    .copy-btn {
      position: absolute;
      top: 0.4rem;
      right: 0.4rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.25rem;
      padding: 0.15rem 0.4rem;
      font-size: 0.7rem;
      cursor: pointer;
      color: var(--muted);
    }
    .copy-btn:hover { color: var(--fg); border-color: var(--accent); }

    /* Resize handles */
    .resize-handle {
      width: 4px;
      flex-shrink: 0;
      cursor: col-resize;
      background: var(--sidebar-border);
      position: sticky;
      top: 0;
      height: 100vh;
      z-index: 2;
    }
    .resize-handle:hover, .resize-handle.active {
      background: var(--accent);
    }
    #handle2 { display: none; }
    body.explorer-open #handle2 { display: block; }
    body.resizing { cursor: col-resize !important; }
    body.resizing * { user-select: none !important; pointer-events: none !important; }
    body.resizing .resize-handle { pointer-events: auto !important; }
    @media (max-width: 768px) {
      .resize-handle { display: none !important; }
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
  <div class="resize-handle" id="handle1"></div>

  <main id="main">
${sections}
  </main>
  <div class="resize-handle" id="handle2"></div>

  <aside class="explorer-panel" id="explorerPanel">
    <div class="explorer-header">
      <h2 id="explorerTitle"></h2>
      <button class="explorer-close" id="explorerClose">&times;</button>
    </div>
    <p class="explorer-subtitle" id="explorerSubtitle"></p>
    <div class="explorer-tabs">
      <button class="explorer-tab active" data-tab="props">Properties</button>
      <button class="explorer-tab" data-tab="graph">Graph</button>
      <button class="explorer-tab" data-tab="iface">Interface</button>
    </div>
    <div class="explorer-tab-content active" id="explorerProps"></div>
    <div class="explorer-tab-content" id="explorerGraph"><div class="graph-container" id="graphContainer"></div></div>
    <div class="explorer-tab-content" id="explorerIface"></div>
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
    const explorerProps = document.getElementById('explorerProps');
    const graphContainer = document.getElementById('graphContainer');
    let currentExplored = null;

    // Tab switching
    explorerPanel.addEventListener('click', e => {
      const tab = e.target.closest('.explorer-tab');
      if (!tab) return;
      explorerPanel.querySelectorAll('.explorer-tab').forEach(t => t.classList.remove('active'));
      explorerPanel.querySelectorAll('.explorer-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const tabMap = { props: 'explorerProps', graph: 'explorerGraph', iface: 'explorerIface' };
      document.getElementById(tabMap[tab.dataset.tab] || 'explorerProps').classList.add('active');
    });

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

      explorerProps.innerHTML = html;
      renderGraph(name);
      renderInterface(name);
      currentExplored = name;
    }

    // ── Graph tab ────────────────────────────────────────────────────────

    function buildInheritanceChain(defsMap, name) {
      const chain = [];
      const visited = new Set();
      function walk(n) {
        if (visited.has(n)) return;
        visited.add(n);
        const def = defsMap[n];
        if (!def) return;
        if (def.$ref) { walk(def.$ref.replace('#/definitions/', '')); return; }
        let parent = null;
        const ownProps = [];
        if (def.allOf) {
          for (const entry of def.allOf) {
            if (entry.$ref) parent = entry.$ref.replace('#/definitions/', '');
            else if (entry.properties) {
              for (const [k, v] of Object.entries(entry.properties)) ownProps.push({ name: k, schema: v });
            }
          }
        }
        if (def.properties) {
          for (const [k, v] of Object.entries(def.properties)) {
            if (!ownProps.some(p => p.name === k)) ownProps.push({ name: k, schema: v });
          }
        }
        if (parent) walk(parent);
        chain.push({ name: n, ownProps });
      }
      walk(name);
      return chain;
    }

    function renderGraph(name) {
      const chain = buildInheritanceChain(defs, name);
      if (chain.length === 0) {
        graphContainer.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;padding:0.5rem;">No inheritance chain.</p>';
        return;
      }

      const NODE_W = 200, NODE_H = 38, NODE_RX = 6;
      const GAP_Y = 28;
      const COMP_W = 130, COMP_H = 24, COMP_GAP_X = 28, COMP_GAP_Y = 4;
      const PAD = 14;
      const MAX_COMPS = 6;

      const rows = [];
      let totalH = PAD;
      let maxW = PAD + NODE_W + PAD;

      for (const node of chain) {
        const refs = node.ownProps
          .filter(p => isRefType(p.schema))
          .slice(0, MAX_COMPS)
          .map(p => ({ name: p.name, target: refTarget(p.schema), type: resolveType(p.schema) }));
        const compBlockH = refs.length > 0 ? refs.length * (COMP_H + COMP_GAP_Y) - COMP_GAP_Y : 0;
        const rowH = Math.max(NODE_H, compBlockH);
        rows.push({ ...node, refs, y: totalH + rowH / 2, rowH, compBlockH });
        totalH += rowH + GAP_Y;
        if (refs.length > 0) maxW = Math.max(maxW, PAD + NODE_W + COMP_GAP_X + COMP_W + PAD);
      }
      totalH = totalH - GAP_Y + PAD;

      const cs = getComputedStyle(document.documentElement);
      const accent = cs.getPropertyValue('--accent').trim();
      const fg = cs.getPropertyValue('--fg').trim();
      const muted = cs.getPropertyValue('--muted').trim();
      const cardBg = cs.getPropertyValue('--card-bg').trim();
      const cardBorder = cs.getPropertyValue('--card-border').trim();

      let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + maxW + '" height="' + totalH + '">';
      svg += '<defs><marker id="arrow" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">';
      svg += '<path d="M0,0 L10,3 L0,6 Z" fill="' + muted + '"/></marker></defs>';

      // Inheritance edges
      for (let i = 0; i < rows.length - 1; i++) {
        const x = PAD + NODE_W / 2;
        svg += '<line x1="' + x + '" y1="' + (rows[i].y + NODE_H / 2) + '" x2="' + x + '" y2="' + (rows[i + 1].y - NODE_H / 2) + '" stroke="' + muted + '" stroke-width="1.5" marker-end="url(#arrow)"/>';
      }

      // Composition edges
      for (const row of rows) {
        if (row.refs.length === 0) continue;
        const sx = PAD + NODE_W;
        const compStartY = row.y - row.compBlockH / 2;
        for (let j = 0; j < row.refs.length; j++) {
          const cy = compStartY + j * (COMP_H + COMP_GAP_Y) + COMP_H / 2;
          svg += '<line x1="' + sx + '" y1="' + row.y + '" x2="' + (PAD + NODE_W + COMP_GAP_X) + '" y2="' + cy + '" stroke="' + cardBorder + '" stroke-width="1" stroke-dasharray="4,3"/>';
        }
      }

      // Chain nodes
      for (const row of rows) {
        const isTarget = row.name === name;
        const fill = isTarget ? accent : cardBg;
        const textFill = isTarget ? '#fff' : fg;
        const stroke = isTarget ? accent : cardBorder;
        const ny = row.y - NODE_H / 2;
        const label = row.name.length > 26 ? row.name.slice(0, 24) + '\u2026' : row.name;

        svg += '<g class="graph-node" data-def="' + esc(row.name) + '">';
        svg += '<title>' + esc(row.name) + ' (' + row.ownProps.length + ' properties)</title>';
        svg += '<rect x="' + PAD + '" y="' + ny + '" width="' + NODE_W + '" height="' + NODE_H + '" rx="' + NODE_RX + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
        svg += '<text x="' + (PAD + NODE_W / 2) + '" y="' + (row.y + 1) + '" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace,monospace" font-size="11" font-weight="600" fill="' + textFill + '">' + esc(label) + '</text>';
        svg += '<text x="' + (PAD + NODE_W - 8) + '" y="' + (ny + 12) + '" text-anchor="end" font-family="system-ui,sans-serif" font-size="9" fill="' + (isTarget ? 'rgba(255,255,255,0.7)' : muted) + '">' + row.ownProps.length + 'p</text>';
        svg += '</g>';

        // Composition nodes
        const compStartY = row.y - row.compBlockH / 2;
        for (let j = 0; j < row.refs.length; j++) {
          const ref = row.refs[j];
          const cy = compStartY + j * (COMP_H + COMP_GAP_Y);
          const clabel = ref.name.length > 16 ? ref.name.slice(0, 14) + '\u2026' : ref.name;
          const hasDef = ref.target && defs[ref.target];
          svg += '<g' + (hasDef ? ' class="graph-node" data-def="' + esc(ref.target) + '"' : '') + '>';
          svg += '<title>' + esc(ref.name) + ': ' + esc(ref.type) + '</title>';
          svg += '<rect x="' + (PAD + NODE_W + COMP_GAP_X) + '" y="' + cy + '" width="' + COMP_W + '" height="' + COMP_H + '" rx="4" fill="' + cardBg + '" stroke="' + cardBorder + '" stroke-width="1" stroke-dasharray="3,2"/>';
          svg += '<text x="' + (PAD + NODE_W + COMP_GAP_X + 6) + '" y="' + (cy + COMP_H / 2 + 1) + '" dominant-baseline="middle" font-family="ui-monospace,monospace" font-size="10" fill="' + muted + '">' + esc(clabel) + '</text>';
          svg += '</g>';
        }
      }

      svg += '</svg>';
      graphContainer.innerHTML = svg;
    }

    // ── Interface tab ─────────────────────────────────────────────────

    function resolveLeafType(name, visited) {
      if (!visited) visited = new Set();
      if (visited.has(name)) return { ts: name, complex: true };
      visited.add(name);
      const def = defs[name];
      if (!def) return { ts: name, complex: true };

      // Pure $ref alias
      if (def.$ref) return resolveLeafType(def.$ref.replace('#/definitions/', ''), visited);

      // allOf with single $ref (wrapper)
      if (def.allOf && !def.properties) {
        const refs = def.allOf.filter(e => e.$ref);
        const hasProps = def.allOf.some(e => e.properties && Object.keys(e.properties).length > 0);
        if (refs.length === 1 && !hasProps) {
          return resolveLeafType(refs[0].$ref.replace('#/definitions/', ''), visited);
        }
      }

      // Enum
      if (def.enum) return { ts: def.enum.map(v => JSON.stringify(v)).join(' | '), complex: false };

      // anyOf union
      if (def.anyOf) {
        const parts = def.anyOf.map(branch => {
          if (branch.$ref) return resolveLeafType(branch.$ref.replace('#/definitions/', ''), new Set(visited));
          if (branch.enum) return { ts: branch.enum.map(v => JSON.stringify(v)).join(' | '), complex: false };
          if (branch.type) return { ts: branch.type, complex: false };
          return { ts: 'unknown', complex: false };
        });
        return { ts: parts.map(p => p.ts).join(' | '), complex: parts.some(p => p.complex) };
      }

      // Primitive (no properties)
      if (def.type && !def.properties && typeof def.type === 'string' && def.type !== 'object') {
        const fmt = def.format ? ' /* ' + def.format + ' */' : '';
        return { ts: def.type + fmt, complex: false };
      }

      // Complex
      return { ts: name, complex: true };
    }

    function resolvePropertyType(schema) {
      if (!schema || typeof schema !== 'object') return { ts: 'unknown', complex: false };

      // Direct $ref
      if (schema.$ref) {
        const target = schema.$ref.replace('#/definitions/', '');
        return resolveLeafType(target);
      }
      // allOf wrapper
      if (schema.allOf) {
        for (const entry of schema.allOf) {
          if (entry.$ref) {
            const target = entry.$ref.replace('#/definitions/', '');
            return resolveLeafType(target);
          }
        }
      }
      // Array
      if (schema.type === 'array' && schema.items) {
        if (schema.items.$ref) {
          const inner = resolveLeafType(schema.items.$ref.replace('#/definitions/', ''));
          return { ts: inner.ts + '[]', complex: inner.complex };
        }
        return { ts: (schema.items.type || 'any') + '[]', complex: false };
      }
      // Enum
      if (schema.enum) return { ts: schema.enum.map(v => JSON.stringify(v)).join(' | '), complex: false };
      // Primitive
      if (schema.type && schema.type !== 'object') {
        const fmt = schema.format ? ' /* ' + schema.format + ' */' : '';
        return { ts: schema.type + fmt, complex: false };
      }
      return { ts: 'object', complex: false };
    }

    const explorerIface = document.getElementById('explorerIface');

    function renderInterface(name) {
      const props = flattenAllOf(defs, name);
      const origins = [...new Set(props.map(p => p.origin))];

      let lines = [];
      lines.push('<span class="if-cmt">/**');
      lines.push(' * Suggested flat interface for ' + esc(name));
      lines.push(' * Resolved from ' + origins.length + ' type' + (origins.length !== 1 ? 's' : '') + ' in the inheritance chain');
      lines.push(' */</span>');
      lines.push('<span class="if-kw">interface</span> ' + esc(name) + ' {');

      let lastOrigin = null;
      for (const p of props) {
        if (p.origin !== lastOrigin) {
          if (lastOrigin !== null) lines.push('');
          lines.push('  <span class="if-cmt">// \u2500\u2500 ' + esc(p.origin) + ' \u2500\u2500</span>');
          lastOrigin = p.origin;
        }
        const resolved = resolvePropertyType(p.schema);
        let typeHtml;
        if (resolved.complex) {
          const typeName = resolved.ts.endsWith('[]') ? resolved.ts.slice(0, -2) : resolved.ts;
          const suffix = resolved.ts.endsWith('[]') ? '[]' : '';
          typeHtml = '<a class="if-ref explorer-type-link" href="#' + esc(typeName) + '">' + esc(typeName) + '</a>' + suffix;
        } else if (resolved.ts.includes('|')) {
          // Literal union or multi-type
          const parts = resolved.ts.split(' | ');
          typeHtml = parts.map(part => {
            part = part.trim();
            if (part.startsWith('"') || part.startsWith("'")) return '<span class="if-lit">' + esc(part) + '</span>';
            return '<span class="if-prim">' + esc(part) + '</span>';
          }).join(' | ');
        } else if (resolved.ts.indexOf('/*') !== -1) {
          // Primitive with format comment
          const ci = resolved.ts.indexOf(' /*');
          if (ci !== -1) typeHtml = '<span class="if-prim">' + esc(resolved.ts.slice(0, ci)) + '</span><span class="if-cmt">' + esc(resolved.ts.slice(ci)) + '</span>';
          else typeHtml = '<span class="if-prim">' + esc(resolved.ts) + '</span>';
        } else {
          typeHtml = '<span class="if-prim">' + esc(resolved.ts) + '</span>';
        }
        lines.push('  <span class="if-prop">' + esc(p.prop) + '</span>?: ' + typeHtml + ';');
      }

      lines.push('}');

      let html = '<div class="interface-block">' + lines.join('\\n');
      html += '<button class="copy-btn" id="ifaceCopy">Copy</button></div>';

      explorerIface.innerHTML = html;
    }

    // Copy handler
    explorerIface.addEventListener('click', e => {
      if (!e.target.closest('.copy-btn')) return;
      const block = explorerIface.querySelector('.interface-block');
      if (!block) return;
      // Extract plain text (strip HTML tags)
      const plain = block.innerText.replace(/Copy$/, '').trimEnd();
      navigator.clipboard.writeText(plain).then(() => {
        const btn = e.target.closest('.copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1500);
      });
    });

    // Graph node clicks
    graphContainer.addEventListener('click', e => {
      const node = e.target.closest('.graph-node');
      if (node && node.dataset.def && defs[node.dataset.def]) {
        location.hash = '#' + node.dataset.def;
        renderExplorer(node.dataset.def);
      }
    });

    // ── Resizable panes ──────────────────────────────────────────────────

    let explorerW = 380;
    const handle1 = document.getElementById('handle1');
    const handle2 = document.getElementById('handle2');
    let drag = null;

    function openExplorer() {
      explorerPanel.style.width = explorerW + 'px';
      document.body.classList.add('explorer-open');
    }
    function closeExplorer() {
      document.body.classList.remove('explorer-open');
      explorerPanel.style.width = '';
      currentExplored = null;
    }

    handle1.addEventListener('mousedown', e => {
      e.preventDefault();
      handle1.classList.add('active');
      document.body.classList.add('resizing');
      drag = { handle: 1, startX: e.clientX, startW: sidebar.offsetWidth };
    });
    handle2.addEventListener('mousedown', e => {
      e.preventDefault();
      handle2.classList.add('active');
      document.body.classList.add('resizing');
      drag = { handle: 2, startX: e.clientX, startW: explorerPanel.offsetWidth };
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      if (drag.handle === 1) {
        const w = Math.max(160, Math.min(500, drag.startW + e.clientX - drag.startX));
        sidebar.style.width = w + 'px';
      } else {
        const w = Math.max(250, drag.startW - (e.clientX - drag.startX));
        explorerW = w;
        explorerPanel.style.width = w + 'px';
      }
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      handle1.classList.remove('active');
      handle2.classList.remove('active');
      document.body.classList.remove('resizing');
      drag = null;
    });

    document.addEventListener('click', e => {
      // Explore button click
      const btn = e.target.closest('.explore-btn');
      if (btn) {
        e.preventDefault();
        const name = btn.dataset.def;
        if (document.body.classList.contains('explorer-open') && currentExplored === name) {
          closeExplorer();
        } else {
          renderExplorer(name);
          openExplorer();
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

    document.getElementById('explorerClose').addEventListener('click', closeExplorer);
  </script>
</body>
</html>`;
}
