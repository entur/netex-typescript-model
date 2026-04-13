/** Collapse resolution for --collapse-refs and --collapse-collections. */

import type { Def, NetexLibrary } from "./types.js";
import { classifySchema, defRole, isRefType, refTarget } from "./classify.js";
import { resolveRefEntity } from "./dep-graph.js";
import { flattenAllOf } from "./schema-nav.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CollapseOpts {
  collapseRefs?: boolean;
  collapseCollections?: boolean;
}

export interface CollapsedRef {
  entityName: string;
  typeStr: string; // "Ref<'Entity'>" or "SimpleRef"
}

export interface CollapsedColl {
  verStructName: string;   // e.g. "VehicleManoeuvringRequirement_VersionStructure"
  simplifiedName: string;  // e.g. "VehicleManoeuvringRequirement"
  childKey: string;        // property name inside the RelStructure wrapper
  typeStr: string;         // same as simplifiedName (used as interface name)
}

// ── Preamble ───────────────────────────────────────────────────────────────

export const REF_PREAMBLE = [
  "export type SimpleRef = string;",
  "// _T is read by codegen AST, not at runtime",
  "// eslint-disable-next-line @typescript-eslint/no-unused-vars",
  "export type Ref<_T extends string = string> = string;",
].join("\n");

// ── Ref collapse ───────────────────────────────────────────────────────────

/**
 * Try to collapse a ref-typed property to Ref<'Entity'> or SimpleRef.
 *
 * Resolution pipeline (layered):
 * 1. refTarget(schema) → ref definition name
 * 2. resolveRefEntity (checks x-netex-refTarget stamp + def name stripping)
 * 3. Property name heuristic (DeckPlanRef → DeckPlan)
 * 4. Validate: candidate exists AND has role "entity"
 *
 * Returns null if the property is not a collapsible ref.
 */
export function collapseRef(
  lib: NetexLibrary,
  propName: string,
  propSchema: Def,
): CollapsedRef | null {
  if (!isRefType(propSchema)) return null;

  const defName = refTarget(propSchema);
  if (!defName) return null;

  const def = lib[defName];
  if (!def) return null;
  if (defRole(def) !== "reference") return null;

  // Layers 1-2: stamp + def name stripping (handled by resolveRefEntity)
  let entity = resolveRefEntity(lib, defName);

  // Layer 3: property name heuristic
  if (!entity && propName.endsWith("Ref")) {
    const candidate = propName.slice(0, -3);
    if (lib[candidate] && defRole(lib[candidate]) === "entity") {
      entity = candidate;
    }
  }

  if (typeof entity === "string") {
    return { entityName: entity, typeStr: `Ref<'${entity}'>` };
  }
  // Array result (abstract with multiple concrete entities) → untyped
  return { entityName: "", typeStr: "SimpleRef" };
}

// ── Collection collapse ────────────────────────────────────────────────────

/**
 * Try to collapse a collection-typed (_RelStructure) property.
 *
 * Finds the single non-$, non-Ref child property of the RelStructure.
 * If exactly one such child exists (entity or structure ref), returns
 * its target name for use as the collapsed type.
 *
 * Returns null if the property is not a collapsible collection
 * (non-collection role, multi-child, or unresolvable).
 */
export function collapseColl(
  lib: NetexLibrary,
  _propName: string,
  propSchema: Def,
): CollapsedColl | null {
  const defName = refTarget(propSchema);
  if (!defName) return null;
  return resolveCollChild(lib, defName);
}

/** Core logic shared between collapseColl and resolveCollVerStruct. */
function resolveCollChild(lib: NetexLibrary, collDefName: string): CollapsedColl | null {
  const def = lib[collDefName];
  if (!def) return null;
  if (defRole(def) !== "collection") return null;

  // Find non-$, non-Ref child properties
  const props = flattenAllOf(lib, collDefName);
  const candidates: Array<{ canon: string; target: string }> = [];
  for (const p of props) {
    const canon = p.prop[1];
    if (canon.startsWith("$") || canon.endsWith("Ref")) continue;

    const shape = classifySchema(p.schema);
    if (shape.kind === "ref" || shape.kind === "refArray") {
      candidates.push({ canon, target: shape.target });
    }
  }

  // Only collapse single-child collections
  if (candidates.length !== 1) return null;
  const { canon, target } = candidates[0];
  return { verStructName: target, simplifiedName: target, childKey: canon, typeStr: target };
}

// ── Collection resolve by def name ─────────────────────────────────────────

/**
 * Resolve a collection (RelStructure) definition to its child type.
 * Like collapseColl but takes a def name directly — avoids needing a property schema.
 * Used by the BFS remap callback in collectDependencyTree.
 */
export function resolveCollVerStruct(
  lib: NetexLibrary,
  collDefName: string,
): CollapsedColl | null {
  return resolveCollChild(lib, collDefName);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a type-override map for all collapsible properties of a definition.
 * Returns a Map<canonicalPropName, collapsedTypeStr> used by generateInterface.
 */
export function buildTypeOverrides(
  lib: NetexLibrary,
  name: string,
  collapse: CollapseOpts,
): Map<string, string> {
  const overrides = new Map<string, string>();
  const props = flattenAllOf(lib, name);
  for (const p of props) {
    const canon = p.prop[1];
    if (collapse.collapseRefs) {
      const cr = collapseRef(lib, canon, p.schema);
      if (cr) { overrides.set(canon, cr.typeStr); continue; }
    }
    if (collapse.collapseCollections) {
      const cc = collapseColl(lib, canon, p.schema);
      if (cc) { overrides.set(canon, cc.typeStr); continue; }
    }
  }
  return overrides;
}
