/** Dependency graph: reverse index, transitive usage, dependency tree, ref resolution. */

import type { Def, NetexLibrary, RefPropEntry, DepTreeNode } from "./types.js";
import { deref, allOfRef, canonicalPropName } from "./util.js";
import { classifySchema, isRefType, refTarget, defRole, isDynNocRef } from "./classify.js";
import { flattenAllOf } from "./schema-nav.js";
import { resolveDefType, resolveAtom } from "./type-res.js";

/** Build a map of definition name → list of definitions that reference it. */
export function buildReverseIndex(netexLibrary: NetexLibrary): Record<string, string[]> {
  const idx: Record<string, string[]> = {};
  const needle = "#/definitions/";
  for (const [name, def] of Object.entries(netexLibrary)) {
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

/**
 * Resolve a reference definition name to the entity/entities it targets.
 *
 * Uses `x-netex-refTarget` stamp when available, falling back to name-stripping.
 * For abstract targets, expands `x-netex-sg-members` recursively to find concrete entities.
 *
 * @returns A single entity name, an array of entity names (abstract expansion), or null.
 */
export function resolveRefEntity(
  netexLibrary: NetexLibrary,
  refDefName: string,
  _visited?: Set<string>,
): string | string[] | null {
  const visited = _visited ?? new Set<string>();
  if (visited.has(refDefName)) return null;
  visited.add(refDefName);

  const def = netexLibrary[refDefName];
  // 1. Read stamp or fall back to name stripping
  let target: string | undefined = def?.["x-netex-refTarget"];
  if (!target) {
    if (refDefName.endsWith("Ref")) target = refDefName.slice(0, -3);
    else if (refDefName.endsWith("_RefStructure")) target = refDefName.slice(0, -13);
    else if (refDefName.endsWith("RefStructure")) target = refDefName.slice(0, -12);
  }
  if (!target || !netexLibrary[target]) return null;

  const role = defRole(netexLibrary[target]);
  // 2. Direct entity
  if (role === "entity") return target;
  // 3. Abstract — expand sg-members recursively
  //    Members may be on the target itself or on a parallel `_Dummy` element.
  if (role === "abstract") {
    let members: string[] = netexLibrary[target]?.["x-netex-sg-members"] ?? [];
    if (members.length === 0) {
      members = netexLibrary[target + "_Dummy"]?.["x-netex-sg-members"] ?? [];
    }
    const entities: string[] = [];
    for (const m of members) {
      // Try via Ref first
      const resolved = resolveRefEntity(netexLibrary, m + "Ref", visited);
      if (typeof resolved === "string") {
        if (!entities.includes(resolved)) entities.push(resolved);
      } else if (Array.isArray(resolved)) {
        for (const e of resolved) if (!entities.includes(e)) entities.push(e);
      }
      // If the member itself is an entity, include it directly
      if (defRole(netexLibrary[m]) === "entity" && !entities.includes(m)) entities.push(m);
    }
    return entities.length > 0 ? entities.sort() : null;
  }
  return null;
}

/**
 * Resolve an abstract element head to the first concrete substitution group member.
 * Follows `x-netex-sg-members` chains until a non-abstract definition is found.
 * Returns the original name unchanged if not abstract.
 */
export function resolveConcreteElement(netexLibrary: NetexLibrary, name: string): string {
  const visited = new Set<string>();
  let current = name;
  while (!visited.has(current)) {
    visited.add(current);
    const d = netexLibrary[current];
    if (!d) break;
    const members = d["x-netex-sg-members"] as string[] | undefined;
    if (!members || members.length === 0) break;
    current = members[0];
  }
  return current;
}

/**
 * Collect ref-typed properties from a definition and resolve their entity targets.
 *
 * Walks the full allOf chain via `flattenAllOf`, filters to `isRefType` properties,
 * resolves each through `resolveRefEntity`, and returns only those with resolvable targets.
 */
export function collectRefProps(netexLibrary: NetexLibrary, name: string): RefPropEntry[] {
  const props = flattenAllOf(netexLibrary, name);
  const result: RefPropEntry[] = [];
  for (const p of props) {
    if (!isRefType(p.schema)) continue;
    const target = refTarget(p.schema);
    if (!target) continue;
    const entities = resolveRefEntity(netexLibrary, target);
    if (!entities) continue;
    const targetEntities = typeof entities === "string" ? [entities] : entities;
    result.push({ propName: p.prop[0], refDefName: target, targetEntities });
  }
  return result;
}

/**
 * Collect the "extra" properties an entity's structure adds beyond a base structure.
 *
 * Walks the allOf chain from the entity's backing structure up to (but not including)
 * `baseStructure`, collecting own property names at each intermediate level.
 */
export function collectExtraProps(netexLibrary: NetexLibrary, entityName: string, baseStructure: string): string[] {
  // Resolve entity → backing structure (entities are $ref aliases)
  const entityDef = netexLibrary[entityName];
  if (!entityDef) return [];
  let struct = entityDef.$ref ? deref(entityDef.$ref) : null;
  if (!struct) {
    const ref = entityDef.allOf ? allOfRef(entityDef.allOf) : null;
    struct = ref ? deref(ref) : null;
  }
  if (!struct || struct === baseStructure) return [];

  // Walk from struct up to baseStructure, collecting own props
  const extras: string[] = [];
  let current: string | null = struct;
  const visited = new Set<string>();
  while (current && current !== baseStructure && !visited.has(current)) {
    visited.add(current);
    const d: Def | undefined = netexLibrary[current];
    if (!d) break;
    // Collect own properties from this level
    if (d.properties) {
      for (const k of Object.keys(d.properties)) extras.push(canonicalPropName(k, d.properties[k]));
    }
    for (const ao of d.allOf ?? []) {
      if (ao.properties) {
        for (const k of Object.keys(ao.properties))
          extras.push(canonicalPropName(k, ao.properties[k]));
      }
    }
    // Move up: find allOf $ref parent
    const parentRef: string | null = d.allOf ? allOfRef(d.allOf) : null;
    current = parentRef ?? (d.$ref ? deref(d.$ref) : null);
  }
  return extras;
}

/**
 * Collect all transitive type dependencies of a definition via BFS.
 *
 * Seeds the queue from the root's `flattenAllOf` properties — for each ref/refArray
 * target, enqueues it at depth 0. Pure `$ref` aliases are resolved before enqueuing.
 * Stops recursion at enumerations, references, atoms (non-simpleObj), and non-complex
 * types (per `resolveDefType`). Duplicates are tracked: re-encountered types are
 * emitted with `duplicate: true` but not recursed into.
 *
 * The root itself is excluded from the output.
 */
/**
 * Optional target remapping for dependency BFS.
 * Return the (possibly replaced) target name, or null to skip the target entirely.
 */
export type RemapTarget = (target: string) => string | null;

export function collectDependencyTree(netexLibrary: NetexLibrary, rootName: string, excludeRootProps?: Set<string>, remapTarget?: RemapTarget): DepTreeNode[] {
  const result: DepTreeNode[] = [];
  const emitted = new Set<string>();
  emitted.add(rootName);

  /** Resolve pure $ref aliases and allOf-passthrough wrappers to the underlying definition name. */
  function resolveAlias(name: string): string {
    const visited = new Set<string>();
    let current = name;
    while (!visited.has(current)) {
      visited.add(current);
      const def = netexLibrary[current];
      if (!def) break;
      if (def.$ref) {
        current = deref(def.$ref);
        continue;
      }
      // allOf with single $ref and no own properties → passthrough
      if (def.allOf) {
        const refs = def.allOf.filter((e: Def) => e.$ref);
        if (refs.length === 1) {
          const hasOwnProps =
            (def.properties && Object.keys(def.properties).length > 0) ||
            def.allOf.some((e: Def) => e.properties && Object.keys(e.properties).length > 0);
          if (!hasOwnProps) {
            current = deref(refs[0].$ref);
            continue;
          }
        }
      }
      break;
    }
    return current;
  }

  /** Should we stop recursion at this definition? */
  function isLeaf(name: string): boolean {
    const def = netexLibrary[name];
    if (!def) return true;
    const role = defRole(def);
    if (role === "enumeration" || role === "reference") return true;
    const atom = resolveAtom(netexLibrary, name);
    if (atom && atom !== "simpleObj") return true;
    const resolved = resolveDefType(netexLibrary, name);
    if (!resolved.complex) return true;
    return false;
  }

  /** Extract ref-typed property targets from a definition. */
  function refTargets(name: string): Array<{ target: string; via: string; canonical: string }> {
    const def = netexLibrary[name];
    const targets: Array<{ target: string; via: string; canonical: string }> = [];

    // Walk properties for ref/refArray targets
    const props = flattenAllOf(netexLibrary, name);
    for (const p of props) {
      // x-fixed-single-enum resolves to a literal — the $ref target is unused
      if (typeof p.schema["x-fixed-single-enum"] === "string") continue;
      if (isDynNocRef(p.schema)) continue;

      const shape = classifySchema(p.schema);
      const canon = p.prop[1];
      if (shape.kind === "ref" || shape.kind === "refArray") {
        targets.push({ target: resolveAlias(shape.target), via: p.prop[0], canonical: canon });
      }
      // anyOf with $ref branches (union enums, abstract unions)
      if (shape.kind === "unknown" || shape.kind === "object") {
        if (p.schema.anyOf) {
          for (const branch of p.schema.anyOf as Def[]) {
            if (branch.$ref) {
              targets.push({ target: resolveAlias(deref(branch.$ref)), via: p.prop[0], canonical: canon });
            }
          }
        }
      }
    }

    // If the def itself is an array with ref items (e.g. list-of-enums wrapper), follow items
    if (def && def.type === "array" && def.items) {
      const itemShape = classifySchema(def.items);
      if (itemShape.kind === "ref") {
        targets.push({ target: resolveAlias(itemShape.target), via: name, canonical: "" });
      }
    }
    // If the def itself has anyOf branches (union type), follow each ref branch
    if (def && def.anyOf) {
      for (const branch of def.anyOf as Def[]) {
        if (branch.$ref) {
          targets.push({ target: resolveAlias(deref(branch.$ref)), via: name, canonical: "" });
        }
      }
    }

    return targets;
  }

  /** Apply remapTarget callback: null = skip, string = replace. */
  function remap(t: string): string | null {
    if (!remapTarget) return t;
    return remapTarget(t);
  }

  // Seed from root
  const queue: Array<{ name: string; via: string; depth: number }> = [];
  for (const { target, via, canonical } of refTargets(resolveAlias(rootName))) {
    if (excludeRootProps && excludeRootProps.has(canonical)) continue;
    const mapped = remap(target);
    if (mapped === null) continue;
    queue.push({ name: mapped, via, depth: 0 });
  }

  // BFS
  let head = 0;
  while (head < queue.length) {
    const { name, via, depth } = queue[head++];
    if (emitted.has(name)) {
      result.push({ name, via, depth, duplicate: true });
      continue;
    }
    emitted.add(name);
    const leaf = isLeaf(name);
    result.push({ name, via, depth, duplicate: false });

    if (leaf) {
      // Even for leaves, follow array items and anyOf branches on the def itself
      // (e.g. list-of-enum wrappers need their item type collected)
      const def = netexLibrary[name];
      if (def && def.type === "array" && def.items) {
        const itemShape = classifySchema(def.items);
        if (itemShape.kind === "ref") {
          const m = remap(resolveAlias(itemShape.target));
          if (m !== null) queue.push({ name: m, via: name, depth: depth + 1 });
        }
      }
      if (def && def.anyOf) {
        for (const branch of def.anyOf as Def[]) {
          if (branch.$ref) {
            const m = remap(resolveAlias(deref(branch.$ref)));
            if (m !== null) queue.push({ name: m, via: name, depth: depth + 1 });
          }
        }
      }
      continue;
    }

    for (const { target, via: childVia } of refTargets(name)) {
      const mapped = remap(target);
      if (mapped === null) continue;
      queue.push({ name: mapped, via: childVia, depth: depth + 1 });
    }
  }

  return result;
}
