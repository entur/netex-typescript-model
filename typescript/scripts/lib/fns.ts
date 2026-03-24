/**
 * Barrel re-export for schema introspection modules.
 *
 * All functions have been split into semantic modules:
 * - types.ts     — shared type definitions
 * - util.ts      — low-level helpers (deref, lcFirst, canonicalPropName)
 * - classify.ts  — schema classification, role detection, ref inspection
 * - schema-nav.ts — inheritance walking, property flattening, inlining
 * - type-res.ts  — definition and property type resolution
 * - dep-graph.ts — reverse index, dependency tree, ref-entity resolution
 *
 * This barrel preserves backward compatibility — all existing imports from
 * `fns.ts` continue to work unchanged.
 */

export * from "./types.js";
export * from "./util.js";
export * from "./classify.js";
export * from "./schema-nav.js";
export * from "./type-res.js";
export * from "./dep-graph.js";

// ── Re-exports from data-faker.ts ───────────────────────────────────────────

export {
  fake,
  defaultForType,
  buildXml,
  toXmlShape,
  serialize,
} from "./data-faker.js";
