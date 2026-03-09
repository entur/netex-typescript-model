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
 * **XML Mapping** — `flattenAllOf`, `resolvePropertyType`, and `resolveAtom`
 * to generate a serialize function for fast-xml-parser XML output.
 *
 * **Utilities** — `flattenAllOf` + `collectRequired` for factory defaults,
 * `resolvePropertyType` for type-guard checks, `refTarget` for outgoing refs,
 * `buildReverseIndex` for incoming "used by" links, and `defaultForType` for
 * factory default-value literals.
 *
 * **Sample data** — `genMockObject` builds a fully populated example from
 * JSON Schema defs, `serializeValue` converts canonical props to
 * fast-xml-parser shape, and `buildXmlString` produces formatted XML.
 */

import { XMLBuilder } from "fast-xml-parser";

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
    | "array-of"
    | "empty-object"
    | "enum"
    | "primitive"
    | "complex"
    | "fixed-for";
}

export interface ResolvedType {
  ts: string;
  complex: boolean;
  /** Resolution chain — each hop records the def name and which resolveDefType branch handled it. */
  via?: ViaHop[];
}

export interface FlatProperty {
  /** `[xsdName, canonicalName]` — original XSD property name and its canonical name (PascalCase for elements, $-prefixed for attributes). */
  prop: [string, string];
  type: string;
  desc: string;
  origin: string;
  schema: Def;
  /** When set, this property was inlined from a 1-to-1 $ref member with this tsName. */
  inlinedFrom?: string;
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
              prop: [pn, canonicalPropName(pn, pv)],
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
            prop: [pn, canonicalPropName(pn, pv)],
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

  // Enum — stamped enumerations stop at the name; unstamped expand to literal union
  if (def.enum) {
    if (def["x-netex-role"] === "enumeration")
      return { ts: name, complex: false, via: [{ name, rule: "enum" }] };
    return {
      ts: def.enum.map((v: unknown) => JSON.stringify(v)).join(" | "),
      complex: false,
      via: [{ name, rule: "enum" }],
    };
  }

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

  // Check x-netex-atom annotation — stamps take precedence over structural inference
  const atom = def["x-netex-atom"];
  if (atom === "array" && def.type === "array" && def.items) {
    const itemShape = classifySchema(def.items);
    if (itemShape.kind === "ref") {
      const inner = resolveDefType(defs, itemShape.target, new Set(visited));
      return withHop(
        { ts: inner.ts + "[]", complex: inner.complex, via: inner.via },
        name,
        "array-of",
      );
    }
    const itemType = itemShape.kind === "primitive" ? itemShape.type : "any";
    return { ts: itemType + "[]", complex: false, via: [{ name, rule: "array-of" }] };
  }
  // Single-prop simpleContent wrappers collapse to primitive
  if (typeof atom === "string" && atom !== "simpleObj" && atom !== "array")
    return { ts: atom, complex: false, via: [{ name, rule: "atom-collapse" }] };

  // Primitive (no properties)
  if (def.type && !def.properties && typeof def.type === "string" && def.type !== "object") {
    const fmt = def.format ? " /* " + def.format + " */" : "";
    return { ts: def.type + fmt, complex: false, via: [{ name, rule: "primitive" }] };
  }

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
export function resolvePropertyType(defs: Defs, schema: Def, context?: string): ResolvedType {
  if (context && typeof schema["x-fixed-single-enum"] === "string") {
    return {
      ts: JSON.stringify(context),
      complex: false,
      via: [{ name: context, rule: "fixed-for" }],
    };
  }
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
  if ((ts.startsWith('"') || ts.startsWith("'")) && ts.indexOf("|") === -1) return ts;
  if (ts === "string") return '"string"';
  if (ts === "number" || ts === "integer") return "0";
  if (ts === "boolean") return "false";
  if (ts.endsWith("[]")) return "[]";
  if (ts.indexOf("|") !== -1) {
    const first = ts.split("|")[0].trim();
    if (first.startsWith('"')) return first;
    return '"string"';
  }
  if (ts.indexOf("/*") !== -1) {
    const base = ts.slice(0, ts.indexOf(" /*")).trim();
    if (base === "string") return '"string"';
    if (base === "number" || base === "integer") return "0";
    return '"string"';
  }
  return "{} as " + ts;
}

/** Lowercase the first character of a property name (NeTEx props are PascalCase, TS conventions use camelCase). */
export function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Return the canonical property name: PascalCase for XML elements, $-prefixed for XML attributes. */
export function canonicalPropName(xsdName: string, schema: Def | undefined): string {
  if (schema && schema.xml && (schema.xml as any).attribute) return "$" + xsdName;
  return xsdName;
}

// ── Inline single-$ref expansion ──────────────────────────────────────────────

/**
 * Replace 1-to-1 `$ref` properties with the target's inner properties.
 *
 * A property is a single-$ref candidate when:
 * - Its schema is `{ $ref }` or `{ allOf: [{ $ref }] }` (one ref, not array)
 * - `resolvePropertyType` returns complex and not an array
 * - The resolved target's role is neither `"collection"` nor `"reference"`
 *
 * For each candidate, the target's properties (from `flattenAllOf`) replace
 * the original entry. Inner prop names that collide with existing names get
 * prefixed with `parentProp_`.
 */
export function inlineSingleRefs(defs: Defs, props: FlatProperty[]): FlatProperty[] {
  // Identify candidate indices
  const candidates: { idx: number; targetName: string }[] = [];
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    const shape = classifySchema(p.schema);
    if (shape.kind !== "ref") continue;
    const resolved = resolvePropertyType(defs, p.schema);
    if (!resolved.complex || resolved.ts.endsWith("[]")) continue;
    const targetDef = defs[resolved.ts];
    if (!targetDef) continue;
    const role = defRole(targetDef);
    if (role === "collection" || role === "reference") continue;
    if (targetDef["x-netex-atom"]) continue;
    candidates.push({ idx: i, targetName: resolved.ts });
  }

  if (candidates.length === 0) return props;

  // Build set of taken names from non-candidate props
  const candidateIndices = new Set(candidates.map((c) => c.idx));
  const takenNames = new Set<string>();
  for (let i = 0; i < props.length; i++) {
    if (!candidateIndices.has(i)) takenNames.add(props[i].prop[1]);
  }

  // Collect parent chain origins (before inlining) — skip props that are
  // themselves candidates so we only capture the inherited ancestor origins.
  const parentOrigins = new Set<string>();
  for (let i = 0; i < props.length; i++) {
    if (!candidateIndices.has(i) && props[i].origin) parentOrigins.add(props[i].origin);
  }

  // Build result, replacing candidates with their inner props
  const result: FlatProperty[] = [];
  let nextCandidate = 0;
  for (let i = 0; i < props.length; i++) {
    if (nextCandidate < candidates.length && candidates[nextCandidate].idx === i) {
      const cand = candidates[nextCandidate++];
      const parentTsName = props[i].prop[1];
      const innerProps = flattenAllOf(defs, cand.targetName);
      for (const ip of innerProps) {
        // Skip props whose origin is already in the parent chain (shared ancestor)
        if (ip.origin && parentOrigins.has(ip.origin)) continue;
        const baseName = ip.prop[1];
        const chosenName = takenNames.has(baseName) ? parentTsName + "_" + baseName : baseName;
        takenNames.add(chosenName);
        result.push({
          prop: [chosenName, chosenName],
          type: ip.type,
          desc: ip.desc,
          origin: ip.origin,
          schema: ip.schema,
          inlinedFrom: parentTsName,
        });
      }
    } else {
      result.push(props[i]);
    }
  }
  return result;
}

// ── Sample data generation ──────────────────────────────────────────────────

/**
 * Convert canonical prop names to fast-xml-parser shape.
 *
 * - `$`-prefixed keys → `@_` prefix (XML attributes), booleans stringified
 * - Arrays: map items recursively
 * - Objects: recurse
 * - Booleans: stringify (XML text nodes must be strings)
 * - `undefined` values: skip
 */
export function serializeValue(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (key.startsWith("$")) {
      out[`@_${key.slice(1)}`] = typeof val === "boolean" ? String(val) : val;
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) =>
        typeof item === "object" && item !== null
          ? serializeValue(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof val === "object" && val !== null) {
      out[key] = serializeValue(val as Record<string, unknown>);
    } else if (typeof val === "boolean") {
      out[key] = String(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/** Build a mock ref object: `{ value: "XXX:Name:1", $ref: "XXX:Name:1" }`. */
function genRefMock(defs: Defs, targetName: string): Record<string, unknown> {
  // Strip trailing "Ref", "RefStructure", "_RefStructure" to get a readable entity name
  const clean = targetName
    .replace(/_?RefStructure$/, "")
    .replace(/Ref$/, "");
  const id = `XXX:${clean || targetName}:1`;
  // Walk the ref target's props to include any attributes
  const def = defs[targetName];
  if (def) {
    const props = flattenAllOf(defs, targetName);
    const result: Record<string, unknown> = {};
    for (const p of props) {
      const propName = p.prop[1];
      if (propName === "value") {
        result.value = id;
      } else if (propName === "$ref") {
        result.$ref = id;
      } else if (propName === "$version") {
        result.$version = "1";
      } else if (propName.startsWith("$")) {
        // Other XML attributes — use sensible defaults
        const shape = classifySchema(p.schema);
        if (shape.kind === "primitive") {
          if (shape.type === "boolean") result[propName] = false;
          else result[propName] = "string";
        }
      }
    }
    if (!("value" in result)) result.value = id;
    if (!("$ref" in result)) result.$ref = id;
    return result;
  }
  return { value: id, $ref: id };
}

/**
 * Try to build a mock for a shallow-complex type (all props are non-complex).
 * Calls `flattenAllOf` once — returns null if any property is complex or there are no props.
 * Used both for the simpleObj atom path and for shallow-complex array/ref handling.
 */
function tryGenShallowMock(defs: Defs, typeName: string): Record<string, unknown> | null {
  const props = flattenAllOf(defs, typeName);
  if (props.length === 0) return null;
  const result: Record<string, unknown> = {};
  for (const p of props) {
    const r = resolvePropertyType(defs, p.schema);
    if (r.complex) return null;
    const propName = p.prop[1];
    const shape = classifySchema(p.schema);
    if (shape.kind === "primitive") {
      if (shape.type === "boolean") result[propName] = false;
      else if (shape.type === "number" || shape.type === "integer") result[propName] = 0;
      else result[propName] = "string";
    } else if (shape.kind === "enum") {
      result[propName] = shape.values[0] ?? "string";
    } else if (shape.kind === "ref") {
      const innerDef = defs[shape.target];
      if (innerDef?.enum) {
        result[propName] = innerDef.enum[0] ?? "string";
      } else {
        result[propName] = "string";
      }
    }
  }
  return result;
}

/**
 * Generate a fully populated mock object from JSON Schema definitions.
 *
 * Uses `flattenAllOf` (pre-inline) to collect all properties, then fills
 * each with a sensible default value based on its resolved type.
 */
export function genMockObject(defs: Defs, name: string): Record<string, unknown> {
  const props = flattenAllOf(defs, name);
  const result: Record<string, unknown> = {};

  for (const p of props) {
    const propName = p.prop[1];
    const schema = p.schema;

    // x-fixed-single-enum: use the context-resolved value
    if (typeof schema["x-fixed-single-enum"] === "string") {
      result[propName] = name;
      continue;
    }

    // $id attribute
    if (propName === "$id") {
      result[propName] = `ENT:${name}:1`;
      continue;
    }
    // $version attribute
    if (propName === "$version") {
      result[propName] = "1";
      continue;
    }

    const resolved = resolvePropertyType(defs, schema, name);

    // Enum name (stamped enumeration)
    if (resolved.via && resolved.via.length > 0) {
      const lastHop = resolved.via[resolved.via.length - 1];
      if (lastHop.rule === "enum") {
        const enumDef = defs[lastHop.name];
        if (enumDef?.enum) {
          // Enum list (x-netex-atom:array)
          if (resolved.ts.endsWith("[]")) {
            result[propName] = [enumDef.enum[0]];
          } else {
            result[propName] = enumDef.enum[0];
          }
          continue;
        }
      }
    }

    // Reference type
    const shape = classifySchema(schema);
    if (shape.kind === "ref") {
      const targetDef = defs[shape.target];
      const role = defRole(targetDef);
      if (role === "reference") {
        result[propName] = genRefMock(defs, shape.target);
        continue;
      }
      if (role === "collection") {
        result[propName] = [];
        continue;
      }
      // Atom types (simpleObj)
      const atom = resolveAtom(defs, shape.target);
      if (atom === "simpleObj") {
        result[propName] = tryGenShallowMock(defs, shape.target) ?? {};
        continue;
      }
      // Single-prop atom collapses to primitive
      if (atom && atom !== "array") {
        if (atom === "string") result[propName] = "string";
        else if (atom === "number" || atom === "integer") result[propName] = 0;
        else if (atom === "boolean") result[propName] = false;
        else result[propName] = "string";
        continue;
      }
    }

    // Primitives
    if (!resolved.complex) {
      const ts = resolved.ts;
      if (ts === "boolean") {
        result[propName] = false;
        continue;
      }
      if (ts === "number" || ts === "integer") {
        result[propName] = 0;
        continue;
      }
      if (ts.includes("/* date-time */")) {
        result[propName] = "2025-01-01T00:00:00";
        continue;
      }
      if (ts.includes("/* date */")) {
        result[propName] = "2025-01-01";
        continue;
      }
      if (ts.includes("/* time */")) {
        result[propName] = "00:00:00";
        continue;
      }
      // Fixed literal (single quoted value, no union)
      if (ts.startsWith('"') && !ts.includes("|")) {
        result[propName] = JSON.parse(ts);
        continue;
      }
      if (ts === "string" || ts.startsWith('"')) {
        result[propName] = "string";
        continue;
      }
      if (ts.endsWith("[]")) {
        result[propName] = [];
        continue;
      }
      result[propName] = "string";
      continue;
    }

    // Shallow-complex: all inner props are non-complex — fill with tryGenShallowMock
    if (resolved.complex) {
      if (resolved.ts.endsWith("[]")) {
        // Array type (e.g. TextType[], KeyValueStructure[]) — one-element sample
        const itemType = resolved.ts.slice(0, -2);
        const shallow = defs[itemType] ? tryGenShallowMock(defs, itemType) : null;
        if (shallow) {
          result[propName] = [shallow];
          continue;
        }
      } else if (shape.kind === "ref") {
        // Single ref (e.g. PassengerCapacity → PassengerCapacityStructure)
        const shallow = defs[shape.target] ? tryGenShallowMock(defs, shape.target) : null;
        if (shallow) {
          result[propName] = shallow;
          continue;
        }
      }
    }

    // Non-shallow refArray — empty array fallback
    if (shape.kind === "refArray") {
      result[propName] = [];
      continue;
    }

    // Complex types with nested complexity — omit to keep mock shallow
  }

  return result;
}

/**
 * Build a formatted XML string from a mock object.
 *
 * Applies `serializeValue` to convert canonical `$`-prefixed attribute names
 * to `@_`-prefixed names, then uses `fast-xml-parser`'s `XMLBuilder`.
 */
export function buildXmlString(name: string, obj: Record<string, unknown>): string {
  const serialized = serializeValue(obj);
  const builder = new XMLBuilder({
    format: true,
    indentBy: "  ",
    ignoreAttributes: false,
  });
  return builder.build({ [name]: serialized }) as string;
}
