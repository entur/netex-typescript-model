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
| `schema-nav.ts` | Inheritance walking (`flattenAllOf`, `buildInheritanceChain`), property flattening, exclusion set builder (`buildExclSet`) |
| `type-res.ts` | Deep type resolution (`resolveDefType`, `resolvePropertyType`, `resolveAtom`) |
| `dep-graph.ts` | Reverse index, dependency tree (`collectDependencyTree`), ref-entity resolution (`resolveRefEntity`, `collectRefProps`) |
| `collapse.ts` | Collapse resolution for `--collapse-refs` / `--collapse-collections` (`collapseRef`, `collapseColl`, `buildTypeOverrides`) |
| `data-faker.ts` | Fake data generation (`fake`) and XML serialization (`serialize`, `toXmlShape`, `buildXml`) |
| `to-xml-shape.ts` | Static generator for stem→XML projection functions |
| `codegens.ts` | TypeScript code generators (`generateInterface`, `generateTypeAlias`, `generateSubTypesBlock`, etc.) |
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
| `valid-roundtrip.test.ts` | Integration (fake → serialize → xmllint XSD validation) |
| `valid-generated-roundtrip.test.ts` | Integration (fake → **generated** mapping code → xmllint XSD validation) |
| `collapse.test.ts` | Unit tests for `collapse.ts` (ref/collection resolution) |
| `test-helpers.ts` | Shared fixtures, `wrapInPublicationDelivery`, `validateWithXmllint`, `nonKeyrefErrors` |

### XSD Roundtrip Harness

Two integration test files validate that generated code produces XSD-valid NeTEx XML. They share a common pipeline: generate fake data, transform it through mapping functions, serialize to XML, wrap in a `PublicationDelivery` envelope, and validate against the full NeTEx XSD via `xmllint --schema`.

#### How It Works

```
fake(lib, "Entity")          deterministic mock object
        │
        ▼
  flattenFake(...)           optional: unwrap collections, strip excludes, collapse refs
        │
        ▼
  evalMapping("Entity")      new Function(generatedCode) → shapeFn
        │
        ▼
  shapeFn(data)              transform to XMLBuilder shape (@_attrs, #text, etc.)
        │
        ▼
  buildXml("Entity", shape)  fast-xml-parser XMLBuilder → XML string
        │
        ▼
  wrapInPublicationDelivery   PublicationDelivery > Frame > wrapper > entity
        │
        ▼
  xmllint --schema            validate against NeTEx_publication.xsd
        │
        ▼
  nonKeyrefErrors(stderr)     filter out keyref violations (test-isolation artifact)
```

**evalMapping** is the key trick — it dynamically compiles the generated JavaScript and returns the root `toXmlShape` function. This tests the actual code that `ts-gen.ts` would write to disk, not internal serialization functions:

```typescript
function evalMapping(name: string): ShapeFn {
  const code = makeInlineCodeBlock(lib, name, { html: false, typed: false });
  return new Function(code + `\nreturn ${lcFirst(name)}ToXmlShape;`)() as ShapeFn;
}
```

**Why keyref errors are filtered:** A test document contains a single entity. Cross-entity references (e.g. `BrandingRef` pointing to a `Branding` entity) can't be satisfied. The XSD declares these as `xsd:keyref` constraints, which `xmllint` reports. `nonKeyrefErrors` strips them so tests only assert structural validity.

#### Test Entities

Each entity needs a frame type and collection wrapper to form a valid document:

| Entity | Frame | Wrapper |
|--------|-------|---------|
| VehicleType | ResourceFrame | vehicleTypes |
| Contact | ResourceFrame | contacts |
| DeckPlan | ResourceFrame | deckPlans |
| ResponsibilitySet | ResourceFrame | responsibilitySets |
| GroupOfOperators | ResourceFrame | groupsOfOperators |

#### Test Groups

**valid-roundtrip.test.ts** validates the internal `serialize()` pipeline (baseline correctness).

**valid-generated-roundtrip.test.ts** validates *generated* mapping code through six groups:

| Group | Pipeline | Purpose |
|-------|----------|---------|
| **A** | `fake` → `evalMapping` → xmllint | Generated mapping handles raw schema-shape objects |
| **A+** | `fake` → `flattenFake(excl)` → `evalMapping(excl)` → xmllint | VehicleType with `gen-vehicletype.sh` excludes |
| **B** | `flattenFake` assertions | `flattenFake` strips excludes, unwraps collections, preserves identity |
| **C** | `fake` → `flattenFake` → `evalMapping` → xmllint | Generated mapping handles flattened interface-shape objects |
| **D** | `fake` → `flattenFake(collapse)` → `evalCollapsedMapping` → xmllint | Collapsed mapping (`--collapse-refs --collapse-collections`) |
| **E** | `fake` → `flattenFake(collapse)` → `evalCollapsedMapping` → xmllint | Same as D, interface-shape input |

Groups A and C test two input shapes that the mapping code must handle:

- **Schema shape** — raw `fake()` output with nested ref objects (`{ BrandingRef: { value: "...", $ref: "...", $version: "1" } }`) and collection wrappers (`{ keyList: { KeyValue: [...] } }`)
- **Interface shape** — `flattenFake()` output matching `generateInterface` types: collections unwrapped to flat arrays, excluded props stripped

Groups D and E mirror A and C but with `collapse: { collapseRefs: true, collapseCollections: true }`. The mapping code uses `refAttr()` (ref strings → `<Ref ref="id"/>`) and `childWrapped()` (single objects → wrapped XML children) instead of `child()` and `wrapArr()`. Both input data (`flattenFake`) and mapping code (`makeInlineCodeBlock`) must use matching collapse opts — a mismatch produces invalid XML.

#### Adding a New Entity

1. Add to `CORE` in `test-helpers.ts` with the correct frame and wrapper element name
2. Groups A, C, D, E run automatically via `describe.each`
3. Run tests; if xmllint fails, check `nonKeyrefErrors` output for structural issues (element ordering, missing required attributes, format mismatches)
