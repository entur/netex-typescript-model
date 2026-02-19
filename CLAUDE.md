# CLAUDE.md

## Project Overview

netex-typescript-model generates TypeScript types and Zod schemas from NeTEx XSD schemas. It is the TypeScript counterpart to `netex-java-model` (which uses JAXB).

## Build Commands

```bash
npm install                # install dependencies
npm run download           # download XSDs from GitHub, extract to xsd/
npm run generate           # generate TypeScript from XSD subset
npm run build              # compile TypeScript
npm run test               # run tests
npm run docs               # generate TypeDoc HTML per slug (requires generate first)
```

## Key Files

- `inputs/config.json` — single source of truth for NeTEx version, GitHub URL, output paths, and XSD subset selection
- `scripts/download.ts` — downloads ZIP from GitHub, extracts `xsd/` directory. Uses `adm-zip` for extraction (no shell dependencies). Annotations are preserved for JSDoc propagation
- `scripts/generate.ts` — orchestrates TypeScript generation from the configured XSD subset. Supports `--part <key>` to enable one optional part for a single run without editing config.json. Required parts (`framework`, `gml`, `siri`, `service`, `publication`) are hardwired and enforced at startup — if config.json is tampered with, the script warns and forces them enabled. After monolithic generation, splits output into per-category modules (siri, reusable, responsibility, generic, core, plus domain parts when enabled)
- `scripts/xsd-to-jsonschema.ts` — custom XSD → JSON Schema converter using fast-xml-parser. Handles xs:include/xs:import by recursive file loading, produces JSON Schema Draft 07 with all NeTEx type definitions. Extracts `xsd:documentation` text into JSON Schema `description` fields, which `json-schema-to-typescript` converts to JSDoc comments
- `scripts/split-output.ts` — post-processes the monolithic TypeScript output into per-category module files with cross-imports. Categories are derived from XSD source directory structure (siri, reusable, responsibility, generic, core; plus network/timetable/fares/new-modes when enabled). Produces a barrel `index.ts` re-exporting all modules
- `scripts/generate-docs.ts` — generates TypeDoc HTML documentation per slug. Discovers slugs in `src/generated/`, creates a slug-specific README for the landing page, runs TypeDoc on the split module files. Output: `src/generated/<slug>/docs/` (gitignored)

## Architecture

### Configuration-Driven

Everything flows from `inputs/config.json`. Scripts read this file to determine:
- Which NeTEx version/branch to download
- Where to put XSDs and generated code
- Which NeTEx parts are enabled (`parts.<key>.enabled`)

### XSD Subset

Full NeTEx 2.0 has 458+ XSD files. The `parts` config toggles which parts to include in generation. All files are loaded (cross-references need to resolve), but only enabled parts produce TypeScript output.

Each part has an `enabled` flag. Framework, GML, SIRI, and service are always required. Domain parts (`part1_network`, `part2_timetable`, `part3_fares`, `part5_new_modes`) are toggled per use case. See `docs/subset-selection-guide.md` for details.

### Generation Pipeline

```
XSD (all files) → xsd-to-jsonschema.ts → JSON Schema (with descriptions) → json-schema-to-typescript → monolithic .ts → split-output.ts → per-category modules → TypeDoc → HTML docs
```

1. All 433 XSD files are parsed (cross-references need the full set)
2. Custom converter (`xsd-to-jsonschema.ts`) builds a global type registry, extracting `xsd:documentation` into JSON Schema `description` fields
3. JSON Schema is filtered to definitions from enabled parts only
4. `json-schema-to-typescript` compiles filtered schema to monolithic TypeScript with JSDoc comments
5. `split-output.ts` splits the monolithic output into per-category modules (siri, reusable, responsibility, generic, core) with cross-imports and a barrel `index.ts`
6. (Future) Zod schemas generated from TypeScript interfaces
7. `npm run docs` generates TypeDoc HTML per slug from the split modules

The custom converter handles `xs:include`/`xs:import` by recursive loading, `xs:extension`/`xs:restriction` via `allOf`/`$ref`, and groups via inline expansion. References to disabled-part types become `unknown` placeholders.

### Custom XSD Parser — Known Limitations

`xsd-to-jsonschema.ts` is a purpose-built converter, not a full XSD implementation. Areas that may need revisiting:

- **Substitution groups** — not modeled. Elements in a substitution group are treated as independent types; the `substitutionGroup` attribute is ignored. This means polymorphic element references (e.g., `<xsd:element ref="Place_"/>` accepting any subtype) won't generate union types. Could be addressed by building a substitution group registry and emitting `oneOf`/`anyOf`.
- **`xsd:any` / `xsd:anyAttribute`** — ignored. Types using open content models will be missing their wildcard properties.
- **Attribute use (`use="required"`)** — not tracked. All attributes are emitted as optional properties.
- **Mixed content** — not handled. Types with `mixed="true"` are treated as regular objects without a text content property.
- **`xsd:redefine`** — not supported (NeTEx doesn't use it).
- **Namespace-qualified property names** — all namespace prefixes are stripped. If two namespaces define the same type name, only the first-loaded wins. In practice this hasn't been an issue because NeTEx and SIRI/GML use distinct naming conventions.
- **Enum values** — extracted correctly from `xsd:restriction`/`xsd:enumeration`, but the generated TypeScript uses string literal unions rather than TypeScript enums.
- **Circular type references** — handled by `json-schema-to-typescript` via `$ref`, but deeply circular NeTEx types (e.g., frames containing frames) may produce overly permissive types.

If generation quality becomes insufficient, alternatives to consider:
1. **Enhance the custom parser** — add substitution group support, attribute `use`, etc.
2. **Use libxmljs2** — full libxml2 bindings with proper XSD schema loading (native dependency)
3. **Pre-flatten XSDs** — merge all same-namespace files into one schema, then use a simpler converter

### Download Pipeline

`scripts/download.ts` does two things in sequence:
1. `fetch()` the GitHub ZIP (cached as `NeTEx-{branch}.zip`)
2. Extract `xsd/*` entries via `adm-zip`

Annotations (`xsd:documentation`) are preserved — the converter reads them for JSDoc propagation.

## Relationship to netex-java-model

This project mirrors the XSD download step of `netex-java-model` but replaces:
- Maven `exec-maven-plugin` → npm scripts + TypeScript
- Shell scripts (`netex-download-extract.sh`, `annotation-replacer.sh`) → `scripts/download.ts` (annotations preserved, not stripped)
- `pom.xml` properties → `inputs/config.json`
- JAXB/cxf-xjc-plugin → custom XSD parser + json-schema-to-typescript

Same upstream source: `https://github.com/NeTEx-CEN/NeTEx` branch `next`.

## Gitignored Artifacts

- `xsd/` — downloaded XSD schemas
- `NeTEx-*.zip` — cached download
- `src/generated/` — generated TypeScript/Zod output
- `node_modules/`, `dist/`
