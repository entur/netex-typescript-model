# XSD Validation Errors in Mock XML Roundtrip

Analysis of errors from `valid-roundtrip.test.ts` — xmllint validation of `genMockObject` + `buildXmlString` output wrapped in a PublicationDelivery envelope against `xsd/2.0/NeTEx_publication.xsd`.

Tested entities: `VehicleType`, `Vehicle`, `DeckPlan` (all role: `entity`).

## Error Map

| # | xmllint error | Root function | Fixable in |
|---|---------------|---------------|------------|
| 1 | `keyList` attribute `typeOfKey` not allowed | `resolveDefType` "array-unwrap" | `genMockObject` |
| 2 | `Key` / `value` instead of `KeyValue` / `Text` / `PrivateCode` | `resolveDefType` "array-unwrap" + "mixed-unwrap" | `genMockObject` |
| 3 | `BrandingRef` / `DeckPlanRef`: element content not allowed (simple type) | `genRefMock` + `serializeValue` | `genRefMock` |
| 4 | `created` / `changed`: 'string' not valid dateTime | `genRefMock` | `genRefMock` |
| 5 | `Extensions`: character content in element-only type | `resolveDefType` "empty-object" | `genMockObject` |
| 6 | `EuroClass` before expected siblings (element ordering) | `flattenAllOf` + converter | converter + `buildXmlString` |
| 7 | keyref: no match for `BrandingRef`, `DeckPlanRef`, etc. | (structural) | test wrapper or accept |

## Detailed Analysis

### Errors 1 & 2 — Wrapper level erasure

**Symptom:** Attributes and child elements appear at the wrong nesting level.

**Mechanism:** `resolveDefType` (schema-viewer-fns.ts:282) has two unwrapping branches designed for TypeScript type display that erase structurally significant XML wrapper levels:

**"array-unwrap" (line 378–393):** When a type has exactly one property that is an array of atom-stamped items, `resolveDefType` collapses the wrapper and returns the item type directly.

```
keyList property
  → keyList (element)
  → KeyListStructure { KeyValue: KeyValueStructure[] }   ← 1 prop, atom items
  → resolveDefType returns: "KeyValueStructure[]", complex: false
```

`genMockObject` then treats `keyList` as a flat array of `KeyValueStructure` objects. `tryGenShallowMock` fills the items with `{ Key, Value, typeOfKey }`. The XML builder renders:

```xml
<!-- ACTUAL (wrong — typeOfKey promoted to keyList, Key is bare) -->
<keyList typeOfKey="string">
  <Key>string</Key>
  <Value>string</Value>
</keyList>

<!-- EXPECTED (two-level nesting preserved) -->
<keyList>
  <KeyValue typeOfKey="string">
    <Key>string</Key>
    <Value>string</Value>
  </KeyValue>
</keyList>
```

Same pattern for `privateCodes → PrivateCodesStructure { PrivateCode: PrivateCode[] }`.

**"mixed-unwrap" (line 374–376):** `MultilingualString` (used by `Name`, `Description`, `ShortName`) is detected via `unwrapMixed` as a mixed-content wrapper with `*Either*` in its description. `resolveDefType` returns `TextType[]`, `complex: true`. `genMockObject` then calls `tryGenShallowMock("TextType")` for array items, producing `{ value, lang, textIdType }`.

```xml
<!-- ACTUAL (wrong — value/lang as bare elements inside Name) -->
<Name>
  <value>string</value>
  <lang>string</lang>
</Name>

<!-- EXPECTED (Text wrapper preserved, value is text content) -->
<Name>
  <Text lang="en">string</Text>
</Name>
```

**Why these branches exist:** They're correct for TypeScript — you *want* `Name: TextType[]` not `Name: MultilingualString`. But XML serialization needs every wrapper level because each maps to a real element.

**Fix approach:** `genMockObject` should not use `resolveDefType` (which is a display-oriented resolver) for deciding mock structure. It needs an XML-aware path that preserves wrapper nesting. Alternatively, add an `xml: true` flag to `resolveDefType` that suppresses the unwrap branches.

---

### Error 3 — Ref `value` becomes child element instead of text content

**Symptom:** `<BrandingRef>` contains `<value>XXX:Branding:1</value>` child element. XSD says content type is simple (text only).

**Mechanism:** `genRefMock` (line 782) builds ref mocks as `{ value: id, $ref: id, ... }`. The `value` key has no `$` prefix, so `serializeValue` treats it as a child element. In the XSD, this is simpleContent — the ID string should be the element's text content.

```
VersionOfObjectRefStructure (the root ref type):
  properties: { value: ObjectIdType, ref (attr), created (attr), ... }
  x-netex-atom: "simpleObj"
```

The converter's `convertSimpleContent` models the base type as a `value` property — correct for JSON Schema, but `value` in fast-xml-parser means a child element, not text content. Text content requires `#text`.

```xml
<!-- ACTUAL -->
<BrandingRef ref="XXX:Branding:1" version="1">
  <value>XXX:Branding:1</value>
</BrandingRef>

<!-- EXPECTED -->
<BrandingRef ref="XXX:Branding:1" version="1">XXX:Branding:1</BrandingRef>
```

**Fix approach:** `genRefMock` (or `serializeValue`) should emit `#text` instead of `value` for simpleContent types. Detection: the type has `x-netex-atom: "simpleObj"` and a `value` property whose schema has no `xml.attribute` marker and is a primitive.

---

### Error 4 — dateTime attributes rendered as "string"

**Symptom:** `<BrandingRef created="string" changed="string">` — xmllint rejects `"string"` as invalid `xs:dateTime`.

**Mechanism:** `genRefMock` (line 804–808) handles `$`-prefixed attribute properties via `classifySchema`. For `created`/`changed`, the schema is `{ type: "string", format: "date-time", xml: { attribute: true } }`. `classifySchema` returns `{ kind: "primitive", type: "string", format: "date-time" }`. But the code only special-cases `boolean` — everything else gets `"string"`:

```typescript
if (shape.type === "boolean") result[propName] = false;
else result[propName] = "string";  // ← ignores format
```

**Fix approach:** Check `shape.format` in `genRefMock`. Same pattern already exists in `genMockObject` main loop (lines 940–951) where `date-time`, `date`, and `time` formats produce proper values. Extract to a shared `defaultForPrimitive(shape)` helper.

---

### Error 5 — `Extensions` gets text content

**Symptom:** `<Extensions>string</Extensions>` — XSD says element-only content (wraps `xsd:any`).

**Mechanism:** `resolveDefType` hits the "empty-object" branch (line 395–398):

```
ExtensionsStructure = { type: "object" }  (no properties — xsd:any wrapper)
→ resolveDefType returns: ts: "any", complex: false
```

Because `complex: false`, `genMockObject` treats it as a primitive and fills with `"string"`. The XSD declares Extensions as element-only — even an empty `<Extensions/>` would be more valid than text content.

**Fix approach:** `genMockObject` should skip properties whose resolved type is `"any"` (the empty-object sentinel), or `resolveDefType` should return `complex: true` for empty objects since they can't be serialized as primitives.

---

### Error 6 — Element ordering

**Symptom:** `<EuroClass>` appears before `<capacities>`, `<LowFloor>`, etc. XSD `xsd:sequence` requires a specific order.

**Mechanism:** This is a compound problem across three layers:

1. **`xsd-to-jsonschema.js`** doesn't preserve `xsd:sequence` ordering metadata. JSON Schema `properties` is an unordered map. The converter emits properties in XSD parse order within a single type, but inheritance interleaving is lost.

2. **`flattenAllOf`** concatenates properties parent-first, then child. When the XSD inserts child properties *between* inherited properties (via `xsd:extension` inside a `xsd:sequence`), the flat concatenation produces the wrong order.

3. **`XMLBuilder`** (fast-xml-parser) emits elements in JS object key order, which reflects the concatenation order from `flattenAllOf`.

**Fix approach:** This requires the converter to stamp per-property sequence indices (e.g., `x-netex-order: 5`). `genMockObject` or `buildXmlString` would then sort properties by these indices before building XML. This is a significant addition to the converter.

---

### Error 7 — keyref (referential integrity)

**Symptom:** `No match found for key-sequence ['XXX:Branding:1', '1'] of keyref 'Branding_AnyKeyRef'`.

**Mechanism:** NeTEx XSD defines `xsd:keyref` constraints requiring that referenced entities exist within the same document. A mock `VehicleType` referencing `BrandingRef XXX:Branding:1` fails because no `Branding` entity exists in the PublicationDelivery.

**Not a function bug.** This is inherent to testing individual entities in isolation. Options:
- Include stub entities for all referenced types in the wrapper (complex, fragile)
- Accept keyref errors and filter them from xmllint output
- Use `xmllint --schema --noout` with post-filtering of `keyref` lines from stderr

The pragmatic choice is to filter keyref errors and focus on structural validity.

## Priority Order for Fixes

1. **Error 3 + 4 (genRefMock)** — smallest change, biggest bang. Fix `value` → `#text` and add format-aware defaults. Affects all entities since refs are universal.
2. **Error 5 (Extensions)** — one-line skip in `genMockObject` for empty-object types.
3. **Error 1 + 2 (wrapper erasure)** — the core architectural issue. Needs an XML-aware mock builder that doesn't use `resolveDefType`'s display-oriented unwrapping. Most impactful but most invasive.
4. **Error 7 (keyref)** — filter in test, not a source fix.
5. **Error 6 (ordering)** — requires converter-level changes (`x-netex-order` stamp). Defer until other errors are resolved.
