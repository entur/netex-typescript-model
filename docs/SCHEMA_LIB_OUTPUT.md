# Definitions-Only Schema and Validation

## Summary

`xsd-to-jsonschema.js` produces a schema with only `definitions` at the root — no `properties`, `type`, or other assertion keywords. Ajv correctly reports this as a valid *schema*, but using it to validate *data* always returns `true` because a schema missing all assertion keywords places zero constraints on the instance.

In JSON Schema Draft-07, `definitions` is not an assertion keyword. It exists purely as a namespace for reusable sub-schemas and has no direct validation effect. The output is structurally a **schema library** (analogous to OpenAPI `components/schemas`), not a document validator.

## Approaches for Validation

### 1. Add a root `$ref`

Point the root at whichever definition represents the expected document shape:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$ref": "#/definitions/PublicationDelivery",
  "definitions": { "..." }
}
```

Locks the schema to a single root type.

### 2. Use `ajv.getSchema()` at runtime (recommended)

```js
ajv.addSchema(schema, 'netex');
const validate = ajv.getSchema('netex#/definitions/PublicationDelivery');
validate(myDocument);
```

Most flexible — the generated schema stays unchanged as a pure definitions container, and consumers choose which type to validate against.

### 3. Compose from an external schema

```json
{
  "$ref": "netex-base.schema.json#/definitions/ServiceJourney"
}
```

Ajv resolves cross-file `$ref` if the base schema is loaded first. This is the OpenAPI model — the library stays generic, each consumer references into it.

## Quick Reference

| Root schema shape | Always passes? | Useful for validation? |
|---|---|---|
| `{ definitions: {...} }` | Yes | No |
| `{ $ref: "#/definitions/X", definitions: {...} }` | No | Yes — checks against X |
| `{ definitions: {...} }` + `ajv.getSchema('id#/definitions/X')` | N/A (per-def) | Yes — most flexible |
| `{ properties: {...}, definitions: {...} }` | No | Yes — checks root shape |

## Pitfall: `additionalProperties: false` at root

Adding `"additionalProperties": false` alongside only `definitions` (no `properties` or `$ref`) causes **nothing** to validate — every property in the instance is treated as "additional". Always pair `additionalProperties` with `properties` or `$ref`.

## Decision

Option 2 (`getSchema`) is the natural fit for this project: the generated schema stays a pure definitions container, and consumers pick which definition to validate against at runtime.
