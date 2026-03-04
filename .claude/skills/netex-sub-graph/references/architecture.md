# xsd-to-jsonschema.js — Internal Architecture

## Table of contents

- [Runtime environment](#runtime-environment)
- [DOM helpers](#dom-helpers)
- [File loading](#file-loading)
- [Pass 1: raw collection](#pass-1-raw-collection)
- [Pass 2: type conversion](#pass-2-type-conversion)
- [Property extraction](#property-extraction)
- [Type resolution](#type-resolution)
- [Pass 3: role classification](#pass-3-role-classification)
- [Pass 4: atom annotation](#pass-4-atom-annotation)
- [Output assembly](#output-assembly)
- [Sub-graph pruning](#sub-graph-pruning)
- [Config and CLI](#config-and-cli)

---

## Runtime environment

GraalVM JavaScript on stock JDK 21+. Maven resolves GraalJS polyglot JARs.
The script uses `Java.type()` for:

- `javax.xml.parsers.DocumentBuilderFactory` — XML parsing
- `org.w3c.dom.Node` — `ELEMENT_NODE` constant
- `java.nio.file.Files`, `java.nio.file.Paths` — file I/O
- `java.nio.charset.StandardCharsets` — UTF-8

The `DocumentBuilder` is configured namespace-aware with external DTD/entity
loading disabled (security). Created once in the constructor and reused.

No Node.js APIs, no `require`, no modules. `print()` for stdout.

## DOM helpers

Five utility functions at the top of the file operate on `org.w3c.dom` nodes:

| Function | Purpose |
|---|---|
| `getChildren(parent, ns, localName)` | Direct child elements matching ns+localName. Indexed loop (for-of doesn't work on Java NodeList) |
| `getFirstChild(parent, ns, localName)` | First matching child element |
| `getText(el)` | `getTextContent()`, trimmed, null-safe |
| `attr(el, name)` | `getAttribute()`, coerced to JS string, empty→null |
| `resolvePath(basePath, relPath)` | Pure-JS path.join(dirname(base), rel) with `..` normalization. Avoids Java Path API differences |

All namespace-aware operations use the constant `XSD_NS = "http://www.w3.org/2001/XMLSchema"`.

## File loading

`loadFile(relativePath)` recursively loads XSD files:

```
loadFile("NeTEx_publication.xsd")
  → parse XML → get <xsd:schema> root
  → for each <xsd:include>: loadFile(resolvePath(current, schemaLocation))
  → for each <xsd:import>:  loadFile(resolvePath(current, schemaLocation))
  → collectRawDefinitions(schema, sourceFile)
```

Deduplication: `this.parsedFiles[normalized]` prevents re-processing.
Files that fail to parse emit a warning and are skipped.

NeTEx 2.0 has 458+ XSD files — all are loaded regardless of part filtering.
Filtering happens at output time, not at load time, because cross-part
`$ref` targets must resolve.

## Pass 1: raw collection

`collectRawDefinitions(schema, sourceFile)` scans direct children of
`<xsd:schema>` and populates:

| Registry | Key | Dedup strategy |
|---|---|---|
| `this.groups` | name → `{ schema: DOM, sourceFile }` | First-wins (skip if exists) |
| `this.attrGroups` | name → `{ schema: DOM, sourceFile }` | First-wins |
| `this.rawComplexTypes` | array of `{ raw: DOM, sourceFile }` | Deferred to Pass 2 |
| `this.rawSimpleTypes` | array of `{ raw: DOM, sourceFile }` | Deferred to Pass 2 |
| `this.rawElements` | array of `{ raw: DOM, sourceFile }` | Deferred to Pass 2 |

Groups and attribute groups are stored immediately because they're inlined
during property extraction (Pass 2) — they need to be available before any
type conversion happens. Types and elements use arrays + `seenTypes`/
`seenElements` sets in Pass 2 for first-wins dedup.

## Pass 2: type conversion

`convert()` processes raw definitions in order: complexTypes → simpleTypes → elements.

### convertComplexType(ct)

Three branches based on content model:

1. **`<complexContent>`** → `convertComplexContent(cc)`
   - **extension**: `{ allOf: [{ $ref: base }, { properties, required }] }`
     The base type becomes the first allOf entry as a `$ref`. Own properties
     (from sequence/choice/attributes) become the second entry. If no own
     properties, returns bare `$ref`.
   - **restriction**: returns bare `$ref` to base type (restricting facets ignored)

2. **`<simpleContent>`** → `convertSimpleContent(sc)`
   - **extension**: creates `{ type: "object", properties: { value: baseType, ...attrs } }`.
     The base type (e.g. `xsd:string`) becomes the `value` property.
     Attributes become additional properties with `xml.attribute: true`.
   - **restriction**: returns `$ref` to base or `{ type: "string" }` fallback

3. **Direct** (no complexContent/simpleContent):
   - Extracts properties from sequence/choice/all
   - Extracts attributes directly
   - Inlines attribute groups
   - Returns `{ type: "object", properties, required }`
   - If `mixed="true"`: stamps `x-netex-mixed: true`

### convertSimpleType(st)

Four branches:

1. **restriction**: copies base type schema, adds `enum`, `pattern`, `minLength`,
   `maxLength`, `minimum`, `maximum` facets. Enum dedup via `Set`.
2. **union** (memberTypes attr): `{ anyOf: [resolvedRefs...] }`
3. **union** (inline simpleTypes): `{ anyOf: [convertedTypes...] }`
4. **list**: `{ type: "array", items: itemType, "x-netex-atom": "array" }`

Fallback: `{ type: "string" }`.

### convertTopLevelElement(el)

Three cases:

1. Has `type` attribute → `resolveTypeRef(type)` (may be `$ref` or built-in)
2. Has inline `<complexType>` child → `convertComplexType(ct)`
3. Has inline `<simpleType>` child → `convertSimpleType(st)`

Element metadata is captured before conversion:
```javascript
this.elementMeta[name] = {
  abstract: attr(raw, "abstract") === "true",
  substitutionGroup: this.stripNs(attr(raw, "substitutionGroup")),
};
```

This metadata drives role classification (Pass 3) — `abstract` and
`substitutionGroup` determine entity/abstract roles.

### Description extraction

`extractDescription(node)` walks `<xsd:annotation>/<xsd:documentation>` to
extract JSDoc text. `withDescription(schema, desc)` attaches it:
- If schema has `$ref`: wraps in `{ allOf: [schema], description }` (can't add
  sibling keys to a `$ref` in JSON Schema)
- Otherwise: sets `schema.description` directly

## Property extraction

`extractProperties(node)` handles the content model:

```
extractProperties(node)
  → getFirstChild(sequence) → processContainer(seq, props, required)
  → getFirstChild(choice)   → processContainer(choice, props, [])  // all optional
  → getFirstChild(all)      → processContainer(all, props, required)
  → getChildren(group)      → inlineGroup(ref, props, required)
```

`processContainer(container, props, required)` recursively handles:
- `<element>` children → `processElement()`
- `<group ref>` → `inlineGroup()` (properties merged in, not a `$ref`)
- Nested `<choice>` inside sequence → recursive with empty required array
- Nested `<sequence>` inside choice → recursive with required array

### processElement(el, properties, required)

For named elements:
- Resolves type via `attr(el, "type")`, inline complexType, or inline simpleType
- `maxOccurs="unbounded"` or `>1` → wraps in `{ type: "array", items: schema }`
- `minOccurs !== "0"` → pushes to required array

For element references (`ref="Foo"`):
- Creates `{ $ref: "#/definitions/Foo" }`, uses ref name as property key
- Same array/required logic

### Group and attribute group inlining

`inlineGroup(refName, properties, required)`:
- Looks up group in `this.groups` registry (populated in Pass 1)
- Calls `extractProperties()` on the group's DOM node
- Merges properties and required arrays via `Object.assign` / `push`

`inlineAttributeGroups(node, properties)`:
- Finds `<attributeGroup ref>` children
- Looks up in `this.attrGroups` registry
- Extracts individual `<attribute>` children, resolves types
- Sets `xml.attribute: true` on each

Both group types are fully inlined — they produce direct properties, not
`$ref` references. This is deliberate: XSD groups are composition mechanisms,
not types.

## Type resolution

`resolveTypeRef(typeName)`:
1. Strip namespace prefix via `stripNs()`
2. Check `XSD_TYPE_MAP` — 35 XSD built-in types mapped to JSON Schema
   (string variants, numeric types, date/time formats, binary)
3. If not built-in: `{ $ref: "#/definitions/${localName}" }`

`XSD_TYPE_MAP` notable entries:
- `anyURI` → `{ type: "string", format: "uri" }`
- `positiveInteger` → `{ type: "integer", minimum: 1 }`
- `dateTime` → `{ type: "string", format: "date-time" }`
- `anySimpleType`, `anyType` → `{}` (empty schema, allows anything)

## Pass 3: role classification

`classifyDefinitions()` stamps `x-netex-role` on every definition. Rules are
applied in priority order — first match wins:

| Priority | Rule | Role | Example |
|---|---|---|---|
| 1 | Suffix `_VersionStructure` or `_BaseStructure` | `structure` | `StopPlace_VersionStructure` |
| 2 | Suffix `_RelStructure` | `collection` | `stopPlaces_RelStructure` |
| 3 | Suffix `_RefStructure` or `RefStructure` | `reference` | `StopPlaceRef_RefStructure` |
| 4 | Suffix `_DerivedViewStructure` | `view` | `StopPlace_DerivedViewStructure` |
| 5 | Schema has `enum` array | `enumeration` | `DayOfWeekEnumeration` |
| 6 | Element metadata: `abstract === true` | `abstract` | `Place_` |
| 7 | Name in `frameRegistry` | `frameMember` | Also stamps `x-netex-frames` |
| 8 | Concrete element with substitutionGroup + DMO ancestry | `entity` | `StopPlace` |
| 9 | Name ends in `Ref` and exists in elements | `reference` | `StopPlaceRef` |
| 10 | Name starts with `Abstract` | `abstract` | `AbstractDiscoveryDeliveryStructure` |

### Entity detection (rule 8)

A definition is an **entity** if all three conditions hold:
1. It exists in `this.elementMeta` (is a top-level element)
2. It is NOT abstract
3. It has a `substitutionGroup` attribute
4. It extends `DataManagedObjectStructure` (checked via `_chainHasAncestor`)

`_chainHasAncestor(name, allDefs, target, visited)` walks the allOf chain
upward looking for the target ancestor name. Handles `$ref` aliases and
`allOf` parent refs. Uses a visited set for cycle protection.

### Frame registry

`loadFrameRegistry(jsonPath)` reads `frame-members.json` — a manually curated
JSON mapping frame names to entity arrays. Inverted to `entity → [frame names]`
for lookup. Entries starting with `_` are skipped (comments/metadata).

## Pass 4: atom annotation

`annotateAtoms()` identifies "transparent wrapper" types — simpleContent types
that exist only to carry a single value with optional attributes.

### Pass 4a: simpleContent wrappers

For each definition with a `value` property (found via `getValueProperties`):

1. Call `resolveValueAtom(name, allDefs, visited)` — follows `$ref` chains and
   `allOf` parent refs to find the terminal primitive type of `value`
2. If found:
   - 1 property total → atom = primitive type string (e.g. `"string"`)
   - 2+ properties → atom = `"simpleObj"` (value + attributes)

`resolveValueAtom` resolution chain:
```
def.$ref → follow ref → recurse
def.allOf → follow parent $ref → recurse
def.type (non-object) → return type as atom
def.properties.value.$ref → follow ref → recurse
def.properties.value.type → return type as atom
```

### Pass 4b: all-primitive structs

For definitions NOT already stamped by 4a and NOT having a role or allOf parent:
- Get own properties via `getValueProperties`
- If every property is inline primitive (type !== object/array, or has enum)
- 1 property → atom = that property's type
- 2+ properties → atom = `"simpleObj"`

### Atom values summary

| `x-netex-atom` value | Meaning | Example |
|---|---|---|
| `"string"` | Single-prop simpleContent wrapping a string | `PrivateCodeStructure` |
| `"integer"` | Single-prop simpleContent wrapping an integer | (rare) |
| `"simpleObj"` | Multi-prop simpleContent (value + attributes) | `MultilingualString` |
| `"array"` | `xsd:list` type | `TypeOfFrameListOfEnumerations` (stamped during simpleType conversion, not here) |

## Output assembly

`toJsonSchema(enabledFilter)`:
1. Calls `convert()` if not yet done
2. Iterates `this.types` then `this.elements` — types take precedence for
   same-name conflicts
3. Applies optional `enabledFilter(sourceFile)` — only includes definitions
   whose source XSD path passes the filter
4. Stamps `x-netex-source` on each included definition
5. Calls `addPlaceholders(definitions)` — BFS through all `$ref` strings,
   creates empty `{}` for any target not in definitions (cross-part references
   that weren't filtered in)
6. Returns `{ $schema: "draft-07", definitions }`

### Placeholder generation

Critical for correctness: when part filtering excludes a definition but another
included definition references it via `$ref`, the missing target would cause
JSON Schema validation errors. Placeholders (`{}`) allow any value, matching
the permissive intent of an unresolved reference.

## Sub-graph pruning

`pruneToSubGraph(schema, rootName)` — standalone function (not a class method):

1. Start BFS from `rootName`
2. For each reached definition, walk its object tree for `$ref` strings
3. Add each ref target to the BFS queue
4. Collect transitive closure in `reachable` set
5. Return new schema with only reachable definitions

Uses two levels of traversal:
- **Outer**: BFS over definition names via `queue`
- **Inner**: DFS over each definition's object tree via `objQueue` + `visited`

The inner walk uses `visited` per-definition to handle cycles within a
definition's object graph (possible with shared schema objects). The outer
`reachable` set prevents re-processing definitions.

Output preserves `$schema`, `x-netex-assembly`, and adds `x-netex-sub-graph-root`.

## Config and CLI

### Constants

- `REQUIRED_PARTS = ["framework", "gml", "siri", "service"]` — always enabled
- `REQUIRED_ROOT_XSDS = ["publication"]` — always loaded
- `NATURAL_NAMES` — maps config keys to human names: `part1_network` → `"network"`

### resolveAssembly(parts)

Builds assembly name from enabled optional parts:
- No optional parts → `"base"`
- One part → that part's natural name (e.g. `"network"`)
- Multiple → sorted, joined with `+` (e.g. `"fares+network"`)

### loadConfig(configPath)

Reads `assembly-config.json`, marks required parts as `required: true, enabled: true`.
Returns `{ raw, parts, rootXsds }`.

### CLI argument parsing

```
positional: xsdRoot, outDir, [configPath]
flags:      --parts key,key,...    (accepts both config keys and natural names)
            --sub-graph TypeName  (prune to reachable definitions)
```

The `--parts` flag builds a reverse lookup `natural name → config key` and
validates each part against the config. Required parts that are explicitly
passed trigger an error.

### main() flow

1. Parse args (GraalJS `arguments` global or `script.args` system property)
2. Load config if provided, apply `--parts`, compute assembly name
3. Load frame registry from `frame-members.json` if it exists
4. `loadFile("NeTEx_publication.xsd")` — entry point for recursive loading
5. Print stats and warnings
6. `toJsonSchema(filter)` with optional source-path filter
7. Optional `pruneToSubGraph()` if `--sub-graph` specified
8. Write output to `<outDir>/<assembly>.schema.json` (or `<assembly>@<root>.schema.json`)
