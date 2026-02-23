# TODO

## Link TypeDoc and schema viewer back to upstream XSD source

Each JSON Schema definition already carries an `x-netex-source` annotation with the relative XSD path (e.g. `netex_framework/netex_reusable/netex_address_version.xsd`). Use this to generate clickable links to the NeTEx-CEN GitHub repo (`https://github.com/NeTEx-CEN/NeTEx/blob/next/xsd/...`) in:

1. **TypeDoc JSDoc** (`generate.ts`) — add a second `@see` tag linking to the source XSD on GitHub
2. **Schema HTML viewer** (`build-schema-html.ts`) — show an "XSD source" link per definition

## Address known XSD parser limitations using Java DOM

The Java-based `xsd-to-jsonschema.js` (GraalJS + `javax.xml.parsers`) has full DOM access and Xerces on the classpath, giving it significantly more power than the deprecated fast-xml-parser TS version. Plan which of the known limitations (documented in CLAUDE.md) can now be fixed:

- **Substitution groups** — Java DOM can read `substitutionGroup` attributes and build a registry to emit `oneOf`/`anyOf` unions
- **`xsd:any` / `xsd:anyAttribute`** — detectable via DOM; could emit `additionalProperties: true` or a typed wildcard
- **Attribute `use="required"`** — trivial to read from DOM and propagate to JSON Schema `required` arrays
- **Mixed content** — `mixed="true"` is a DOM attribute; could add a `_text` or `$value` string property
- **Namespace-qualified names** — Java DOM preserves namespace URIs; could disambiguate collisions if needed

## Make x-netex-role comprehensive — eliminate unclassified types

968 of 3055 definitions (base assembly) have no `x-netex-role`. The viewer groups these under "Unclassified", and `x-netex-atom` acts as a classification fallback in `resolveLeafType` — a design smell where two annotations compensate for each other's gaps.

Fix by extending `classifyDefinitions()` in `xsd-to-jsonschema.js` with catch-all rules after the existing suffix/ancestry cascade:

- **Naked primitive aliases** (136 types: `ObjectIdType→string`, `LengthType→number`, etc.) — `type` is not `object`, no properties → role `"primitive"`
- **Atomic structs** (32 types: `PrivateCodeStructure`, `TextType`, `ClosedTimeRangeStructure`, etc.) — object with only inline-primitive props, no `$ref` → role `"structure"`
- **$ref aliases** (372 types) — inherit role from target, or default `"structure"`
- **allOf types** (324 types) — they extend something, classify as `"structure"`
- **Remaining with-ref objects** (87 types) — object with `$ref` in properties → `"structure"`

Goal: near-zero unclassified. Then `x-netex-atom` stays purely as rendering metadata ("what's the underlying primitive"), not a classification crutch.

## Consider limiting TypeScript interface generation to key roles

Currently `generate.ts` emits interfaces for every JSON Schema definition. Most consumers only need entities and frame members — not every internal structure, abstract base, or collection wrapper. Plan whether to filter by `x-netex-role`:

- **entity** and **frameMember** are the primary public-facing types users would import
- Structures, references, enumerations etc. could remain in the schema but be excluded from (or tree-shaken out of) the TypeScript output
- Would reduce generated code size and make the TypeDoc surface more navigable
- Need to verify that entity/frameMember interfaces don't reference excluded types (or inline them)

## Add test suite using netex-validator-java XML fixtures

The [netex-validator-java](https://github.com/entur/netex-validator-java) repo contains real NeTEx XML fixtures. Use these to build a validation/round-trip test suite for the generated schemas and (future) parser. See [docs/netex-testing-landscape.md](docs/netex-testing-landscape.md) for an overview of existing NeTEx test infrastructure.

Also evaluate [openapi-sampler](https://github.com/Redocly/openapi-sampler) (or `json-schema-faker`) for generating sample data from the JSON Schema, then roundtrip-testing: JSON Schema → generate sample object → parse into TypeScript interfaces → serialize to XML → verify valid NeTEx XML.

## Implement NeTEx XML parser

Build a TypeScript parser that can read NeTEx XML documents into the generated interfaces. See [docs/PARSER.md](docs/PARSER.md) for the design plan.

## Sync GitHub Actions with Entur conventions

Review Entur's shared workflow conventions (reusable workflows, naming, artifact registries) and align `docs.yml` and `release.yml` if useful.
