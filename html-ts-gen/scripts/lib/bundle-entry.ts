/**
 * esbuild entry point for the schema viewer IIFE bundle.
 *
 * Re-exports all public functions from the semantic modules.
 * esbuild bundles this into a single IIFE with `globalName: "_viewerBundle"`,
 * embedding fast-xml-parser and all viewer functions in the HTML page.
 */
export { lcFirst, canonicalPropName } from "./util.js";
export {
  resolveType,
  isRefType,
  refTarget,
  classifySchema,
  defRole,
  isDynNocRef,
  unwrapMixed,
  countRoles,
  presentRoles,
} from "./classify.js";
export {
  OMNIPRESENT_DEFS,
  ESSENTIAL_OMNI_PROPS,
  buildExclSet,
  flattenAllOf,
  collectRequired,
  buildInheritanceChain,
} from "./schema-nav.js";
export { resolveDefType, resolvePropertyType, resolveAtom } from "./type-res.js";
export {
  buildReverseIndex,
  findTransitiveEntityUsers,
  resolveRefEntity,
  collectRefProps,
  collectExtraProps,
  collectDependencyTree,
} from "./dep-graph.js";

export {
  fake,
  flattenFake,
  defaultForType,
  buildXml,
  toXmlShape,
  serialize,
} from "./data-faker.js";

export { makeInlinedToXmlShape, makeInlineCodeBlock, emitHelpers } from "./to-xml-shape.js";

export {
  generateInterface,
  generateTypeAlias,
  generateSubTypesBlock,
  collectRenderableDeps,
  toConstName,
  escHtml,
} from "./codegens.js";
