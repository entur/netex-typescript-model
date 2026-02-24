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
        renderGraphSvg: renderGraphSvg,
        renderInterfaceHtml: renderInterfaceHtml,
        renderMappingHtml: renderMappingHtml,
        renderUtilsHtml: renderUtilsHtml
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
  const viewerFns = buildViewerFnsScript();
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
    // Search / filter
    const search = document.getElementById('search');
    const links = document.querySelectorAll('.sidebar-link');
    const visibleCount = document.getElementById('visibleCount');
    const roleChips = document.querySelectorAll('.role-chip');
    const activeRoles = new Set();

    function applyFilters() {
      const q = search.value.toLowerCase();
      let count = 0;
      links.forEach(a => {
        const textMatch = !q || a.dataset.name.includes(q);
        const roleMatch = activeRoles.size === 0 || activeRoles.has(a.dataset.role);
        const match = textMatch && roleMatch;
        a.classList.toggle('hidden', !match);
        if (match) count++;
      });
      visibleCount.textContent = count;
    }

    search.addEventListener('input', applyFilters);

    roleChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const role = chip.dataset.role;
        if (activeRoles.has(role)) {
          activeRoles.delete(role);
          chip.classList.remove('active');
        } else {
          activeRoles.add(role);
          chip.classList.add('active');
        }
        applyFilters();
      });
    });

    // Role help popup
    const roleHelpOverlay = document.getElementById('roleHelpOverlay');
    document.getElementById('roleHelpBtn').addEventListener('click', () => {
      roleHelpOverlay.classList.add('open');
    });
    document.getElementById('roleHelpClose').addEventListener('click', () => {
      roleHelpOverlay.classList.remove('open');
    });
    roleHelpOverlay.addEventListener('click', e => {
      if (e.target === roleHelpOverlay) roleHelpOverlay.classList.remove('open');
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
    ${viewerFns}
    const explorerPanel = document.getElementById('explorerPanel');
    const explorerTitle = document.getElementById('explorerTitle');
    const explorerSubtitle = document.getElementById('explorerSubtitle');
    const explorerProps = document.getElementById('explorerProps');
    const graphContainer = document.getElementById('graphContainer');
    let currentExplored = null;
    let currentMode = null;

    function setExplorerMode(mode) {
      currentMode = mode;
      // Update mode chip in title
      var chip = explorerTitle.querySelector('.mode-chip');
      if (chip) {
        chip.className = 'mode-chip ' + (mode === 'code' ? 'code' : 'explore');
        chip.textContent = mode === 'code' ? 'Code' : 'Explore';
      }
      var tabs = explorerPanel.querySelectorAll('.explorer-tab');
      var visible = mode === 'code' ? { iface: true, mapping: true, utils: true } : { props: true, graph: true };
      var firstVisible = null;
      tabs.forEach(function(t) {
        var show = !!visible[t.dataset.tab];
        t.style.display = show ? '' : 'none';
        if (show && !firstVisible) firstVisible = t;
      });
      // Activate first visible tab
      if (firstVisible) {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        explorerPanel.querySelectorAll('.explorer-tab-content').forEach(function(c) { c.classList.remove('active'); });
        firstVisible.classList.add('active');
        var tm = { props: 'explorerProps', graph: 'explorerGraph', iface: 'explorerIface', mapping: 'explorerMapping', utils: 'explorerUtils' };
        document.getElementById(tm[firstVisible.dataset.tab]).classList.add('active');
      }
    }

    // Tab switching
    explorerPanel.addEventListener('click', e => {
      const tab = e.target.closest('.explorer-tab');
      if (!tab) return;
      explorerPanel.querySelectorAll('.explorer-tab').forEach(t => t.classList.remove('active'));
      explorerPanel.querySelectorAll('.explorer-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const tabMap = { props: 'explorerProps', graph: 'explorerGraph', iface: 'explorerIface', mapping: 'explorerMapping', utils: 'explorerUtils' };
      document.getElementById(tabMap[tab.dataset.tab] || 'explorerProps').classList.add('active');
    });

    function esc(s) {
      const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    }

    function renderExplorer(name) {
      const props = flattenAllOf(defs, name);
      explorerTitle.innerHTML = '<span class="mode-chip"></span>' + esc(name);
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
        html += '<div class="prop-row"><div class="prop-name">' + esc(p.prop[0]) + ' <span class="prop-type">' + typeHtml + '</span></div>';
        if (p.desc) html += '<div class="prop-pdesc">' + esc(p.desc) + '</div>';
        html += '</div>';
      }
      if (lastOrigin !== null) html += '</div>';
      if (props.length === 0) html = '<p style="color:var(--muted);font-size:0.85rem;">No properties found.</p>';

      explorerProps.innerHTML = html;
      renderGraph(name);
      explorerIface.innerHTML = '<div class="spinner"></div>';
      explorerMapping.innerHTML = '<div class="spinner"></div>';
      explorerUtils.innerHTML = '<div class="spinner"></div>';
      setTimeout(function() {
        renderInterface(name);
        renderMappingGuide(name);
        renderUtils(name);
      }, 0);
      currentExplored = name;
    }

    // ── Graph tab ────────────────────────────────────────────────────────

    function renderGraph(name) {
      var cs = getComputedStyle(document.documentElement);
      var colors = {
        accent: cs.getPropertyValue('--accent').trim(),
        fg: cs.getPropertyValue('--fg').trim(),
        muted: cs.getPropertyValue('--muted').trim(),
        cardBg: cs.getPropertyValue('--card-bg').trim(),
        cardBorder: cs.getPropertyValue('--card-border').trim()
      };
      graphContainer.innerHTML = _fns.renderGraphSvg(defs, name, colors, esc);
    }

    // ── Interface tab ─────────────────────────────────────────────────

    const explorerIface = document.getElementById('explorerIface');

    function renderInterface(name) {
      explorerIface.innerHTML = _fns.renderInterfaceHtml(defs, name, esc);
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

    // Via-chain popup on hover
    var viaPopup = null;
    var viaTarget = null;
    function showViaPopup(span) {
      hideViaPopup();
      var raw = span.getAttribute('data-via');
      if (!raw) return;
      var via;
      try { via = JSON.parse(decodeURIComponent(raw)); } catch(_) { return; }
      if (!via || !via.length) return;
      var popup = document.createElement('div');
      popup.className = 'via-popup';
      var inner = '';
      for (var i = 0; i < via.length; i++) {
        if (i > 0) inner += '<span class="via-arrow">\u2192</span>';
        var hop = via[i];
        var isDefLink = !!defs[hop.name];
        if (isDefLink) {
          inner += '<span class="via-name via-link">' + esc(hop.name) + '</span>';
        } else {
          inner += '<span class="via-name">' + esc(hop.name) + '</span>';
        }
        inner += ' <span class="via-rule">' + esc(hop.rule) + '</span>';
      }
      popup.innerHTML = inner;
      document.body.appendChild(popup);
      var rect = span.getBoundingClientRect();
      popup.style.left = rect.left + 'px';
      popup.style.top = (rect.bottom + 4) + 'px';
      var pr = popup.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) {
        popup.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
      }
      viaPopup = popup;
      viaTarget = span;
    }
    function hideViaPopup() {
      if (viaPopup) { viaPopup.remove(); viaPopup = null; }
      viaTarget = null;
    }
    document.addEventListener('mouseover', function(e) {
      var span = e.target.closest && e.target.closest('.if-prop[data-via]');
      if (span && explorerIface.contains(span)) {
        if (span !== viaTarget) showViaPopup(span);
      } else if (viaPopup) {
        hideViaPopup();
      }
    });

    // ── Mapping tab ───────────────────────────────────────────────────

    const explorerMapping = document.getElementById('explorerMapping');

    function renderMappingGuide(name) {
      explorerMapping.innerHTML = _fns.renderMappingHtml(defs, name, esc);
    }

    // Copy handler for mapping tab
    explorerMapping.addEventListener('click', function(e) {
      if (!e.target.closest('.copy-btn')) return;
      var block = e.target.closest('.interface-block');
      if (!block) return;
      var plain = block.innerText.replace(/Copy$/, '').trimEnd();
      navigator.clipboard.writeText(plain).then(function() {
        var btn = e.target.closest('.copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
      });
    });

    // ── Utilities tab ─────────────────────────────────────────────────

    const explorerUtils = document.getElementById('explorerUtils');

    function renderUtils(name) {
      explorerUtils.innerHTML = _fns.renderUtilsHtml(defs, name, buildReverseIndex(), esc);
    }

    // Copy handler for utilities tab
    explorerUtils.addEventListener('click', function(e) {
      if (!e.target.closest('.copy-btn')) return;
      var block = e.target.closest('.interface-block');
      if (!block) return;
      var plain = block.innerText.replace(/Copy$/, '').trimEnd();
      navigator.clipboard.writeText(plain).then(function() {
        var btn = e.target.closest('.copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
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
      currentMode = null;
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

    // ── "Used by entities" dropdown ───────────────────────────────────
    var _openDropdown = null;

    function closeUsedByDropdown() {
      if (_openDropdown) {
        _openDropdown.classList.remove('open');
        _openDropdown = null;
      }
    }

    function toggleUsedByDropdown(btn) {
      var name = btn.dataset.def;
      var dd = document.getElementById('ub-' + name);
      if (!dd) return;

      // Close if same dropdown is already open
      if (_openDropdown === dd) { closeUsedByDropdown(); return; }
      closeUsedByDropdown();

      // Show spinner
      dd.innerHTML = '<div class="ub-spinner"></div>';
      dd.classList.add('open');
      _openDropdown = dd;

      // Compute async to let spinner render
      setTimeout(function() {
        var entities = findTransitiveEntityUsers(name);
        var html = '';
        if (entities.length === 0) {
          html = '<div class="ub-empty">No entities use this type.</div>';
        } else {
          html = '<div class="ub-count">' + entities.length + ' entit' + (entities.length === 1 ? 'y' : 'ies') + '</div>';
          html += '<div class="ub-list">';
          for (var i = 0; i < entities.length; i++) {
            html += '<a href="#' + esc(entities[i]) + '" class="ub-chip">' + esc(entities[i]) + '</a>';
          }
          html += '</div>';
        }
        dd.innerHTML = html;
      }, 0);
    }

    document.addEventListener('click', e => {
      // Used-by button click
      var ubtn = e.target.closest('.used-by-btn');
      if (ubtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleUsedByDropdown(ubtn);
        return;
      }
      // Chip click inside dropdown — navigate and close
      var ubchip = e.target.closest('.ub-chip');
      if (ubchip && _openDropdown && _openDropdown.contains(ubchip)) {
        closeUsedByDropdown();
        // Let default anchor navigation proceed
        return;
      }
      // Click outside dropdown — close it
      if (_openDropdown && !_openDropdown.contains(e.target)) {
        closeUsedByDropdown();
      }

      // Explore button click
      const btn = e.target.closest('.explore-btn');
      if (btn) {
        e.preventDefault();
        const name = btn.dataset.def;
        if (document.body.classList.contains('explorer-open') && currentExplored === name && currentMode === 'explore') {
          closeExplorer();
        } else {
          renderExplorer(name);
          setExplorerMode('explore');
          openExplorer();
        }
        return;
      }
      // Suggest code button click
      const sbtn = e.target.closest('.suggest-btn');
      if (sbtn) {
        e.preventDefault();
        const name = sbtn.dataset.def;
        if (document.body.classList.contains('explorer-open') && currentExplored === name && currentMode === 'code') {
          closeExplorer();
        } else {
          renderExplorer(name);
          setExplorerMode('code');
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
            if (currentMode) setExplorerMode(currentMode);
          }
        }
      }
    });

    document.getElementById('explorerClose').addEventListener('click', closeExplorer);
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
