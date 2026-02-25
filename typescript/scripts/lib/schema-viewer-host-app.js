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
     *  - HTML builders for explorer tabs (graph, interface, mapping, utils)
     *  - "Used by entities" dropdown (BFS via findTransitiveEntityUsers)
     *  - Via-chain hover popup on interface properties
     *  - Copy-to-clipboard for code blocks
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
    const defs = JSON.parse(document.getElementById('schema-data').textContent);
    /*@@VIEWER_FNS@@*/
    const explorerPanel = document.getElementById('explorerPanel');
    const explorerTitle = document.getElementById('explorerTitle');
    const explorerSubtitle = document.getElementById('explorerSubtitle');
    const explorerProps = document.getElementById('explorerProps');
    const graphContainer = document.getElementById('graphContainer');
    let currentExplored = null;
    let currentMode = null;

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
      if (props.length === 0) html = '<p class="explorer-empty">No properties found.</p>';

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
          var hasDef = ref.target && defs[ref.target];
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

    // ── Interface tab ─────────────────────────────────────────────────

    const explorerIface = document.getElementById('explorerIface');
    var inlineRefsEnabled = false;

    /**
     * Build the "suggested flat interface" HTML for the Interface tab.
     *
     * Flattens the allOf inheritance chain, resolves each property's
     * TypeScript type, and emits syntax-highlighted pseudo-code with
     * clickable ref links and `data-via` attributes for hover popups.
     *
     * @param {string} name  Definition name.
     * @returns {string} An `.interface-block` div with a Copy button.
     */
    function renderInterfaceHtml(name) {
      var flat = flattenAllOf(defs, name);
      var props = inlineRefsEnabled ? inlineSingleRefs(flat) : flat;
      var origins = [];
      var originSeen = {};
      for (var oi = 0; oi < props.length; oi++) {
        if (!originSeen[props[oi].origin]) { originSeen[props[oi].origin] = true; origins.push(props[oi].origin); }
      }

      var lines = [];
      lines.push('<span class="if-cmt">/**');
      lines.push(' * Suggested flat interface for ' + esc(name));
      lines.push(' * Resolved from ' + origins.length + ' type' + (origins.length !== 1 ? 's' : '') + ' in the inheritance chain');
      lines.push(' */</span>');
      lines.push('<span class="if-kw">interface</span> My_' + esc(name) + ' {');

      var lastOrigin = null;
      var lastInlinedFrom = null;
      for (var pi = 0; pi < props.length; pi++) {
        var p = props[pi];
        if (p.origin !== lastOrigin) {
          if (lastOrigin !== null) lines.push('');
          lines.push('  <span class="if-cmt">// \u2500\u2500 ' + esc(p.origin) + ' \u2500\u2500</span>');
          lastOrigin = p.origin;
          lastInlinedFrom = null;
        }
        if (p.inlinedFrom && p.inlinedFrom !== lastInlinedFrom) {
          lines.push('  <span class="if-cmt">// \u2500\u2500 ' + esc(p.inlinedFrom) + ' (inlined) \u2500\u2500</span>');
          lastInlinedFrom = p.inlinedFrom;
        } else if (!p.inlinedFrom && lastInlinedFrom) {
          lastInlinedFrom = null;
        }
        var resolved = resolvePropertyType(p.schema);
        var typeHtml;
        if (resolved.complex) {
          var typeName = resolved.ts.endsWith('[]') ? resolved.ts.slice(0, -2) : resolved.ts;
          var suffix = resolved.ts.endsWith('[]') ? '[]' : '';
          typeHtml = '<a class="if-ref explorer-type-link" href="#' + esc(typeName) + '">' + esc(typeName) + '</a>' + suffix;
          var atom = resolveAtom(typeName);
          if (atom && atom !== 'simpleObj') typeHtml += ' <span class="if-cmt">// \u2192 ' + esc(atom) + '</span>';
        } else if (resolved.ts.indexOf('|') !== -1) {
          var parts = resolved.ts.split(' | ');
          typeHtml = parts.map(function(part) {
            part = part.trim();
            if (part.charAt(0) === '"' || part.charAt(0) === "'") return '<span class="if-lit">' + esc(part) + '</span>';
            return '<span class="if-prim">' + esc(part) + '</span>';
          }).join(' | ');
        } else if (resolved.ts.indexOf('/*') !== -1) {
          var ci = resolved.ts.indexOf(' /*');
          if (ci !== -1) typeHtml = '<span class="if-prim">' + esc(resolved.ts.slice(0, ci)) + '</span><span class="if-cmt">' + esc(resolved.ts.slice(ci)) + '</span>';
          else typeHtml = '<span class="if-prim">' + esc(resolved.ts) + '</span>';
        } else {
          typeHtml = '<span class="if-prim">' + esc(resolved.ts) + '</span>';
        }
        var viaAttr = '';
        if (resolved.via && resolved.via.length > 0) {
          viaAttr = ' data-via="' + encodeURIComponent(JSON.stringify(resolved.via)) + '"';
        }
        lines.push('  <span class="if-prop"' + viaAttr + '>' + esc(p.prop[1]) + '</span>?: ' + typeHtml + ';');
      }

      lines.push('}');

      var html = '<label class="iface-toggle"><input type="checkbox" id="inlineRefsCheck"' + (inlineRefsEnabled ? ' checked' : '') + '> Inline 1-to-1 refs</label>';
      html += '<div class="interface-block">' + lines.join('\n');
      html += '<button class="copy-btn" id="ifaceCopy">Copy</button></div>';
      return html;
    }

    /** Render the Interface tab into its container element. */
    function renderInterface(name) {
      explorerIface.innerHTML = renderInterfaceHtml(name);
      var cb = document.getElementById('inlineRefsCheck');
      if (cb) {
        cb.addEventListener('change', function() {
          inlineRefsEnabled = cb.checked;
          renderInterface(name);
        });
      }
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

    /**
     * Build the Mapping tab HTML: `toGenerated` and `fromGenerated` converters.
     *
     * For simpleContent atom types the `fromGenerated` body includes a
     * `?.value` unwrap with a comment showing the atom primitive.
     *
     * @param {string} name  Definition name.
     * @returns {string} A `.mapping-section` div with two code blocks and Copy buttons.
     */
    function renderMappingHtml(name) {
      var props = flattenAllOf(defs, name);
      var myName = 'My_' + name;

      var html = '';
      html += '<div class="mapping-section">';
      html += '<p class="mapping-intro">';
      html += 'The generated <code>' + esc(name) + '</code> uses intersection types from the NeTEx inheritance chain. ';
      html += 'The flat <code>' + esc(myName) + '</code> from the Interface tab is simpler to work with. ';
      html += 'These functions convert between them.</p>';

      html += '<h3>' + esc(myName) + ' \u2192 ' + esc(name) + '</h3>';
      html += '<div class="interface-block">';
      var toLines = [];
      toLines.push('<span class="if-kw">function</span> toGenerated(src: <span class="if-ref">' + esc(myName) + '</span>): <span class="if-ref">' + esc(name) + '</span> {');
      toLines.push('  <span class="if-cmt">// The generated type is an intersection (allOf),</span>');
      toLines.push('  <span class="if-cmt">// but at runtime it\u2019s just a plain object with the same keys.</span>');
      toLines.push('  <span class="if-kw">return</span> src <span class="if-kw">as unknown as</span> <span class="if-ref">' + esc(name) + '</span>;');
      toLines.push('}');
      html += toLines.join('\n');
      html += '<button class="copy-btn">Copy</button></div>';

      html += '<h3>' + esc(name) + ' \u2192 ' + esc(myName) + '</h3>';
      html += '<div class="interface-block">';
      var fromLines = [];
      fromLines.push('<span class="if-kw">function</span> fromGenerated(src: <span class="if-ref">' + esc(name) + '</span>): <span class="if-ref">' + esc(myName) + '</span> {');
      fromLines.push('  <span class="if-kw">return</span> {');
      for (var mi = 0; mi < props.length; mi++) {
        var p = props[mi];
        var resolved = resolvePropertyType(p.schema);
        var atom = null;
        if (resolved.complex) {
          var typeName = resolved.ts.endsWith('[]') ? resolved.ts.slice(0, -2) : resolved.ts;
          atom = resolveAtom(typeName);
        }
        if (atom && atom !== 'simpleObj') {
          fromLines.push('    ' + esc(p.prop[1]) + ': src.' + esc(p.prop[0]) + '<span class="if-cmt">?.value</span>,  <span class="if-cmt">// ' + esc(resolved.ts) + ' \u2192 ' + esc(atom) + '</span>');
        } else {
          fromLines.push('    ' + esc(p.prop[1]) + ': src.' + esc(p.prop[0]) + ',');
        }
      }
      fromLines.push('  };');
      fromLines.push('}');
      html += fromLines.join('\n');
      html += '<button class="copy-btn">Copy</button></div>';

      html += '</div>';
      return html;
    }

    /** Render the Mapping tab into its container element. */
    function renderMappingGuide(name) {
      explorerMapping.innerHTML = renderMappingHtml(name);
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

    /**
     * Build the Utilities tab HTML: type guard, factory, and references.
     *
     * Sections:
     *  - **Type Guard** — `isFoo(o)` with typeof / Array.isArray checks
     *  - **Factory** — `createFoo(init?)` with required-field defaults
     *  - **References** — outgoing "Uses" and incoming "Used by" chip lists
     *
     * @param {string} name  Definition name.
     * @returns {string} Three `.mapping-section` divs with code blocks and Copy buttons.
     */
    function renderUtilsHtml(name) {
      var props = flattenAllOf(defs, name);
      var required = collectRequired(defs, name);

      var html = '';

      // Type Guard
      html += '<div class="mapping-section"><h3>Type Guard</h3>';
      html += '<div class="interface-block">';
      var lines = [];
      lines.push('<span class="if-kw">function</span> is' + esc(name) + '(o: <span class="if-prim">unknown</span>): o <span class="if-kw">is</span> <span class="if-ref">' + esc(name) + '</span> {');
      lines.push('  <span class="if-kw">if</span> (!o || <span class="if-kw">typeof</span> o !== <span class="if-lit">"object"</span>) <span class="if-kw">return false</span>;');
      lines.push('  <span class="if-kw">const</span> obj = o <span class="if-kw">as</span> Record&lt;<span class="if-prim">string</span>, <span class="if-prim">unknown</span>&gt;;');
      for (var gi = 0; gi < props.length; gi++) {
        var p = props[gi];
        var resolved = resolvePropertyType(p.schema);
        var check = '';
        if (resolved.ts.endsWith('[]')) {
          check = '!Array.isArray(obj.' + p.prop[1] + ')';
        } else if (resolved.complex) {
          check = '<span class="if-kw">typeof</span> obj.' + esc(p.prop[1]) + ' !== <span class="if-lit">"object"</span>';
        } else {
          var base = resolved.ts;
          if (base.indexOf('/*') !== -1) base = base.slice(0, base.indexOf(' /*')).trim();
          if (base.indexOf('|') !== -1) {
            var firstPart = base.split('|')[0].trim();
            if (firstPart.charAt(0) === '"' || firstPart.charAt(0) === "'") {
              check = '<span class="if-kw">typeof</span> obj.' + esc(p.prop[1]) + ' !== <span class="if-lit">"string"</span>';
            } else {
              check = '<span class="if-kw">typeof</span> obj.' + esc(p.prop[1]) + ' !== <span class="if-lit">"' + esc(firstPart) + '"</span>';
            }
          } else if (base === 'integer') {
            check = '<span class="if-kw">typeof</span> obj.' + esc(p.prop[1]) + ' !== <span class="if-lit">"number"</span>';
          } else {
            check = '<span class="if-kw">typeof</span> obj.' + esc(p.prop[1]) + ' !== <span class="if-lit">"' + esc(base) + '"</span>';
          }
        }
        lines.push('  <span class="if-kw">if</span> (<span class="if-lit">"' + esc(p.prop[1]) + '"</span> <span class="if-kw">in</span> obj && ' + check + ') <span class="if-kw">return false</span>;');
      }
      lines.push('  <span class="if-kw">return true</span>;');
      lines.push('}');
      html += lines.join('\n');
      html += '<button class="copy-btn">Copy</button></div></div>';

      // Factory
      html += '<div class="mapping-section"><h3>Factory</h3>';
      html += '<div class="interface-block">';
      var flines = [];
      flines.push('<span class="if-kw">function</span> create' + esc(name) + '(');
      flines.push('  init?: Partial&lt;<span class="if-ref">' + esc(name) + '</span>&gt;');
      flines.push('): <span class="if-ref">' + esc(name) + '</span> {');
      if (required.size > 0) {
        flines.push('  <span class="if-kw">return</span> {');
        for (var fi = 0; fi < props.length; fi++) {
          var fp = props[fi];
          if (!required.has(fp.prop[0])) continue;
          var fresolved = resolvePropertyType(fp.schema);
          var defVal = defaultForType(fresolved.ts);
          flines.push('    ' + esc(fp.prop[1]) + ': ' + '<span class="if-lit">' + esc(defVal) + '</span>,  <span class="if-cmt">// required</span>');
        }
        flines.push('    ...init,');
        flines.push('  };');
      } else {
        flines.push('  <span class="if-kw">return</span> { ...init } <span class="if-kw">as</span> <span class="if-ref">' + esc(name) + '</span>;');
      }
      flines.push('}');
      html += flines.join('\n');
      html += '<button class="copy-btn">Copy</button></div></div>';

      // References
      html += '<div class="mapping-section"><h3>References</h3>';

      var uses = [];
      var seen = {};
      for (var ui = 0; ui < props.length; ui++) {
        var t = refTarget(props[ui].schema);
        if (t && !seen[t]) {
          seen[t] = true;
          uses.push(t);
        }
      }
      html += '<div class="utils-section"><span class="utils-label">Uses</span>';
      if (uses.length > 0) {
        html += '<div class="ref-list">';
        for (var uj = 0; uj < uses.length; uj++) {
          html += '<a href="#' + esc(uses[uj]) + '" class="ref-chip explorer-type-link">' + esc(uses[uj]) + '</a>';
        }
        html += '</div>';
      } else {
        html += ' <span class="ref-empty">none</span>';
      }
      html += '</div>';

      var usedBy = (buildReverseIndex()[name] || []).slice().sort();
      html += '<div><span class="utils-label">Used by</span>';
      if (usedBy.length > 0) {
        html += '<div class="ref-list">';
        for (var uk = 0; uk < usedBy.length; uk++) {
          html += '<a href="#' + esc(usedBy[uk]) + '" class="ref-chip explorer-type-link">' + esc(usedBy[uk]) + '</a>';
        }
        html += '</div>';
      } else {
        html += ' <span class="ref-empty">none</span>';
      }
      html += '</div></div>';

      return html;
    }

    /** Render the Utilities tab into its container element. */
    function renderUtils(name) {
      explorerUtils.innerHTML = renderUtilsHtml(name);
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
          if (defs[targetName]) {
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
