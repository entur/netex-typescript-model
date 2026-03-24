/** Type resolution: resolve definitions and properties to TypeScript types. */

import type { Def, NetexLibrary, ViaHop, ResolvedType } from "./types.js";
import { deref, allOfRef } from "./util.js";
import { classifySchema, isDynNocRef, unwrapMixed } from "./classify.js";

/**
 * Resolve a definition name to its TypeScript type.
 *
 * Follows $ref aliases, allOf wrappers, enums, and anyOf unions.
 * Unwraps single-prop array wrappers whose items have an atom annotation
 * (e.g. KeyListStructure → KeyValueStructure[]) when the wrapper has no role.
 * Returns `{ complex: true }` for types with own properties that can't
 * be reduced to a primitive.
 */
export function resolveDefType(netexLibrary: NetexLibrary, name: string, visited?: Set<string>): ResolvedType {
  if (!visited) visited = new Set();
  if (visited.has(name)) return { ts: name, complex: true };
  visited.add(name);
  const def = netexLibrary[name];
  if (!def) return { ts: name, complex: true };

  /** Prepend a hop to the via chain of an inner result. */
  function withHop(result: ResolvedType, hopName: string, rule: ViaHop["rule"]): ResolvedType {
    return { ...result, via: [{ name: hopName, rule }, ...(result.via || [])] };
  }

  // Pure $ref alias
  if (def.$ref) return withHop(resolveDefType(netexLibrary, deref(def.$ref), visited), name, "ref");

  // allOf with single $ref (wrapper or inheritance)
  if (def.allOf) {
    const refs = def.allOf.filter((e: Def) => e.$ref);
    if (refs.length === 1) {
      const target = deref(refs[0].$ref);
      const hasOwnProps =
        (def.properties && Object.keys(def.properties).length > 0) ||
        def.allOf.some((e: Def) => e.properties && Object.keys(e.properties).length > 0);
      if (!hasOwnProps) {
        return withHop(resolveDefType(netexLibrary, target, visited), name, "allOf-passthrough");
      }
      // Speculatively follow parent — use result if primitive
      const parentResult = resolveDefType(netexLibrary, target, new Set(visited));
      if (!parentResult.complex) return withHop(parentResult, name, "allOf-speculative");
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
      if (branch.$ref) return resolveDefType(netexLibrary, deref(branch.$ref), new Set(visited));
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
      const inner = resolveDefType(netexLibrary, itemShape.target, new Set(visited));
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
    const tsType = def.type === "integer" ? "number" : def.type;
    const fmt = def.format ? " /* " + def.format + " */" : "";
    return { ts: tsType + fmt, complex: false, via: [{ name, rule: "primitive" }] };
  }

  // Mixed-content wrapper — resolve as the inner element type array
  const mixedTarget = unwrapMixed(netexLibrary, name);
  if (mixedTarget)
    return { ts: mixedTarget + "[]", complex: true, via: [{ name, rule: "mixed-unwrap" }] };

  // Single-prop array wrapper with atom items → unwrap to item[]
  // Gate: skip classified types (e.g. _RelStructure role=collection)
  if (!def["x-netex-role"] && def.properties) {
    const keys = Object.keys(def.properties);
    if (keys.length === 1) {
      const shape = classifySchema(def.properties[keys[0]]);
      if (shape.kind === "refArray" && resolveAtom(netexLibrary, shape.target)) {
        const inner = resolveDefType(netexLibrary, shape.target, new Set(visited));
        return withHop(
          { ts: inner.ts + "[]", complex: inner.complex, via: inner.via },
          name,
          "array-unwrap",
        );
      }
    }
  }

  // Empty object (no properties, no role) — e.g. ExtensionsStructure (xsd:any wrapper)
  // Also catches completely empty schemas ({}) from unresolved XSD constructs
  if (
    (!def.type || def.type === "object") &&
    !def.properties &&
    !def["x-netex-role"] &&
    !def.allOf &&
    !def.anyOf &&
    !def.enum
  ) {
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
export function resolvePropertyType(netexLibrary: NetexLibrary, schema: Def, context?: string): ResolvedType {
  if (context && typeof schema["x-fixed-single-enum"] === "string") {
    return {
      ts: JSON.stringify(context),
      complex: false,
      via: [{ name: context, rule: "fixed-for" }],
    };
  }
  if (isDynNocRef(schema)) {
    return { ts: "string", complex: false, via: [{ name: "NameOfClass", rule: "dyn-class" }] };
  }
  const shape = classifySchema(schema);
  switch (shape.kind) {
    case "ref":
      return resolveDefType(netexLibrary, shape.target);
    case "refArray": {
      const inner = resolveDefType(netexLibrary, shape.target);
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
      const tsType = shape.type === "integer" ? "number" : shape.type;
      const fmt = shape.format ? " /* " + shape.format + " */" : "";
      return { ts: tsType + fmt, complex: false };
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
export function resolveAtom(netexLibrary: NetexLibrary, name: string): string | null {
  const def = netexLibrary[name];
  if (!def) return null;
  if (def.$ref) return resolveAtom(netexLibrary, deref(def.$ref));
  if (def["x-netex-atom"]) return def["x-netex-atom"];
  // Walk allOf single-ref wrappers (e.g. PrivateCode → PrivateCodeStructure)
  if (def.allOf) {
    const ref = allOfRef(def.allOf);
    if (ref) return resolveAtom(netexLibrary, ref);
  }
  return null;
}
