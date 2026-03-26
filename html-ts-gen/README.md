# html-ts-gen/ — Node.js Pipeline

JSON Schema → TypeScript interfaces, interactive schema HTML viewer, TypeDoc documentation. See [CODEGEN_FLOW.md](CODEGEN_FLOW.md) for a visual map of every render path in the schema viewer.

## Quick Start

```bash
npm install                # once
cd .. && make all          # full pipeline (or run stages below individually)
```

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run tests (vitest) |
| `npm run docs` | Generate TypeDoc HTML per assembly |
| `npm run validate:jsonschema` | Validate generated schemas against Draft 07 |

## Scripts

| File | Purpose |
|------|---------|
| `scripts/primitive-ts-gen.ts` | JSON Schema → monolithic TypeScript → per-category modules → type-check |
| `scripts/split-output.ts` | Split monolithic `.ts` into per-category modules with cross-imports |
| `scripts/build-schema-html.ts` | Generate self-contained interactive HTML viewer per assembly |
| `scripts/build-docs-index.ts` | Assemble `docs-site/` with welcome page for GitHub Pages |
| `scripts/generate-docs.ts` | TypeDoc HTML per assembly |
| `scripts/validate-generated-schemas.ts` | Validate JSON Schema files against Draft 07 meta-schema |
| `scripts/ts-gen.ts` | E2E: assemble codegen output and verify with `tsc --strict` |

## Library Modules (`scripts/lib/`)

Schema introspection and code generation, shared between the HTML viewer (bundled via esbuild) and CLI scripts/tests.

| Module | Responsibility |
|--------|---------------|
| `types.ts` | Shared type definitions (`NetexLibrary`, `FlatProperty`, `ViaHop`, `DepTreeNode`, etc.) |
| `util.ts` | Low-level helpers (`deref`, `allOfRef`, `lcFirst`, `canonicalPropName`) |
| `classify.ts` | Schema classification, role detection (`defRole`, `resolveType`, `isRefType`), mixed-content (`unwrapMixed`) |
| `schema-nav.ts` | Inheritance walking (`flattenAllOf`, `buildInheritanceChain`), property flattening, ref inlining (`inlineSingleRefs`), exclusion set builder (`buildExclSet`) |
| `type-res.ts` | Deep type resolution (`resolveDefType`, `resolvePropertyType`, `resolveAtom`) |
| `dep-graph.ts` | Reverse index, dependency tree (`collectDependencyTree`), ref-entity resolution (`resolveRefEntity`, `collectRefProps`) |
| `data-faker.ts` | Fake data generation (`fake`) and XML serialization (`serialize`, `toXmlShape`, `buildXml`) |
| `to-xml-shape.ts` | Static generator for stem→XML projection functions |
| `codegens.ts` | TypeScript code generators (`generateInterface`, `generateTypeGuard`, `generateFactory`, etc.) |
| `config.ts` | Build configuration (`Config` class, part resolution, assembly naming) |
| `loader.ts` | Schema loader (`loadNetexLibrary()`) — loads base assembly schema for CLI scripts and tests |
| `bundle-entry.ts` | esbuild entry point — re-exports all lib modules into a single IIFE for the HTML viewer |

## Static Assets (`scripts/static/`)

| File | Purpose |
|------|---------|
| `schema-viewer-host-app.js` | Browser-side controller for the schema HTML page (embedded verbatim) |
| `schema-viewer.css` | Viewer CSS (embedded in `<style>` tag) |

## Tests (`scripts/lib/__tests__/`)

Per-module unit tests (inline mock schemas) and integration tests (real generated schema from `generated-src/base/`).

| File | Type |
|------|------|
| `classify.test.ts` | Unit |
| `schema-nav.test.ts` | Unit |
| `type-res.test.ts` | Unit |
| `dep-graph.test.ts` | Unit |
| `util.test.ts` | Unit |
| `codegens.test.ts` | Unit |
| `data-faker.test.ts` | Unit |
| `classify.integration.test.ts` | Integration |
| `schema-nav.integration.test.ts` | Integration |
| `type-res.integration.test.ts` | Integration |
| `dep-graph.integration.test.ts` | Integration |
| `data-faker.integration.test.ts` | Integration |
| `to-xml-shape.test.ts` | Integration |
| `valid-roundtrip.test.ts` | Integration (fake → XML → xmllint XSD validation) |
| `test-helpers.ts` | Re-exports `loadNetexLibrary()` from `loader.ts` for integration tests |
