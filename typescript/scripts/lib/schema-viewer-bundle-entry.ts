/**
 * esbuild entry point for the schema viewer IIFE bundle.
 *
 * Re-exports all public functions from schema-viewer-fns.ts.
 * esbuild bundles this into a single IIFE with `globalName: "_viewerBundle"`,
 * embedding fast-xml-parser and all viewer functions in the HTML page.
 */
export {
  resolveType,
  isRefType,
  refTarget,
  flattenAllOf,
  collectRequired,
  resolveDefType,
  resolvePropertyType,
  resolveAtom,
  buildReverseIndex,
  findTransitiveEntityUsers,
  defRole,
  defaultForType,
  lcFirst,
  buildInheritanceChain,
  inlineSingleRefs,
  canonicalPropName,
  unwrapMixed,
  countRoles,
  presentRoles,
  serializeValue,
  genMockObject,
  buildXmlString,
} from "./schema-viewer-fns.js";
