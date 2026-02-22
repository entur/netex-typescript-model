/**
 * Pure functions used by the schema HTML viewer's explorer panel.
 *
 * These are the canonical implementations — the inline JS in the <script> tag
 * of build-schema-html.ts mirrors them, closing over a page-level `defs` variable
 * instead of taking `defs` as a parameter. Keep both in sync.
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
  prop: string;
  type: string;
  desc: string;
  origin: string;
  schema: Def;
}

// ── Property introspection ───────────────────────────────────────────────────

/** Resolve a property schema to a human-readable type string. */
export function resolveType(prop: Def): string {
  if (!prop || typeof prop !== "object") return "unknown";
  if (prop.$ref) return prop.$ref.replace("#/definitions/", "");
  if (prop.allOf) {
    for (const entry of prop.allOf) {
      if (entry.$ref) return entry.$ref.replace("#/definitions/", "");
    }
  }
  if (prop.enum) return prop.enum.join(" | ");
  if (prop.type === "array" && prop.items) {
    if (prop.items.$ref) return prop.items.$ref.replace("#/definitions/", "") + "[]";
    return (prop.items.type || "any") + "[]";
  }
  if (prop.type) return Array.isArray(prop.type) ? prop.type.join(" | ") : prop.type;
  return "object";
}

/** Does this property schema reference another definition? */
export function isRefType(prop: Def): boolean {
  if (!prop || typeof prop !== "object") return false;
  if (prop.$ref) return true;
  if (prop.allOf) return prop.allOf.some((e: Def) => e.$ref);
  if (prop.type === "array" && prop.items && prop.items.$ref) return true;
  return false;
}

/** Extract the target definition name from a reference property, or null. */
export function refTarget(prop: Def): string | null {
  if (prop.$ref) return prop.$ref.replace("#/definitions/", "");
  if (prop.allOf) {
    for (const e of prop.allOf) {
      if (e.$ref) return e.$ref.replace("#/definitions/", "");
    }
  }
  if (prop.type === "array" && prop.items && prop.items.$ref)
    return prop.items.$ref.replace("#/definitions/", "");
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
      walk(def.$ref.replace("#/definitions/", ""));
      return;
    }
    if (def.allOf) {
      for (const entry of def.allOf) {
        if (entry.$ref) {
          walk(entry.$ref.replace("#/definitions/", ""));
        } else if (entry.properties) {
          for (const [pn, pv] of Object.entries(entry.properties) as [string, Def][]) {
            results.push({ prop: pn, type: resolveType(pv), desc: pv.description || "", origin: n, schema: pv });
          }
        }
      }
    }
    if (def.properties) {
      for (const [pn, pv] of Object.entries(def.properties) as [string, Def][]) {
        if (!results.some((r) => r.prop === pn && r.origin === n)) {
          results.push({ prop: pn, type: resolveType(pv), desc: pv.description || "", origin: n, schema: pv });
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
      walk(def.$ref.replace("#/definitions/", ""));
      return;
    }
    if (def.allOf) {
      for (const entry of def.allOf) {
        if (entry.$ref) walk(entry.$ref.replace("#/definitions/", ""));
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
  if (def.$ref) return resolveLeafType(defs, def.$ref.replace("#/definitions/", ""), visited);

  // allOf with single $ref (wrapper or inheritance)
  if (def.allOf) {
    const refs = def.allOf.filter((e: Def) => e.$ref);
    if (refs.length === 1) {
      const hasOwnProps =
        (def.properties && Object.keys(def.properties).length > 0) ||
        def.allOf.some((e: Def) => e.properties && Object.keys(e.properties).length > 0);
      if (!hasOwnProps) {
        return resolveLeafType(defs, refs[0].$ref.replace("#/definitions/", ""), visited);
      }
      // Speculatively follow parent — use result if primitive
      const parentResult = resolveLeafType(defs, refs[0].$ref.replace("#/definitions/", ""), new Set(visited));
      if (!parentResult.complex) return parentResult;
    }
  }

  // Enum
  if (def.enum) return { ts: def.enum.map((v: unknown) => JSON.stringify(v)).join(" | "), complex: false };

  // anyOf union
  if (def.anyOf) {
    const parts = def.anyOf.map((branch: Def) => {
      if (branch.$ref) return resolveLeafType(defs, branch.$ref.replace("#/definitions/", ""), new Set(visited));
      if (branch.enum) return { ts: branch.enum.map((v: unknown) => JSON.stringify(v)).join(" | "), complex: false };
      if (branch.type) return { ts: branch.type, complex: false };
      return { ts: "unknown", complex: false };
    });
    return { ts: parts.map((p: ResolvedType) => p.ts).join(" | "), complex: parts.some((p: ResolvedType) => p.complex) };
  }

  // Primitive (no properties)
  if (def.type && !def.properties && typeof def.type === "string" && def.type !== "object") {
    const fmt = def.format ? " /* " + def.format + " */" : "";
    return { ts: def.type + fmt, complex: false };
  }

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
  if (!schema || typeof schema !== "object") return { ts: "unknown", complex: false };

  // Direct $ref
  if (schema.$ref) {
    return resolveLeafType(defs, schema.$ref.replace("#/definitions/", ""));
  }
  // allOf wrapper
  if (schema.allOf) {
    for (const entry of schema.allOf) {
      if (entry.$ref) {
        return resolveLeafType(defs, entry.$ref.replace("#/definitions/", ""));
      }
    }
  }
  // Array
  if (schema.type === "array" && schema.items) {
    if (schema.items.$ref) {
      const inner = resolveLeafType(defs, schema.items.$ref.replace("#/definitions/", ""));
      return { ts: inner.ts + "[]", complex: inner.complex };
    }
    return { ts: (schema.items.type || "any") + "[]", complex: false };
  }
  // Enum
  if (schema.enum) return { ts: schema.enum.map((v: unknown) => JSON.stringify(v)).join(" | "), complex: false };
  // Primitive
  if (schema.type && schema.type !== "object") {
    const fmt = schema.format ? " /* " + schema.format + " */" : "";
    return { ts: schema.type + fmt, complex: false };
  }
  return { ts: "object", complex: false };
}

/**
 * Read the x-netex-leaf annotation for a definition.
 *
 * The converter (xsd-to-jsonschema-1st-try.ts) stamps `x-netex-leaf` on simpleContent-
 * derived types at build time (Option B: propagated through the full value chain).
 * This function is a simple property read — no chain-walking needed.
 */
export function resolveValueLeaf(defs: Defs, name: string): string | null {
  const def = defs[name];
  if (!def) return null;
  if (def.$ref) return resolveValueLeaf(defs, def.$ref.replace("#/definitions/", ""));
  return def["x-netex-leaf"] || null;
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
