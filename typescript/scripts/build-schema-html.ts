/**
 * Generates a self-contained HTML page per assembly from the JSON Schema.
 *
 * For each assembly in generated-src/<assembly>/*.schema.json, produces
 * generated-src/<assembly>/netex-schema.html with:
 * - Sidebar with alphabetical definition index and search/filter
 * - Per-definition sections with permalink anchors
 * - Pretty-printed JSON with syntax highlighting and clickable $ref links
 * - Dark/light mode support
 * - Responsive layout (sidebar collapses on mobile)
 *
 * Usage: npx tsx scripts/build-schema-html.ts
 */

import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import ts from "typescript";
import { defRole, presentRoles } from "./lib/schema-viewer-fns.js";

// ── HTML builder ──────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
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

export function buildRoleFilter(defNames: string[], defs: Record<string, unknown>): string {
  const chips = presentRoles(defNames, defs as Record<string, Record<string, any>>).map(
    ({ role, label, count }) =>
      `<button class="role-chip" data-role="${escapeHtml(role)}">${escapeHtml(label)} (${count})</button>`,
  );
  return chips.join("\n      ");
}

export function buildSidebarItems(defNames: string[], defs: Record<string, unknown>): string {
  return defNames
    .map((name) => {
      const role = defRole(defs[name] as Record<string, any> | undefined);
      return `        <li><a href="#${escapeHtml(name)}" class="sidebar-link" data-name="${escapeHtml(name.toLowerCase())}" data-role="${escapeHtml(role)}">${escapeHtml(name)}</a></li>`;
    })
    .join("\n");
}

function buildDefinitionSections(defs: Record<string, unknown>, defNames: string[]): string {
  return defNames
    .map((name) => {
      const def = defs[name] as Record<string, unknown>;
      const role = defRole(def as Record<string, any> | undefined);
      const desc = typeof def.description === "string" ? def.description : "";
      // Show the definition without the top-level description (it's shown separately)
      const displayDef = { ...def };
      delete displayDef.description;
      const jsonHtml = highlightJson(displayDef);

      const isEntity = role === "entity";
      const suggestBtn = `<button class="suggest-btn" data-def="${escapeHtml(name)}" title="Generate code helpers">Suggest code</button>`;
      const usedByBtn = !isEntity
        ? `<span class="used-by-wrap"><button class="used-by-btn" data-def="${escapeHtml(name)}" title="Find entities that use this type">Entities\u2026</button><div class="used-by-dropdown" id="ub-${escapeHtml(name)}"></div></span>`
        : "";

      return `    <section id="${escapeHtml(name)}" class="def-section" data-role="${escapeHtml(role)}">
      <h2><a href="#${escapeHtml(name)}" class="permalink">#</a> ${escapeHtml(name)}${suggestBtn}${usedByBtn}<button class="explore-btn" data-def="${escapeHtml(name)}" title="Explore type hierarchy">Explore</button></h2>
      ${desc ? `<p class="def-desc">${escapeHtml(desc)}</p>` : ""}
      <pre><code>${jsonHtml}</code></pre>
    </section>`;
    })
    .join("\n\n");
}

/** Read the extracted CSS for the schema viewer page. */
function buildCss(): string {
  return readFileSync(resolve(import.meta.dirname, "lib/schema-viewer.css"), "utf-8");
}

/** Read the extracted app script and splice in the transpiled viewer functions. */
function buildAppScript(): string {
  const raw = readFileSync(resolve(import.meta.dirname, "lib/schema-viewer-host-app.js"), "utf-8");
  const viewerFns = buildViewerFnsScript();
  return raw.replace("/*@@VIEWER_FNS@@*/", viewerFns).trimEnd();
}

/**
 * Read the canonical viewer functions from schema-viewer-fns.ts and compile
 * to plain JS via the TypeScript compiler API.
 *
 * The util functions take `defs` as an explicit first parameter. The browser
 * wrappers close over the page-level `defs` variable and bind it automatically.
 */
function buildViewerFnsScript(): string {
  const src = readFileSync(resolve(import.meta.dirname, "lib/schema-viewer-fns.ts"), "utf-8");

  // Strip `export` keywords before transpiling — ts.transpileModule still
  // emits `exports.x = x` for exported declarations even with ModuleKind.None.
  const stripped = src.replace(/^export /gm, "");

  const { outputText: js } = ts.transpileModule(stripped, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      removeComments: false,
    },
  });

  // The util functions take `defs` as first arg. Create bound wrappers that
  // close over the page-level `defs` for use in the rest of the inline script.
  const bound = `
    // ── Viewer functions (generated from scripts/lib/schema-viewer-fns.ts) ──
    var _fns = (function() {
      ${js}
      return {
        resolveType: resolveType,
        isRefType: isRefType,
        refTarget: refTarget,
        flattenAllOf: flattenAllOf,
        collectRequired: collectRequired,
        resolveDefType: resolveDefType,
        resolvePropertyType: resolvePropertyType,
        resolveAtom: resolveAtom,
        buildReverseIndex: buildReverseIndex,
        findTransitiveEntityUsers: findTransitiveEntityUsers,
        defRole: defRole,
        defaultForType: defaultForType,
        lcFirst: lcFirst,
        buildInheritanceChain: buildInheritanceChain,
        inlineSingleRefs: inlineSingleRefs
      };
    })();

    // Bound wrappers — close over page-level defs
    function resolveType(p) { return _fns.resolveType(p); }
    function isRefType(p) { return _fns.isRefType(p); }
    function refTarget(p) { return _fns.refTarget(p); }
    function flattenAllOf(d, n) { return _fns.flattenAllOf(d, n); }
    function collectRequired(d, n) { return _fns.collectRequired(d, n); }
    function resolveDefType(n, v) { return _fns.resolveDefType(defs, n, v); }
    function resolvePropertyType(s) { return _fns.resolvePropertyType(defs, s); }
    function resolveAtom(n) { return _fns.resolveAtom(defs, n); }
    function defaultForType(t) { return _fns.defaultForType(t); }

    function inlineSingleRefs(props) { return _fns.inlineSingleRefs(defs, props); }
    function defRole(name) { return _fns.defRole(defs[name]); }
    function buildInheritanceChain(n) { return _fns.buildInheritanceChain(defs, n); }
    var _reverseIdx = null;
    function buildReverseIndex() {
      if (!_reverseIdx) _reverseIdx = _fns.buildReverseIndex(defs);
      return _reverseIdx;
    }
    function findTransitiveEntityUsers(name) {
      return _fns.findTransitiveEntityUsers(name, buildReverseIndex(), (n) => _fns.defRole(defs[n]) === "entity");
    }`;
  return bound;
}

function buildHtml(
  assembly: string,
  defs: Record<string, unknown>,
  defNames: string[],
  version: string,
): string {
  const sidebarItems = buildSidebarItems(defNames, defs);
  const roleFilterHtml = buildRoleFilter(defNames, defs);
  const sections = buildDefinitionSections(defs, defNames);
  const appScript = buildAppScript();
  const css = buildCss();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NeTEx JSON Schema — ${escapeHtml(assembly)}</title>
  <style>
${css}
  </style>
</head>
<body>
  <div class="loading-overlay" id="loadingOverlay">
    <div class="loading-spinner"></div>
    <div class="loading-text">Loading ${defNames.length} definitions\u2026</div>
  </div>

  <button class="sidebar-toggle" id="sidebarToggle">Definitions</button>

  <nav class="sidebar" id="sidebar">
    <h1>NeTEx JSON Schema</h1>
    <p class="subtitle">${escapeHtml(assembly)} · v${escapeHtml(version)}</p>
    <input type="text" class="search-box" id="search" placeholder="Filter definitions…" autocomplete="off">
    <div class="role-box">
      <div class="role-box-header">
        <span class="role-box-title">Roles</span>
        <button class="role-help-btn" id="roleHelpBtn" title="What are roles?">?</button>
      </div>
      <div class="role-filter" id="roleFilter">
        ${roleFilterHtml}
      </div>
    </div>
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
      <button class="explorer-tab" data-tab="mapping">Mapping</button>
      <button class="explorer-tab" data-tab="utils">Utilities</button>
    </div>
    <div class="explorer-tab-content active" id="explorerProps"></div>
    <div class="explorer-tab-content" id="explorerGraph"><div class="graph-container" id="graphContainer"></div></div>
    <label class="iface-toggle" id="ifaceToggleLabel" style="display:none"><input type="checkbox" id="inlineRefsCheck"> Inline 1-to-1 props</label>
    <div class="explorer-tab-content" id="explorerIface"></div>
    <div class="explorer-tab-content" id="explorerMapping"></div>
    <div class="explorer-tab-content" id="explorerUtils"></div>
  </aside>

  <div class="role-help-overlay" id="roleHelpOverlay">
    <div class="role-help-dialog">
      <h3>What are roles?</h3>
      <p>Every definition in the NeTEx schema has a <em>role</em> that describes its purpose. Filtering by role helps you find the types relevant to your task.</p>
      <ul>
        <li><strong>Entity</strong> &mdash; The primary domain objects you create, display, and edit: stops, lines, journeys, vehicles. <em>This is the most useful filter for frontend work.</em></li>
        <li><strong>Frame member</strong> &mdash; Top-level containers in NeTEx XML. A frame groups related entities for import/export (e.g. a ServiceFrame holds routes and lines). Relevant when working directly with NeTEx XML payloads.</li>
        <li><strong>Structure</strong> &mdash; Value objects embedded inside entities: addresses, contact details, capacities. You encounter these as properties of entities rather than searching for them directly.</li>
        <li><strong>Reference</strong> &mdash; Foreign-key wrappers (e.g. StopPlaceRef). Typically a wrapper around a string ID with an optional version.</li>
        <li><strong>Enum</strong> &mdash; Fixed value sets used for dropdowns and classification (stop place types, vehicle modes, day types).</li>
        <li><strong>Collection</strong> &mdash; Plural wrapper types for XML serialization structure. In TypeScript/JSON these are just arrays.</li>
        <li><strong>Abstract</strong> &mdash; Base types in the inheritance chain. Rarely referenced directly in application code.</li>
        <li><strong>View</strong> &mdash; Projection types that present a subset of an entity&rsquo;s data.</li>
        <li><strong>Unclassified</strong> &mdash; Definitions without an assigned role, typically low-level schema plumbing.</li>
      </ul>
      <p>Click one or more chips to show only matching definitions. When no chips are active, all definitions are shown.</p>
      <div class="close-row"><button id="roleHelpClose">Got it</button></div>
    </div>
  </div>

  <script id="schema-data" type="application/json">${JSON.stringify(defs)}</script>

  <script>
${appScript}
  </script>
</body>
</html>`;
}

// ── Main script ──────────────────────────────────────────────────────────────
// Only runs when executed directly (not when imported by tests)

const _isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.dirname, "build-schema-html.ts");

if (_isDirectRun) {
  const CONFIG_PATH = resolve(import.meta.dirname, "../../assembly-config.json");
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  const configDir = dirname(CONFIG_PATH);
  const generatedBase = resolve(configDir, config.paths.generated);

  if (!existsSync(generatedBase)) {
    console.error(`Generated directory not found: ${generatedBase}`);
    process.exit(1);
  }

  let built = 0;

  for (const entry of readdirSync(generatedBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const assemblyDir = join(generatedBase, entry.name);
    const schemaFile = readdirSync(assemblyDir).find((f) => f.endsWith(".schema.json"));
    if (!schemaFile) continue;

    const assembly = entry.name;
    const schema = JSON.parse(readFileSync(join(assemblyDir, schemaFile), "utf-8"));
    const defs = schema.definitions ?? {};
    const defNames = Object.keys(defs).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );

    if (defNames.length === 0) {
      console.log(`  ${assembly}: no definitions, skipping`);
      continue;
    }

    const html = buildHtml(assembly, defs, defNames, config.netex.version);
    const outPath = join(generatedBase, assembly, "netex-schema.html");
    writeFileSync(outPath, html);
    console.log(`  ${assembly}: ${defNames.length} definitions → netex-schema.html`);
    built++;
  }

  if (built === 0) {
    console.error("No JSON Schema files found. Run 'npm run generate' first.");
    process.exit(1);
  }

  console.log(`\nBuilt ${built} schema HTML page(s).`);
}
