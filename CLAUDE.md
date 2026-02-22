# CLAUDE.md

## Project Overview

netex-typescript-model generates TypeScript interfaces from NeTEx XSD schemas. It is the TypeScript counterpart to `netex-java-model` (which uses JAXB). TypeDoc API documentation is deployed to GitHub Pages via CI.

The project has two sub-directories:
- **`typescript/`** — Node.js/TypeScript pipeline (npm scripts, fast-xml-parser, json-schema-to-typescript)
- **`json-schema/`** — GraalVM JavaScript pipeline (Maven, Java DOM, feature-parity port of the TS converter)

Shared artifacts live at the repo root: `xsd/` (downloaded schemas), `NeTEx-*.zip` (cached download).

## Build Commands

### typescript/ (Node.js pipeline)

```bash
cd typescript
npm install                # install dependencies
npm run download           # download XSDs from GitHub, extract to xsd/
npm run generate           # generate TypeScript from XSD subset (includes JSON Schema validation)
npm run build              # compile TypeScript
npm run test               # run tests (vitest)
npm run docs               # generate TypeDoc HTML per assembly (requires generate first)
```

### json-schema/ (GraalVM pipeline)

Requires JDK 21+ (any distribution — GraalVM not required). Maven resolves GraalJS polyglot dependencies.

```bash
cd json-schema
mvn generate-resources                    # download JARs, write classpath.txt
mvn exec:exec -Dscript.args="../xsd/2.0 /tmp/out ../typescript/inputs/config.json"
./verify-parity.sh                        # compare output against typescript/ reference
```

## Key Files

### typescript/

- `inputs/config.json` — single source of truth for NeTEx version, GitHub URL, output paths, and XSD subset selection
- `scripts/download.ts` — downloads ZIP from GitHub, extracts `xsd/` directory. Uses `adm-zip` for extraction (no shell dependencies). Annotations are preserved for JSDoc propagation
- `scripts/lib/config.ts` — shared configuration module: `Config` class, `PartConfig`/`RootXsdConfig` interfaces, `REQUIRED_PARTS`, `REQUIRED_ROOT_XSDS`, `NATURAL_NAMES`, and `resolveAssembly()`. Imported by both `generate.ts` and the `xsd-to-jsonschema.ts` CLI
- `scripts/generate.ts` — orchestrates TypeScript generation from the configured XSD subset. Supports `--schema-source <path>` to use a pre-generated JSON Schema instead of running the XSD converter (the schema must contain `"x-netex-assembly"` identifying the assembly; skips category split since no typeSourceMap is available). Required parts (`framework`, `gml`, `siri`, `service`, `publication`) are hardwired and enforced at startup — if config.json is tampered with, the script warns and forces them enabled. After monolithic generation, splits output into per-category modules (when typeSourceMap is available), then type-checks the result. Injects `@see` links into each definition's JSDoc pointing to the published JSON Schema HTML viewer (the persisted JSON stays clean — only the TypeScript output gets the links)
- `scripts/xsd-to-jsonschema.ts` — custom XSD → JSON Schema converter using fast-xml-parser. Handles xs:include/xs:import by recursive file loading, produces JSON Schema Draft 07 with all NeTEx type definitions. Extracts `xsd:documentation` text into JSON Schema `description` fields, which `json-schema-to-typescript` converts to JSDoc comments. Stamps `"x-netex-assembly"` in the output schema. Also runnable standalone: `npx tsx scripts/xsd-to-jsonschema.ts <xsdRoot> <outDir> [configPath] [--parts <key,key,...>]` (mirrors json-schema/'s CLI interface; `--parts` requires configPath)
- `scripts/split-output.ts` — post-processes the monolithic TypeScript output into per-category module files with cross-imports. Categories are derived from XSD source directory structure (siri, reusable, responsibility, generic, core; plus network/timetable/fares/new-modes when enabled). Produces a barrel `index.ts` re-exporting all modules
- `scripts/validate-generated-schemas.ts` — validates all generated JSON Schema files in `src/generated/` against the Draft 07 meta-schema using ajv. Run automatically as part of `npm run generate`
- `scripts/generate-docs.ts` — generates TypeDoc HTML documentation per assembly. Discovers assemblies in `src/generated/`, creates an assembly-specific README for the landing page, runs TypeDoc on the split module files. Output: `src/generated/<assembly>/docs/` (gitignored)
- `scripts/build-schema-html.ts` — generates a self-contained HTML viewer per assembly from `src/generated/<assembly>/jsonschema/<assembly>.schema.json`. Features: sidebar with search, per-definition sections with permalink anchors, syntax-highlighted JSON with clickable `$ref` links, dark/light mode, responsive layout. Output: `src/generated/<assembly>/netex-schema.html`
- `scripts/build-docs-index.ts` — assembles a `docs-site/` directory for GitHub Pages deployment. Copies each assembly's TypeDoc output and schema HTML into `docs-site/<assembly>/` and generates a welcome `index.html` listing all assemblies with descriptions, stats, and links to both TypeDoc and JSON Schema viewer
- `.github/workflows/docs.yml` — CI workflow that generates all parts (base + each optional part individually), builds TypeDoc per assembly, assembles the docs site, and deploys to GitHub Pages

### json-schema/

- `pom.xml` — Maven POM with `pom` packaging (no Java source). Declares GraalJS + Xerces dependencies, uses `maven-dependency-plugin` to write classpath, `exec-maven-plugin` to invoke `JSLauncher` on stock JDK 21+
- `xsd-to-jsonschema.js` — feature-parity port of `typescript/scripts/xsd-to-jsonschema.ts`. Uses `Java.type()` for DOM parsing (`DocumentBuilderFactory`, `org.w3c.dom.Node`) instead of fast-xml-parser. Plain JavaScript, no modules, no npm
- `verify-parity.sh` — runs both pipelines and diffs JSON Schema output (key-order normalized via `jq`)

## Architecture

### Configuration-Driven

Everything flows from `typescript/inputs/config.json`. Scripts read this file to determine:
- Which NeTEx version/branch to download
- Where to put XSDs and generated code
- Which NeTEx parts are enabled (`parts.<key>.enabled`)

### XSD Subset

Full NeTEx 2.0 has 458+ XSD files. The `parts` config toggles which parts to include in generation. All files are loaded (cross-references need to resolve), but only enabled parts produce TypeScript output.

Each part has an `enabled` flag. Framework, GML, SIRI, and service are always required. Domain parts (`part1_network`, `part2_timetable`, `part3_fares`, `part5_new_modes`) are toggled per use case. See `typescript/docs/subset-selection-guide.md` for details.

### Output Assemblies

Each `npm run generate` invocation writes to `typescript/src/generated/<assembly>/` where the assembly name reflects which optional parts are enabled:
- `base` — only required parts (no optional parts enabled)
- `network` — base + part1_network
- `fares+network` — base + part1_network + part3_fares
- etc.

The CI workflow generates each optional part individually (base, network, timetable, fares, new-modes) to produce separate TypeDoc sites.

### Generation Pipeline (typescript/)

```
XSD (all files) → xsd-to-jsonschema.ts → JSON Schema (with descriptions)
  → persist clean JSON Schema
  → inject @see links into clone → json-schema-to-typescript → monolithic .ts (with schema links in JSDoc)
  → split-output.ts → per-category modules
  → tsc --noEmit (type-check)
  → validate-generated-schemas.ts (JSON Schema validation)
```

1. All 433 XSD files are parsed (cross-references need the full set)
2. Custom converter (`xsd-to-jsonschema.ts`) builds a global type registry, extracting `xsd:documentation` into JSON Schema `description` fields
3. JSON Schema is filtered to definitions from enabled parts only, stamped with `"x-netex-assembly"`, and persisted to disk as `<assembly>.schema.json` (clean, no links)
4. A cloned schema gets `@see` links injected into each definition's `description`, pointing to the published JSON Schema HTML viewer
5. `json-schema-to-typescript` compiles the linked schema to monolithic TypeScript with JSDoc comments (including `@see` links)
6. `split-output.ts` splits the monolithic output into per-category modules (siri, reusable, responsibility, generic, core, plus domain parts) with cross-imports and a barrel `index.ts`
7. `tsc --noEmit` validates all split modules compile without errors
8. `validate-generated-schemas.ts` validates the generated JSON Schema against the Draft 07 meta-schema

### Generation Pipeline (json-schema/)

```
XSD (all files) → xsd-to-jsonschema.js (Java DOM) → JSON Schema (with descriptions)
```

Same algorithm as the TS version, but uses Java standard library DOM APIs via GraalVM interop. Only produces JSON Schema — the TypeScript generation, splitting, and docs steps remain in `typescript/`.

### Documentation Pipeline

```
npm run docs → generate-docs.ts → TypeDoc HTML per assembly → src/generated/<assembly>/docs/
npx tsx scripts/build-schema-html.ts → src/generated/<assembly>/netex-schema.html (per assembly)
npx tsx scripts/build-docs-index.ts → docs-site/ (welcome page + assembly TypeDoc + schema HTML)
```

The CI workflow (`.github/workflows/docs.yml`) runs all three, then deploys `docs-site/` to GitHub Pages. Generated TypeScript JSDoc includes `@see` links to the schema HTML viewer, creating a two-way bridge between TypeDoc and JSON Schema.

### Custom XSD Parser — Known Limitations

`xsd-to-jsonschema.ts` (and its JS port) is a purpose-built converter, not a full XSD implementation. Areas that may need revisiting:

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

`typescript/scripts/download.ts` does two things in sequence:
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
- `typescript/src/generated/` — generated TypeScript output (per-assembly directories)
- `typescript/dist/` — compiled TypeScript
- `docs-site/` — assembled GitHub Pages site
- `node_modules/`
- `json-schema/target/` — Maven build output
