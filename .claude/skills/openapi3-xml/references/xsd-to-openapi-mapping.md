# XSD → OpenAPI 3 XML Mapping Rules

## Table of contents

- [XML object properties](#xml-object-properties)
- [Element mapping](#element-mapping)
- [Attribute mapping](#attribute-mapping)
- [Array mapping](#array-mapping)
- [Namespace mapping](#namespace-mapping)
- [Inheritance mapping](#inheritance-mapping)
- [simpleContent mapping](#simplecontent-mapping)
- [Enumeration mapping](#enumeration-mapping)
- [NeTEx patterns](#netex-patterns)
- [OpenAPI 3 structural differences from JSON Schema](#openapi-3-structural-differences-from-json-schema)

---

## XML object properties

The OpenAPI `xml` keyword controls XML serialization. Five properties:

| Property | Type | Default | Effect |
|---|---|---|---|
| `name` | string | property key | Renames the XML element |
| `attribute` | boolean | `false` | Serialize as XML attribute instead of child element |
| `wrapped` | boolean | `false` | Wrap array items in an outer element (arrays only) |
| `namespace` | string (URI) | — | XML namespace URI (must be absolute) |
| `prefix` | string | — | Namespace prefix for the element |

## Element mapping

### Named element in sequence

```xml
<!-- XSD -->
<xsd:element name="Name" type="xsd:string"/>
```

```yaml
# OpenAPI
Name:
  type: string
```

No `xml` annotation needed — property key matches element name.

### Element ref

```xml
<!-- XSD -->
<xsd:element ref="StopPlace"/>
```

```yaml
# OpenAPI
StopPlace:
  $ref: '#/components/schemas/StopPlace'
```

If the referenced element's type has a different name than the element
(common in NeTEx: element `StopPlace`, type `StopPlace_VersionStructure`),
set `xml.name` on the component schema:

```yaml
# On StopPlace_VersionStructure schema
StopPlace_VersionStructure:
  xml:
    name: StopPlace
  allOf:
    - $ref: '#/components/schemas/DataManagedObjectStructure'
    - properties: ...
```

### Element with fixed/default value

```xml
<xsd:element name="version" type="xsd:string" fixed="1.0"/>
```

```yaml
version:
  type: string
  enum: ["1.0"]
```

## Attribute mapping

```xml
<!-- XSD -->
<xsd:attribute name="id" type="xsd:string" use="required"/>
```

```yaml
# OpenAPI
id:
  type: string
  xml:
    attribute: true
```

The existing converter already emits `xml: { attribute: true }`.

**Missing**: `use="required"` is not tracked — the attribute should appear
in the schema's `required` array.

## Array mapping

### Unwrapped array (direct repeat)

```xml
<!-- XSD -->
<xsd:element name="Line" type="LineType" maxOccurs="unbounded"/>
```

```yaml
# OpenAPI — unwrapped
Line:
  type: array
  items:
    $ref: '#/components/schemas/LineType'
```

Serializes as:
```xml
<Line>...</Line>
<Line>...</Line>
```

### Wrapped array (container element)

```xml
<!-- XSD — element inside a named container -->
<xsd:complexType name="lines_RelStructure">
  <xsd:sequence>
    <xsd:element ref="Line" maxOccurs="unbounded"/>
  </xsd:sequence>
</xsd:complexType>
```

When the parent type is used as a property:

```yaml
# OpenAPI — wrapped
lines:
  type: array
  xml:
    wrapped: true
    name: lines
  items:
    $ref: '#/components/schemas/Line'
```

Serializes as:
```xml
<lines>
  <Line>...</Line>
  <Line>...</Line>
</lines>
```

**NeTEx pattern**: `_RelStructure` types are collection wrappers. When a
property references a `_RelStructure` type, expand it as a wrapped array
of the inner element ref.

## Namespace mapping

### Single namespace

```xml
<!-- XSD -->
<xsd:schema targetNamespace="http://www.netex.org.uk/netex"
            xmlns:netex="http://www.netex.org.uk/netex">
```

```yaml
# OpenAPI — on the root component
StopPlace:
  xml:
    namespace: http://www.netex.org.uk/netex
    prefix: netex
```

### Cross-namespace references

NeTEx types referencing SIRI or GML types need distinct namespace annotations:

```yaml
# NeTEx type
ServiceJourney:
  xml:
    namespace: http://www.netex.org.uk/netex
    prefix: netex

# SIRI type referenced within
MonitoredCall:
  xml:
    namespace: http://www.siri.org.uk/siri
    prefix: siri

# GML type referenced within
LineString:
  xml:
    namespace: http://www.opengis.net/gml/3.2
    prefix: gml
```

### Namespace propagation strategy

Track `targetNamespace` per XSD file during `loadFile()`. When emitting
definitions, look up the source file's namespace:

```javascript
// In toJsonSchema():
const fileNamespaces = {};  // populated during loadFile()
// ...
entry.schema.xml = {
  ...(entry.schema.xml || {}),
  namespace: fileNamespaces[entry.sourceFile],
  prefix: prefixFor(fileNamespaces[entry.sourceFile]),
};
```

## Inheritance mapping

### complexContent/extension → allOf

```xml
<!-- XSD -->
<xsd:complexType name="StopPlace_VersionStructure">
  <xsd:complexContent>
    <xsd:extension base="Site_VersionStructure">
      <xsd:sequence>
        <xsd:element name="PublicCode" type="xsd:string"/>
      </xsd:sequence>
    </xsd:extension>
  </xsd:complexContent>
</xsd:complexType>
```

```yaml
# OpenAPI
StopPlace_VersionStructure:
  allOf:
    - $ref: '#/components/schemas/Site_VersionStructure'
    - type: object
      properties:
        PublicCode:
          type: string
```

Same as current JSON Schema output. Works in OpenAPI 3.0 and 3.1.

### Restriction → $ref only

```xml
<xsd:complexContent>
  <xsd:restriction base="SomeType">...</xsd:restriction>
</xsd:complexContent>
```

```yaml
# OpenAPI
$ref: '#/components/schemas/SomeType'
```

Same as current behavior — facet restrictions on complex types are dropped.

## simpleContent mapping

```xml
<!-- XSD -->
<xsd:complexType name="MultilingualString">
  <xsd:simpleContent>
    <xsd:extension base="xsd:string">
      <xsd:attribute name="lang" type="xsd:language"/>
    </xsd:extension>
  </xsd:simpleContent>
</xsd:complexType>
```

```yaml
# OpenAPI
MultilingualString:
  type: object
  properties:
    value:
      type: string
    lang:
      type: string
      xml:
        attribute: true
```

The `value` property serializes as the text content of the element.
OpenAPI tooling varies in handling this pattern — test with target codegen.

**Note**: OpenAPI has no native "text content" concept. The `value` property
convention is used by `xsd-to-jsonschema.js` but may not round-trip through
all OpenAPI XML serializers. Some generators use `x-xml-text: true` or
similar vendor extensions.

## Enumeration mapping

```xml
<!-- XSD -->
<xsd:simpleType name="StopPlaceTypeEnumeration">
  <xsd:restriction base="xsd:string">
    <xsd:enumeration value="railStation"/>
    <xsd:enumeration value="busStation"/>
    <xsd:enumeration value="airport"/>
  </xsd:restriction>
</xsd:simpleType>
```

```yaml
# OpenAPI
StopPlaceTypeEnumeration:
  type: string
  enum:
    - railStation
    - busStation
    - airport
```

No xml annotation needed — enum values serialize as text content.

## NeTEx patterns

### Entity with ref shorthand

NeTEx defines both element `StopPlace` (the entity) and element `StopPlaceRef`
(its reference). In OpenAPI:

```yaml
StopPlace:
  xml:
    name: StopPlace
    namespace: http://www.netex.org.uk/netex
  allOf:
    - $ref: '#/components/schemas/StopPlace_VersionStructure'

StopPlaceRef:
  xml:
    name: StopPlaceRef
    namespace: http://www.netex.org.uk/netex
  allOf:
    - $ref: '#/components/schemas/StopPlaceRef_RefStructure'
```

### Frame structure

NeTEx frames (ResourceFrame, ServiceFrame, etc.) contain typed members.
In OpenAPI, frame members appear as optional wrapped arrays:

```yaml
ServiceFrame:
  allOf:
    - $ref: '#/components/schemas/CommonVersionFrame_VersionStructure'
    - type: object
      properties:
        lines:
          type: array
          xml:
            wrapped: true
          items:
            $ref: '#/components/schemas/Line'
        routes:
          type: array
          xml:
            wrapped: true
          items:
            $ref: '#/components/schemas/Route'
```

## OpenAPI 3 structural differences from JSON Schema

When converting `xsd-to-jsonschema.js` output to OpenAPI 3:

| JSON Schema (current) | OpenAPI 3 equivalent |
|---|---|
| `#/definitions/Foo` | `#/components/schemas/Foo` (3.0+) |
| `$schema: "draft-07"` | Remove (not used in OpenAPI) |
| `{ definitions: {...} }` | `{ components: { schemas: {...} } }` |
| `description` on `$ref` sibling | Move into `allOf` wrapper (3.0) or keep as sibling (3.1) |
| `x-netex-*` annotations | Keep as vendor extensions (valid in OpenAPI) |

### OpenAPI 3.0 vs 3.1

- **3.0**: JSON Schema Draft 05 subset. No `$ref` siblings allowed — wrap in allOf
- **3.1**: Full JSON Schema Draft 2020-12. `$ref` siblings allowed. `type` can be array

For NeTEx, target 3.0 for maximum tooling compatibility unless the consumer
requires 3.1 features.
