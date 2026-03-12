/**
 * Data generation functions extracted from fns.ts.
 *
 * Builds fully populated fake objects from JSON Schema definitions and
 * serializes them to XML via fast-xml-parser. The primary export is `fake`
 * (aliased as `genMockObject` for backward compat).
 *
 * Depends on schema introspection functions from fns.ts for type resolution,
 * inheritance walking, and role classification.
 */

import { XMLBuilder } from "fast-xml-parser";
import {
  flattenAllOf,
  resolvePropertyType,
  resolveAtom,
  defRole,
  classifySchema,
  type Defs,
  type Def,
} from "./fns.js";

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

// ── Sample data generation ──────────────────────────────────────────────────

/** Build a fake ref object: `{ value: "XXX:Name:1", $ref: "XXX:Name:1" }`. */
function fakeRef(defs: Defs, targetName: string): Record<string, unknown> {
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
 * Try to build a fake for a shallow-complex type (all props are non-complex).
 * Calls `flattenAllOf` once — returns null if any property is complex or there are no props.
 * Used both for the simpleObj atom path and for shallow-complex array/ref handling.
 */
function tryFakeShallow(defs: Defs, typeName: string): Record<string, unknown> | null {
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
 * Generate a fully populated fake object from JSON Schema definitions.
 *
 * Uses `flattenAllOf` (pre-inline) to collect all properties, then fills
 * each with a sensible default value based on its resolved type.
 */
export function fake(defs: Defs, name: string): Record<string, unknown> {
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
        result[propName] = fakeRef(defs, shape.target);
        continue;
      }
      if (role === "collection") {
        result[propName] = [];
        continue;
      }
      // Atom types (simpleObj)
      const atom = resolveAtom(defs, shape.target);
      if (atom === "simpleObj") {
        result[propName] = tryFakeShallow(defs, shape.target) ?? {};
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
        const shallow = defs[itemType] ? tryFakeShallow(defs, itemType) : null;
        if (shallow) {
          result[propName] = [shallow];
          continue;
        }
      } else if (shape.kind === "ref") {
        // Single ref (e.g. PassengerCapacity → PassengerCapacityStructure)
        const shallow = defs[shape.target] ? tryFakeShallow(defs, shape.target) : null;
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

    // Complex types with nested complexity — omit to keep fake shallow
  }

  return result;
}

/**
 * Build a formatted XML string from a pre-transformed XML-ready object.
 *
 * Takes the output of `toXmlShape` (with `@_`-prefixed attributes, `#text`
 * for simpleContent, correct property ordering) and wraps it in an XMLBuilder
 * call. This is a thin formatting layer — no schema awareness.
 */
export function buildXml(name: string, xmlShape: Record<string, unknown>): string {
  const builder = new XMLBuilder({
    format: true,
    indentBy: "  ",
    ignoreAttributes: false,
  });
  return builder.build({ [name]: xmlShape }) as string;
}

// ── Schema-aware XML transform ──────────────────────────────────────────────

/**
 * Convention-only fallback for objects without schema context.
 *
 * Applies the same rules as `toXmlShape` but without property ordering
 * or ref-target recursion. Used when a nested object's definition isn't known.
 */
function toXmlShapePlain(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const hasDollarKey = Object.keys(obj).some((k) => k.startsWith("$"));
  const isSimpleContent = "value" in obj && hasDollarKey;
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (key.startsWith("$")) {
      out[`@_${key.slice(1)}`] = typeof val === "boolean" ? String(val) : val;
    } else if (isSimpleContent && key === "value") {
      out["#text"] = typeof val === "boolean" ? String(val) : val;
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) =>
        typeof item === "object" && item !== null
          ? toXmlShapePlain(item as Record<string, unknown>)
          : typeof item === "boolean"
            ? String(item)
            : item,
      );
    } else if (typeof val === "object" && val !== null) {
      out[key] = toXmlShapePlain(val as Record<string, unknown>);
    } else if (typeof val === "boolean") {
      out[key] = String(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Schema-aware transform from stem shape to fast-xml-parser XMLBuilder shape.
 *
 * Converts a flat fake object (from `fake`) to the nested structure
 * that `XMLBuilder` needs for valid XML output:
 *
 * 1. **Property ordering** — iterates properties in JSON Schema definition
 *    order (which matches the XSD `xsd:sequence`), not `obj` key order.
 * 2. **Attributes** — `$`-prefixed keys become `@_`-prefixed.
 * 3. **simpleContent** — for `x-netex-atom: "simpleObj"` types (e.g. refs),
 *    the `value` key becomes `#text`.
 * 4. **Booleans** — stringified (XML text nodes must be strings).
 * 5. **Ref-typed properties** — recurse with the ref target's definition.
 * 6. **Arrays** — map items recursively for ref-typed arrays.
 *
 * @param defs  JSON Schema definitions.
 * @param name  Definition name (follows $ref chains via `flattenAllOf`).
 * @param obj   Stem object (e.g. from `fake`).
 */
export function toXmlShape(
  defs: Defs,
  name: string,
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const schemaProps = flattenAllOf(defs, name);
  if (schemaProps.length === 0) return toXmlShapePlain(obj);

  const isSimpleContent = resolveAtom(defs, name) === "simpleObj";
  const out: Record<string, unknown> = {};
  const processed = new Set<string>();

  for (const p of schemaProps) {
    const canonName = p.prop[1];
    if (processed.has(canonName)) continue;
    processed.add(canonName);
    if (!(canonName in obj)) continue;
    const val = obj[canonName];
    if (val === undefined) continue;

    // Attributes: $ → @_
    if (canonName.startsWith("$")) {
      out[`@_${canonName.slice(1)}`] = typeof val === "boolean" ? String(val) : val;
      continue;
    }

    // simpleContent: value → #text
    if (isSimpleContent && canonName === "value") {
      out["#text"] = typeof val === "boolean" ? String(val) : val;
      continue;
    }

    const shape = classifySchema(p.schema);

    if (typeof val === "boolean") {
      out[canonName] = String(val);
    } else if (Array.isArray(val)) {
      if (shape.kind === "refArray") {
        out[canonName] = val.map((item) =>
          typeof item === "object" && item !== null
            ? toXmlShape(defs, shape.target, item as Record<string, unknown>)
            : typeof item === "boolean"
              ? String(item)
              : item,
        );
      } else {
        out[canonName] = val.map((item) =>
          typeof item === "object" && item !== null
            ? toXmlShapePlain(item as Record<string, unknown>)
            : typeof item === "boolean"
              ? String(item)
              : item,
        );
      }
    } else if (typeof val === "object" && val !== null) {
      if (shape.kind === "ref") {
        out[canonName] = toXmlShape(
          defs,
          shape.target,
          val as Record<string, unknown>,
        );
      } else {
        out[canonName] = toXmlShapePlain(val as Record<string, unknown>);
      }
    } else {
      out[canonName] = val;
    }
  }

  // Keys in obj not covered by schema (defensive fallback)
  for (const key of Object.keys(obj)) {
    if (processed.has(key)) continue;
    const val = obj[key];
    if (val === undefined) continue;
    if (key.startsWith("$")) {
      out[`@_${key.slice(1)}`] = typeof val === "boolean" ? String(val) : val;
    } else if (typeof val === "boolean") {
      out[key] = String(val);
    } else if (typeof val === "object" && val !== null) {
      out[key] = Array.isArray(val)
        ? val.map((item) =>
            typeof item === "object" && item !== null
              ? toXmlShapePlain(item as Record<string, unknown>)
              : typeof item === "boolean"
                ? String(item)
                : item,
          )
        : toXmlShapePlain(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }

  return out;
}

/**
 * Serialize a stem object to formatted XML.
 *
 * Composes `toXmlShape` (schema-aware transform) and `buildXml` (XMLBuilder
 * formatting). This is the recommended single-call API for producing valid
 * XML from `fake` output.
 *
 * @param defs  JSON Schema definitions.
 * @param name  Definition name (root element name in XML).
 * @param obj   Stem object (e.g. from `fake`).
 */
export function serialize(
  defs: Defs,
  name: string,
  obj: Record<string, unknown>,
): string {
  return buildXml(name, toXmlShape(defs, name, obj));
}
