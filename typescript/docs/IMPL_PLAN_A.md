# Plan: Implement Step 2 — XSD → TypeScript interfaces

## Context

`scripts/generate.ts` lines 216-218 are a stub for Step 2 (XSD → TypeScript). The original plan was to use `cxsd`, but cxsd lacks substitution group support — a blocker for NeTEx which uses them extensively. We'll use **xsd2jsonschema** (XSD → JSON Schema) + **json-schema-to-typescript** (JSON Schema → TypeScript interfaces) instead.

## Pre-step: make SIRI a required part

SIRI is only 12 files / 2,204 lines but `NeTEx_publication.xsd` unconditionally imports 3 SIRI files. Making it optional adds stub complexity for no real benefit. Matches netex-java-model which always includes SIRI.

Changes:
- `inputs/config.json`: set `siri.required: true`, `siri.enabled: true`
- `scripts/generate.ts`: add `"siri"` to `REQUIRED_PARTS`
- `inputs/config.json`: add `netex_service` dir to siri's dirs (or add a new required `service` part) — the 4 `netex_service/*.xsd` files are also always needed

## Key design decision: respect config.json subset toggles

Config toggles control which parts produce generated TypeScript. Cross-dependencies require careful handling:

- `netex_all.xsd` includes aggregators for all parts
- `netex_filter_frame.xsd` hard-includes `netex_part_1/.../netex_line_support.xsd`

**Strategy: load all XSDs for reference resolution, but only emit TypeScript for enabled parts.**

1. Load all 458 XSD files into memory (cross-references need to resolve)
2. Replace `netex_service/netex_all.xsd` with a synthetic version including only enabled parts
3. Feed everything to xsd2jsonschema
4. Filter output: only convert JSON Schemas to TypeScript for files belonging to enabled parts

This matches how netex-java-model works (loads everything, JAXB resolves all refs), but our output is scoped to the configured subset.

## Implementation steps

### 1. Install dependencies

```bash
npm install --save-dev xsd2jsonschema json-schema-to-typescript
```

- `xsd2jsonschema@^0.3.7` — CJS package, import via `createRequire`
- `json-schema-to-typescript@^15` — ESM-compatible, async `compile()` API

### 2. Config changes

**`inputs/config.json`:**
- Add `"generatedJsonSchema": "src/generated/jsonschema"` to `paths`
- Set `siri.enabled: true, siri.required: true`
- Add `netex_service` to the always-included dirs (either in siri or as separate required part)

### 3. Changes to `scripts/generate.ts`

**Constants:** Add `"siri"` to `REQUIRED_PARTS`.

**Config class additions:**
- `readonly generatedJsonSchema: string` property
- `collectAllXsdFiles(): Map<string, string>` — walks **all** dirs under `xsdRoot`, returns `{relativePath → content}` map with forward-slash URIs
- `buildSyntheticNetexAll(): string` — generates replacement `netex_all.xsd` with only enabled part includes
- `isEnabledPath(uri: string): boolean` — returns true if a URI belongs to an enabled part dir or root XSD. Used to filter output.

**New async functions:**
- `generateJsonSchemas(config)` — loads all XSDs, injects synthetic netex_all.xsd, feeds to xsd2jsonschema, returns `Map<string, object>`
- `persistJsonSchemas(schemas, config)` — writes to `src/generated/jsonschema/`
- `generateTypeScript(schemas, config)` — filters by `isEnabledPath()`, runs `compile()` per schema, writes `.ts` files to `src/generated/interfaces/`
- `cleanGeneratedDirs(config)` — rm + mkdir for idempotency

Replace stub lines 216-222. Script becomes async (top-level await).

### 4. xsd2jsonschema invocation

```typescript
const xsdFiles = config.collectAllXsdFiles();
xsdFiles.set("netex_service/netex_all.xsd", config.buildSyntheticNetexAll());

const converter = new Xsd2JsonSchema();
for (const [uri, content] of xsdFiles) {
  converter.processSchema(uri, content);
}
```

Fallback if batch doesn't work: process root `NeTEx_publication.xsd` and let library resolve from filesystem.

#### Synthetic `netex_all.xsd`

```xml
<!-- Always: framework -->
<xsd:include schemaLocation="../netex_framework/netex_frames/netex_all_frames_framework.xsd"/>
<!-- Only if part1_network enabled: -->
<xsd:include schemaLocation="../netex_part_1/..."/>
<!-- Filter files only if Part 1 enabled (they depend on Part 1): -->
<xsd:include schemaLocation="netex_filter_frame.xsd"/>
```

### 5. Output filtering + TypeScript generation

```typescript
for (const [uri, schema] of jsonSchemas) {
  if (!config.isEnabledPath(uri)) continue;
  const tsCode = await compile(schema, deriveTypeName(uri), { ... });
  // Write to src/generated/interfaces/<mirrored-path>.ts
}
```

`isEnabledPath()`: URI starts with any enabled part's dir → ✅, matches enabled root XSD → ✅, else → ❌

### 6. Error handling

| Scenario | Action |
|---|---|
| XSD dir missing | Error: "run `npm run download` first" |
| xsd2jsonschema fails on a file | Log warning, skip, report at end |
| compile error | Log warning per file, skip, continue |

### 7. Update docs

- `CLAUDE.md`: pipeline now uses xsd2jsonschema + json-schema-to-typescript
- `README.md`: update generation pipeline description
- `docs/subset-selection-guide.md`: clarify load-all/filter-output strategy, SIRI now required

## Critical files

- `scripts/generate.ts` — ~200 lines added
- `inputs/config.json` — add jsonschema path, SIRI required
- `package.json` — add 2 devDependencies

## Verification

1. **Smoke test**: `npm run generate` with default config. Check output dirs have files from framework, gml, siri, service only — NOT from part1-5.
2. **Compile check**: `npx tsc --noEmit` on generated interfaces.
3. **Inspect output**: Check a known type (e.g., `MultilingualString`) for reasonableness.
4. **Subset test**: generate with `--parts part5_new_modes`, verify Part 5 appears in output.

## Risks

- **xsd2jsonschema is 6 years old** — may not handle all NeTEx features. Fallback: custom XSD parser or `xuri/xgen`.
- **Substitution groups** — mapped to `oneOf`/`anyOf`, may be overly permissive. Acceptable first pass.
- **Circular `$ref`** — json-schema-to-typescript handles cycles but may emit `any` at break points.
- **Unresolved `$ref`** — TypeScript for enabled parts may reference disabled parts as `any`/`unknown`. Expected.

## Tool research summary

| Tool | Output | Substitution groups | Maintenance | Verdict |
|------|--------|-------------------|-------------|---------|
| cxsd | TypeScript .d.ts | ❌ Not supported | Low activity | Rejected |
| Modelina | TypeScript | ❌ Not supported | Active | Rejected |
| xsd2ts | TypeScript | ❓ Unknown | Unknown | Insufficient info |
| xsdata | Python only | ✅ Full support | Active | Wrong language |
| **xsd2jsonschema** | **JSON Schema** | **⚠️ Partial** | **Stable** | **Chosen (step 1)** |
| **json-schema-to-typescript** | **TypeScript** | **N/A** | **Active (14M/wk)** | **Chosen (step 2)** |
| @kie-tools/xml-parser-ts-codegen | TypeScript | ✅ Via unions | Active | Not tested on arbitrary XSD |
| xuri/xgen | Multi-lang | ❓ Unknown | Active | Backup option |
