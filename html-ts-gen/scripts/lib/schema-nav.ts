/** Schema navigation: inheritance walking, property flattening, inlining. */

import type { Def, NetexLibrary, FlatProperty, InheritanceNode } from "./types.js";
import { deref, canonicalPropName } from "./util.js";
import { classifySchema, resolveType, defRole } from "./classify.js";
import { resolvePropertyType } from "./type-res.js";

/** Base types inherited by every NeTEx entity — ~19 props of infrastructure clutter. */
export const OMNIPRESENT_DEFS = new Set([
  "EntityStructure",
  "EntityInVersionStructure",
  "DataManagedObjectStructure",
]);

/**
 * Build a merged exclusion set from explicit prop names + optional omni filtering.
 * Shared by CLI (ts-gen) and browser (schema-viewer-host-app).
 */
export function buildExclSet(
  allProps: FlatProperty[],
  opts?: { omni?: boolean; explicit?: Set<string> },
): Set<string> | undefined {
  const excl = new Set(opts?.explicit ?? []);
  if (opts?.omni) {
    const kept = new Set(
      allProps.filter((p) => !OMNIPRESENT_DEFS.has(p.origin)).map((p) => p.prop[1]),
    );
    for (const p of allProps) if (!kept.has(p.prop[1])) excl.add(p.prop[1]);
  }
  return excl.size > 0 ? excl : undefined;
}

/** Flatten allOf inheritance to a list of properties with their origin type. */
export function flattenAllOf(
  netexLibrary: NetexLibrary,
  name: string,
  opts?: { excludeOmni?: boolean },
): FlatProperty[] {
  const results: FlatProperty[] = [];
  const visited = new Set<string>();

  function walk(n: string): void {
    if (visited.has(n)) return;
    visited.add(n);
    const def = netexLibrary[n];
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
  return opts?.excludeOmni ? results.filter((r) => !OMNIPRESENT_DEFS.has(r.origin)) : results;
}

/** Collect all required property names from the inheritance chain. */
export function collectRequired(
  netexLibrary: NetexLibrary,
  name: string,
  opts?: { excludeOmni?: boolean },
): Set<string> {
  const req = new Set<string>();
  const visited = new Set<string>();

  function walk(n: string): void {
    if (visited.has(n)) return;
    visited.add(n);
    const def = netexLibrary[n];
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
  if (opts?.excludeOmni) {
    for (const omni of OMNIPRESENT_DEFS) {
      const def = netexLibrary[omni];
      if (def?.required) def.required.forEach((r: string) => req.delete(r));
      for (const ao of def?.allOf ?? []) {
        if (ao.required) ao.required.forEach((r: string) => req.delete(r));
      }
    }
  }
  return req;
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
export function buildInheritanceChain(netexLibrary: NetexLibrary, name: string): InheritanceNode[] {
  const chain: InheritanceNode[] = [];
  const visited = new Set<string>();

  function walk(n: string): void {
    if (visited.has(n)) return;
    visited.add(n);
    const def = netexLibrary[n];
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
          for (const [k, v] of Object.entries(entry.properties))
            ownProps.push({ name: k, schema: v as Record<string, unknown> });
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
export function inlineSingleRefs(netexLibrary: NetexLibrary, props: FlatProperty[]): FlatProperty[] {
  // Identify candidate indices
  const candidates: { idx: number; targetName: string }[] = [];
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    const shape = classifySchema(p.schema);
    if (shape.kind !== "ref") continue;
    const resolved = resolvePropertyType(netexLibrary, p.schema);
    if (!resolved.complex || resolved.ts.endsWith("[]")) continue;
    const targetDef = netexLibrary[resolved.ts];
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
      const innerProps = flattenAllOf(netexLibrary, cand.targetName);
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
