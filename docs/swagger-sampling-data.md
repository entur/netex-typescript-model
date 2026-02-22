# JSON Schema Sample Data Generation — Library Evaluation

Evaluated 2026-02-22. Goal: find a JS library that generates structurally valid sample objects from our JSON Schema (Draft 07, `$ref`, `allOf`, `definitions`, `enum`) for use in roundtrip testing (JSON Schema → sample object → parse → serialize to XML).

## Candidates

### 1. openapi-sampler (Redocly) — Recommended

| | |
|---|---|
| **npm** | `openapi-sampler` |
| **GitHub** | [Redocly/openapi-sampler](https://github.com/Redocly/openapi-sampler) (218 stars) |
| **License** | MIT |

Generates a single **deterministic** sample object from a JSON Schema or OpenAPI schema. Given the same input, always produces the same output — no randomness. Synchronous API.

```js
import { sample } from 'openapi-sampler';
import fullSchema from '../generated-src/base/base.schema.json';

const defSchema = fullSchema.definitions['ValidityCondition'];
const sampleData = sample(defSchema, { maxSampleDepth: 3 }, fullSchema);
```

- Resolves `$ref` when the full schema is passed as the third argument (no external refs allowed).
- Supports `allOf`, `oneOf`, `anyOf`, `if/then/else`.
- Uses `default`, `const`, `enum`, `examples` values when present.
- `maxSampleDepth` (default 2) limits recursion — prevents explosion on deeply nested NeTEx hierarchies.
- Circular `$ref` detection built-in. Known issue: fully dereferenced circular schemas (no `$ref` nodes) can stack-overflow ([#113](https://github.com/Redocly/openapi-sampler/issues/113)), but our schemas preserve `$ref`.
- Output style: placeholder values (`"string"`, `0`, `true`) — shows structure, not noise.

### 2. json-schema-faker — Alternative

| | |
|---|---|
| **npm** | `json-schema-faker` |
| **GitHub** | [json-schema-faker/json-schema-faker](https://github.com/json-schema-faker/json-schema-faker) (3.4k stars) |
| **License** | MIT |
| **Dependencies** | Zero production deps |

Full-featured fake data generator. Produces realistic-looking random data. Supports Draft 04 through 2020-12. Async API.

```js
import { generate } from 'json-schema-faker';

const schema = {
  $ref: '#/definitions/ValidityCondition',
  definitions: fullSchema.definitions
};
const sampleData = await generate(schema, {
  alwaysFakeOptionals: false,
  refDepthMax: 3,
  seed: 42  // deterministic
});
```

- Full `$ref` + `definitions` support, cycle detection, configurable `refDepthMax` (default 3).
- `allOf` merges, `oneOf`/`anyOf` picks one.
- Can integrate faker.js/chance.js for realistic names, emails, etc.
- Known issue: `alwaysFakeOptionals: true` with circular schemas can hang ([#530](https://github.com/json-schema-faker/json-schema-faker/issues/530)). Workaround: keep `refDepthMax` low.
- Noisier output (random strings) — better for test fixtures than for documentation samples.

### 3. @stoplight/json-schema-sampler — Skip

Fork of `openapi-sampler` refocused on Draft 7. Same API. 10 stars, last published ~Feb 2024. No meaningful advantage over the actively maintained original.

### 4. @swagger-api/apidom family — Not applicable

Parser/transformer toolkit, not a sample generator. No `sample()` or `generate()` function. Only relevant for programmatic spec transformation.

### 5. swagger-jsdoc — Not applicable

Generates OpenAPI specs from JSDoc comments — opposite direction.

## Comparison

| Library | Output style | Deterministic | `$ref`/`allOf` | Circular safe | API |
|---|---|---|---|---|---|
| **openapi-sampler** | Minimal placeholders | Always | Yes | Yes (`$ref`-based) | Sync |
| **json-schema-faker** | Realistic random | Via seed | Yes | Yes (`refDepthMax`) | Async |

## Recommendation for roundtrip testing

**`openapi-sampler`** for the initial roundtrip test harness:

1. Deterministic — tests are reproducible without seeds
2. Synchronous — simpler test code
3. Minimal output — easier to debug when serialization fails
4. `maxSampleDepth: 3` naturally caps NeTEx's deep inheritance chains

**`json-schema-faker`** as a follow-up if we want varied/realistic fixtures or property-based-style testing with different seeds.

## Roundtrip test sketch

```
JSON Schema (base.schema.json)
  │
  ├─ openapi-sampler.sample(def, opts, fullSchema)
  │     → plain JS object conforming to schema
  │
  ├─ cast to TypeScript interface (compile-time check)
  │
  ├─ serialize to XML (using attributeMap from schema's xml.attribute markers)
  │
  └─ validate XML against NeTEx XSD (xmllint or similar)
```

Key: the schema's `xml: { attribute: true }` annotations drive the serializer to emit attributes vs child elements correctly. The `x-netex-role` annotations identify which definitions are worth testing (entities and frameMember types).
