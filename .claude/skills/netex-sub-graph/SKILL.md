---
name: netex-sub-graph
description: >
  Internal architecture of json-schema/xsd-to-jsonschema.js — the GraalVM
  JavaScript converter that transforms NeTEx XSD schemas into annotated
  JSON Schema. Use when modifying the converter, debugging conversion
  output, adding new annotation passes, or understanding how XSD constructs
  map to JSON Schema. Trigger: /sub-graph or when editing xsd-to-jsonschema.js.
---

# XSD → JSON Schema Converter (`xsd-to-jsonschema.js`)

Reference for the primary converter that transforms NeTEx XSD schemas into
JSON Schema with custom annotations. Read [references/architecture.md](references/architecture.md)
for the full internal walkthrough.

## Key file

`json-schema/xsd-to-jsonschema.js` — 1286 lines, plain JavaScript, no modules.
Runs on stock JDK 21+ via GraalJS polyglot. Uses `Java.type()` for DOM parsing
(`DocumentBuilderFactory`, `org.w3c.dom.Node`). No Node.js APIs.

## Multi-pass architecture

```
loadFile(root)           → recursive XSD file loading (include/import)
  ↓
Pass 1: collectRawDefinitions  → populate rawComplexTypes, rawSimpleTypes, rawElements,
                                  groups, attrGroups registries
  ↓
Pass 2: convert()        → convertComplexType / convertSimpleType / convertTopLevelElement
                           → populate this.types, this.elements with JSON Schema objects
  ↓
Pass 3: classifyDefinitions  → stamp x-netex-role (10 priority-ordered rules)
  ↓
Pass 4: annotateAtoms        → stamp x-netex-atom (simpleContent wrappers, flat primitives)
  ↓
toJsonSchema(filter)     → assemble output, stamp x-netex-source, add placeholders
```

## Custom annotations stamped

| Annotation | Values | Purpose |
|---|---|---|
| `x-netex-source` | XSD file path | Origin tracking for per-category module splitting |
| `x-netex-role` | structure, collection, reference, view, enumeration, abstract, frameMember, entity | Role classification for viewer filtering and type resolution |
| `x-netex-atom` | primitive string, `"simpleObj"`, `"array"` | Transparent wrapper detection for viewer collapse |
| `x-netex-frames` | string[] of frame names | Frame membership for frameMember-role defs |
| `x-netex-assembly` | assembly name | Top-level schema annotation |
| `x-netex-mixed` | `true` | Types with `mixed="true"` attribute |

## XSD → JSON Schema mapping patterns

| XSD construct | JSON Schema output |
|---|---|
| `complexType` with `complexContent/extension` | `{ allOf: [{ $ref: base }, { properties }] }` |
| `complexType` with `simpleContent/extension` | `{ type: "object", properties: { value: baseType, ...attrs } }` |
| `complexType` with direct sequence/choice | `{ type: "object", properties }` |
| `simpleType` with `restriction` + enum | `{ type: "string", enum: [...] }` |
| `simpleType` with `union` | `{ anyOf: [...] }` |
| `simpleType` with `list` | `{ type: "array", items: itemType, "x-netex-atom": "array" }` |
| `element` with `type` ref | resolveTypeRef (built-in → inline, user-defined → `$ref`) |
| `element ref="Foo"` | `{ $ref: "#/definitions/Foo" }` |
| `maxOccurs="unbounded"` | `{ type: "array", items: schema }` |
| `xsd:group ref` | properties inlined (not a $ref) |
| `xsd:attributeGroup ref` | attributes inlined with `xml.attribute: true` |

## When editing this file

- Run full pipeline after changes: `make all ASSEMBLY=base`
- Validate output: `cd typescript && npx tsx scripts/validate-generated-schemas.ts`
- Check role/atom counts in output schema match expectations
- No test suite for xsd-to-jsonschema.js itself — validation is end-to-end via generated TypeScript type-checking
