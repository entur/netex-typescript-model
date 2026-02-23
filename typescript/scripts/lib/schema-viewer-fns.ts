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
 * `resolvePropertyType` to resolve each to its leaf TypeScript type and
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

export interface ResolvedType {
  ts: string;
  complex: boolean;
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
 * Resolve a definition name to its leaf TypeScript type.
 *
 * Follows $ref aliases, allOf wrappers, enums, and anyOf unions.
 * Returns `{ complex: true }` for types with own properties that can't
 * be reduced to a primitive.
 */
export function resolveLeafType(defs: Defs, name: string, visited?: Set<string>): ResolvedType {
  if (!visited) visited = new Set();
  if (visited.has(name)) return { ts: name, complex: true };
  visited.add(name);
  const def = defs[name];
  if (!def) return { ts: name, complex: true };

  // Pure $ref alias
  if (def.$ref) return resolveLeafType(defs, deref(def.$ref), visited);

  // allOf with single $ref (wrapper or inheritance)
  if (def.allOf) {
    const refs = def.allOf.filter((e: Def) => e.$ref);
    if (refs.length === 1) {
      const target = deref(refs[0].$ref);
      const hasOwnProps =
        (def.properties && Object.keys(def.properties).length > 0) ||
        def.allOf.some((e: Def) => e.properties && Object.keys(e.properties).length > 0);
      if (!hasOwnProps) {
        return resolveLeafType(defs, target, visited);
      }
      // Speculatively follow parent — use result if primitive
      const parentResult = resolveLeafType(defs, target, new Set(visited));
      if (!parentResult.complex) return parentResult;
    }
  }

  // Enum
  if (def.enum)
    return { ts: def.enum.map((v: unknown) => JSON.stringify(v)).join(" | "), complex: false };

  // anyOf union
  if (def.anyOf) {
    const parts = def.anyOf.map((branch: Def) => {
      if (branch.$ref) return resolveLeafType(defs, deref(branch.$ref), new Set(visited));
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
    return { ts: def.type + fmt, complex: false };
  }

  // Check x-netex-atom annotation — single-prop simpleContent wrappers collapse to primitive
  const atom = def["x-netex-atom"];
  if (typeof atom === "string" && atom !== "simpleObj") return { ts: atom, complex: false };

  // Mixed-content wrapper — resolve as the inner element type array
  const mixedTarget = unwrapMixed(defs, name);
  if (mixedTarget) return { ts: mixedTarget + "[]", complex: true };

  // Complex
  return { ts: name, complex: true };
}

/**
 * Resolve a property schema to its TypeScript type representation.
 *
 * Delegates to resolveLeafType for $ref targets. Handles arrays, enums,
 * and inline primitives directly.
 */
export function resolvePropertyType(defs: Defs, schema: Def): ResolvedType {
  const shape = classifySchema(schema);
  switch (shape.kind) {
    case "ref":
      return resolveLeafType(defs, shape.target);
    case "refArray": {
      const inner = resolveLeafType(defs, shape.target);
      return { ts: inner.ts + "[]", complex: inner.complex };
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
 * types get `"simpleObj"`. Returns the annotation value or null if absent.
 */
export function resolveAtom(defs: Defs, name: string): string | null {
  const def = defs[name];
  if (!def) return null;
  if (def.$ref) return resolveAtom(defs, deref(def.$ref));
  return def["x-netex-atom"] || null;
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
