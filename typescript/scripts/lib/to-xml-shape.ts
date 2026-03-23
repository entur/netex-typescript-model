/**
 * Static code generator for stem→XML projection functions.
 *
 * `makeInlinedToXmlShape` emits a per-entity JavaScript function that builds
 * an output object via const-based spread entries. Each property gets an
 * explicit `...(obj['x'] !== undefined && { xmlName: expr })` entry.
 * Complex ref-typed properties delegate to a `toXmlShape` callback.
 */

import {
  flattenAllOf,
  classifySchema,
  resolveAtom,
  resolvePropertyType,
  lcFirst,
  defRole,
  type NetexLibrary,
  type Def,
  type FlatProperty,
  type ResolvedType,
} from "./fns.js";
import { escHtml } from "./codegens.js";

/**
 * Resolve an abstract element head to the first concrete substitution group member.
 * Follows `x-netex-sg-members` chains until a non-abstract definition is found.
 */
function resolveConcreteElement(netexLibrary: NetexLibrary, name: string): string {
  const visited = new Set<string>();
  let current = name;
  while (!visited.has(current)) {
    visited.add(current);
    const d = netexLibrary[current];
    if (!d) break;
    const members = d["x-netex-sg-members"] as string[] | undefined;
    if (!members || members.length === 0) break;
    current = members[0];
  }
  return current;
}

/**
 * Check whether a ref-typed property resolves to a direct-assignable value
 * (primitive or empty array from `fake`) rather than a complex object that
 * needs `toXmlShape` delegation.
 */
function shouldDirectAssign(netexLibrary: NetexLibrary, refTarget: string, resolved: ResolvedType): boolean {
  const targetDef = netexLibrary[refTarget];
  if (!targetDef) return false;

  const role = defRole(targetDef);
  if (role === "collection" || role === "enumeration") return true;

  const atom = resolveAtom(netexLibrary, refTarget);
  if (atom && atom !== "simpleObj") return true;

  return !resolved.complex;
}

export interface InlineOptions {
  /** Emit `...name(obj)` spread instead of per-property entries for base properties. */
  baseCall?: string;
  /** Emit `...name(obj)` spread for simpleContent types. */
  baseSimpleCall?: string;
  /** Pre-computed flattened properties — avoids redundant `flattenAllOf` call. */
  props?: FlatProperty[];
  /** Callback name used in expressions (default: 'toXmlShape'). */
  callbackName?: string;
  /** If false, callback is a free variable, not a function parameter (default: true). */
  callbackAsParam?: boolean;
  /** Emit `<span class="if-*">` syntax-highlighting tags (default: false). */
  html?: boolean;
}

/** Format a JS property key — unquoted if valid identifier, single-quoted otherwise. */
function propKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;
}

/** Syntax-highlight tag helpers — return identity functions when html is false. */
function makeTaggers(html: boolean) {
  const e = html ? escHtml : (s: string) => s;
  return {
    e,
    kw: (s: string) => (html ? `<span class="if-kw">${s}</span>` : s),
    lit: (s: string) => (html ? `<span class="if-lit">${e(s)}</span>` : s),
    prop: (s: string) => (html ? `<span class="if-prop">${e(s)}</span>` : s),
    cmt: (s: string) => (html ? `<span class="if-cmt">${e(s)}</span>` : s),
  };
}

/**
 * Generate a standalone JavaScript function that performs the same
 * stem→XMLBuilder-shape transform as `toXmlShape` for a specific definition.
 *
 * Builds a const-based object via per-property spread entries that handle
 * attribute rename (`$`→`@_`), boolean stringification, and simpleContent
 * `value`→`#text`. Complex ref-typed properties delegate to a `toXmlShape`
 * callback.
 *
 * When `opts.baseCall` / `opts.baseSimpleCall` is provided, non-override
 * properties are handled by spreading the base helper's result, and only
 * override entries (complex/renamed) are emitted explicitly.
 */
export function makeInlinedToXmlShape(
  netexLibrary: NetexLibrary,
  name: string,
  opts?: InlineOptions,
): string {
  const props = opts?.props ?? flattenAllOf(netexLibrary, name);
  const isSimpleContent = resolveAtom(netexLibrary, name) === "simpleObj";
  const fnName = lcFirst(name) + "ToXmlShape";

  // ── Syntax-highlighting helpers ─────────────────────────────────────────

  const { e: esc, kw, lit, prop: propTag, cmt } = makeTaggers(opts?.html ?? false);

  // ── Phase 1: classify every property ──────────────────────────────────────

  const cb = opts?.callbackName ?? "toXmlShape";

  interface PropEmit {
    canonName: string;
    xmlName: string;
    expr: string;
    isOverride: boolean;
  }

  const boolStr = (prop: string): string =>
    `${kw("typeof")} obj[${lit("'" + prop + "'")}] === ${lit("'boolean'")} ? String(obj[${lit("'" + prop + "'")}]) : obj[${lit("'" + prop + "'")}]`;

  const entries: PropEmit[] = [];
  const processed = new Set<string>();

  for (const p of props) {
    const canonName = p.prop[1];
    if (processed.has(canonName)) continue;
    processed.add(canonName);

    // Attribute ($foo → @_foo)
    if (canonName.startsWith("$")) {
      entries.push({
        canonName,
        xmlName: "@_" + canonName.slice(1),
        expr: boolStr(canonName),
        isOverride: false,
      });
      continue;
    }

    // SimpleContent value → #text
    if (isSimpleContent && canonName === "value") {
      entries.push({
        canonName,
        xmlName: "#text",
        expr: `obj[${lit("'value'")}]`,
        isOverride: false,
      });
      continue;
    }

    // Classify the schema shape
    const shape = classifySchema(p.schema);
    let xmlName = canonName;
    let refTarget: string | undefined;
    if (shape.kind === "ref") refTarget = shape.target;
    else if (shape.kind === "refArray") refTarget = shape.target;

    // Resolve abstract elements to first concrete member
    if (refTarget) {
      const targetDef = netexLibrary[refTarget];
      if (
        targetDef?.["x-netex-role"] === "abstract" &&
        targetDef?.["x-netex-sg-members"]
      ) {
        const concrete = resolveConcreteElement(netexLibrary, refTarget);
        xmlName = concrete;
        refTarget = concrete;
      }
    }

    let isOverride = false;
    let expr: string;

    if (shape.kind === "ref" && refTarget) {
      const resolved = resolvePropertyType(netexLibrary, p.schema);
      const isMixed = resolved.via?.some((h) => h.rule === "mixed-unwrap") ?? false;

      if (isMixed && resolved.ts.endsWith("[]")) {
        const innerType = resolved.ts.slice(0, -2);
        expr = `obj[${lit("'" + canonName + "'")}].map(${kw("function")}(item) { ${kw("return")} ${cb}(${lit("'" + innerType + "'")}, item); })`;
        isOverride = true;
      } else if (!shouldDirectAssign(netexLibrary, refTarget, resolved)) {
        expr = `${cb}(${lit("'" + refTarget + "'")}, obj[${lit("'" + canonName + "'")}])`;
        isOverride = true;
      } else if (xmlName !== canonName) {
        expr = `obj[${lit("'" + canonName + "'")}]`;
        isOverride = true;
      } else {
        expr = boolStr(canonName);
      }
    } else if (shape.kind === "refArray" && refTarget) {
      expr = `obj[${lit("'" + canonName + "'")}].map(${kw("function")}(item) { ${kw("return")} ${cb}(${lit("'" + refTarget + "'")}, item); })`;
      isOverride = true;
    } else {
      expr = boolStr(canonName);
    }

    entries.push({ canonName, xmlName, expr, isOverride });
  }

  // ── Phase 2: emit function ──────────────────────────────────────────────

  const lines: string[] = [];
  const cbParam = (opts?.callbackAsParam ?? true) ? `, ${cb}` : "";
  lines.push(`${kw("function")} ${fnName}(obj${cbParam}) {`);

  const helperName = isSimpleContent ? opts?.baseSimpleCall : opts?.baseCall;

  /** Format a spread entry: `...(obj['x'] !== undefined && { key: expr })` */
  const spreadEntry = (canonName: string, xmlName: string, expr: string): string =>
    `    ...(obj[${lit("'" + canonName + "'")}] !== ${kw("undefined")} && { ${propTag(propKey(xmlName))}: ${expr} }),`;

  if (helperName) {
    // baseCall mode: spread base helper + override-only entries
    const overrides = entries.filter((en) => en.isOverride);
    const renames = overrides.filter((en) => en.xmlName !== en.canonName);

    if (renames.length > 0) {
      const drops = renames.map((r, i) => `${r.canonName}: _drop${i}`).join(", ");
      lines.push(`  ${kw("const")} { ${drops}, ...baseRest } = ${helperName}(obj);`);
      lines.push(`  ${kw("const")} out = {`);
      lines.push(`    ...baseRest,`);
    } else {
      lines.push(`  ${kw("const")} out = {`);
      lines.push(`    ...${helperName}(obj),`);
    }

    for (const ov of overrides) {
      lines.push(spreadEntry(ov.canonName, ov.xmlName, ov.expr));
    }
  } else {
    // Standalone mode: per-property spread entries
    lines.push(`  ${kw("const")} out = {`);
    for (const en of entries) {
      lines.push(spreadEntry(en.canonName, en.xmlName, en.expr));
    }
  }

  lines.push(`  };`);
  lines.push(`  ${kw("return")} out;`);
  lines.push(`}`);

  return lines.join("\n");
}

/**
 * Generate a self-contained code block for the schema viewer Mapping tab.
 *
 * If the entity has complex children that need delegation, emits a
 * `reshapeComplex` dispatch function above the entity function. Leaf
 * entities (no complex children) get just the entity function with no
 * callback parameter.
 */
export function makeInlineCodeBlock(
  netexLibrary: NetexLibrary,
  name: string,
  opts?: { props?: FlatProperty[]; html?: boolean },
): string {
  const props = opts?.props ?? flattenAllOf(netexLibrary, name);
  const html = opts?.html ?? false;
  const { kw, lit, cmt } = makeTaggers(html);

  // Collect ref targets that need delegation (same classification as Phase 1)
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const p of props) {
    const canonName = p.prop[1];
    if (seen.has(canonName) || canonName.startsWith("$")) continue;
    seen.add(canonName);

    const shape = classifySchema(p.schema);
    let refTarget: string | undefined;
    if (shape.kind === "ref") refTarget = shape.target;
    else if (shape.kind === "refArray") refTarget = shape.target;
    if (!refTarget) continue;

    // Resolve abstract elements
    const targetDef = netexLibrary[refTarget];
    if (
      targetDef?.["x-netex-role"] === "abstract" &&
      targetDef?.["x-netex-sg-members"]
    ) {
      refTarget = resolveConcreteElement(netexLibrary, refTarget);
    }

    // Check if this property needs delegation (same logic as Phase 1)
    if (shape.kind === "refArray") {
      if (!seen.has(refTarget)) targets.push(refTarget);
      seen.add(refTarget);
    } else if (shape.kind === "ref") {
      const resolved = resolvePropertyType(netexLibrary, p.schema);
      const isMixed = resolved.via?.some((h) => h.rule === "mixed-unwrap") ?? false;
      if (isMixed && resolved.ts.endsWith("[]")) {
        const innerType = resolved.ts.slice(0, -2);
        if (!seen.has(innerType)) targets.push(innerType);
        seen.add(innerType);
      } else if (!shouldDirectAssign(netexLibrary, refTarget, resolved)) {
        if (!seen.has(refTarget)) targets.push(refTarget);
        seen.add(refTarget);
      }
    }
  }

  // Build comment header
  const comment = cmt(
    "/*\n" +
      " * Project " + name + " to fast-xml-parser XMLBuilder shape.\n" +
      " * Renames $-prefixed attrs to @_, stringifies booleans,\n" +
      " * and delegates complex children via reshapeComplex.\n" +
      " */",
  );

  if (targets.length === 0) {
    // Leaf entity — no dispatch, no callback
    const entityFn = makeInlinedToXmlShape(netexLibrary, name, {
      props,
      callbackName: "reshapeComplex",
      callbackAsParam: false,
      html,
    });
    return comment + "\n" + entityFn;
  }

  // Build dispatch function
  const dispatchLines: string[] = [];
  dispatchLines.push(`${kw("function")} reshapeComplex(name, obj) {`);
  dispatchLines.push(`  ${kw("switch")} (name) {`);
  for (const t of targets) {
    const fn = lcFirst(t) + "ToXmlShape";
    dispatchLines.push(`    ${kw("case")} ${lit("'" + t + "'")}: ${kw("return")} ${fn}(obj, reshapeComplex);`);
  }
  dispatchLines.push(`    ${kw("default")}: ${kw("return")} obj;`);
  dispatchLines.push("  }");
  dispatchLines.push("}");

  const entityFn = makeInlinedToXmlShape(netexLibrary, name, {
    props,
    callbackName: "reshapeComplex",
    callbackAsParam: false,
    html,
  });

  return comment + "\n" + dispatchLines.join("\n") + "\n\n" + entityFn;
}
