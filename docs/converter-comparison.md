# Converter Comparison: XML Annotations in JSON Schema

Decision document for adding OpenAPI `xml` object annotations to the JSON Schema output, enabling downstream tools (Swagger codegen, data generators) to produce both JSON and XML.

## The requirement

The JSON Schema currently describes NeTEx types structurally but loses all XML serialization metadata. To round-trip between JSON and XML, each definition needs OpenAPI-style `xml` annotations per [Swagger XML representation](https://swagger.io/docs/specification/v3_0/data-models/representing-xml/):

| XSD concept | JSON Schema `xml` property | Example |
|---|---|---|
| `xsd:attribute` | `xml: { attribute: true }` | `version` rendered as `<Element version="1.0">` not `<version>1.0</version>` |
| Element name differs from property key | `xml: { name: "OriginalName" }` | When namespace prefixes are stripped |
| Namespace-qualified elements | `xml: { namespace: "...", prefix: "..." }` | GML/SIRI elements in NeTEx namespace |
| Array wrapper elements | `xml: { wrapped: true }` | `<members><member>...</member></members>` |

This is **not** about XSD `<xsd:annotation>/<xsd:documentation>` (human-readable docs). It's about structural metadata that controls XML serialization.

## Current state

The custom converter (`xsd-to-jsonschema.ts`, ~630 lines) already parses the XSD constructs that carry this information:

- **Attributes are parsed** — `xsd:attribute` elements are read and emitted as properties, but nothing marks them as `xml: { attribute: true }`. They're indistinguishable from child elements in the output.
- **Namespaces are stripped** — `stripNs()` removes all prefixes. The original namespace/prefix is discarded.
- **Element names are preserved** — property keys match XSD element names (after prefix stripping).
- **Array wrapping is implicit** — `maxOccurs="unbounded"` produces `{ type: "array", items: ... }` but no `xml: { wrapped: true/false }`.

The information exists in the XSD parse tree but is discarded during conversion.

## What needs to change

### For attributes (highest impact)
NeTEx uses `xsd:attribute` extensively (version, id, modification, status, etc.). Every attribute currently looks like an element property in the JSON Schema. Adding `xml: { attribute: true }` to these is the single most impactful change for XML round-tripping.

The converter already has the attribute/element distinction in `convertComplexType`, `convertComplexContent`, `convertSimpleContent`, and `inlineAttributeGroups` — each iterates `xsd:attribute` separately from `xsd:element`. The fix is emitting `xml: { attribute: true }` on those properties.

### For namespaces (medium impact)
NeTEx has three namespaces: `http://www.netex.org.uk/netex`, `http://www.opengis.net/gml/3.2` (GML), `http://www.siri.org.uk/siri` (SIRI). The converter currently strips prefixes and merges everything. Preserving namespace info requires:
- Tracking the target namespace from each `xsd:schema[@targetNamespace]`
- Storing it per-definition alongside `sourceFile`
- Emitting `xml: { namespace: "...", prefix: "..." }` on cross-namespace references

### For wrapped arrays (lower impact)
XSD doesn't have a direct "wrapped" concept — it depends on whether the repeating element is inside a named container element. This requires context-aware detection during sequence processing.

## Path A: Enhance the custom converter

**Effort**: 2-4 days for attributes + namespaces. Wrapped arrays add 1-2 days.

The converter already distinguishes attributes from elements in the parse logic. The changes:

1. **Attribute marking** — in every code path that processes `xsd:attribute`, emit `xml: { attribute: true }` on the property schema. ~10 lines across 4 methods. This is purely additive.

2. **Namespace tracking** — read `@_targetNamespace` from each `xsd:schema` root during `loadFile`. Store as a file→namespace map. During type conversion, attach `xml: { namespace, prefix }` to definitions from GML/SIRI namespaces. ~30 lines.

3. **`xml.name` for renamed properties** — when the XSD element name differs from the JSON property key (currently doesn't happen since we use XSD names, but would be needed if we ever rename for JS conventions). Low priority.

4. **Wrapped arrays** — detect wrapper patterns in sequences. More complex, context-dependent. Can defer.

**Advantages**: Surgical changes to code we own. The attribute/element distinction already exists in the parse logic — we're just carrying it through to the output. `JSONSchema7` from `@types/json-schema` allows arbitrary extension properties via index signature, so `xml: { ... }` objects are valid.

**Risk**: Low for attributes and namespaces. Wrapped array detection is the only non-trivial part and can be deferred.

**Limitation**: Substitution groups remain unaddressed. Not related to XML annotations.

## Path B: xsdata (Python)

xsdata has the most complete XSD model — it knows about attributes, namespaces, substitution groups, and all XSD metadata natively. It could produce a JSON Schema with full XML annotations because it understands the complete XSD semantics.

**Integration**: xsdata doesn't output JSON Schema directly. You'd need a custom Python emitter (~300-500 lines) that walks xsdata's internal model and produces JSON Schema + `xml` annotations. The Node.js pipeline would call Python as a subprocess.

**Advantage over Path A**: xsdata's model distinguishes attributes, elements, namespace-qualified names, and substitution groups from the start. No risk of missing edge cases that the custom parser handles incorrectly.

**Disadvantage**: Python dependency in a TypeScript project. The JSON Schema emitter doesn't exist. More code to write than enhancing the custom converter, and in a different language. The attribute-marking fix alone is ~10 lines in the custom converter vs ~300+ lines of new Python bridge.

**Verdict**: The correct tool if you need comprehensive XSD fidelity including substitution groups. Overkill if the immediate need is attribute/namespace annotations.

## Path C: @kie-tools/xml-parser-ts-codegen

Generates TypeScript types + XML parser metadata from XSD. The metadata includes element/attribute distinction and namespace info — exactly what we need for `xml` annotations.

**Problem**: "Not tested against arbitrary XSD files." NeTEx would be the largest, most complex schema it has ever processed. If it fails, debugging Apache's codegen internals is harder than fixing our own 630-line converter.

**Verdict**: High risk, unclear reward. Not recommended for this feature.

## Recommendation

**Enhance the custom converter (Path A), starting with attribute marking.**

1. **Attribute `xml` annotations are the highest-value, lowest-effort change.** The code already separates attributes from elements — carrying `xml: { attribute: true }` through is ~10 lines. This alone enables correct XML serialization for the most common NeTEx pattern.

2. **Namespace annotations are straightforward.** The `targetNamespace` is on every `xsd:schema` root. Tracking it per-file and emitting it on GML/SIRI definitions is ~30 lines.

3. **xsdata is the escape hatch, not the starting point.** If attribute/namespace annotations prove insufficient and full substitution group support becomes blocking, xsdata is the right tool. But introducing Python for what the custom converter can handle in 40 lines of TypeScript is premature.

### Concrete next steps

1. Emit `xml: { attribute: true }` on properties created from `xsd:attribute` in `convertComplexType`, `convertComplexContent`, `convertSimpleContent`, `inlineAttributeGroups`
2. Build a file→targetNamespace map during `loadFile`
3. Emit `xml: { namespace, prefix }` on definitions from non-NeTEx namespaces (GML, SIRI)
4. Verify that `json-schema-to-typescript` passes through `xml` objects (it should — they're just extra properties)
5. Validate with a Swagger/OpenAPI tool that the annotations produce correct XML output
