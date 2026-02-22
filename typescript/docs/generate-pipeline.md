# `npm run generate` — Pipeline Flowchart

One-way data flow. Each box is a processing step, arrows show data passing.

```
inputs/config.json ──────────────────────────────────────────────────────┐
  │                                                                      │
  ▼                                                                      │
┌─────────────────────────────────┐                                      │
│  Config                         │                                      │
│  Parse config, enforce required │                                      │
│  parts, resolve assembly        │                                      │
└──────┬──────────────────────────┘                                      │
       │ enabledDirs[], xsdRoot, assembly                                │
       ▼                                                                 │
┌──────────────────────────────────────────┐                             │
│  Step 1: XsdToJsonSchema.loadFile()      │                             │
│                                          │                             │
│  IN:  xsd/NeTEx_publication.xsd          │                             │
│       (recursively resolves all           │                             │
│        xs:include / xs:import)           │                             │
│                                          │                             │
│  Parses 458 XSD files via fast-xml-parser│                             │
│  Two passes:                             │                             │
│    Pass 1 → groups, attrGroups registry  │                             │
│    Pass 2 → types, elements registry     │                             │
│  Tracks sourceFile per definition        │                             │
│                                          │                             │
│  OUT: in-memory type registry            │                             │
│       (types, elements, groups maps)     │                             │
└──────┬───────────────────────────────────┘                             │
       │                                                                 │
       ▼                                                                 │
┌──────────────────────────────────────────┐                             │
│  Step 2: converter.toJsonSchema(filter)  │                             │
│                                          │◄────────────────────────────┘
│  IN:  type registry + filter function    │  config.isEnabledPath()
│       filter = config.isEnabledPath()    │
│                                          │
│  Converts each enabled definition to     │
│  JSON Schema Draft 07.                   │
│  Disabled-part refs → placeholder {}     │
│  xsd:annotation → description fields     │
│  $ref wrapping via allOf for descriptions│
│                                          │
│  OUT: JsonSchema object (in memory)      │
│       { $schema, definitions: {...} }    │
└──────┬───────────────────────────────────┘
       │
       ├──────────────────────────────────────┐
       ▼                                      ▼
┌────────────────────────┐   ┌──────────────────────────────────────────┐
│  persistJsonSchema()   │   │  Step 3: compile() — json-schema-to-ts  │
│                        │   │                                          │
│  OUT: file written     │   │  IN:  JsonSchema object                  │
│  src/generated/        │   │       options: unreachableDefinitions,   │
│    <assembly>/             │   │       additionalProperties: false,       │
│      jsonschema/       │   │       format: false                      │
│    <asm>.schema.json ● │   │                                          │
│                        │   │  Compiles all definitions to TypeScript  │
│  ⚠ NO VALIDATION      │   │  description → JSDoc comments            │
│                        │   │  $ref → type references                  │
└────────────────────────┘   │  allOf → intersection types / extension  │
                             │                                          │
                             │  OUT: monolithic TypeScript string       │
                             └──────┬──────┐                            │
                                    │      │                            │
                                    │      ▼                            │
                                    │  ┌──────────────────────────┐     │
                                    │  │  Write monolithic file   │     │
                                    │  │                          │     │
                                    │  │  OUT: file written       │     │
                                    │  │  src/generated/          │     │
                                    │  │    <assembly>/               │     │
                                    │  │      interfaces/         │     │
                                    │  │        netex.ts  ●       │     │
                                    │  └──────────────────────────┘     │
                                    │                                   │
       ┌────────────────────────────┘                                   │
       │  TypeScript string                                             │
       │                         converter.getTypeSourceMap()           │
       │  ┌─────────────────────────────────────────────┐               │
       │  │  Map<defName, sourceFile>                    │               │
       │  │  e.g. "ScheduledStopPointStructure"          │               │
       │  │    → "netex_part_1/.../netex_ssp_version.xsd"│               │
       │  └──────────────┬──────────────────────────────┘               │
       │                 │                                              │
       ▼                 ▼                                              │
┌──────────────────────────────────────────┐                            │
│  Step 4: splitTypeScript()               │                            │
│                                          │                            │
│  IN:  monolithic TS string               │                            │
│       sourceMap (defName → sourceFile)   │                            │
│                                          │                            │
│  1. parseDeclarations() — find JSDoc +   │                            │
│     export boundaries in the TS string   │                            │
│  2. categorize() each block by source    │                            │
│     directory (reusable, siri, core...)  │                            │
│  3. extractTypeReferences() — scan for   │                            │
│     PascalCase identifiers to resolve    │                            │
│     cross-category imports               │                            │
│  4. Write per-category files with banner,│                            │
│     import statements, and declarations  │                            │
│                                          │                            │
│  OUT: files written                      │                            │
│  src/generated/<assembly>/interfaces/        │                            │
│    core.ts  ●                            │                            │
│    generic.ts  ●                         │                            │
│    reusable.ts  ●                        │                            │
│    responsibility.ts  ●                  │                            │
│    siri.ts  ●                            │                            │
│    network.ts  ●  (if Part 1 enabled)    │                            │
│    index.ts  ●  (barrel re-export)       │                            │
└──────────────────────────────────────────┘

● = file written to disk
```

## Validation gaps

| Point in pipeline | What could go wrong | Current guard |
|---|---|---|
| XSD parsing (Step 1) | Malformed XML, missing includes | `fast-xml-parser` throws; warnings logged |
| JSON Schema (Step 2) | Invalid `$ref` targets, malformed definitions | **None** — no schema validation |
| JSON Schema → TS (Step 3) | Schema rejected by `json-schema-to-typescript` | Catch block logs error, exits |
| Split (Step 4) | JSDoc parsing misses declarations | **None** — silent data loss |
| Final output | TypeScript doesn't compile | **None** — `tsc` not run in pipeline |

The biggest gap is between Steps 2 and 3: if `toJsonSchema()` produces structurally valid JSON but semantically broken JSON Schema (e.g., `$ref` pointing to nonexistent definitions), the error surfaces deep inside `json-schema-to-typescript` with an unhelpful stack trace.
