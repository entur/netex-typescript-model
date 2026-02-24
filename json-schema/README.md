# json-schema/ — XSD to JSON Schema Converter

## Annotation Stamping

The converter (`xsd-to-jsonschema.js`) stamps six custom `x-netex-*` annotations on JSON Schema definitions. These are consumed downstream by the schema HTML viewer, TypeScript generator, and split-output module.

### `x-netex-source` (string)

Stamped in `toJsonSchema()`. Records the origin XSD filename for each definition. Used by `generate.ts` to build a source map that drives per-category module splitting (siri, reusable, core, network, etc.).

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
