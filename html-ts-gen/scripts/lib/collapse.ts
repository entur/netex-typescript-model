/** Collapse resolution for --collapse-refs and --collapse-collections. */

import type { Def, NetexLibrary, FlatProperty } from "./types.js";
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
  /** Child def name — used as reshapeComplex dispatch key and interface name. */
  target: string;
  /** Property name inside the RelStructure wrapper (XML child element name). */
  childKey: string;
}

export interface CollapsedCollRef {
  entityName: string;
  typeStr: string;      // "Ref<'Entity'>" or "SimpleRef"
  refChildKey: string;  // Ref property name inside the wrapper (for flattenFake)
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
  return resolveCollVerStruct(lib, defName);
}

/**
 * Resolve a collection (RelStructure) def to its single child type.
 * Rejects refArray children (childWrapped handles single objects only).
 * Exported for BFS remap callback in collectDependencyTree.
 */
export function resolveCollVerStruct(lib: NetexLibrary, collDefName: string): CollapsedColl | null {
  const def = lib[collDefName];
  if (!def || defRole(def) !== "collection") return null;

  const props = flattenAllOf(lib, collDefName);
  const candidates: Array<{ canon: string; target: string }> = [];
  for (const p of props) {
    const canon = p.prop[1];
    if (canon.startsWith("$") || canon.endsWith("Ref")) continue;
    const shape = classifySchema(p.schema);
    if (shape.kind === "ref") candidates.push({ canon, target: shape.target });
  }

  if (candidates.length !== 1) return null;
  return { target: candidates[0].target, childKey: candidates[0].canon };
}

/**
 * Try to collapse a collection via its Ref child (option A).
 * Prop-level wrapper around resolveCollRefVerStruct.
 */
export function collapseCollAsRef(
  lib: NetexLibrary,
  _propName: string,
  propSchema: Def,
): CollapsedCollRef | null {
  const defName = refTarget(propSchema);
  if (!defName) return null;
  return resolveCollRefVerStruct(lib, defName);
}

/**
 * Resolve a collection def to its Ref child type.
 * Finds the first Ref-suffixed, ref-typed child and delegates to collapseRef.
 * Exported for BFS remap callback in collectDependencyTree.
 */
export function resolveCollRefVerStruct(lib: NetexLibrary, collDefName: string): CollapsedCollRef | null {
  const def = lib[collDefName];
  if (!def || defRole(def) !== "collection") return null;

  const props = flattenAllOf(lib, collDefName);
  for (const p of props) {
    const canon = p.prop[1];
    if (canon.startsWith("$") || !canon.endsWith("Ref")) continue;
    if (!isRefType(p.schema)) continue;
    const cr = collapseRef(lib, canon, p.schema);
    if (cr) return { entityName: cr.entityName, typeStr: cr.typeStr, refChildKey: canon };
  }
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a type-override map for all collapsible properties of a definition.
 * Accepts pre-computed props to avoid redundant flattenAllOf calls.
 */
export function buildTypeOverrides(
  lib: NetexLibrary,
  name: string,
  collapse: CollapseOpts,
  preProps?: FlatProperty[],
): Map<string, string> {
  const overrides = new Map<string, string>();
  const props = preProps ?? flattenAllOf(lib, name);
  for (const p of props) {
    const canon = p.prop[1];
    if (collapse.collapseRefs) {
      const cr = collapseRef(lib, canon, p.schema);
      if (cr) { overrides.set(canon, cr.typeStr); continue; }
    }
    if (collapse.collapseCollections) {
      const ccRef = collapseCollAsRef(lib, canon, p.schema);
      if (ccRef) { overrides.set(canon, ccRef.typeStr); continue; }
      const cc = collapseColl(lib, canon, p.schema);
      if (cc) { overrides.set(canon, cc.target); continue; }
    }
  }
  return overrides;
}
