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

968 of 3055 definitions (base assembly) have no `x-netex-role`. The viewer groups these under "Unclassified", and `x-netex-atom` acts as a classification fallback in `resolveDefType` — a design smell where two annotations compensate for each other's gaps.

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

## Quality-improve build-docs-index.ts

`build-docs-index.ts` generates the GitHub Pages welcome page. It has hardcoded assembly descriptions and no connection to releases. Improve:

- **Derive assembly descriptions from config** — `assembly-config.json` already has part metadata; generate descriptions from part keys and their enabled state instead of the hardcoded `ASSEMBLY_DESCRIPTIONS` map
- **Link to GitHub Releases** — the welcome page should link to the latest release tarball for each assembly (the release workflow already produces `netex-<version>-<assembly>-v<tag>.tgz` artifacts). Use the GitHub API or a static convention to construct download links
- **Show NeTEx version** — read `netex.version` from config and display it prominently on the landing page
- **Reduce template hardcoding** — the inline HTML/CSS is a long string literal; extract into a template file (same pattern as the `build-schema-html.ts` TODO)

## Quality-improve build-schema-html.ts

`build-schema-html.ts` is a single 1400+ line file that mixes CSS, HTML template strings, and JS logic. Refactor for maintainability:

- **Extract CSS** into a `.templ` file (or `.css` that gets inlined at build time) — the style block is ~300 lines of string literals
- **Extract text/HTML templates** into `.templ` files — tab renderers (Interface, Mapping, Utilities, Graph, Properties) are long template-string blocks that would be clearer as separate files with placeholder substitution
- **More functional style** — the tab render functions use imperative loops building HTML strings; refactor toward composable helpers (e.g. `renderPropRow`, `renderTypeLink`, `renderCodeBlock`) that return fragments
- **Split by concern** — consider separating the IIFE/runtime JS (embedded in the page) from the build-time template assembly

Goal: the main file becomes a build orchestrator that reads templates and composes the final HTML, rather than a monolith that does everything inline.

## Sync GitHub Actions with Entur conventions

Review Entur's shared workflow conventions (reusable workflows, naming, artifact registries) and align `docs.yml` and `release.yml` if useful.
