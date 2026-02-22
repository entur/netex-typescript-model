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

## Consider limiting TypeScript interface generation to key roles

Currently `generate.ts` emits interfaces for every JSON Schema definition. Most consumers only need entities and frame members — not every internal structure, abstract base, or collection wrapper. Plan whether to filter by `x-netex-role`:

- **entity** and **frameMember** are the primary public-facing types users would import
- Structures, references, enumerations etc. could remain in the schema but be excluded from (or tree-shaken out of) the TypeScript output
- Would reduce generated code size and make the TypeDoc surface more navigable
- Need to verify that entity/frameMember interfaces don't reference excluded types (or inline them)

## Implement NeTEx XML parser

Build a TypeScript parser that can read NeTEx XML documents into the generated interfaces. See [typescript/docs/PARSER.md](typescript/docs/PARSER.md) for the design plan.

## Sync GitHub Actions with Entur conventions

Review Entur's shared workflow conventions (reusable workflows, naming, artifact registries) and align `docs.yml` and `release.yml` if useful.
