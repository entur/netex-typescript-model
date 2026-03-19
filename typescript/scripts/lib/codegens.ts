/**
 * Code generators extracted from schema-viewer-host-app.js.
 *
 * Each function takes `(defs, name, opts?)` and returns generated TypeScript
 * code. When `opts.html` is true (default), output includes `<span>` tags and
 * `<a>` links for browser rendering. When false, output is plain text —
 * testable and CLI-usable.
 */

import {
  flattenAllOf,
  collectRequired,
  resolveDefType,
  resolvePropertyType,
  resolveAtom,
  inlineSingleRefs,
  refTarget,
  defRole,
  type Defs,
  type FlatProperty,
} from "./fns.js";

import { defaultForType } from "./data-faker.js";

// ── Escaping ────────────────────────────────────────────────────────────────

/** HTML-escape `<>&"` characters. */
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Identity function — used when html mode is off. */
function escPlain(s: string): string {
  return s;
}

/** Return the appropriate escape function for the given mode. */
function escFn(html: boolean): (s: string) => string {
  return html ? escHtml : escPlain;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Convert a PascalCase type name to UPPER_SNAKE_CASE for a const array name.
 * Strips trailing "Enumeration" suffix before converting.
 * e.g. "AllPublicTransportModesEnumeration" → "ALL_PUBLIC_TRANSPORT_MODES"
 */
export function toConstName(name: string): string {
  const base = name.replace(/Enumeration$/, "");
  return base
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

// ── Type rendering helpers ──────────────────────────────────────────────────

/** Render a resolved TypeScript type as a formatted string (HTML or plain). */
function renderTypeStr(
  defs: Defs,
  resolved: { ts: string; complex: boolean },
  html: boolean,
  name: string,
): string {
  const e = escFn(html);
  if (resolved.complex) {
    const typeName = resolved.ts.endsWith("[]") ? resolved.ts.slice(0, -2) : resolved.ts;
    const suffix = resolved.ts.endsWith("[]") ? "[]" : "";
    let result: string;
    if (html) {
      result =
        '<a class="if-ref explorer-type-link" href="#' +
        e(typeName) +
        '">' +
        e(typeName) +
        "</a>" +
        suffix;
    } else {
      result = typeName + suffix;
    }
    const atom = resolveAtom(defs, typeName);
    if (atom && atom !== "simpleObj") {
      result += html
        ? ' <span class="if-cmt">// \u2192 ' + e(atom) + "</span>"
        : " // \u2192 " + atom;
    }
    return result;
  }
  if (defs[resolved.ts]) {
    // Named def resolved as non-complex (e.g. stamped enum) — still linkable
    return html
      ? '<a class="if-ref explorer-type-link" href="#' +
          e(resolved.ts) +
          '">' +
          e(resolved.ts) +
          "</a>"
      : resolved.ts;
  }
  if (resolved.ts.indexOf("|") !== -1) {
    const parts = resolved.ts.split(" | ");
    return parts
      .map((part) => {
        part = part.trim();
        if (part.charAt(0) === '"' || part.charAt(0) === "'") {
          return html ? '<span class="if-lit">' + e(part) + "</span>" : part;
        }
        return html ? '<span class="if-prim">' + e(part) + "</span>" : part;
      })
      .join(" | ");
  }
  if (resolved.ts.indexOf("/*") !== -1) {
    const ci = resolved.ts.indexOf(" /*");
    if (ci !== -1) {
      return html
        ? '<span class="if-prim">' +
            e(resolved.ts.slice(0, ci)) +
            '</span><span class="if-cmt">' +
            e(resolved.ts.slice(ci)) +
            "</span>"
        : resolved.ts;
    }
  }
  return html ? '<span class="if-prim">' + e(resolved.ts) + "</span>" : resolved.ts;
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface InterfaceOpts {
  /** Emit HTML tags (default: true). */
  html?: boolean;
  /** Omit JSDoc/origin comments (default: false). */
  compact?: boolean;
  /** Inline single-ref properties (default: false). */
  inlineRefs?: boolean;
  /** Pre-computed flat properties (avoids recomputing). */
  preProps?: FlatProperty[];
}

export interface TypeAliasOpts {
  html?: boolean;
  compact?: boolean;
}

export interface TypeGuardOpts {
  html?: boolean;
  /** Pre-computed flat properties. */
  preProps?: FlatProperty[];
}

export interface FactoryOpts {
  html?: boolean;
  /** Pre-computed flat properties. */
  preProps?: FlatProperty[];
  /** Pre-computed required set. */
  preRequired?: Set<string>;
}

// ── generateTypeAlias ───────────────────────────────────────────────────────

/**
 * Generate a type alias for a definition that resolves to a primitive or enum.
 *
 * Enum output uses `const` array + indexed type pattern.
 * Non-enum produces `type FooRef = string;`.
 */
export function generateTypeAlias(
  defs: Defs,
  name: string,
  resolved: { ts: string; complex: boolean; via?: Array<{ name: string; rule: string }> },
  opts?: TypeAliasOpts,
): { text: string; isAlias: boolean } {
  const html = opts?.html !== false;
  const compact = opts?.compact ?? false;
  const e = escFn(html);

  // Find the enum values — walk through the via chain to find the def with .enum
  let enumValues: unknown[] | null = null;
  const def = defs[name];
  if (def && def.enum) {
    enumValues = def.enum;
  } else if (resolved.via) {
    for (const hop of resolved.via) {
      const hopDef = defs[hop.name];
      if (hopDef && hopDef.enum) {
        enumValues = hopDef.enum;
        break;
      }
    }
  }

  const lines: string[] = [];
  if (!compact) {
    if (html) {
      lines.push('<span class="if-cmt">/**');
      lines.push(" * Type alias for " + e(name));
      if (resolved.via && resolved.via.length > 0) {
        const chain = resolved.via
          .map((hop) => hop.name + " \u2192 " + hop.rule)
          .join(" \u2192 ");
        lines.push(" * Resolved via: " + e(chain));
      }
      lines.push(" */</span>");
    } else {
      lines.push("/**");
      lines.push(" * Type alias for " + name);
      if (resolved.via && resolved.via.length > 0) {
        const chain = resolved.via
          .map((hop) => hop.name + " \u2192 " + hop.rule)
          .join(" \u2192 ");
        lines.push(" * Resolved via: " + chain);
      }
      lines.push(" */");
    }
  }

  // Enum with values → const array + indexed type
  if (enumValues) {
    const constName = toConstName(name);
    if (html) {
      const litItems = enumValues.map(
        (v) => '  <span class="if-lit">' + e(JSON.stringify(v)) + "</span>",
      );
      lines.push('<span class="if-kw">const</span> ' + e(constName) + " = [");
      lines.push(litItems.join(",\n"));
      lines.push('] <span class="if-kw">as const</span>;');
      lines.push(
        '<span class="if-kw">type</span> ' +
          e(name) +
          ' = (<span class="if-kw">typeof</span> ' +
          e(constName) +
          ')[<span class="if-prim">number</span>];',
      );
    } else {
      const litItems = enumValues.map((v) => "  " + JSON.stringify(v));
      lines.push("const " + constName + " = [");
      lines.push(litItems.join(",\n"));
      lines.push("] as const;");
      lines.push("type " + name + " = (typeof " + constName + ")[number];");
    }
  } else {
    // Non-enum type alias
    const typeStr = renderTypeStr(defs, resolved, html, name);
    if (html) {
      lines.push('<span class="if-kw">type</span> ' + e(name) + " = " + typeStr + ";");
    } else {
      lines.push("type " + name + " = " + typeStr + ";");
    }
  }

  return { text: lines.join("\n"), isAlias: true };
}

// ── generateInterface ───────────────────────────────────────────────────────

/**
 * Generate a TypeScript interface for a definition.
 *
 * Flattens the allOf inheritance chain, resolves each property's TypeScript
 * type, and emits formatted code. When `html` is true, output includes
 * syntax-highlighting spans, clickable ref links, and `data-via` attributes.
 *
 * When flattenAllOf returns empty props, delegates to `generateTypeAlias`.
 */
export function generateInterface(
  defs: Defs,
  name: string,
  opts?: InterfaceOpts,
): { text: string; isAlias: boolean } {
  const html = opts?.html !== false;
  const compact = opts?.compact ?? false;
  const inlineRefs = opts?.inlineRefs ?? false;
  const e = escFn(html);

  let flat = opts?.preProps || flattenAllOf(defs, name);

  // If no properties, try to render as a type alias
  if (flat.length === 0) {
    const resolved = resolveDefType(defs, name);
    const isAlias = !resolved.complex || resolved.ts !== name;
    if (isAlias) {
      return generateTypeAlias(defs, name, resolved, { html, compact });
    }
  }

  const props = !compact && inlineRefs ? inlineSingleRefs(defs, flat) : flat;
  const lines: string[] = [];

  if (!compact) {
    const originSeen: Record<string, boolean> = {};
    const origins: string[] = [];
    for (const p of props) {
      if (!originSeen[p.origin]) {
        originSeen[p.origin] = true;
        origins.push(p.origin);
      }
    }
    if (html) {
      lines.push('<span class="if-cmt">/**');
      lines.push(" * Suggested flat interface for " + e(name));
      lines.push(
        " * Resolved from " +
          origins.length +
          " type" +
          (origins.length !== 1 ? "s" : "") +
          " in the inheritance chain",
      );
      lines.push(" */</span>");
    } else {
      lines.push("/**");
      lines.push(" * Suggested flat interface for " + name);
      lines.push(
        " * Resolved from " +
          origins.length +
          " type" +
          (origins.length !== 1 ? "s" : "") +
          " in the inheritance chain",
      );
      lines.push(" */");
    }
  }

  if (html) {
    lines.push('<span class="if-kw">interface</span> ' + e(name) + " {");
  } else {
    lines.push("interface " + name + " {");
  }

  let lastOrigin: string | null = null;
  let lastInlinedFrom: string | null = null;
  for (const p of props) {
    if (!compact) {
      if (p.origin !== lastOrigin) {
        if (lastOrigin !== null) lines.push("");
        if (html) {
          lines.push('  <span class="if-cmt">// \u2500\u2500 ' + e(p.origin) + " \u2500\u2500</span>");
        } else {
          lines.push("  // \u2500\u2500 " + p.origin + " \u2500\u2500");
        }
        lastOrigin = p.origin;
        lastInlinedFrom = null;
      }
      if (p.inlinedFrom && p.inlinedFrom !== lastInlinedFrom) {
        if (html) {
          lines.push(
            '  <span class="if-cmt">// \u2500\u2500 ' +
              e(p.inlinedFrom) +
              " (inlined) \u2500\u2500</span>",
          );
        } else {
          lines.push("  // \u2500\u2500 " + p.inlinedFrom + " (inlined) \u2500\u2500");
        }
        lastInlinedFrom = p.inlinedFrom;
      } else if (!p.inlinedFrom && lastInlinedFrom) {
        lastInlinedFrom = null;
      }
    }

    const resolved = resolvePropertyType(defs, p.schema, name);
    const typeStr = renderTypeStr(defs, resolved, html, name);
    if (html) {
      let viaAttr = "";
      if (!compact && resolved.via && resolved.via.length > 0) {
        viaAttr = ' data-via="' + encodeURIComponent(JSON.stringify(resolved.via)) + '"';
      }
      lines.push(
        '  <span class="if-prop"' + viaAttr + ">" + e(p.prop[1]) + "</span>?: " + typeStr + ";",
      );
    } else {
      lines.push("  " + p.prop[1] + "?: " + typeStr + ";");
    }
  }

  lines.push("}");
  return { text: lines.join("\n"), isAlias: false };
}

// ── generateTypeGuard ───────────────────────────────────────────────────────

/**
 * Generate a runtime type guard function for a definition.
 *
 * Produces `function isFoo(o: unknown): o is Foo { ... }` with typeof /
 * Array.isArray checks for each property.
 */
export function generateTypeGuard(
  defs: Defs,
  name: string,
  opts?: TypeGuardOpts,
): string {
  const html = opts?.html !== false;
  const e = escFn(html);
  const props = opts?.preProps || flattenAllOf(defs, name);

  const lines: string[] = [];
  if (html) {
    lines.push(
      '<span class="if-kw">function</span> is' +
        e(name) +
        '(o: <span class="if-prim">unknown</span>): o <span class="if-kw">is</span> <span class="if-ref">' +
        e(name) +
        "</span> {",
    );
    lines.push(
      '  <span class="if-kw">if</span> (!o || <span class="if-kw">typeof</span> o !== <span class="if-lit">"object"</span>) <span class="if-kw">return false</span>;',
    );
    lines.push(
      '  <span class="if-kw">const</span> obj = o <span class="if-kw">as</span> Record&lt;<span class="if-prim">string</span>, <span class="if-prim">unknown</span>&gt;;',
    );
  } else {
    lines.push("function is" + name + "(o: unknown): o is " + name + " {");
    lines.push('  if (!o || typeof o !== "object") return false;');
    lines.push("  const obj = o as Record<string, unknown>;");
  }

  for (const p of props) {
    const resolved = resolvePropertyType(defs, p.schema, name);
    let check: string;

    if (resolved.ts.endsWith("[]")) {
      if (html) {
        check = "!Array.isArray(obj." + e(p.prop[1]) + ")";
      } else {
        check = "!Array.isArray(obj." + p.prop[1] + ")";
      }
    } else if (resolved.complex) {
      if (html) {
        check =
          '<span class="if-kw">typeof</span> obj.' +
          e(p.prop[1]) +
          ' !== <span class="if-lit">"object"</span>';
      } else {
        check = 'typeof obj.' + p.prop[1] + ' !== "object"';
      }
    } else {
      let base = resolved.ts;
      if (base.indexOf("/*") !== -1) base = base.slice(0, base.indexOf(" /*")).trim();
      let checkType: string;
      if (base.indexOf("|") !== -1) {
        const firstPart = base.split("|")[0].trim();
        checkType =
          firstPart.charAt(0) === '"' || firstPart.charAt(0) === "'" ? "string" : firstPart;
      } else if (base === "integer") {
        checkType = "number";
      } else if (base.charAt(0) === '"' || base.charAt(0) === "'") {
        checkType = "string";
      } else {
        checkType = base;
      }
      if (html) {
        check =
          '<span class="if-kw">typeof</span> obj.' +
          e(p.prop[1]) +
          ' !== <span class="if-lit">"' +
          e(checkType) +
          '"</span>';
      } else {
        check = 'typeof obj.' + p.prop[1] + ' !== "' + checkType + '"';
      }
    }

    if (html) {
      lines.push(
        '  <span class="if-kw">if</span> (<span class="if-lit">"' +
          e(p.prop[1]) +
          '"</span> <span class="if-kw">in</span> obj && ' +
          check +
          ') <span class="if-kw">return false</span>;',
      );
    } else {
      lines.push('  if ("' + p.prop[1] + '" in obj && ' + check + ") return false;");
    }
  }

  if (html) {
    lines.push('  <span class="if-kw">return true</span>;');
  } else {
    lines.push("  return true;");
  }
  lines.push("}");
  return lines.join("\n");
}

// ── generateFactory ─────────────────────────────────────────────────────────

/**
 * Generate a factory function for a definition.
 *
 * Produces `function createFoo(init?: Partial<Foo>): Foo { ... }` with
 * default values for required fields.
 */
export function generateFactory(
  defs: Defs,
  name: string,
  opts?: FactoryOpts,
): string {
  const html = opts?.html !== false;
  const e = escFn(html);
  const props = opts?.preProps || flattenAllOf(defs, name);
  const required = opts?.preRequired || collectRequired(defs, name);

  const lines: string[] = [];
  if (html) {
    lines.push('<span class="if-kw">function</span> create' + e(name) + "(");
    lines.push(
      '  init?: Partial&lt;<span class="if-ref">' + e(name) + "</span>&gt;",
    );
    lines.push('): <span class="if-ref">' + e(name) + "</span> {");
  } else {
    lines.push("function create" + name + "(");
    lines.push("  init?: Partial<" + name + ">");
    lines.push("): " + name + " {");
  }

  if (required.size > 0) {
    if (html) {
      lines.push('  <span class="if-kw">return</span> {');
    } else {
      lines.push("  return {");
    }
    for (const fp of props) {
      if (!required.has(fp.prop[0])) continue;
      const fresolved = resolvePropertyType(defs, fp.schema, name);
      const defVal = defaultForType(fresolved.ts);
      if (html) {
        lines.push(
          "    " +
            e(fp.prop[1]) +
            ": " +
            '<span class="if-lit">' +
            e(defVal) +
            "</span>,  " +
            '<span class="if-cmt">// required</span>',
        );
      } else {
        lines.push("    " + fp.prop[1] + ": " + defVal + ",  // required");
      }
    }
    lines.push("    ...init,");
    lines.push("  };");
  } else {
    if (html) {
      lines.push(
        '  <span class="if-kw">return</span> { ...init } <span class="if-kw">as</span> <span class="if-ref">' +
          e(name) +
          "</span>;",
      );
    } else {
      lines.push("  return { ...init } as " + name + ";");
    }
  }

  lines.push("}");
  return lines.join("\n");
}
