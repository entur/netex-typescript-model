/**
 * esbuild entry point for the schema viewer IIFE bundle.
 *
 * Re-exports all public functions from fns.ts and data-faker.ts.
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
  lcFirst,
  buildInheritanceChain,
  inlineSingleRefs,
  canonicalPropName,
  unwrapMixed,
  countRoles,
  presentRoles,
  resolveRefEntity,
  collectRefProps,
  collectExtraProps,
  collectDependencyTree,
} from "./fns.js";

export {
  fake,
  fake as genMockObject,
  defaultForType,
  buildXml,
  toXmlShape,
  serialize,
} from "./data-faker.js";

export { makeInlinedToXmlShape, makeInlineCodeBlock } from "./to-xml-shape.js";

export {
  generateInterface,
  generateTypeAlias,
  generateTypeGuard,
  generateFactory,
  toConstName,
} from "./codegens.js";
