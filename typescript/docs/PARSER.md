# Schema-Driven XML Parser Design

Design document for a future `src/parser/` module that uses `netex.json` to drive NeTEx XML parsing and serialization.

## Problem

`fast-xml-parser` (and similar XML parsers) flatten XML attributes and child elements into the same object. Without external metadata, a consumer cannot:

1. Distinguish `id` (attribute) from `Name` (child element) — both become object keys
2. Know which properties should serialize as `<Name>text</Name>` vs `id="value"`
3. Detect arrays — XML allows repeated elements (`<Line>` appearing multiple times) but single occurrences parse as plain objects

The enriched `netex.json` schema solves (1) and (2) via `xml: { attribute: true }` markers, and (3) via `type: "array"` / `items` in property definitions.

## Schema Structure

After generation, `netex.json` contains:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "DataManagedObjectStructure": {
      "allOf": [
        { "$ref": "#/definitions/EntityInVersionStructure" },
        {
          "properties": {
            "id": { "type": "string", "xml": { "attribute": true } },
            "version": { "type": "string", "xml": { "attribute": true } },
            "keyList": { "$ref": "#/definitions/KeyList" }
          }
        }
      ]
    }
  }
}
```

Properties with `xml.attribute === true` are XML attributes. All others are child elements.

## Parsing Strategy

### Step 1: Build Lookup Tables from Schema

At startup, walk `definitions` once to build two maps:

```typescript
// Per-type: which property names are attributes
const attributeMap: Map<string, Set<string>>;

// Per-type: which property names are arrays
const arrayMap: Map<string, Set<string>>;
```

Resolution must follow `$ref` and `allOf` chains to collect inherited attributes. For example, `StopPlace` extends `DataManagedObjectStructure` which extends `EntityInVersionStructure` — all attribute markers from the chain apply.

### Step 2: Configure fast-xml-parser

```typescript
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",  // no prefix — schema tells us which are attributes
  isArray: (name, jpath) => {
    // Use arrayMap to determine if this element should always be an array
    return isArrayProperty(name, jpath, arrayMap);
  },
});
```

The `isArray` callback receives the element name and JSON path. Cross-reference with `arrayMap` to force array wrapping even for single-occurrence elements.

### Step 3: Post-Process Parsed Output

`fast-xml-parser` with `attributeNamePrefix: ""` merges attributes and child elements into one object. No post-processing needed for property placement — the schema metadata is used at serialization time.

For parsing, the key post-processing step is type coercion: the schema's `type` field tells us whether a string value should remain a string or be coerced to number/boolean.

### Step 4: Type-Safe Access

The generated TypeScript interfaces provide compile-time safety. The parsed XML object can be cast to the appropriate interface:

```typescript
const xml = readFileSync("delivery.xml", "utf-8");
const parsed = parser.parse(xml);
const delivery = parsed.PublicationDelivery as PublicationDeliveryStructure;
```

## Serialization Strategy

Serialization (object to XML) requires the attribute/element distinction:

### Step 1: Build XMLBuilder Config

```typescript
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",  // internal convention for builder
  format: true,
});
```

### Step 2: Pre-Process for Serialization

Before passing to `XMLBuilder`, walk the object and use `attributeMap` to prefix attribute properties:

```typescript
function prepareForXml(obj: any, typeName: string, schema: JsonSchema): any {
  const attrs = attributeMap.get(typeName);
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (attrs?.has(key)) {
      result[`@_${key}`] = value;  // mark as attribute for XMLBuilder
    } else {
      result[key] = value;         // child element
    }
  }
  return result;
}
```

### Step 3: Handle Arrays

Properties marked as `type: "array"` in the schema need their items unwrapped for XML — an array of objects becomes repeated XML elements.

## Schema Walking Algorithm

Resolving the full attribute/array set for a type requires walking `allOf`, `$ref`, and nested `properties`:

```
function collectAttributes(typeName, definitions, visited):
  if visited.has(typeName): return empty
  visited.add(typeName)

  def = definitions[typeName]
  attrs = Set()

  // Direct properties
  for each (name, prop) in def.properties:
    if prop.xml?.attribute: attrs.add(name)

  // allOf chains (inheritance)
  for each schema in def.allOf:
    if schema.$ref:
      refName = extractRefName(schema.$ref)
      attrs.addAll(collectAttributes(refName, definitions, visited))
    if schema.properties:
      for each (name, prop) in schema.properties:
        if prop.xml?.attribute: attrs.add(name)

  return attrs
```

The `visited` set prevents infinite recursion on circular type references.

## Array Detection

A property should parse as an array when any of these hold:

1. `property.type === "array"` — explicit array type
2. `property.items` exists — array items schema present
3. XSD had `maxOccurs="unbounded"` — already captured as `{ type: "array", items: ... }` by the converter

The `isArray` callback for `fast-xml-parser` needs the parent type context to look up the property definition. The `jpath` parameter provides the nesting path which can be mapped to schema types.

## Edge Cases

### Inherited Attributes

`id`, `version`, and `modification` are defined on base types (`EntityInVersionStructure`, `DataManagedObjectStructure`). Every concrete type inherits them through `allOf` chains. The walker must resolve the full chain.

### $ref-Only Properties

Some properties are pure `$ref` with no inline schema. The attribute marker will be on the referenced type's properties, not the reference itself. Element-level references are never attributes — only leaf properties carry `xml.attribute`.

### Mixed allOf

A type may have `allOf: [{ $ref: "Base" }, { properties: { ... } }]`. Attributes can appear in either the referenced base or the inline properties object. Both must be checked.

### Placeholder Types

Types from disabled NeTEx parts are emitted as `{}` (empty schema). Properties referencing these types will parse as untyped objects. The parser should handle these gracefully — no attribute/array metadata means treat all properties as child elements.

## Future Work

- **Zod schema generation** — generate runtime validators from `netex.json` that also carry XML metadata
- **Streaming parser** — for large NeTEx files, SAX-style parsing with schema-driven element handling
- **Validation** — use the JSON Schema directly with ajv to validate parsed XML objects against NeTEx type constraints
- **Namespace handling** — NeTEx uses multiple namespaces (netex, siri, gml); the parser may need namespace-aware element resolution
