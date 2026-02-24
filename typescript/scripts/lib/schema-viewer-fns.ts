/**
 * Pure functions used by the schema HTML viewer's explorer panel (pane 3).
 *
 * These are the canonical implementations — the inline JS in the `<script>` tag
 * of build-schema-html.ts mirrors them, closing over a page-level `defs` variable
 * instead of taking `defs` as a parameter. Keep both in sync.
 *
 * ## Explorer tabs and their entry functions
 *
 * **Properties** — `flattenAllOf` to walk the inheritance chain, then
 * `isRefType` / `refTarget` to render each property's type as a clickable link.
 *
 * **Graph** — `isRefType`, `refTarget`, and `resolveType` to build an SVG
 * inheritance-chain diagram with composition edges for ref-typed properties.
 *
 * **Interface** — `flattenAllOf` to collect all properties, then
 * `resolvePropertyType` to resolve each to its TypeScript type and
 * `resolveAtom` to annotate simpleContent wrappers (e.g. `→ string`).
 *
 * **Mapping** — `flattenAllOf`, `resolvePropertyType`, and `resolveAtom`
 * to generate `toGenerated` / `fromGenerated` converter functions between the
 * flat interface and the generated intersection type.
 *
 * **Utilities** — `flattenAllOf` + `collectRequired` for factory defaults,
 * `resolvePropertyType` for type-guard checks, `refTarget` for outgoing refs,
 * `buildReverseIndex` for incoming "used by" links, and `defaultForType` for
 * factory default-value literals.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** A JSON Schema definition (loose typing — mirrors what the viewer receives). */
export type Def = Record<string, any>;
export type Defs = Record<string, Def>;

export interface ViaHop {
  name: string;
  rule:
    | "ref"
    | "allOf-passthrough"
    | "allOf-speculative"
    | "atom-collapse"
    | "mixed-unwrap"
    | "array-unwrap"
    | "empty-object"
    | "enum"
    | "primitive"
    | "complex";
}

export interface ResolvedType {
  ts: string;
  complex: boolean;
  /** Resolution chain — each hop records the def name and which resolveDefType branch handled it. */
  via?: ViaHop[];
}

export interface FlatProperty {
  /** `[xsdName, tsName]` — original XSD property name and its camelCase TypeScript equivalent. */
  prop: [string, string];
  type: string;
  desc: string;
  origin: string;
  schema: Def;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Strip the JSON Schema `#/definitions/` prefix from a `$ref` string. */
function deref(ref: string): string {
  return ref.replace("#/definitions/", "");
}

/**
 * Detect a backward-compat mixed-content wrapper and return the "new way" element type.
 *
 * NeTEx has exactly one mixed-content type: MultilingualString. It exists for
 * backward compatibility — pre-v2.0 code puts text + lang directly on the element,
 * while v2.0+ uses Text child elements. The XSD documentation signals this with
 * "*Either*" in the description and `mixed="true"` (stamped as `x-netex-mixed`).
 *
 * When detected, the wrapper is treated as opaque: consumers should present the
 * inner array element type (e.g. TextType[]) instead of the wrapper's own shape.
 *
 * Returns the element type name (e.g. "TextType") or null if not a mixed wrapper.
 */
export function unwrapMixed(defs: Defs, name: string): string | null {
  const def = defs[name];
  if (!def) return null;
  if (def["x-netex-mixed"] !== true) return null;
  if (typeof def.description !== "string" || def.description.indexOf("*Either*") === -1)
    return null;
  if (!def.properties) return null;
  for (const pv of Object.values(def.properties) as Def[]) {
    if (pv.xml && pv.xml.attribute) continue;
    if (pv.type === "array" && pv.items && pv.items.$ref) {
      return deref(pv.items.$ref);
    }
  }
  return null;
}

/** Find the first `$ref` target in an `allOf` array, or `null`. */
function allOfRef(allOf: Def[]): string | null {
  for (const e of allOf) {
    if (e.$ref) return deref(e.$ref);
  }
  return null;
}

/** Discriminated shape of a JSON Schema property node. */
type SchemaShape =
  | { kind: "ref"; target: string }
  | { kind: "enum"; values: unknown[] }
  | { kind: "refArray"; target: string }
  | { kind: "array"; itemType: string }
  | { kind: "primitive"; type: string; format?: string }
  | { kind: "object" }
  | { kind: "unknown" };

/** Classify a property schema into a discriminated shape (single pass). */
function classifySchema(prop: Def): SchemaShape {
  if (!prop || typeof prop !== "object") return { kind: "unknown" };
  if (prop.$ref) return { kind: "ref", target: deref(prop.$ref) };
  if (prop.allOf) {
    const target = allOfRef(prop.allOf);
    if (target) return { kind: "ref", target };
  }
  if (prop.enum) return { kind: "enum", values: prop.enum };
  if (prop.type === "array" && prop.items) {
    if (prop.items.$ref) return { kind: "refArray", target: deref(prop.items.$ref) };
    if (prop.items.allOf) {
      const target = allOfRef(prop.items.allOf);
      if (target) return { kind: "refArray", target };
    }
    return { kind: "array", itemType: prop.items.type || "any" };
  }
  if (prop.type) {
    const type = Array.isArray(prop.type) ? prop.type.join(" | ") : prop.type;
    if (type !== "object") return { kind: "primitive", type, format: prop.format };
  }
  return { kind: "object" };
}

// ── Property introspection ───────────────────────────────────────────────────

/** Resolve a property schema to a human-readable type string. */
export function resolveType(prop: Def): string {
  const shape = classifySchema(prop);
  switch (shape.kind) {
    case "ref":
      return shape.target;
    case "enum":
      return shape.values.join(" | ");
    case "refArray":
      return shape.target + "[]";
    case "array":
      return shape.itemType + "[]";
    case "primitive":
      return shape.type;
    case "object":
      return "object";
    case "unknown":
      return "unknown";
  }
}

/** Does this property schema reference another definition? */
export function isRefType(prop: Def): boolean {
  const kind = classifySchema(prop).kind;
  return kind === "ref" || kind === "refArray";
}

/** Extract the target definition name from a reference property, or null. */
export function refTarget(prop: Def): string | null {
  const shape = classifySchema(prop);
  if (shape.kind === "ref" || shape.kind === "refArray") return shape.target;
  return null;
}

// ── Inheritance chain ────────────────────────────────────────────────────────

/** Flatten allOf inheritance to a list of properties with their origin type. */
export function flattenAllOf(defs: Defs, name: string): FlatProperty[] {
  const results: FlatProperty[] = [];
  const visited = new Set<string>();

  function walk(n: string): void {
    if (visited.has(n)) return;
    visited.add(n);
    const def = defs[n];
    if (!def) return;
    if (def.$ref) {
      walk(deref(def.$ref));
      return;
    }
    if (def.allOf) {
      for (const entry of def.allOf) {
        if (entry.$ref) {
          walk(deref(entry.$ref));
        } else if (entry.properties) {
          for (const [pn, pv] of Object.entries(entry.properties) as [string, Def][]) {
            results.push({
              prop: [pn, lcFirst(pn)],
              type: resolveType(pv),
              desc: pv.description || "",
              origin: n,
              schema: pv,
            });
          }
        }
      }
    }
    if (def.properties) {
      for (const [pn, pv] of Object.entries(def.properties) as [string, Def][]) {
        if (!results.some((r) => r.prop[0] === pn && r.origin === n)) {
          results.push({
            prop: [pn, lcFirst(pn)],
            type: resolveType(pv),
            desc: pv.description || "",
            origin: n,
            schema: pv,
          });
        }
      }
    }
  }
  walk(name);
  return results;
}

/** Collect all required property names from the inheritance chain. */
export function collectRequired(defs: Defs, name: string): Set<string> {
  const req = new Set<string>();
  const visited = new Set<string>();

  function walk(n: string): void {
    if (visited.has(n)) return;
    visited.add(n);
    const def = defs[n];
    if (!def) return;
    if (def.$ref) {
      walk(deref(def.$ref));
      return;
    }
    if (def.allOf) {
      for (const entry of def.allOf) {
        if (entry.$ref) walk(deref(entry.$ref));
        if (entry.required) entry.required.forEach((r: string) => req.add(r));
      }
    }
    if (def.required) def.required.forEach((r: string) => req.add(r));
  }
  walk(name);
  return req;
}

// ── Type resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a definition name to its TypeScript type.
 *
 * Follows $ref aliases, allOf wrappers, enums, and anyOf unions.
 * Unwraps single-prop array wrappers whose items have an atom annotation
 * (e.g. KeyListStructure → KeyValueStructure[]) when the wrapper has no role.
 * Returns `{ complex: true }` for types with own properties that can't
 * be reduced to a primitive.
 */
export function resolveDefType(defs: Defs, name: string, visited?: Set<string>): ResolvedType {
  if (!visited) visited = new Set();
  if (visited.has(name)) return { ts: name, complex: true };
  visited.add(name);
  const def = defs[name];
  if (!def) return { ts: name, complex: true };

  /** Prepend a hop to the via chain of an inner result. */
  function withHop(result: ResolvedType, hopName: string, rule: ViaHop["rule"]): ResolvedType {
    return { ...result, via: [{ name: hopName, rule }, ...(result.via || [])] };
  }

  // Pure $ref alias
  if (def.$ref) return withHop(resolveDefType(defs, deref(def.$ref), visited), name, "ref");

  // allOf with single $ref (wrapper or inheritance)
  if (def.allOf) {
    const refs = def.allOf.filter((e: Def) => e.$ref);
    if (refs.length === 1) {
      const target = deref(refs[0].$ref);
      const hasOwnProps =
        (def.properties && Object.keys(def.properties).length > 0) ||
        def.allOf.some((e: Def) => e.properties && Object.keys(e.properties).length > 0);
      if (!hasOwnProps) {
        return withHop(
          resolveDefType(defs, target, visited),
          name,
          "allOf-passthrough",
        );
      }
      // Speculatively follow parent — use result if primitive
      const parentResult = resolveDefType(defs, target, new Set(visited));
      if (!parentResult.complex)
        return withHop(parentResult, name, "allOf-speculative");
    }
  }

  // Enum
  if (def.enum)
    return {
      ts: def.enum.map((v: unknown) => JSON.stringify(v)).join(" | "),
      complex: false,
      via: [{ name, rule: "enum" }],
    };

  // anyOf union — branches diverge, no single linear chain
  if (def.anyOf) {
    const parts = def.anyOf.map((branch: Def) => {
      if (branch.$ref) return resolveDefType(defs, deref(branch.$ref), new Set(visited));
      if (branch.enum)
        return {
          ts: branch.enum.map((v: unknown) => JSON.stringify(v)).join(" | "),
          complex: false,
        };
      if (branch.type) return { ts: branch.type, complex: false };
      return { ts: "unknown", complex: false };
    });
    return {
      ts: parts.map((p: ResolvedType) => p.ts).join(" | "),
      complex: parts.some((p: ResolvedType) => p.complex),
    };
  }

  // Primitive (no properties)
  if (def.type && !def.properties && typeof def.type === "string" && def.type !== "object") {
    const fmt = def.format ? " /* " + def.format + " */" : "";
    return { ts: def.type + fmt, complex: false, via: [{ name, rule: "primitive" }] };
  }

  // Check x-netex-atom annotation — single-prop simpleContent wrappers collapse to primitive
  const atom = def["x-netex-atom"];
  if (typeof atom === "string" && atom !== "simpleObj")
    return { ts: atom, complex: false, via: [{ name, rule: "atom-collapse" }] };

  // Mixed-content wrapper — resolve as the inner element type array
  const mixedTarget = unwrapMixed(defs, name);
  if (mixedTarget)
    return { ts: mixedTarget + "[]", complex: true, via: [{ name, rule: "mixed-unwrap" }] };

  // Single-prop array wrapper with atom items → unwrap to item[]
  // Gate: skip classified types (e.g. _RelStructure role=collection)
  if (!def["x-netex-role"] && def.properties) {
    const keys = Object.keys(def.properties);
    if (keys.length === 1) {
      const shape = classifySchema(def.properties[keys[0]]);
      if (shape.kind === "refArray" && resolveAtom(defs, shape.target)) {
        const inner = resolveDefType(defs, shape.target, new Set(visited));
        return withHop(
          { ts: inner.ts + "[]", complex: inner.complex, via: inner.via },
          name,
          "array-unwrap",
        );
      }
    }
  }

  // Empty object (no properties, no role) — e.g. ExtensionsStructure (xsd:any wrapper)
  if (def.type === "object" && !def.properties && !def["x-netex-role"]) {
    return { ts: "any", complex: false, via: [{ name, rule: "empty-object" }] };
  }

  // Complex
  return { ts: name, complex: true, via: [{ name, rule: "complex" }] };
}

/**
 * Resolve a property schema to its TypeScript type representation.
 *
 * Delegates to resolveDefType for $ref targets. Handles arrays, enums,
 * and inline primitives directly.
 */
export function resolvePropertyType(defs: Defs, schema: Def): ResolvedType {
  const shape = classifySchema(schema);
  switch (shape.kind) {
    case "ref":
      return resolveDefType(defs, shape.target);
    case "refArray": {
      const inner = resolveDefType(defs, shape.target);
      return { ts: inner.ts + "[]", complex: inner.complex, via: inner.via };
    }
    case "array":
      return { ts: shape.itemType + "[]", complex: false };
    case "enum":
      return {
        ts: shape.values.map((v: unknown) => JSON.stringify(v)).join(" | "),
        complex: false,
      };
    case "primitive": {
      const fmt = shape.format ? " /* " + shape.format + " */" : "";
      return { ts: shape.type + fmt, complex: false };
    }
    case "unknown":
      return { ts: "unknown", complex: false };
    case "object":
      return { ts: "object", complex: false };
  }
}

/**
 * Read the x-netex-atom annotation for a definition.
 *
 * The converter (xsd-to-jsonschema.js) stamps `x-netex-atom` on simpleContent-derived
 * types at build time. Single-prop types get the primitive (e.g. `"string"`), multi-prop
 * types get `"simpleObj"`. Follows $ref and allOf single-ref chains
 * (e.g. PrivateCode → PrivateCodeStructure). Returns the annotation value or null.
 */
export function resolveAtom(defs: Defs, name: string): string | null {
  const def = defs[name];
  if (!def) return null;
  if (def.$ref) return resolveAtom(defs, deref(def.$ref));
  if (def["x-netex-atom"]) return def["x-netex-atom"];
  // Walk allOf single-ref wrappers (e.g. PrivateCode → PrivateCodeStructure)
  if (def.allOf) {
    const ref = allOfRef(def.allOf);
    if (ref) return resolveAtom(defs, ref);
  }
  return null;
}

// ── Inheritance chain (structured) ────────────────────────────────────────────

/** A node in the inheritance chain returned by `buildInheritanceChain`. */
export interface InheritanceNode {
  name: string;
  ownProps: { name: string; schema: Record<string, unknown> }[];
}

/**
 * Walk the allOf/$ref chain to build a bottom-up inheritance list.
 *
 * Each entry contains the type name and properties defined directly on that type
 * (not inherited). The chain is ordered root-first (base class at index 0,
 * the requested type at the end).
 *
 * Used by the Graph tab to render the SVG inheritance diagram.
 */
export function buildInheritanceChain(defs: Defs, name: string): InheritanceNode[] {
  const chain: InheritanceNode[] = [];
  const visited = new Set<string>();

  function walk(n: string): void {
    if (visited.has(n)) return;
    visited.add(n);
    const def = defs[n];
    if (!def) return;
    if (def.$ref) {
      walk(deref(def.$ref));
      return;
    }
    let parent: string | null = null;
    const ownProps: InheritanceNode["ownProps"] = [];
    if (def.allOf) {
      for (const entry of def.allOf as Def[]) {
        if (entry.$ref) parent = deref(entry.$ref);
        else if (entry.properties) {
          for (const [k, v] of Object.entries(entry.properties)) ownProps.push({ name: k, schema: v as Record<string, unknown> });
        }
      }
    }
    if (def.properties) {
      for (const [k, v] of Object.entries(def.properties) as [string, Def][]) {
        if (!ownProps.some((p) => p.name === k)) ownProps.push({ name: k, schema: v });
      }
    }
    if (parent) walk(parent);
    chain.push({ name: n, ownProps });
  }
  walk(name);
  return chain;
}

// ── Reverse index ────────────────────────────────────────────────────────────

/** Build a map of definition name → list of definitions that reference it. */
export function buildReverseIndex(defs: Defs): Record<string, string[]> {
  const idx: Record<string, string[]> = {};
  const needle = "#/definitions/";
  for (const [name, def] of Object.entries(defs)) {
    const json = JSON.stringify(def);
    let start = 0;
    while (true) {
      const pos = json.indexOf(needle, start);
      if (pos === -1) break;
      const rest = json.slice(pos + needle.length);
      const endQ = rest.indexOf('"');
      if (endQ !== -1) {
        const target = rest.slice(0, endQ);
        if (target !== name) {
          if (!idx[target]) idx[target] = [];
          if (idx[target].indexOf(name) === -1) idx[target].push(name);
        }
      }
      start = pos + needle.length;
    }
  }
  return idx;
}

/**
 * Find definitions that transitively use a given definition.
 *
 * Walks the reverse-index upward (BFS) through definitions where
 * `isTarget` returns false, collecting every definition where it returns true.
 * Stops traversal at target nodes — does not follow target→target chains,
 * since that would surface containment relationships rather than structural "uses".
 *
 * The input name itself is excluded from the result even if it matches `isTarget`.
 */
export function findTransitiveEntityUsers(
  name: string,
  reverseIndex: Record<string, string[]>,
  isTarget: (name: string) => boolean,
): string[] {
  const entities: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [name];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    // If we reached a target (that isn't the starting point), record it and stop traversing
    if (current !== name && isTarget(current)) {
      entities.push(current);
      continue;
    }

    for (const referrer of reverseIndex[current] ?? []) {
      if (!visited.has(referrer)) queue.push(referrer);
    }
  }

  return entities.sort();
}

// ── Role filter ─────────────────────────────────────────────────────────────

/** Fixed display order for role filter chips. */
export const ROLE_DISPLAY_ORDER = [
  "frameMember",
  "entity",
  "abstract",
  "structure",
  "collection",
  "reference",
  "view",
  "enumeration",
  "unclassified",
] as const;

/** Human-readable labels for each role value. */
export const ROLE_LABELS: Record<string, string> = {
  frameMember: "Frame member",
  entity: "Entity",
  abstract: "Abstract",
  structure: "Structure",
  collection: "Collection",
  reference: "Reference",
  view: "View",
  enumeration: "Enum",
  unclassified: "Unclassified",
};

/** Extract the role string from a definition, defaulting to "unclassified". */
export function defRole(def: Def | undefined): string {
  return typeof def?.["x-netex-role"] === "string" ? def["x-netex-role"] : "unclassified";
}

/** Count definitions per role. Returns a Map keyed by role string. */
export function countRoles(defNames: string[], defs: Defs): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of defNames) {
    const role = defRole(defs[name]);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return counts;
}

/**
 * Return the roles present in the data, sorted in ROLE_DISPLAY_ORDER.
 * Each entry includes the role key, label, and count.
 */
export function presentRoles(
  defNames: string[],
  defs: Defs,
): Array<{ role: string; label: string; count: number }> {
  const counts = countRoles(defNames, defs);
  return ROLE_DISPLAY_ORDER.filter((r) => counts.has(r)).map((role) => ({
    role,
    label: ROLE_LABELS[role] ?? role,
    count: counts.get(role) ?? 0,
  }));
}

// ── Code generation helpers ──────────────────────────────────────────────────

/** Return a sensible default value literal for a resolved TypeScript type string. */
export function defaultForType(ts: string): string {
  if (ts === "string") return '""';
  if (ts === "number" || ts === "integer") return "0";
  if (ts === "boolean") return "false";
  if (ts.endsWith("[]")) return "[]";
  if (ts.indexOf("|") !== -1) {
    const first = ts.split("|")[0].trim();
    if (first.startsWith('"')) return first;
    return '""';
  }
  if (ts.indexOf("/*") !== -1) {
    const base = ts.slice(0, ts.indexOf(" /*")).trim();
    if (base === "string") return '""';
    if (base === "number" || base === "integer") return "0";
    return '""';
  }
  return "{} as " + ts;
}

/** Lowercase the first character of a property name (NeTEx props are PascalCase, TS conventions use camelCase). */
export function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// ── Render helpers (pure HTML-string builders) ───────────────────────────────
//
// These produce HTML strings for the explorer panel tabs. They are pure
// functions (no DOM access) that take an `esc` callback for HTML-escaping
// (the runtime uses a DOM-based escaper: createElement + textContent + innerHTML).
//
// At runtime, thin DOM wrappers call these and set `.innerHTML` on the
// corresponding container element.

/** CSS variable colors required by the graph SVG renderer. */
export interface GraphColors {
  accent: string;
  fg: string;
  muted: string;
  cardBg: string;
  cardBorder: string;
}

/**
 * Render an SVG inheritance diagram for the named definition.
 *
 * Returns an SVG string (or a "no chain" paragraph if the chain is empty).
 * The caller provides CSS variable values since this function has no DOM access.
 */
export function renderGraphSvg(
  defs: Defs,
  name: string,
  colors: GraphColors,
  esc: (s: string) => string,
): string {
  const chain = buildInheritanceChain(defs, name);
  if (chain.length === 0) {
    return '<p style="color:var(--muted);font-size:0.85rem;padding:0.5rem;">No inheritance chain.</p>';
  }

  const NODE_W = 200, NODE_H = 38, NODE_RX = 6;
  const GAP_Y = 28;
  const COMP_W = 130, COMP_H = 24, COMP_GAP_X = 28, COMP_GAP_Y = 4;
  const PAD = 14;
  const MAX_COMPS = 6;

  const { accent, fg, muted, cardBg, cardBorder } = colors;

  const rows: Array<InheritanceNode & {
    refs: { name: string; target: string | null; type: string }[];
    y: number;
    rowH: number;
    compBlockH: number;
  }> = [];
  let totalH = PAD;
  let maxW = PAD + NODE_W + PAD;

  for (const node of chain) {
    const refs = node.ownProps
      .filter(p => isRefType(p.schema as Def))
      .slice(0, MAX_COMPS)
      .map(p => ({ name: p.name, target: refTarget(p.schema as Def), type: resolveType(p.schema as Def) }));
    const compBlockH = refs.length > 0 ? refs.length * (COMP_H + COMP_GAP_Y) - COMP_GAP_Y : 0;
    const rowH = Math.max(NODE_H, compBlockH);
    rows.push({ ...node, refs, y: totalH + rowH / 2, rowH, compBlockH });
    totalH += rowH + GAP_Y;
    if (refs.length > 0) maxW = Math.max(maxW, PAD + NODE_W + COMP_GAP_X + COMP_W + PAD);
  }
  totalH = totalH - GAP_Y + PAD;

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
      svg += '<g' + (hasDef ? ' class="graph-node" data-def="' + esc(ref.target!) + '"' : '') + '>';
      svg += '<title>' + esc(ref.name) + ': ' + esc(ref.type) + '</title>';
      svg += '<rect x="' + (PAD + NODE_W + COMP_GAP_X) + '" y="' + cy + '" width="' + COMP_W + '" height="' + COMP_H + '" rx="4" fill="' + cardBg + '" stroke="' + cardBorder + '" stroke-width="1" stroke-dasharray="3,2"/>';
      svg += '<text x="' + (PAD + NODE_W + COMP_GAP_X + 6) + '" y="' + (cy + COMP_H / 2 + 1) + '" dominant-baseline="middle" font-family="ui-monospace,monospace" font-size="10" fill="' + muted + '">' + esc(clabel) + '</text>';
      svg += '</g>';
    }
  }

  svg += '</svg>';
  return svg;
}

/**
 * Render a suggested TypeScript interface block for the named definition.
 *
 * Returns an HTML string containing the interface-block div with syntax-highlighted
 * code and a copy button. Properties include `data-via` attributes for hover popups.
 */
export function renderInterfaceHtml(
  defs: Defs,
  name: string,
  esc: (s: string) => string,
): string {
  const props = flattenAllOf(defs, name);
  const origins = [...new Set(props.map(p => p.origin))];

  const lines: string[] = [];
  lines.push('<span class="if-cmt">/**');
  lines.push(' * Suggested flat interface for ' + esc(name));
  lines.push(' * Resolved from ' + origins.length + ' type' + (origins.length !== 1 ? 's' : '') + ' in the inheritance chain');
  lines.push(' */</span>');
  lines.push('<span class="if-kw">interface</span> My_' + esc(name) + ' {');

  let lastOrigin: string | null = null;
  for (const p of props) {
    if (p.origin !== lastOrigin) {
      if (lastOrigin !== null) lines.push('');
      lines.push('  <span class="if-cmt">// \u2500\u2500 ' + esc(p.origin) + ' \u2500\u2500</span>');
      lastOrigin = p.origin;
    }
    const resolved = resolvePropertyType(defs, p.schema);
    let typeHtml: string;
    if (resolved.complex) {
      const typeName = resolved.ts.endsWith('[]') ? resolved.ts.slice(0, -2) : resolved.ts;
      const suffix = resolved.ts.endsWith('[]') ? '[]' : '';
      typeHtml = '<a class="if-ref explorer-type-link" href="#' + esc(typeName) + '">' + esc(typeName) + '</a>' + suffix;
      const atom = resolveAtom(defs, typeName);
      if (atom && atom !== 'simpleObj') typeHtml += ' <span class="if-cmt">// \u2192 ' + esc(atom) + '</span>';
    } else if (resolved.ts.includes('|')) {
      const parts = resolved.ts.split(' | ');
      typeHtml = parts.map(part => {
        part = part.trim();
        if (part.startsWith('"') || part.startsWith("'")) return '<span class="if-lit">' + esc(part) + '</span>';
        return '<span class="if-prim">' + esc(part) + '</span>';
      }).join(' | ');
    } else if (resolved.ts.indexOf('/*') !== -1) {
      const ci = resolved.ts.indexOf(' /*');
      if (ci !== -1) typeHtml = '<span class="if-prim">' + esc(resolved.ts.slice(0, ci)) + '</span><span class="if-cmt">' + esc(resolved.ts.slice(ci)) + '</span>';
      else typeHtml = '<span class="if-prim">' + esc(resolved.ts) + '</span>';
    } else {
      typeHtml = '<span class="if-prim">' + esc(resolved.ts) + '</span>';
    }
    let viaAttr = '';
    if (resolved.via && resolved.via.length > 0) {
      viaAttr = ' data-via="' + encodeURIComponent(JSON.stringify(resolved.via)) + '"';
    }
    lines.push('  <span class="if-prop"' + viaAttr + '>' + esc(p.prop[1]) + '</span>?: ' + typeHtml + ';');
  }

  lines.push('}');

  let html = '<div class="interface-block">' + lines.join('\n');
  html += '<button class="copy-btn" id="ifaceCopy">Copy</button></div>';
  return html;
}

/**
 * Render mapping guide (toGenerated / fromGenerated converter functions).
 *
 * Returns an HTML string containing the mapping-section div with two
 * syntax-highlighted code blocks and copy buttons.
 */
export function renderMappingHtml(
  defs: Defs,
  name: string,
  esc: (s: string) => string,
): string {
  const props = flattenAllOf(defs, name);
  const myName = 'My_' + name;

  let html = '';
  html += '<div class="mapping-section">';
  html += '<p style="color:var(--muted);font-size:0.85rem;margin:0 0 1rem 0;">';
  html += 'The generated <code>' + esc(name) + '</code> uses intersection types from the NeTEx inheritance chain. ';
  html += 'The flat <code>' + esc(myName) + '</code> from the Interface tab is simpler to work with. ';
  html += 'These functions convert between them.</p>';

  // To generated type
  html += '<h3>' + esc(myName) + ' \u2192 ' + esc(name) + '</h3>';
  html += '<div class="interface-block">';
  const toLines: string[] = [];
  toLines.push('<span class="if-kw">function</span> toGenerated(src: <span class="if-ref">' + esc(myName) + '</span>): <span class="if-ref">' + esc(name) + '</span> {');
  toLines.push('  <span class="if-cmt">// The generated type is an intersection (allOf),</span>');
  toLines.push('  <span class="if-cmt">// but at runtime it\u2019s just a plain object with the same keys.</span>');
  toLines.push('  <span class="if-kw">return</span> src <span class="if-kw">as unknown as</span> <span class="if-ref">' + esc(name) + '</span>;');
  toLines.push('}');
  html += toLines.join('\n');
  html += '<button class="copy-btn">Copy</button></div>';

  // From generated type
  html += '<h3>' + esc(name) + ' \u2192 ' + esc(myName) + '</h3>';
  html += '<div class="interface-block">';
  const fromLines: string[] = [];
  fromLines.push('<span class="if-kw">function</span> fromGenerated(src: <span class="if-ref">' + esc(name) + '</span>): <span class="if-ref">' + esc(myName) + '</span> {');
  fromLines.push('  <span class="if-kw">return</span> {');
  for (const p of props) {
    const resolved = resolvePropertyType(defs, p.schema);
    let atom: string | null = null;
    if (resolved.complex) {
      const typeName = resolved.ts.endsWith('[]') ? resolved.ts.slice(0, -2) : resolved.ts;
      atom = resolveAtom(defs, typeName);
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

/**
 * Render the utilities tab: type guard, factory, and references sections.
 *
 * Takes a pre-computed reverse index to avoid recomputing it on each call.
 * Returns the complete HTML string for the utilities tab content.
 */
export function renderUtilsHtml(
  defs: Defs,
  name: string,
  reverseIndex: Record<string, string[]>,
  esc: (s: string) => string,
): string {
  const props = flattenAllOf(defs, name);
  const required = collectRequired(defs, name);

  let html = '';

  // Type Guard
  html += '<div class="mapping-section"><h3>Type Guard</h3>';
  html += '<div class="interface-block">';
  const lines: string[] = [];
  lines.push('<span class="if-kw">function</span> is' + esc(name) + '(o: <span class="if-prim">unknown</span>): o <span class="if-kw">is</span> <span class="if-ref">' + esc(name) + '</span> {');
  lines.push('  <span class="if-kw">if</span> (!o || <span class="if-kw">typeof</span> o !== <span class="if-lit">"object"</span>) <span class="if-kw">return false</span>;');
  lines.push('  <span class="if-kw">const</span> obj = o <span class="if-kw">as</span> Record&lt;<span class="if-prim">string</span>, <span class="if-prim">unknown</span>&gt;;');
  for (const p of props) {
    const resolved = resolvePropertyType(defs, p.schema);
    let check = '';
    if (resolved.ts.endsWith('[]')) {
      check = '!Array.isArray(obj.' + p.prop[1] + ')';
    } else if (resolved.complex) {
      check = '<span class="if-kw">typeof</span> obj.' + esc(p.prop[1]) + ' !== <span class="if-lit">"object"</span>';
    } else {
      let base = resolved.ts;
      if (base.indexOf('/*') !== -1) base = base.slice(0, base.indexOf(' /*')).trim();
      if (base.indexOf('|') !== -1) {
        const firstPart = base.split('|')[0].trim();
        if (firstPart.startsWith('"') || firstPart.startsWith("'")) {
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
  const flines: string[] = [];
  flines.push('<span class="if-kw">function</span> create' + esc(name) + '(');
  flines.push('  init?: Partial&lt;<span class="if-ref">' + esc(name) + '</span>&gt;');
  flines.push('): <span class="if-ref">' + esc(name) + '</span> {');
  if (required.size > 0) {
    flines.push('  <span class="if-kw">return</span> {');
    for (const p of props) {
      if (!required.has(p.prop[0])) continue;
      const resolved = resolvePropertyType(defs, p.schema);
      const defVal = defaultForType(resolved.ts);
      flines.push('    ' + esc(p.prop[1]) + ': ' + '<span class="if-lit">' + esc(defVal) + '</span>,  <span class="if-cmt">// required</span>');
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

  // Uses (outgoing)
  const uses: string[] = [];
  const seen: Record<string, boolean> = {};
  for (const p of props) {
    const t = refTarget(p.schema);
    if (t && !seen[t]) {
      seen[t] = true;
      uses.push(t);
    }
  }
  html += '<div style="margin-bottom:0.5rem;"><span style="font-size:0.75rem;font-weight:600;color:var(--fg);">Uses</span>';
  if (uses.length > 0) {
    html += '<div class="ref-list">';
    for (const u of uses) {
      html += '<a href="#' + esc(u) + '" class="ref-chip explorer-type-link">' + esc(u) + '</a>';
    }
    html += '</div>';
  } else {
    html += ' <span class="ref-empty">none</span>';
  }
  html += '</div>';

  // Used by (incoming)
  const usedBy = (reverseIndex[name] || []).slice().sort();
  html += '<div><span style="font-size:0.75rem;font-weight:600;color:var(--fg);">Used by</span>';
  if (usedBy.length > 0) {
    html += '<div class="ref-list">';
    for (const u of usedBy) {
      html += '<a href="#' + esc(u) + '" class="ref-chip explorer-type-link">' + esc(u) + '</a>';
    }
    html += '</div>';
  } else {
    html += ' <span class="ref-empty">none</span>';
  }
  html += '</div></div>';

  return html;
}
