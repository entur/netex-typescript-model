# json-schema/ — XSD to JSON Schema Converter

## OpenAPI 3.x XML Annotations

The converter stamps OpenAPI 3.x [`xml` objects](https://spec.openapis.org/oas/v3.1.1.html#xml-object) on properties derived from XSD attributes:

```json
"id": {
  "type": "string",
  "xml": { "attribute": true }
}
```

This distinguishes XML attributes (`<Foo id="...">`) from XML elements (`<Foo><Id>...</Id></Foo>`) in the generated schema. Downstream consumers use this to:

- **`canonicalPropName()`** — prefix attribute properties with `$` (e.g. `id` → `$id`) to avoid collisions with element properties
- **`toXmlShape()`** — map `$`-prefixed properties to `@_`-prefixed keys for `fast-xml-parser` XMLBuilder
- **`unwrapMixed()`** — skip `xml.attribute` properties when detecting the inner element type of mixed-content wrappers

## NeTEx Annotation Stamping

The converter (`xsd-to-jsonschema.js`) stamps custom `x-netex-*` annotations on JSON Schema definitions (ten per-definition, one per-property). These are consumed downstream by the schema HTML viewer, TypeScript generator, and split-output module.

### `x-netex-source` (string)

Stamped in `toJsonSchema()`. Records the origin XSD filename for each definition. Used by `primitive-ts-gen.ts` to build a source map that drives per-category module splitting (siri, reusable, core, network, etc.).

### `x-netex-assembly` (string)

Top-level schema annotation (not per-definition). Records the assembly name (`base`, `network`, `fares+network`, etc.) so consumers know which part configuration produced this schema.

### `x-netex-role` (string enum)

Stamped in `classifyDefinitions()`. Classifies each definition by its structural role using a priority cascade:

| Priority | Rule | Role |
|----------|------|------|
| 1 | `*_VersionStructure`, `*_BaseStructure` | `structure` |
| 2 | `*_RelStructure` | `collection` |
| 3 | `*_RefStructure`, `*RefStructure` | `reference` |
| 4 | `*_DerivedViewStructure` | `view` |
| 5 | Has `enum` property | `enumeration` |
| 6 | Element with `abstract="true"` | `abstract` |
| 7 | In frame registry | `frameMember` |
| 8 | Concrete element + substitutionGroup + extends DataManagedObject | `entity` |
| 9 | Name ends in `Ref` + exists in elements | `reference` |
| 10 | Name starts with `Abstract` | `abstract` |

Used by the schema HTML viewer for filter chips and by `findTransitiveEntityUsers` for BFS traversal.

### `x-netex-frames` (string[])

Only set on `frameMember` definitions. Lists which frame types contain this member (e.g. `["ResourceFrame", "ServiceFrame"]`), built from a frame registry populated during XSD parsing.

### `x-netex-atom` (string)

Marks definitions that are transparent wrappers around simpler types. Three sources:

- **`annotateAtoms()` — simpleContent wrappers.** Two passes:
  - **Pass 1:** Types with a lowercase `value` property. Follows `$ref` chains to resolve the underlying primitive. Single-property wrappers get the primitive type (e.g. `"string"`), multi-property wrappers get `"simpleObj"`.
  - **Pass 2:** Structs where every own property is an inline primitive (no `$ref`, no `allOf` inheritance). Same split: 1 prop → primitive type, 2+ props → `"simpleObj"`.

- **`xsd:list` handler — value `"array"`.** Set on definitions derived from `xsd:simpleType` with `xsd:list itemType="..."`. These are top-level array definitions (e.g. `AccessFacilityListOfEnumerations`, `LanguageListOfEnumerations`). `resolveDefType` uses this stamp to resolve the array items — producing e.g. `AccessFacilityEnumeration[]` or `string[]` — rather than treating the definition as a bare `"array"` primitive.

Used by the schema viewer's Interface/Mapping tabs to collapse trivial wrapper types and resolve list-of-enumeration types.

### `x-netex-mixed` (boolean)

Set to `true` when the XSD complexType has `mixed="true"`. Currently informational only — mixed content isn't fully modeled in the output.

### `x-netex-substitutionGroup` (string)

Stamped per-definition on elements that declare a `substitutionGroup` attribute. Records the head element name (e.g. `"Place_"`). Used by `classifyDefinitions()` rule 8 (entity detection) and by `pruneToSubGraph()` to follow substitution group edges when computing reachable definitions.

### `x-netex-sg-members` (string[])

Stamped on head elements of substitution groups. Lists the concrete members (e.g. `["StopPlace", "TopographicPlace", ...]`). Built from a reverse map populated during element parsing. Used by `pruneToSubGraph()` to include substitution group members when the head is reachable.

### `x-netex-refTarget` (string)

Stamped per-definition on reference-role definitions. Records the target element name that this reference points to (e.g. `TransportTypeRef` → `"TransportType"`, `TransportTypeRefStructure` → `"TransportType"`). Built by matching the `Ref`/`RefStructure` suffix against the element registry. Framework refs like `VersionOfObjectRef` that don't map to a specific entity get no stamp. Used by `resolveRefEntity()` in the schema viewer's Relations tab to resolve ref-typed properties to their target entities.

### `x-netex-choice` (string[], per-property)

Stamped per-property (not per-definition). Set on properties that originate from an `xsd:choice` group. Contains the names of sibling properties from the same choice group. Used by the data faker to emit only the first alternative from each choice group rather than all properties simultaneously.

### `x-netex-collapsed` (number)

Top-level schema annotation (not per-definition). Set by `collapseTransparent()` when invoked via the `--collapse` CLI flag. Records the total number of transparent wrapper definitions inlined during collapse. Only applies to sub-graph outputs.
