/**
 * Static code generator for stem→XML projection functions.
 *
 * `makeInlinedToXmlShape` emits a per-entity function that builds
 * an output object via spread helper calls: `...attr(obj, 'key')`,
 * `...elem(obj, 'key')`, `...child(obj, 'key', 'Type', rc)`, etc.
 * Runtime helpers (`strVal`, `attr`, `elem`, `child`, `mapArr`, `text`)
 * are appended at the bottom — function declarations hoist in JS.
 */

import type { NetexLibrary, FlatProperty, ResolvedType } from "./types.js";
import type { CollapseOpts } from "./collapse.js";
import { collapseRef, collapseColl, collapseCollAsRef } from "./collapse.js";
import { lcFirst } from "./util.js";
import { classifySchema, defRole, isRefType, refTarget } from "./classify.js";
import { flattenAllOf } from "./schema-nav.js";
import { resolvePropertyType, resolveAtom } from "./type-res.js";
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
  /** Pre-computed flattened properties — avoids redundant `flattenAllOf` call. */
  props?: FlatProperty[];
  /** Callback name used in expressions (default: 'toXmlShape'). */
  callbackName?: string;
  /** If false, callback is a free variable, not a function parameter (default: true). */
  callbackAsParam?: boolean;
  /** Emit `<span class="if-*">` syntax-highlighting tags (default: false). */
  html?: boolean;
  /** Emit TypeScript type annotations on params/returns (default: false). */
  typed?: boolean;
  /** Append runtime helper functions at the bottom (default: true). */
  includeHelpers?: boolean;
  /** Collapse options — when active, refs become refAttr and collections become childWrapped. */
  collapse?: CollapseOpts;
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

// ── Runtime helpers block ───────────────────────────────────────────────────

/**
 * Emit the runtime helper functions used by generated entity functions.
 * Function declarations hoist, so placing these at the bottom is safe.
 */
export function emitHelpers(opts?: { html?: boolean; typed?: boolean; collapse?: CollapseOpts }): string {
  const html = opts?.html ?? false;
  const typed = opts?.typed ?? false;
  const collapse = opts?.collapse;
  const { kw, lit, prop } = makeTaggers(html);

  const tUnk = typed ? ": unknown" : "";
  const tObj = typed ? ": Obj" : "";
  const tStr = typed ? ": string" : "";
  const tRc = typed ? ": Reshape" : "";
  const tOptStr = typed ? "?: string" : "";
  const asObj = typed ? ` ${kw("as")} Obj` : "";
  const asArr = typed ? ` ${kw("as")} Obj[]` : "";
  const lines: string[] = [];

  if (typed) {
    lines.push(`${kw("type")} Obj = Record<string, unknown>;`);
    lines.push(`${kw("type")} Reshape = (name${tStr}, obj${tObj}) => Obj;`);
    lines.push("");
  }

  lines.push(
    `${kw("function")} strVal(v${tUnk}) {` +
    ` ${kw("return")} ${kw("typeof")} v === ${lit("'boolean'")} ? String(v) : v;` +
    ` }`,
  );
  lines.push("");
  lines.push(`${kw("function")} attr(obj${tObj}, key${tStr}) {`);
  lines.push(`  ${kw("const")} v = obj[${lit("'$'")} + key];`);
  lines.push(`  ${kw("return")} v !== ${kw("undefined")} ? { [${lit("'@_'")} + key]: strVal(v) } : {};`);
  lines.push("}");
  lines.push("");
  lines.push(`${kw("function")} elem(obj${tObj}, key${tStr}) {`);
  lines.push(`  ${kw("const")} v = obj[key];`);
  lines.push(`  ${kw("return")} v !== ${kw("undefined")} ? { [key]: strVal(v) } : {};`);
  lines.push("}");
  lines.push("");
  lines.push(`${kw("function")} child(obj${tObj}, key${tStr}, type${tStr}, rc${tRc}, xmlKey${tOptStr}) {`);
  lines.push(`  ${kw("const")} k = xmlKey || key;`);
  lines.push(`  ${kw("return")} obj[key] !== ${kw("undefined")} ? { [k]: rc(type, obj[key]${asObj}) } : {};`);
  lines.push("}");
  lines.push("");
  lines.push(`${kw("function")} mapArr(obj${tObj}, key${tStr}, type${tStr}, rc${tRc}, xmlKey${tOptStr}) {`);
  lines.push(`  ${kw("const")} k = xmlKey || key;`);
  lines.push(`  ${kw("return")} obj[key] !== ${kw("undefined")}`);
  lines.push(`    ? { [k]: (obj[key]${asArr}).map(${kw("function")}(item${tObj}) { ${kw("return")} rc(type, item); }) }`);
  lines.push(`    : {};`);
  lines.push("}");
  lines.push("");
  lines.push(`${kw("function")} wrapArr(obj${tObj}, key${tStr}, childKey${tStr}, type${tStr}, rc${tRc}, xmlKey${tOptStr}) {`);
  lines.push(`  ${kw("const")} k = xmlKey || key;`);
  lines.push(`  ${kw("const")} arr = obj[key]${asArr};`);
  lines.push(`  ${kw("return")} arr && arr.length`);
  lines.push(`    ? { [k]: { [childKey]: arr.map(${kw("function")}(item${tObj}) { ${kw("return")} rc(type, item); }) } }`);
  lines.push(`    : {};`);
  lines.push("}");
  lines.push("");
  lines.push(`${kw("function")} text(obj${tObj}) {`);
  lines.push(`  ${kw("return")} obj[${lit("'value'")}] !== ${kw("undefined")} ? { ${prop("'#text'")}: obj[${lit("'value'")}] } : {};`);
  lines.push("}");

  if (collapse?.collapseRefs || collapse?.collapseCollections) {
    lines.push("");
    lines.push(`${kw("function")} refAttr(obj${tObj}, key${tStr}) {`);
    lines.push(`  ${kw("return")} obj[key] !== ${kw("undefined")} ? { [key]: { ${prop("'@_ref'")}: obj[key] } } : {};`);
    lines.push("}");
  }

  if (collapse?.collapseCollections) {
    lines.push("");
    lines.push(`${kw("function")} childWrapped(obj${tObj}, key${tStr}, wrapName${tStr}, type${tStr}, rc${tRc}) {`);
    lines.push(`  ${kw("return")} obj[key] !== ${kw("undefined")} ? { [key]: { [wrapName]: rc(type, obj[key]${asObj}) } } : {};`);
    lines.push("}");
  }

  return lines.join("\n");
}

// ── Property classification ─────────────────────────────────────────────────

type PropKind = "attr" | "elem" | "complex" | "array" | "text" | "rename" | "wrapArr" | "refAttr" | "childWrapped";

interface PropEmit {
  kind: PropKind;
  canonName: string;
  xmlKey?: string;        // output key when different from canonName (abstract resolution)
  refTarget?: string;     // type name for complex/array/wrapArr
  wrapChildKey?: string;  // child element name for wrapArr (e.g. "KeyValue" for KeyListStructure)
}

/** Extract the single child element name from a wrapper type (e.g. KeyListStructure → "KeyValue"). */
function wrapperChildKey(netexLibrary: NetexLibrary, name: string): string | null {
  const def = netexLibrary[name];
  if (!def?.properties) return null;
  const keys = Object.keys(def.properties);
  return keys.length === 1 ? keys[0] : null;
}

/** Classify all properties of a definition into helper-call entries. */
function classifyProps(
  netexLibrary: NetexLibrary,
  name: string,
  props: FlatProperty[],
  collapse?: CollapseOpts,
): PropEmit[] {
  const isSimpleContent = resolveAtom(netexLibrary, name) === "simpleObj";
  const entries: PropEmit[] = [];
  const processed = new Set<string>();

  for (const p of props) {
    const canonName = p.prop[1];
    if (processed.has(canonName)) continue;
    processed.add(canonName);

    if (canonName.startsWith("$")) {
      entries.push({ kind: "attr", canonName });
      continue;
    }

    if (isSimpleContent && canonName === "value") {
      entries.push({ kind: "text", canonName });
      continue;
    }

    // Collapse interception — before normal classification
    if (collapse?.collapseRefs && isRefType(p.schema)) {
      const cr = collapseRef(netexLibrary, canonName, p.schema);
      if (cr) {
        entries.push({ kind: "refAttr", canonName });
        continue;
      }
    }
    if (collapse?.collapseCollections && isRefType(p.schema)) {
      const ccRef = collapseCollAsRef(netexLibrary, canonName, p.schema);
      if (ccRef) {
        entries.push({ kind: "refAttr", canonName });
        continue;
      }
      const cc = collapseColl(netexLibrary, canonName, p.schema);
      if (cc) {
        entries.push({ kind: "childWrapped", canonName, refTarget: cc.target, wrapChildKey: cc.childKey });
        continue;
      }
    }

    const shape = classifySchema(p.schema);
    let xmlKey: string | undefined;
    let rt: string | undefined;
    if (shape.kind === "ref") rt = shape.target;
    else if (shape.kind === "refArray") rt = shape.target;

    // Resolve abstract elements to first concrete member
    if (rt) {
      const targetDef = netexLibrary[rt];
      if (targetDef?.["x-netex-role"] === "abstract" && targetDef?.["x-netex-sg-members"]) {
        const concrete = resolveConcreteElement(netexLibrary, rt);
        if (concrete !== canonName) xmlKey = concrete;
        rt = concrete;
      }
    }

    if (shape.kind === "ref" && rt) {
      const resolved = resolvePropertyType(netexLibrary, p.schema);
      const isMixed = resolved.via?.some((h) => h.rule === "mixed-unwrap") ?? false;
      const isArrayUnwrapped = resolved.via?.some((h) => h.rule === "array-unwrap") ?? false;

      if (isArrayUnwrapped && resolved.ts.endsWith("[]")) {
        const wrapperName = resolved.via!.find((h) => h.rule === "array-unwrap")!.name;
        const childKey = wrapperChildKey(netexLibrary, wrapperName);
        if (childKey) {
          entries.push({ kind: "wrapArr", canonName, xmlKey, refTarget: resolved.ts.slice(0, -2), wrapChildKey: childKey });
          continue;
        }
      }

      if (isMixed && resolved.ts.endsWith("[]")) {
        entries.push({ kind: "array", canonName, xmlKey, refTarget: resolved.ts.slice(0, -2) });
      } else if (!shouldDirectAssign(netexLibrary, rt, resolved)) {
        entries.push({ kind: "complex", canonName, xmlKey, refTarget: rt });
      } else if (xmlKey) {
        entries.push({ kind: "rename", canonName, xmlKey });
      } else {
        entries.push({ kind: "elem", canonName });
      }
    } else if (shape.kind === "refArray" && rt) {
      const resolved = resolvePropertyType(netexLibrary, p.schema);
      if (shouldDirectAssign(netexLibrary, rt, resolved)) {
        entries.push({ kind: "elem", canonName });
      } else {
        entries.push({ kind: "array", canonName, xmlKey, refTarget: rt });
      }
    } else {
      entries.push({ kind: "elem", canonName });
    }
  }
  return entries;
}

// ── Entry formatting ────────────────────────────────────────────────────────

type Taggers = ReturnType<typeof makeTaggers>;

/** Format a single spread helper call for an entry. */
function fmtEntry(e: PropEmit, cb: string, t: Taggers): string {
  const { lit } = t;
  switch (e.kind) {
    case "attr":
      return `...attr(obj, ${lit("'" + e.canonName.slice(1) + "'")})`;
    case "elem":
      return `...elem(obj, ${lit("'" + e.canonName + "'")})`;
    case "text":
      return `...text(obj)`;
    case "complex": {
      const xk = e.xmlKey ? `, ${lit("'" + e.xmlKey + "'")}` : "";
      return `...child(obj, ${lit("'" + e.canonName + "'")}, ${lit("'" + e.refTarget + "'")}, ${cb}${xk})`;
    }
    case "array": {
      const xk = e.xmlKey ? `, ${lit("'" + e.xmlKey + "'")}` : "";
      return `...mapArr(obj, ${lit("'" + e.canonName + "'")}, ${lit("'" + e.refTarget + "'")}, ${cb}${xk})`;
    }
    case "wrapArr": {
      const xk = e.xmlKey ? `, ${lit("'" + e.xmlKey + "'")}` : "";
      return `...wrapArr(obj, ${lit("'" + e.canonName + "'")}, ${lit("'" + e.wrapChildKey + "'")}, ${lit("'" + e.refTarget + "'")}, ${cb}${xk})`;
    }
    case "rename":
      return `...(obj[${lit("'" + e.canonName + "'")}] !== undefined && { [${lit("'" + e.xmlKey + "'")}]: obj[${lit("'" + e.canonName + "'")}] })`;
    case "refAttr":
      return `...refAttr(obj, ${lit("'" + e.canonName + "'")})`;
    case "childWrapped":
      return `...childWrapped(obj, ${lit("'" + e.canonName + "'")}, ${lit("'" + e.wrapChildKey + "'")}, ${lit("'" + e.refTarget + "'")}, ${cb})`;
  }
}

/** Pack entries into indented lines, grouping consecutive same-kind entries. */
function packEntries(entries: PropEmit[], cb: string, taggers: Taggers, html: boolean): string[] {
  const plainT = html ? makeTaggers(false) : taggers;
  const lines: string[] = [];
  let curPlain = "";
  let curFull = "";
  let prevKind: PropKind | undefined;

  for (const e of entries) {
    const plain = fmtEntry(e, cb, plainT);
    const full = html ? fmtEntry(e, cb, taggers) : plain;
    const sep = curPlain ? " " : "";
    const candidate = curPlain + sep + plain + ",";

    if (e.kind !== prevKind || candidate.length > 100) {
      if (curFull) lines.push("    " + curFull);
      curPlain = plain + ",";
      curFull = full + ",";
    } else {
      curPlain = candidate;
      curFull += sep + full + ",";
    }
    prevKind = e.kind;
  }
  if (curFull) lines.push("    " + curFull);
  return lines;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a JavaScript function that projects one definition to XMLBuilder shape.
 *
 * Uses spread helper calls (`attr`, `elem`, `child`, `mapArr`, `text`)
 * defined by `emitHelpers`. When `includeHelpers` is true (default),
 * the helpers are appended at the bottom of the output.
 */
export function makeInlinedToXmlShape(
  netexLibrary: NetexLibrary,
  name: string,
  opts?: InlineOptions,
): string {
  const props = opts?.props ?? flattenAllOf(netexLibrary, name);
  const fnName = lcFirst(name) + "ToXmlShape";
  const html = opts?.html ?? false;
  const typed = opts?.typed ?? false;
  const cb = opts?.callbackName ?? "toXmlShape";

  const taggers = makeTaggers(html);
  const { kw } = taggers;

  const entries = classifyProps(netexLibrary, name, props, opts?.collapse);
  const bodyLines = packEntries(entries, cb, taggers, html);

  // Function signature
  const tObj = typed ? ": Obj" : "";
  const tRc = typed ? ": Reshape" : "";
  const cbParam = (opts?.callbackAsParam ?? true) ? `, ${cb}${tRc}` : "";

  const lines: string[] = [];
  lines.push(`${kw("function")} ${fnName}(obj${tObj}${cbParam})${tObj} {`);
  lines.push(`  ${kw("return")} {`);
  lines.push(...bodyLines);
  lines.push("  };");
  lines.push("}");

  const fn = lines.join("\n");
  if (opts?.includeHelpers === false) return fn;
  return fn + "\n\n" + emitHelpers({ html, typed, collapse: opts?.collapse });
}

/** Unique complex/array ref targets from classified entries. */
function complexTargets(entries: PropEmit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if ((e.kind === "complex" || e.kind === "array" || e.kind === "wrapArr" || e.kind === "childWrapped") && e.refTarget && !seen.has(e.refTarget)) {
      seen.add(e.refTarget);
      out.push(e.refTarget);
    }
  }
  return out;
}

/** BFS-walk transitive complex children starting from root's direct targets. */
function collectAllTargets(
  netexLibrary: NetexLibrary,
  rootName: string,
  rootEntries: PropEmit[],
  collapse?: CollapseOpts,
): string[] {
  const all: string[] = [];
  const visited = new Set([rootName]);
  const queue = complexTargets(rootEntries);
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    if (visited.has(t)) continue;
    visited.add(t);
    all.push(t);
    for (const c of complexTargets(classifyProps(netexLibrary, t, flattenAllOf(netexLibrary, t), collapse))) {
      if (!visited.has(c)) queue.push(c);
    }
  }
  return all;
}

/**
 * Generate a self-contained code block for the schema viewer Mapping tab.
 *
 * Emits typed functions for the root entity and all transitive complex
 * children, plus a `reshapeComplex` dispatch that routes by type name.
 * Helpers are appended once at the very bottom.
 */
export function makeInlineCodeBlock(
  netexLibrary: NetexLibrary,
  name: string,
  opts?: { props?: FlatProperty[]; html?: boolean; typed?: boolean; excludeProps?: Set<string>; collapse?: CollapseOpts },
): string {
  const props = opts?.props ?? flattenAllOf(netexLibrary, name);
  const filteredProps = opts?.excludeProps
    ? props.filter((p) => !opts.excludeProps!.has(p.prop[1]))
    : props;
  const html = opts?.html ?? false;
  const typed = opts?.typed ?? true;
  const collapse = opts?.collapse;
  const { kw, lit, cmt } = makeTaggers(html);

  const rootEntries = classifyProps(netexLibrary, name, filteredProps, collapse);
  const targets = collectAllTargets(netexLibrary, name, rootEntries, collapse);

  const comment = cmt(
    "/*\n" +
      " * Project " + name + " to fast-xml-parser XMLBuilder shape.\n" +
      " * Renames $-prefixed attrs to @_, stringifies booleans,\n" +
      " * and delegates complex children via reshapeComplex.\n" +
      " */",
  );

  const sharedOpts = { callbackName: "reshapeComplex", html, typed, includeHelpers: false, collapse } as const;
  const helpers = emitHelpers({ html, typed, collapse });

  if (targets.length === 0) {
    const entityFn = makeInlinedToXmlShape(netexLibrary, name, {
      ...sharedOpts,
      props: filteredProps,
      callbackAsParam: false,
    });
    return comment + "\n" + entityFn + "\n\n" + helpers;
  }

  // Dispatch function
  const dispatchLines: string[] = [];
  const tStr = typed ? ": string" : "";
  const tObj = typed ? ": Obj" : "";
  dispatchLines.push(`${kw("function")} reshapeComplex(name${tStr}, obj${tObj})${tObj} {`);
  dispatchLines.push(`  ${kw("switch")} (name) {`);
  for (const t of targets) {
    const fn = lcFirst(t) + "ToXmlShape";
    dispatchLines.push(`    ${kw("case")} ${lit("'" + t + "'")}: ${kw("return")} ${fn}(obj, reshapeComplex);`);
  }
  dispatchLines.push(`    ${kw("default")}: ${kw("return")} obj;`);
  dispatchLines.push("  }");
  dispatchLines.push("}");

  const entityFn = makeInlinedToXmlShape(netexLibrary, name, {
    ...sharedOpts,
    props: filteredProps,
    callbackAsParam: false,
  });

  // Dedup identical child functions: emit once, alias the rest
  const childOpts = { ...sharedOpts, callbackAsParam: true } as const;
  const fpByTarget = new Map<string, { fp: string; props: FlatProperty[] }>();
  for (const t of targets) {
    const props = flattenAllOf(netexLibrary, t);
    const entries = classifyProps(netexLibrary, t, props, collapse);
    const fp = entries.map(e => e.kind + ":" + e.canonName + ":" + (e.refTarget || "") + ":" + (e.xmlKey || "") + ":" + (e.wrapChildKey || "")).join("|");
    fpByTarget.set(t, { fp, props });
  }

  const emitted = new Map<string, string>();
  const childBlocks: string[] = [];
  for (const t of targets) {
    const { fp, props } = fpByTarget.get(t)!;
    const canon = emitted.get(fp);
    if (canon) {
      childBlocks.push(`${kw("const")} ${lcFirst(t)}ToXmlShape = ${lcFirst(canon)}ToXmlShape;`);
    } else {
      emitted.set(fp, t);
      childBlocks.push(makeInlinedToXmlShape(netexLibrary, t, { ...childOpts, props }));
    }
  }

  return (
    comment + "\n" +
    dispatchLines.join("\n") + "\n\n" +
    entityFn + "\n\n" +
    childBlocks.join("\n\n") + "\n\n" +
    helpers
  );
}
