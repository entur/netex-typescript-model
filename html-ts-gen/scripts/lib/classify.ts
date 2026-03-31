/** Definition classification: role detection, schema shape, ref inspection. */

import type { Def, NetexLibrary, SchemaShape } from "./types.js";
import { deref, allOfRef } from "./util.js";

/** Classify a property schema into a discriminated shape (single pass). */
export function classifySchema(prop: Def): SchemaShape {
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

/**
 * Detect a backward-compat mixed-content wrapper and return the "new way" element type.
 *
 * NeTEx has exactly one mixed-content type: MultilingualString. It exists for
 * backward compatibility — pre-v2.0 code puts text + lang directly on the element,
 * while v2.0+ uses Text child elements. The XSD documentation signals this with
 * "*Either*" in the description and `mixed="true"` (stamped as `x-netex-mixed`).
 *
 * Returns the element type name (e.g. "TextType") or null if not a mixed wrapper.
 */
export function unwrapMixed(netexLibrary: NetexLibrary, name: string): string | null {
  const def = netexLibrary[name];
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

const MEGA_ENUM = "NameOfClass";

/** Does this property schema dynamically reference the NameOfClass mega-enum (without x-fixed-single-enum)? */
export function isDynNocRef(schema: Def): boolean {
  if (typeof schema["x-fixed-single-enum"] === "string") return false;
  const shape = classifySchema(schema);
  return shape.kind === "ref" && shape.target === MEGA_ENUM;
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

/** Raw x-netex-role value, or "unclassified". */
function rawRole(def: Def | undefined): string {
  return typeof def?.["x-netex-role"] === "string" ? def["x-netex-role"] : "unclassified";
}

/** Extract the base role (without /deprecated suffix), defaulting to "unclassified". */
export function defRole(def: Def | undefined): string {
  const r = rawRole(def);
  return r.endsWith("/deprecated") ? r.slice(0, -11) : r;
}

/** Whether definition is deprecated (role ends with /deprecated). */
export function isDeprecated(def: Def | undefined): boolean {
  return rawRole(def).endsWith("/deprecated");
}

/** Count definitions per role. Returns a Map keyed by role string. */
export function countRoles(defNames: string[], netexLibrary: NetexLibrary): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of defNames) {
    const role = defRole(netexLibrary[name]);
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
  netexLibrary: NetexLibrary,
): Array<{ role: string; label: string; count: number }> {
  const counts = countRoles(defNames, netexLibrary);
  return ROLE_DISPLAY_ORDER.filter((r) => counts.has(r)).map((role) => ({
    role,
    label: ROLE_LABELS[role] ?? role,
    count: counts.get(role) ?? 0,
  }));
}
