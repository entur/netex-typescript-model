    /**
     * Schema viewer host application.
     *
     * This file is the browser-side controller for the self-contained
     * netex-schema.html page. It is read by build-schema-html.ts and
     * embedded verbatim inside a <script> tag. Before embedding, the
     * placeholder `/*@@VIEWER_FNS@@*​/` is replaced with the transpiled
     * viewer-fns IIFE and bound wrappers, making functions like
     * `flattenAllOf`, `resolvePropertyType`, `buildReverseIndex` etc.
     * available in this scope.
     *
     * Responsibilities:
     *  - Sidebar search and role-chip filtering
     *  - Explorer panel lifecycle (open/close, tab switching, resize)
     *  - HTML builders for explorer tabs (graph, interface, XML mapping, utils)
     *  - "Used by entities" dropdown (BFS via findTransitiveEntityUsers)
     *  - Via-chain hover popup on interface properties
     *  - Copy-to-clipboard for code blocks
     *
     * Style rule: no inline `style=` attributes in generated HTML.
     * Use CSS classes/IDs defined in schema-viewer.css instead.
     * Runtime `.style.*` for computed geometry (resize, popups) is OK.
     *
     * @file
     */

    // Search / filter
    const search = document.getElementById('search');
    const links = document.querySelectorAll('.sidebar-link');
    const visibleCount = document.getElementById('visibleCount');
    const roleChips = document.querySelectorAll('.role-chip');
    const activeRoles = new Set();

    /** Re-filter the sidebar list by the current search query and active role chips. */
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

    var _filterTimer = null;
    search.addEventListener('input', function() {
      clearTimeout(_filterTimer);
      _filterTimer = setTimeout(applyFilters, 150);
    });

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

    // Mobile sidebar toggle
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    sidebar.addEventListener('click', e => {
      if (e.target.classList.contains('sidebar-link')) sidebar.classList.remove('open');
    });

    // Explorer panel
    const netexLibrary = JSON.parse(document.getElementById('schema-data').textContent);
    /*@@VIEWER_FNS@@*/
    const explorerPanel = document.getElementById('explorerPanel');
    const explorerTitle = document.getElementById('explorerTitle');
    const explorerSubtitle = document.getElementById('explorerSubtitle');
    const explorerProps = document.getElementById('explorerProps');
    const graphContainer = document.getElementById('graphContainer');
    let currentExplored = null;
    let currentMode = null;

    var TAB_MAP = { props: 'explorerProps', graph: 'explorerGraph', relations: 'explorerRelations', iface: 'explorerIface', mapping: 'explorerMapping', sample: 'explorerSample' };
    const relationsContainer = document.getElementById('relationsContainer');

    /**
     * Switch the explorer panel between "explore" (Properties + Graph)
     * and "code" (Interface + Mapping + Utilities) tab sets.
     * @param {"explore"|"code"} mode
     */
    function setExplorerMode(mode) {
      currentMode = mode;
      // Update mode chip in title
      var chip = explorerTitle.querySelector('.mode-chip');
      if (chip) {
        chip.className = 'mode-chip ' + (mode === 'code' ? 'code' : 'explore');
        chip.textContent = mode === 'code' ? 'Code' : 'Explore';
      }
      var tabs = explorerPanel.querySelectorAll('.explorer-tab');
      var visible = mode === 'code' ? { iface: true, mapping: true, sample: true } : { props: true, graph: true, relations: true };
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
        document.getElementById(TAB_MAP[firstVisible.dataset.tab]).classList.add('active');
        ifaceToggles.style.display = (firstVisible.dataset.tab === 'iface' && !currentIsAlias) ? '' : 'none';
      }
    }

    // Tab switching
    explorerPanel.addEventListener('click', e => {
      const tab = e.target.closest('.explorer-tab');
      if (!tab) return;
      explorerPanel.querySelectorAll('.explorer-tab').forEach(t => t.classList.remove('active'));
      explorerPanel.querySelectorAll('.explorer-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(TAB_MAP[tab.dataset.tab] || 'explorerProps').classList.add('active');
      ifaceToggles.style.display = (tab.dataset.tab === 'iface' && !currentIsAlias) ? '' : 'none';
    });

    /** HTML-escape a string using the DOM (createElement + textContent → innerHTML). */
    function esc(s) {
      const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    }

    /**
     * Populate the explorer panel for the given definition.
     *
     * Fills the Properties tab synchronously, renders the Graph tab,
     * then defers Interface / Mapping / Utilities via setTimeout(0)
     * so the spinner is visible while they compute.
     * @param {string} name  Definition name (e.g. "StopPlace").
     */
    function renderExplorer(name) {
      currentIsAlias = false;
      const props = flattenAllOf(netexLibrary, name);
      var role = defRole(name);
      var isDep = isDeprecated(name);
      var nameSpan = isDep ? '<span class="deprecated-name">' + esc(name) + '</span>' : esc(name);
      explorerTitle.innerHTML = '<span class="mode-chip"></span>' + nameSpan + ' <span class="title-role-badge">' + esc(ROLE_LABELS[role] || role) + '</span>';
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
        var propDepCls = p.schema['x-netex-deprecated'] ? ' deprecated' : '';
        html += '<div class="prop-row' + propDepCls + '"><div class="prop-name">' + esc(p.prop[0]) + ' <span class="prop-type">' + typeHtml + '</span></div>';
        if (p.desc) html += '<div class="prop-pdesc">' + esc(p.desc) + '</div>';
        html += '</div>';
      }
      if (lastOrigin !== null) html += '</div>';
      if (props.length === 0) html = '<p class="explorer-empty">No properties found.</p>';

      explorerProps.innerHTML = html;
      renderGraph(name);
      relationsContainer.innerHTML = '<div class="spinner"></div>';
      setTimeout(function() { renderRelations(name); }, 0);
      explorerIface.innerHTML = '<div class="spinner"></div>';
      explorerMapping.innerHTML = '<div class="spinner"></div>';
      explorerSample.innerHTML = '<div class="spinner"></div>';
      setTimeout(function() {
        renderInterface(name, props);
        renderMappingGuide(name, props);
        renderSampleData(name, props);
      }, 0);
      currentExplored = name;
    }

    // ── Graph tab ────────────────────────────────────────────────────────

    /**
     * Build an SVG inheritance-chain diagram for a definition.
     *
     * Nodes are stacked vertically (root at top). Ref-typed properties
     * appear as dashed composition boxes to the right of their owner node.
     * The target definition node is highlighted with the accent colour.
     *
     * @param {string} name    Definition name.
     * @param {{accent:string, fg:string, muted:string, cardBg:string, cardBorder:string}} colors
     *   CSS variable values — required because SVG attributes can't use var().
     * @returns {string} An `<svg>` string, or a "no chain" `<p>` if the chain is empty.
     */
    function renderGraphSvg(name, colors) {
      var chain = buildInheritanceChain(name);
      if (chain.length === 0) {
        return '<p class="explorer-empty">No inheritance chain.</p>';
      }

      var NODE_W = 200, NODE_H = 38, NODE_RX = 6;
      var GAP_Y = 28;
      var COMP_W = 130, COMP_H = 24, COMP_GAP_X = 28, COMP_GAP_Y = 4;
      var PAD = 14;
      var MAX_COMPS = 6;

      var accent = colors.accent, fg = colors.fg, muted = colors.muted, cardBg = colors.cardBg, cardBorder = colors.cardBorder;

      var rows = [];
      var totalH = PAD;
      var maxW = PAD + NODE_W + PAD;

      for (var ni = 0; ni < chain.length; ni++) {
        var node = chain[ni];
        var refs = node.ownProps
          .filter(function(p) { return isRefType(p.schema); })
          .slice(0, MAX_COMPS)
          .map(function(p) { return { name: p.name, target: refTarget(p.schema), type: resolveType(p.schema) }; });
        var compBlockH = refs.length > 0 ? refs.length * (COMP_H + COMP_GAP_Y) - COMP_GAP_Y : 0;
        var rowH = Math.max(NODE_H, compBlockH);
        rows.push({ name: node.name, ownProps: node.ownProps, refs: refs, y: totalH + rowH / 2, rowH: rowH, compBlockH: compBlockH });
        totalH += rowH + GAP_Y;
        if (refs.length > 0) maxW = Math.max(maxW, PAD + NODE_W + COMP_GAP_X + COMP_W + PAD);
      }
      totalH = totalH - GAP_Y + PAD;

      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + maxW + '" height="' + totalH + '">';
      svg += '<defs><marker id="arrow" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">';
      svg += '<path d="M0,0 L10,3 L0,6 Z" fill="' + muted + '"/></marker></defs>';

      for (var i = 0; i < rows.length - 1; i++) {
        var x = PAD + NODE_W / 2;
        svg += '<line x1="' + x + '" y1="' + (rows[i].y + NODE_H / 2) + '" x2="' + x + '" y2="' + (rows[i + 1].y - NODE_H / 2) + '" stroke="' + muted + '" stroke-width="1.5" marker-end="url(#arrow)"/>';
      }

      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri];
        if (row.refs.length === 0) continue;
        var sx = PAD + NODE_W;
        var compStartY = row.y - row.compBlockH / 2;
        for (var j = 0; j < row.refs.length; j++) {
          var cy = compStartY + j * (COMP_H + COMP_GAP_Y) + COMP_H / 2;
          svg += '<line x1="' + sx + '" y1="' + row.y + '" x2="' + (PAD + NODE_W + COMP_GAP_X) + '" y2="' + cy + '" stroke="' + cardBorder + '" stroke-width="1" stroke-dasharray="4,3"/>';
        }
      }

      for (var ri2 = 0; ri2 < rows.length; ri2++) {
        var row = rows[ri2];
        var isTarget = row.name === name;
        var fill = isTarget ? accent : cardBg;
        var textFill = isTarget ? '#fff' : fg;
        var stroke = isTarget ? accent : cardBorder;
        var ny = row.y - NODE_H / 2;
        var label = row.name.length > 26 ? row.name.slice(0, 24) + '\u2026' : row.name;

        svg += '<g class="graph-node" data-def="' + esc(row.name) + '">';
        svg += '<title>' + esc(row.name) + ' (' + row.ownProps.length + ' properties)</title>';
        svg += '<rect x="' + PAD + '" y="' + ny + '" width="' + NODE_W + '" height="' + NODE_H + '" rx="' + NODE_RX + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
        svg += '<text x="' + (PAD + NODE_W / 2) + '" y="' + (row.y + 1) + '" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace,monospace" font-size="11" font-weight="600" fill="' + textFill + '">' + esc(label) + '</text>';
        svg += '<text x="' + (PAD + NODE_W - 8) + '" y="' + (ny + 12) + '" text-anchor="end" font-family="system-ui,sans-serif" font-size="9" fill="' + (isTarget ? 'rgba(255,255,255,0.7)' : muted) + '">' + row.ownProps.length + 'p</text>';
        svg += '</g>';

        var compStartY2 = row.y - row.compBlockH / 2;
        for (var j2 = 0; j2 < row.refs.length; j2++) {
          var ref = row.refs[j2];
          var cy2 = compStartY2 + j2 * (COMP_H + COMP_GAP_Y);
          var clabel = ref.name.length > 16 ? ref.name.slice(0, 14) + '\u2026' : ref.name;
          var hasDef = ref.target && netexLibrary[ref.target];
          svg += '<g' + (hasDef ? ' class="graph-node" data-def="' + esc(ref.target) + '"' : '') + '>';
          svg += '<title>' + esc(ref.name) + ': ' + esc(ref.type) + '</title>';
          svg += '<rect x="' + (PAD + NODE_W + COMP_GAP_X) + '" y="' + cy2 + '" width="' + COMP_W + '" height="' + COMP_H + '" rx="4" fill="' + cardBg + '" stroke="' + cardBorder + '" stroke-width="1" stroke-dasharray="3,2"/>';
          svg += '<text x="' + (PAD + NODE_W + COMP_GAP_X + 6) + '" y="' + (cy2 + COMP_H / 2 + 1) + '" dominant-baseline="middle" font-family="ui-monospace,monospace" font-size="10" fill="' + muted + '">' + esc(clabel) + '</text>';
          svg += '</g>';
        }
      }

      svg += '</svg>';
      return svg;
    }

    /** Read CSS custom-property colours and render the graph SVG into the container. */
    function renderGraph(name) {
      var cs = getComputedStyle(document.documentElement);
      var colors = {
        accent: cs.getPropertyValue('--accent').trim(),
        fg: cs.getPropertyValue('--fg').trim(),
        muted: cs.getPropertyValue('--muted').trim(),
        cardBg: cs.getPropertyValue('--card-bg').trim(),
        cardBorder: cs.getPropertyValue('--card-border').trim()
      };
      graphContainer.innerHTML = renderGraphSvg(name, colors);
    }

    // ── Relations tab ─────────────────────────────────────────────────

    var _relationsRefProps = [];
    var _relationsCurrentName = null;

    /**
     * Build a bipartite SVG showing entity-to-entity relationships through a selected ref.
     *
     * Left column = "my entities" (entities whose structure has the ref property).
     * Right column = "can own" (entities at the target of the ref).
     * Each box shows entity name + extra properties that entity adds beyond the base.
     */
    function renderRelationsSvg(leftNodes, rightNodes, refLabel, colors) {
      var PAD = 14, COL_W = 180, GAP_X = 80, NODE_RX = 6;
      var TITLE_H = 22, PROP_H = 14, BOX_PAD_Y = 6, BOX_GAP_Y = 10;
      var MAX_SHOWN_PROPS = 6;
      var HEADER_H = 22;

      var accent = colors.accent, fg = colors.fg, muted = colors.muted, cardBg = colors.cardBg, cardBorder = colors.cardBorder;

      function boxHeight(node) {
        var shown = Math.min(node.extras.length, MAX_SHOWN_PROPS);
        var moreH = node.extras.length > MAX_SHOWN_PROPS ? PROP_H : 0;
        return TITLE_H + (shown > 0 ? BOX_PAD_Y + shown * PROP_H + moreH : 0) + BOX_PAD_Y;
      }

      function stackColumn(nodes) {
        var y = PAD + HEADER_H;
        var items = [];
        for (var i = 0; i < nodes.length; i++) {
          var h = boxHeight(nodes[i]);
          items.push({ node: nodes[i], y: y, h: h });
          y += h + BOX_GAP_Y;
        }
        return { items: items, totalH: y - BOX_GAP_Y + PAD };
      }

      var leftCol = stackColumn(leftNodes);
      var rightCol = stackColumn(rightNodes);
      var totalH = Math.max(leftCol.totalH, rightCol.totalH, PAD + HEADER_H + 40);
      var totalW = PAD + COL_W + GAP_X + COL_W + PAD;

      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + totalW + '" height="' + totalH + '">';
      svg += '<defs><marker id="rel-arrow" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">';
      svg += '<path d="M0,0 L10,3 L0,6 Z" fill="' + muted + '"/></marker></defs>';

      // Column headers
      svg += '<text x="' + (PAD + COL_W / 2) + '" y="' + (PAD + 14) + '" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="' + muted + '">My entities</text>';
      svg += '<text x="' + (PAD + COL_W + GAP_X + COL_W / 2) + '" y="' + (PAD + 14) + '" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="' + muted + '">Can own</text>';

      // Ref label centered between columns
      svg += '<text x="' + (PAD + COL_W + GAP_X / 2) + '" y="' + (PAD + 14) + '" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="' + accent + '">' + esc(refLabel) + '</text>';

      function renderColumn(col, x, isLeft) {
        for (var i = 0; i < col.items.length; i++) {
          var item = col.items[i];
          var n = item.node;
          var fill = cardBg;
          var stroke = cardBorder;
          var textFill = fg;
          svg += '<g class="graph-node" data-def="' + esc(n.name) + '">';
          svg += '<title>' + esc(n.name) + (n.extras.length > 0 ? ' (+' + n.extras.length + ' props)' : '') + '</title>';
          svg += '<rect x="' + x + '" y="' + item.y + '" width="' + COL_W + '" height="' + item.h + '" rx="' + NODE_RX + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
          // Title
          var label = n.name.length > 22 ? n.name.slice(0, 20) + '\u2026' : n.name;
          svg += '<text x="' + (x + 8) + '" y="' + (item.y + 15) + '" dominant-baseline="middle" font-family="ui-monospace,monospace" font-size="11" font-weight="600" fill="' + textFill + '">' + esc(label) + '</text>';
          // Extra props
          var shown = Math.min(n.extras.length, MAX_SHOWN_PROPS);
          for (var j = 0; j < shown; j++) {
            var py = item.y + TITLE_H + BOX_PAD_Y + j * PROP_H;
            var pLabel = n.extras[j].length > 24 ? n.extras[j].slice(0, 22) + '\u2026' : n.extras[j];
            svg += '<text x="' + (x + 12) + '" y="' + (py + 10) + '" font-family="ui-monospace,monospace" font-size="9" fill="' + muted + '">+ ' + esc(pLabel) + '</text>';
          }
          if (n.extras.length > MAX_SHOWN_PROPS) {
            var moreY = item.y + TITLE_H + BOX_PAD_Y + shown * PROP_H;
            svg += '<text x="' + (x + 12) + '" y="' + (moreY + 10) + '" font-family="system-ui,sans-serif" font-size="9" font-style="italic" fill="' + muted + '">…and ' + (n.extras.length - MAX_SHOWN_PROPS) + ' more</text>';
          }
          svg += '</g>';
        }
      }

      renderColumn(leftCol, PAD, true);
      renderColumn(rightCol, PAD + COL_W + GAP_X, false);

      // Edges: each left → each right
      for (var li = 0; li < leftCol.items.length; li++) {
        var lItem = leftCol.items[li];
        var lMidY = lItem.y + lItem.h / 2;
        for (var ri = 0; ri < rightCol.items.length; ri++) {
          var rItem = rightCol.items[ri];
          var rMidY = rItem.y + rItem.h / 2;
          svg += '<line x1="' + (PAD + COL_W) + '" y1="' + lMidY + '" x2="' + (PAD + COL_W + GAP_X) + '" y2="' + rMidY + '" stroke="' + cardBorder + '" stroke-width="1" marker-end="url(#rel-arrow)"/>';
        }
      }

      svg += '</svg>';
      return svg;
    }

    /** Render the Relations SVG for a given definition and selected ref prop into the SVG container. */
    function renderRelationsForRef(name, refEntry) {
      var svgContainer = document.getElementById('relationsSvgContainer');
      if (!svgContainer) return;

      var cs = getComputedStyle(document.documentElement);
      var colors = {
        accent: cs.getPropertyValue('--accent').trim(),
        fg: cs.getPropertyValue('--fg').trim(),
        muted: cs.getPropertyValue('--muted').trim(),
        cardBg: cs.getPropertyValue('--card-bg').trim(),
        cardBorder: cs.getPropertyValue('--card-border').trim()
      };

      // Left column: entities that use the current structure
      var reverseIdx = buildReverseIndex();
      var isEntityPred = function(n) { return defRole(netexLibrary[n]) === 'entity'; };
      var myEntities = findTransitiveEntityUsers(name, reverseIdx, isEntityPred);

      // Right column: find entities that use the target's backing structure
      // (mirrors left-side logic — target entity is a pure alias, its structure has the subtypes)
      var rightEntitiesSet = {};
      var rightBaseStructure = null;
      for (var ti = 0; ti < refEntry.targetEntities.length; ti++) {
        var te = refEntry.targetEntities[ti];
        var teDef = netexLibrary[te];
        // Resolve entity → backing structure
        var backingStruct = teDef && teDef.$ref
          ? teDef.$ref.replace('#/definitions/', '')
          : (teDef && teDef.allOf ? (function() {
              for (var a = 0; a < teDef.allOf.length; a++) {
                if (teDef.allOf[a].$ref) return teDef.allOf[a].$ref.replace('#/definitions/', '');
              }
              return null;
            })() : null);
        if (!backingStruct) { rightEntitiesSet[te] = true; continue; }
        if (!rightBaseStructure) rightBaseStructure = backingStruct;
        var structUsers = findTransitiveEntityUsers(backingStruct, reverseIdx, isEntityPred);
        for (var ui = 0; ui < structUsers.length; ui++) {
          rightEntitiesSet[structUsers[ui]] = true;
        }
      }
      var rightEntityNames = Object.keys(rightEntitiesSet).sort();

      var leftNodes = myEntities.map(function(e) {
        return { name: e, extras: collectExtraProps(e, name) };
      });
      var rightNodes = rightEntityNames.map(function(e) {
        return { name: e, extras: rightBaseStructure ? collectExtraProps(e, rightBaseStructure) : [] };
      });

      if (leftNodes.length === 0 && rightNodes.length === 0) {
        svgContainer.innerHTML = '<p class="explorer-empty">No entity relationships for this reference.</p>';
        return;
      }

      svgContainer.innerHTML = renderRelationsSvg(leftNodes, rightNodes, refEntry.propName, colors);
    }

    /** Populate the Relations tab: dropdown + initial SVG. */
    function renderRelations(name) {
      _relationsRefProps = collectRefProps(name);
      _relationsCurrentName = name;

      if (_relationsRefProps.length === 0) {
        relationsContainer.innerHTML = '<p class="explorer-empty">No reference properties.</p>';
        return;
      }

      // Build dropdown + container
      var html = '<div class="relations-controls"><label>Ref: <select class="relations-select" id="relationsSelect">';
      for (var i = 0; i < _relationsRefProps.length; i++) {
        html += '<option value="' + i + '">' + esc(_relationsRefProps[i].propName) + '</option>';
      }
      html += '</select></label></div>';
      html += '<div class="relations-svg-container" id="relationsSvgContainer"></div>';
      relationsContainer.innerHTML = html;

      // Render first ref
      renderRelationsForRef(name, _relationsRefProps[0]);

      // Wire dropdown change
      document.getElementById('relationsSelect').addEventListener('change', function(e) {
        var idx = parseInt(e.target.value, 10);
        if (_relationsRefProps[idx]) {
          renderRelationsForRef(_relationsCurrentName, _relationsRefProps[idx]);
        }
      });
    }

    // Relations SVG node clicks (delegate from relationsContainer)
    relationsContainer.addEventListener('click', function(e) {
      var node = e.target.closest('.graph-node');
      if (node && node.dataset.def && netexLibrary[node.dataset.def]) {
        if (decodeURIComponent(location.hash) !== '#' + node.dataset.def) location.hash = '#' + node.dataset.def;
        renderExplorer(node.dataset.def);
      }
    });

    // ── TypeScript tab ─────────────────────────────────────────────────

    const explorerIface = document.getElementById('explorerIface');
    const ifaceToggles = document.getElementById('ifaceToggles');
    const hideOmniCheck = document.getElementById('hideOmniCheck');
    const collapseRefsCheck = document.getElementById('collapseRefsCheck');
    var hideOmniEnabled = true;
    var collapseEnabled = true;
    function collapseOpts() { return collapseEnabled ? { collapseRefs: true, collapseCollections: true } : undefined; }
    var currentIsAlias = false;
    var currentExcluded = {};

    /**
     * Build the "suggested flat interface" HTML for the TypeScript tab.
     *
     * Property names use the canonical XML convention: PascalCase for XML
     * elements, `$`-prefixed for XML attributes (mirrors fast-xml-parser's
     * `@_` prefix, but uses `$` for JS-friendly property access).
     *
     * Flattens the allOf inheritance chain, resolves each property's
     * TypeScript type, and emits syntax-highlighted pseudo-code with
     * clickable ref links and `data-via` attributes for hover popups.
     *
     * @param {string} name  Definition name.
     * @returns {{html: string, isAlias: boolean}} An `.interface-block` div with a Copy button.
     */
    function renderInterfaceHtml(name, preProps, metaComments) {
      var ifProps = preProps || flattenAllOf(netexLibrary, name);
      var co = collapseOpts();
      var overrides = co ? buildTypeOverrides(name, co, ifProps) : undefined;
      var result = generateInterface(netexLibrary, name, {
        html: true,
        metaComments: metaComments,
        preProps: ifProps,
        excludeCheckboxes: metaComments,
        omniCollapse: hideOmniEnabled,
        excludeProps: hostExclSet(ifProps),
        typeOverrides: overrides,
      });
      var blockClass = metaComments ? 'interface-block' : 'interface-block dep-block';
      var html = '<div class="' + blockClass + '">' + result.text;
      if (metaComments) html += '<button class="copy-btn">Copy</button>';
      html += '</div>';
      return { html: html, isAlias: result.isAlias };
    }

    hideOmniCheck.addEventListener('change', function() {
      hideOmniEnabled = hideOmniCheck.checked;
      if (currentExplored) {
        renderInterface(currentExplored);
        renderMappingGuide(currentExplored);
        refreshSamplePanels();
      }
    });

    collapseRefsCheck.addEventListener('change', function() {
      collapseEnabled = collapseRefsCheck.checked;
      if (currentExplored) {
        renderInterface(currentExplored);
        renderMappingGuide(currentExplored);
        refreshSamplePanels();
      }
    });

    /** Render the TypeScript tab into its container element. */
    function renderInterface(name, props) {
      currentExcluded = {};
      var result = renderInterfaceHtml(name, props, true);
      explorerIface.innerHTML = result.html;
      currentIsAlias = result.isAlias;
      // Append Ref<T>/SimpleRef preamble into the root interface block
      if (collapseEnabled && !result.isAlias) {
        var rootBlock = explorerIface.querySelector('.interface-block');
        if (rootBlock) {
          var pre = document.createElement('div');
          pre.className = 'ref-preamble';
          pre.textContent = '\n' + _viewerBundle.REF_PREAMBLE;
          rootBlock.insertBefore(pre, rootBlock.querySelector('.copy-btn'));
        }
      }
      updateDepsSection();
      hideOmniCheck.checked = hideOmniEnabled;
      var ifaceActive = explorerIface.classList.contains('active');
      ifaceToggles.style.display = (!currentIsAlias && ifaceActive) ? '' : 'none';
    }

    /** Build remapTarget callback + keepAliases set for collapse-aware BFS. */
    function collapseRemap() {
      var co = collapseOpts();
      if (!co) return { remap: undefined, aliases: undefined };
      var aliases = new Set();
      var remap = function(target) {
        var role = defRole(target);
        if (co.collapseRefs && role === 'reference') return null;
        if (co.collapseCollections && role === 'collection') {
          var cc = _viewerBundle.resolveCollVerStruct(netexLibrary, target);
          if (cc) { aliases.add(cc.target); return cc.target; }
          return target;
        }
        return target;
      };
      return { remap: remap, aliases: aliases };
    }

    /** (Re-)render the "+N subtypes" chip and dep blocks, respecting excluded props. */
    function updateDepsSection() {
      var oldChip = explorerIface.querySelector('.deps-expand-chip');
      var oldDeps = document.getElementById('ifaceDepBlocks');
      if (oldChip) oldChip.remove();
      if (oldDeps) oldDeps.remove();

      if (currentIsAlias || !currentExplored) return;

      var allProps = flattenAllOf(netexLibrary, currentExplored);
      var excludedSet = hostExclSet(allProps) || new Set();
      var cr = collapseRemap();
      var depNodes = collectDependencyTree(currentExplored, excludedSet, cr.remap);
      // Total unique deps (for compaction % display)
      var seen = {};
      var totalUnique = 0;
      for (var i = 0; i < depNodes.length; i++) {
        if (!depNodes[i].duplicate && !seen[depNodes[i].name]) {
          seen[depNodes[i].name] = true;
          totalUnique++;
        }
      }

      var uniqueNames = collectRenderableDeps(currentExplored, excludedSet, cr.remap, cr.aliases);
      // Remove subtypes whose properties are all excluded (empty interface)
      if (hideOmniEnabled || excludedSet.size > 0) {
        uniqueNames = uniqueNames.filter(function(n) {
          if (defRole(n) === 'enumeration') return true;
          var sp = flattenAllOf(netexLibrary, n);
          var se = buildExclSet(sp, { omni: hideOmniEnabled, explicit: excludedSet });
          return !se || sp.some(function(p) { return !se.has(p.prop[1]); });
        });
      }
      if (uniqueNames.length > 0) {
        var chip = document.createElement('button');
        chip.className = 'deps-expand-chip';
        chip.textContent = depChipLabel(uniqueNames.length, totalUnique, false);
        if (hideOmniEnabled || Object.keys(currentExcluded).length > 0) {
          chip.classList.add('chip-flash');
          chip.addEventListener('animationend', function() { chip.classList.remove('chip-flash'); }, { once: true });
        }
        explorerIface.appendChild(chip);

        var depsDiv = document.createElement('div');
        depsDiv.id = 'ifaceDepBlocks';
        depsDiv.style.display = 'none';
        explorerIface.appendChild(depsDiv);

        chip.addEventListener('click', function() {
          if (depsDiv.style.display !== 'none') {
            depsDiv.style.display = 'none';
            depsDiv.innerHTML = '';
            chip.textContent = depChipLabel(uniqueNames.length, totalUnique, false);
            chip.classList.remove('expanded');
            explorerIface.classList.remove('deps-expanded');
            return;
          }
          chip.classList.add('expanded');
          explorerIface.classList.add('deps-expanded');
          chip.textContent = 'Loading\u2026';
          depsDiv.style.display = '';
          depsDiv.innerHTML = '<div class="spinner"></div>';
          setTimeout(function() { renderDepInterfaces(depsDiv, chip, uniqueNames, totalUnique); }, 0);
        });
      }

    }

    /** Build chip label showing rendered count and compaction percentage. */
    function depChipLabel(shown, total, expanded) {
      var prefix = expanded ? '\u25BC ' : '+';
      var label = prefix + shown + ' subtype' + (shown !== 1 ? 's' : '');
      if (total > shown) {
        var pct = Math.round((1 - shown / total) * 100);
        label += ' (' + pct + '% compaction)';
      }
      return label;
    }

    /** Lazily render compact interface blocks for all transitive dependency types. */
    function renderDepInterfaces(container, chip, names, totalUnique) {
      var html = '';
      for (var i = 0; i < names.length; i++) {
        var result = renderInterfaceHtml(names[i], null, false);
        html += result.html;
      }
      container.innerHTML = html;
      chip.textContent = depChipLabel(names.length, totalUnique, true);
    }

    // Copy-to-clipboard: shared handler for all tabs with .copy-btn inside .interface-block
    function attachCopyHandler(container) {
      container.addEventListener('click', function(e) {
        if (!e.target.closest('.copy-btn')) return;
        var block = e.target.closest('.interface-block');
        if (!block) return;
        // For iface tab: generate full copy block with subtypes
        var plain;
        if (container === explorerIface && currentExplored) {
          // Collect excluded property names from checked checkboxes
          var excludedProps = {};
          var cbs = block.querySelectorAll('.excl-cb:checked');
          for (var ci = 0; ci < cbs.length; ci++) {
            var propSpan = cbs[ci].closest('.if-line');
            if (propSpan) {
              var pn = propSpan.querySelector('.if-prop');
              if (pn) excludedProps[pn.textContent] = true;
            }
          }
          var excludedSet = new Set(Object.keys(excludedProps));
          var copyAllProps = flattenAllOf(netexLibrary, currentExplored);
          var copyExcl = hostExclSet(copyAllProps);
          var co = collapseOpts();
          var copyOverrides = co ? buildTypeOverrides(currentExplored, co, copyAllProps) : undefined;
          var root = generateInterface(netexLibrary, currentExplored, { html: false, excludeProps: copyExcl, typeOverrides: copyOverrides }).text;
          var subs = generateSubTypesBlock(currentExplored, { excludedMembers: excludedSet, excludeProps: copyExcl, collapse: co });
          var parts = [root];
          if (subs) parts.push(subs);
          if (co?.collapseRefs) parts.push(_viewerBundle.REF_PREAMBLE);
          plain = parts.join('\n\n');
        } else if (container === explorerMapping && currentExplored) {
          var mapProps = flattenAllOf(netexLibrary, currentExplored);
          plain = makeInlineCodeBlock(currentExplored, mapProps, { html: false, excludeProps: hostExclSet(mapProps), collapse: collapseOpts() });
        } else {
          plain = block.innerText.replace(/Copy$/, '').trimEnd();
        }
        navigator.clipboard.writeText(plain).then(function() {
          var btn = e.target.closest('.copy-btn');
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
        });
      });
    }
    attachCopyHandler(explorerIface);

    // Exclude-from-codegen checkbox toggle
    explorerIface.addEventListener('change', function(e) {
      if (!e.target.classList.contains('excl-cb')) return;
      var line = e.target.closest('.if-line');
      if (!line) return;
      var propName = line.querySelector('.if-prop')?.textContent;
      if (e.target.checked) {
        line.classList.add('excludeInCodeGen');
        if (propName) currentExcluded[propName] = true;
      } else {
        line.classList.remove('excludeInCodeGen');
        if (propName) delete currentExcluded[propName];
      }
      updateDepsSection();
      if (currentExplored) renderMappingGuide(currentExplored);
      refreshSamplePanels();
    });

    // Via-chain popup on hover
    var viaPopup = null;
    var viaTarget = null;
    /** Show a hover popup with the type-resolution chain for an interface property. */
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
        if (i > 0) inner += '<span class="via-arrow">→</span>';
        var hop = via[i];
        var isDefLink = !!netexLibrary[hop.name];
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
    /** Remove the via-chain popup if one is showing. */
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

    /** Convenience: merge per-prop checkboxes + omni toggle into one exclusion set. */
    function hostExclSet(allProps) {
      return buildExclSet(allProps, { omni: hideOmniEnabled, explicit: new Set(Object.keys(currentExcluded)) });
    }

    /**
     * Build the XML Mapping tab HTML: a generated per-entity projection
     * function from `makeInlineCodeBlock`.
     */
    function renderMappingHtml(name, props) {
      var highlighted = makeInlineCodeBlock(name, props, { html: true, excludeProps: hostExclSet(props), collapse: collapseOpts() });

      var html = '';
      html += '<div class="mapping-section"><h3>Serialize</h3>';
      html += '<div class="interface-block">';
      html += highlighted;
      html += '<button class="copy-btn">Copy</button></div></div>';

      return html;
    }

    /** Render the XML Mapping tab into its container element. */
    function renderMappingGuide(name, props) {
      var p = props || flattenAllOf(netexLibrary, name);
      explorerMapping.innerHTML = renderMappingHtml(name, p);
    }

    // ── Sample data tab ──────────────────────────────────────────────────

    const explorerSample = document.getElementById('explorerSample');
    var _cachedFakeMock = null;
    var _cachedSampleStem = null;
    var _cachedSampleNested = null;
    var _cachedSampleName = null;

    /** Syntax-highlight a JSON string for display. */
    function highlightJsonStr(str) {
      // Manual HTML-escaping (not esc()) because the regex highlighting below
      // needs to operate on the raw string structure, not a DOM-escaped result.
      return str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"([^"\\]*(\\.[^"\\]*)*)"(\s*:)?/g, function(match, content, _esc, colon) {
          if (colon) return '<span class="if-prop">"' + content + '"</span>:';
          // Check if content looks like a number or boolean
          return '<span class="if-lit">"' + content + '"</span>';
        })
        .replace(/\b(true|false)\b/g, '<span class="if-kw">$1</span>')
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="if-prim">$1</span>');
    }

    /** Show the given sample format, hiding the others (no DOM rebuild). */
    function showSampleFormat(format) {
      var panels = explorerSample.querySelectorAll('.sample-panel');
      for (var i = 0; i < panels.length; i++) {
        panels[i].style.display = panels[i].dataset.fmt === format ? '' : 'none';
      }
      var pills = explorerSample.querySelectorAll('.sample-pill');
      for (var i = 0; i < pills.length; i++) {
        var input = pills[i].querySelector('input');
        var isActive = input && input.value === format;
        pills[i].classList.toggle('active', isActive);
        if (input) input.checked = isActive;
      }
    }

    /** Re-render all three sample panels with the current exclusion set. */
    function refreshSamplePanels() {
      if (!_cachedSampleName || !_cachedFakeMock) return;
      var allProps = flattenAllOf(netexLibrary, _cachedSampleName);
      var exclSet = hostExclSet(allProps);

      // Flat: interface shape with exclusions + collapse
      _cachedSampleStem = flattenFake(_cachedSampleName, _cachedFakeMock, { excludeProps: exclSet, props: allProps, collapse: collapseOpts() });
      // XmlShaped + XML: strip excluded props from raw mock, keep schema shape
      var filteredRaw = {};
      for (var k in _cachedFakeMock) { if (!exclSet || !exclSet.has(k)) filteredRaw[k] = _cachedFakeMock[k]; }
      _cachedSampleNested = toXmlShape(_cachedSampleName, filteredRaw);

      var flatPanel = explorerSample.querySelector('[data-fmt="js"]');
      if (flatPanel) flatPanel.innerHTML = highlightJsonStr(JSON.stringify(_cachedSampleStem, null, 2))
        + '<button class="copy-btn">Copy</button>';
      var nestedPanel = explorerSample.querySelector('[data-fmt="nested"]');
      if (nestedPanel) nestedPanel.innerHTML = highlightJsonStr(JSON.stringify(_cachedSampleNested, null, 2))
        + '<button class="copy-btn">Copy</button>';
      var xmlPanel = explorerSample.querySelector('[data-fmt="xml"]');
      if (xmlPanel) xmlPanel.innerHTML = esc(buildXml(_cachedSampleName, _cachedSampleNested))
        + '<button class="copy-btn">Copy</button>';
    }

    /** Build all three sample panels once, then show the requested format. */
    function renderSampleData(name, allProps) {
      _cachedFakeMock = fake(name);
      var exclSet = allProps ? hostExclSet(allProps) : undefined;
      _cachedSampleStem = flattenFake(name, _cachedFakeMock, { excludeProps: exclSet, props: allProps, collapse: collapseOpts() });
      // XmlShaped: strip excluded props from raw mock, keep schema shape for toXmlShape
      var filteredRaw = {};
      for (var k in _cachedFakeMock) { if (!exclSet || !exclSet.has(k)) filteredRaw[k] = _cachedFakeMock[k]; }
      _cachedSampleNested = toXmlShape(name, filteredRaw);
      _cachedSampleName = name;

      var html = '';
      // Pill toggle
      html += '<div class="sample-toggle">';
      html += '<label class="sample-pill active">';
      html += '<input type="radio" name="sampleFmt" value="js" checked> Flat';
      html += '</label>';
      html += '<label class="sample-pill">';
      html += '<input type="radio" name="sampleFmt" value="nested"> XmlShaped';
      html += '</label>';
      html += '<label class="sample-pill">';
      html += '<input type="radio" name="sampleFmt" value="xml"> XML';
      html += '</label>';
      html += '</div>';

      // Pre-render all three panels
      html += '<div class="sample-panel interface-block" data-fmt="js">';
      html += highlightJsonStr(JSON.stringify(_cachedSampleStem, null, 2));
      html += '<button class="copy-btn">Copy</button></div>';

      html += '<div class="sample-panel interface-block" data-fmt="nested" style="display:none">';
      html += highlightJsonStr(JSON.stringify(_cachedSampleNested, null, 2));
      html += '<button class="copy-btn">Copy</button></div>';

      html += '<div class="sample-panel interface-block" data-fmt="xml" style="display:none">';
      html += esc(buildXml(_cachedSampleName, _cachedSampleNested));
      html += '<button class="copy-btn">Copy</button></div>';

      explorerSample.innerHTML = html;
    }

    // Toggle handler for sample format pills — just toggle visibility
    explorerSample.addEventListener('change', function(e) {
      if (e.target.name === 'sampleFmt') {
        showSampleFormat(e.target.value);
      }
    });

    attachCopyHandler(explorerSample);
    attachCopyHandler(explorerMapping);

    // Graph node clicks
    graphContainer.addEventListener('click', e => {
      const node = e.target.closest('.graph-node');
      if (node && node.dataset.def && netexLibrary[node.dataset.def]) {
        if (decodeURIComponent(location.hash) !== '#' + node.dataset.def) location.hash = '#' + node.dataset.def;
        renderExplorer(node.dataset.def);
      }
    });

    // ── Resizable panes ──────────────────────────────────────────────────

    let explorerW = 380;
    const handle1 = document.getElementById('handle1');
    const handle2 = document.getElementById('handle2');
    let drag = null;

    /** Expand the explorer panel to its stored width. */
    function openExplorer() {
      explorerPanel.style.width = explorerW + 'px';
      document.body.classList.add('explorer-open');
    }
    /** Collapse the explorer panel and reset state. */
    function closeExplorer() {
      document.body.classList.remove('explorer-open');
      explorerPanel.style.width = '';
      currentExplored = null;
      currentMode = null;
      ifaceToggles.style.display = 'none';
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

    /** Close the currently open "used by entities" dropdown, if any. */
    function closeUsedByDropdown() {
      if (_openDropdown) {
        _openDropdown.classList.remove('open');
        _openDropdown = null;
      }
    }

    /**
     * Toggle the "used by entities" dropdown for a definition.
     *
     * Shows a spinner, then asynchronously computes transitive entity
     * users via BFS (findTransitiveEntityUsers) and renders chip links.
     */
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
        if (decodeURIComponent(location.hash) !== '#' + name) location.hash = '#' + name;
        renderExplorer(name);
        setExplorerMode('explore');
        openExplorer();
        return;
      }
      // Suggest code button click
      const sbtn = e.target.closest('.suggest-btn');
      if (sbtn) {
        e.preventDefault();
        const name = sbtn.dataset.def;
        if (decodeURIComponent(location.hash) !== '#' + name) location.hash = '#' + name;
        renderExplorer(name);
        setExplorerMode('code');
        openExplorer();
        return;
      }
      // Type link click inside explorer panel
      const typeLink = e.target.closest('.explorer-type-link');
      if (typeLink && explorerPanel.contains(typeLink)) {
        const href = typeLink.getAttribute('href');
        if (href && href.startsWith('#')) {
          const targetName = decodeURIComponent(href.slice(1));
          if (netexLibrary[targetName]) {
            renderExplorer(targetName);
            if (currentMode) setExplorerMode(currentMode);
          }
        }
      }
    });

    document.getElementById('explorerClose').addEventListener('click', closeExplorer);

    // Remove loading overlay — all DOM queries and setup are done
    var _loadingOverlay = document.getElementById('loadingOverlay');
    if (_loadingOverlay) _loadingOverlay.remove();
