/**
 * Code generators extracted from schema-viewer-host-app.js.
 *
 * Each function takes `(netexLibrary, name, opts?)` and returns generated TypeScript
 * code. When `opts.html` is true (default), output includes `<span>` tags and
 * `<a>` links for browser rendering. When false, output is plain text —
 * testable and CLI-usable.
 */

import type { NetexLibrary, FlatProperty } from "./types.js";
import { defRole } from "./classify.js";
import { flattenAllOf, ESSENTIAL_OMNI_PROPS, OMNIPRESENT_DEFS } from "./schema-nav.js";
import { resolveDefType, resolvePropertyType, resolveAtom } from "./type-res.js";
import { collectDependencyTree } from "./dep-graph.js";

/** Infrastructure base-type origins rendered after domain-specific properties. */
const TAIL_ORIGINS = new Set(["EntityInVersionStructure", "DataManagedObjectStructure"]);

export type { NetexLibrary };


// ── Escaping ────────────────────────────────────────────────────────────────

/** HTML-escape `<>&"` characters. */
export function escHtml(s: string): string {
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
  netexLibrary: NetexLibrary,
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
    const atom = resolveAtom(netexLibrary, typeName);
    if (atom && atom !== "simpleObj") {
      result += html
        ? ' <span class="if-cmt">// \u2192 ' + e(atom) + "</span>"
        : " // \u2192 " + atom;
    }
    return result;
  }
  if (netexLibrary[resolved.ts]) {
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
  /** Include JSDoc/origin comments (default: true). */
  metaComments?: boolean;
  /** Pre-computed flat properties (avoids recomputing). */
  preProps?: FlatProperty[];
  /** Prepend exclude-from-codegen checkboxes to each property line (HTML only). */
  excludeCheckboxes?: boolean;
  /** Collapse omnipresent origin banners into "Essential base attrs" (when hide-base-props is on). */
  omniCollapse?: boolean;
  /** Filter out specific properties by canonical name. */
  excludeProps?: Set<string>;
}

export interface TypeAliasOpts {
  html?: boolean;
  /** Include JSDoc/origin comments (default: true). */
  metaComments?: boolean;
}

// ── generateTypeAlias ───────────────────────────────────────────────────────

/**
 * Generate a type alias for a definition that resolves to a primitive or enum.
 *
 * Enum output uses `const` array + indexed type pattern.
 * Non-enum produces `type FooRef = string;`.
 */
export function generateTypeAlias(
  netexLibrary: NetexLibrary,
  name: string,
  resolved: { ts: string; complex: boolean; via?: Array<{ name: string; rule: string }> },
  opts?: TypeAliasOpts,
): { text: string; isAlias: boolean } {
  const html = opts?.html !== false;
  const metaComments = opts?.metaComments ?? true;
  const e = escFn(html);

  // Find the enum values — walk through the via chain to find the def with .enum
  let enumValues: unknown[] | null = null;
  const def = netexLibrary[name];
  if (def && def.enum) {
    enumValues = def.enum;
  } else if (resolved.via) {
    for (const hop of resolved.via) {
      const hopDef = netexLibrary[hop.name];
      if (hopDef && hopDef.enum) {
        enumValues = hopDef.enum;
        break;
      }
    }
  }

  const lines: string[] = [];
  if (metaComments) {
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
    const typeStr = renderTypeStr(netexLibrary, resolved, html, name);
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
  netexLibrary: NetexLibrary,
  name: string,
  opts?: InterfaceOpts,
): { text: string; isAlias: boolean } {
  const html = opts?.html !== false;
  const metaComments = opts?.metaComments ?? true;
  const excludeCb = html && (opts?.excludeCheckboxes ?? false);
  const omniCollapse = excludeCb && (opts?.omniCollapse ?? false);
  const e = escFn(html);

  let flat = opts?.preProps || flattenAllOf(netexLibrary, name);
  if (opts?.excludeProps) {
    flat = flat.filter((p) => !opts.excludeProps!.has(p.prop[1]));
  }

  // If no properties, try to render as a type alias
  if (flat.length === 0) {
    const resolved = resolveDefType(netexLibrary, name);
    const isAlias = !resolved.complex || resolved.ts !== name;
    if (isAlias) {
      return generateTypeAlias(netexLibrary, name, resolved, { html, metaComments });
    }
  }

  const ess = (p: FlatProperty) => omniCollapse && ESSENTIAL_OMNI_PROPS.has(p.prop[1]);
  const head = flat.filter((p) => !TAIL_ORIGINS.has(p.origin) || ess(p));
  const dmo = flat.filter((p) => p.origin === "DataManagedObjectStructure");
  const eiv = flat.filter((p) => p.origin === "EntityInVersionStructure" && !ess(p));
  const props = [...head, ...dmo, ...eiv];
  const lines: string[] = [];

  if (metaComments) {
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

  const ESSENTIAL_BANNER = "Essential base attrs";
  let lastOrigin: string | null = null;
  for (const p of props) {
    if (metaComments) {
      const origin =
        omniCollapse && OMNIPRESENT_DEFS.has(p.origin) && ESSENTIAL_OMNI_PROPS.has(p.prop[1])
          ? ESSENTIAL_BANNER
          : p.origin;
      if (origin !== lastOrigin) {
        if (lastOrigin !== null) lines.push("");
        if (html) {
          lines.push('  <span class="if-cmt">// \u2500\u2500 ' + e(origin) + " \u2500\u2500</span>");
        } else {
          lines.push("  // \u2500\u2500 " + origin + " \u2500\u2500");
        }
        lastOrigin = origin;
      }
    }

    const resolved = resolvePropertyType(netexLibrary, p.schema, name);
    const typeStr = renderTypeStr(netexLibrary, resolved, html, name);
    if (html) {
      let viaAttr = "";
      if (metaComments && resolved.via && resolved.via.length > 0) {
        viaAttr = ' data-via="' + encodeURIComponent(JSON.stringify(resolved.via)) + '"';
      }
      const propHtml =
        '  <span class="if-prop"' + viaAttr + ">" + e(p.prop[1]) + "</span>?: " + typeStr + ";";
      if (excludeCb) {
        if (ESSENTIAL_OMNI_PROPS.has(p.prop[1])) {
          lines.push('<span class="if-line"><span class="excl-spacer"></span>' + propHtml + "</span>");
        } else {
          lines.push(
            '<span class="if-line"><input type="checkbox" class="excl-cb">' + propHtml + "</span>",
          );
        }
      } else {
        lines.push(propHtml);
      }
    } else {
      lines.push("  " + p.prop[1] + "?: " + typeStr + ";");
    }
  }

  lines.push("}");
  return { text: lines.join("\n"), isAlias: false };
}

// ── Composite block generators ─────────────────────────────────────────────

/**
 * Collect the renderable (non-duplicate, non-alias, non-empty) dependency
 * names for a definition. Extracted from the host-app's inline 3-filter logic
 * so it can be tested and reused.
 */
export function collectRenderableDeps(netexLibrary: NetexLibrary, name: string, excludedMembers?: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const n of collectDependencyTree(netexLibrary, name, excludedMembers)) {
    if (n.duplicate || seen.has(n.name)) continue;
    seen.add(n.name);
    const r = resolveDefType(netexLibrary, n.name);
    if (!r.complex && defRole(netexLibrary[n.name]) !== "enumeration") continue;
    if (r.complex && r.ts !== n.name) continue;
    out.push(n.name);
  }
  return out;
}

/** Collect enum names targeted by any x-fixed-single-enum stamp. */
function collectFixedEnumTargets(netexLibrary: NetexLibrary): Set<string> {
  const targets = new Set<string>();
  for (const d of Object.values(netexLibrary)) {
    for (const ao of [d, ...(d.allOf ?? [])]) {
      if (!ao.properties) continue;
      for (const ps of Object.values(ao.properties)) {
        const t = (ps as Record<string, unknown>)["x-fixed-single-enum"];
        if (typeof t === "string") targets.add(t);
      }
    }
  }
  return targets;
}

/**
 * Generate compact interface blocks for all transitive subtypes of a
 * definition, excluding the root itself.
 */
export function generateSubTypesBlock(
  netexLibrary: NetexLibrary,
  name: string,
  opts?: { html?: boolean; excludedMembers?: Set<string>; excludeProps?: Set<string> },
): string {
  const html = opts?.html ?? false;
  const fixedEnumTargets = collectFixedEnumTargets(netexLibrary);

  const excl = opts?.excludeProps;
  return collectRenderableDeps(netexLibrary, name, opts?.excludedMembers)
    .filter((n) => {
      if (!excl || fixedEnumTargets.has(n)) return true;
      if (defRole(netexLibrary[n]) === "enumeration") return true;
      const flat = flattenAllOf(netexLibrary, n);
      return flat.some((p) => !excl.has(p.prop[1]));
    })
    .map((n) => {
      if (fixedEnumTargets.has(n)) {
        return html
          ? `<span class="if-kw">type</span> <span class="if-name">${n}</span> = <span class="if-type">string</span>;`
          : `type ${n} = string;`;
      }
      return generateInterface(netexLibrary, n, { html, metaComments: false, excludeProps: excl }).text;
    })
    .join("\n\n");
}
