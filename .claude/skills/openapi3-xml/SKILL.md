---
name: openapi3-xml
description: >
  Generate OpenAPI 3.x schema components from XSD schemas with correct XML
  serialization annotations. Covers the xml: object (name, attribute, wrapped,
  namespace, prefix), XSD-to-OpenAPI mapping rules, and how to extend
  xsd-to-jsonschema.js to produce OpenAPI-compatible output. Use when converting
  XSD types to OpenAPI schemas, adding XML media type support to OpenAPI specs,
  or debugging XML serialization of OpenAPI-generated models.
---

# XSD → OpenAPI 3 with XML Annotations

Generate OpenAPI 3 schema components from XSD schemas that serialize correctly
as `application/xml`. The existing `xsd-to-jsonschema.js` already produces
JSON Schema with partial XML annotations — this skill covers the full mapping.

## What the converter already does

`xsd-to-jsonschema.js` stamps `xml: { attribute: true }` on every XSD
`<attribute>` it encounters (lines 382, 409, 448, 653). This is the only
OpenAPI XML annotation currently emitted.

## What's missing for full OpenAPI 3 XML

| XML property | XSD source | Status |
|---|---|---|
| `attribute: true` | `<xsd:attribute>` | Done |
| `name` | element name vs type name divergence | Not emitted |
| `namespace` | `targetNamespace` on `<xsd:schema>` | Not emitted |
| `prefix` | namespace prefix from XSD | Not emitted |
| `wrapped: true` | `maxOccurs="unbounded"` inside named container | Not emitted |

## Core mapping rules

See [references/xsd-to-openapi-mapping.md](references/xsd-to-openapi-mapping.md)
for detailed rules with XSD input → OpenAPI output examples.

### Quick reference

| XSD construct | OpenAPI schema |
|---|---|
| `<attribute name="id" type="string">` | `id: { type: string, xml: { attribute: true } }` |
| `<element name="Name">` (in sequence) | `Name: { type: string }` (xml.name not needed — matches property key) |
| `<element ref="StopPlace">` | `StopPlace: { $ref: '#/components/schemas/StopPlace' }` |
| `<element maxOccurs="unbounded">` in named wrapper | `items: ..., type: array, xml: { wrapped: true }` |
| `<complexContent><extension base="...">` | `allOf: [{ $ref: base }, { properties }]` |
| `<simpleContent><extension base="string">` | `properties: { value: { type: string }, ...attrs }` |
| `targetNamespace="http://..."` | `xml: { namespace: 'http://...', prefix: 'ns' }` |

## NeTEx-specific challenges

- **Deep inheritance**: NeTEx types chain 5-8 levels of allOf. OpenAPI tooling may struggle with deeply nested allOf + xml annotations — test with target codegen tool
- **Mixed namespaces**: NeTEx XSD uses `http://www.netex.org.uk/netex`, SIRI uses `http://www.siri.org.uk/siri`, GML uses `http://www.opengis.net/gml/3.2`. Each element needs the correct namespace/prefix
- **Element vs type naming**: NeTEx convention: element `StopPlace`, type `StopPlace_VersionStructure`. XML serializes the element name, not the type name. OpenAPI `xml.name` is needed when the schema component name differs from the desired XML element name
- **Wrapped collections**: NeTEx `_RelStructure` types are collection wrappers containing unbounded element refs. These need `xml.wrapped: true` on the array property

## Implementation approach

To extend `xsd-to-jsonschema.js` for OpenAPI output:

1. **Track target namespaces** — store `targetNamespace` per parsed file, propagate to definitions via `x-netex-source` file → namespace lookup
2. **Emit `xml.name`** — when an element `ref` resolves to a type with a different name
3. **Emit `xml.wrapped`** — on arrays inside named container elements
4. **Emit `xml.namespace`/`xml.prefix`** — from tracked namespaces
5. **Post-process** — convert `#/definitions/` refs to `#/components/schemas/` for OpenAPI 3
