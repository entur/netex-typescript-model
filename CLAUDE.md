# CLAUDE.md

## Project Overview

netex-typescript-model generates TypeScript interfaces from NeTEx XSD schemas. It is the TypeScript counterpart to `netex-java-model` (which uses JAXB). TypeDoc API documentation is deployed to GitHub Pages via CI.

The project has two sub-directories:
- **`typescript/`** — Node.js/TypeScript pipeline (npm scripts, json-schema-to-typescript, TypeDoc)
- **`json-schema/`** — GraalVM JavaScript pipeline (Maven, Java DOM — the primary XSD → JSON Schema converter)

A root `Makefile` orchestrates the full pipeline: XSD download → JSON Schema → schema HTML → TypeScript interfaces → TypeDoc. `make all` runs everything.

Shared artifacts live at the repo root: `xsd/` (downloaded schemas), `generated-src/` (output), `assembly-config.json` (configuration).

## Build Commands

### Quick start (Makefile)

```bash
cd typescript && npm install     # install Node.js dependencies (once)
make all                         # full pipeline: XSD → JSON Schema → HTML → TypeScript → TypeDoc
make all ASSEMBLY=network        # generate a variant (parts derived from assembly name)
```

### TypeScript interface generation (standalone)

```bash
cd typescript
npx tsx scripts/generate.ts ../generated-src/base/base.schema.json
```

Or via Makefile: `make types ASSEMBLY=base`

### json-schema/ (GraalVM pipeline + XSD download)

Requires JDK 21+ (any distribution — GraalVM not required). Maven resolves GraalJS polyglot dependencies.

```bash
cd json-schema
mvn initialize                            # download XSDs from GitHub, extract to xsd/
mvn generate-resources                    # download JARs, write classpath.txt
mvn exec:exec -Dscript.args="../xsd/2.0 /tmp/out ../assembly-config.json"
```

### typescript/ (Node.js pipeline)

```bash
cd typescript
npm install                # install dependencies
npm run test               # run tests (vitest)
npm run docs               # generate TypeDoc HTML per assembly (requires generated interfaces)
```

## Key Files

### Root

- `assembly-config.json` — single source of truth for NeTEx version, GitHub URL, output paths, and XSD subset selection
- `Makefile` — build orchestrator: XSD download → JSON Schema → schema HTML → TypeScript → TypeDoc → tarball. Parses `NETEX_VERSION`/`NETEX_BRANCH` from config. Key targets: `all`, `schema`, `types`, `docs`, `tarball`, `clean`. The schema HTML target depends on both the JSON Schema file and the embedded source files (`build-schema-html.ts`, `schema-viewer-fns.ts`, `schema-viewer-bundle-entry.ts`, `schema-viewer-host-app.js`, `schema-viewer.css`) so edits to viewer logic trigger a rebuild
- `tsconfig.generated.json` — type-check configuration for generated output in `generated-src/`
- `TODO.md` — project roadmap and planned improvements

### typescript/

- `scripts/lib/config.ts` — shared configuration module: `Config` class, `PartConfig`/`RootXsdConfig` interfaces, `REQUIRED_PARTS`, `REQUIRED_ROOT_XSDS`, `NATURAL_NAMES`, and `resolveAssembly()`. `applyCliParts()` accepts both config keys (`part1_network`) and natural names (`network`)
- `scripts/lib/schema-viewer-fns.ts` — pure functions shared between the schema HTML viewer and unit tests. **Keep this description in sync when editing the file.** Internal helpers: `deref` (strip `#/definitions/` prefix), `allOfRef` (first `$ref` in allOf), `classifySchema` (discriminated `SchemaShape` union — single-pass classification used by `resolveType`, `isRefType`, `refTarget`, `resolvePropertyType`), `tryGenShallowMock` (single-pass shallow-complex mock builder — calls `flattenAllOf` once, bails with `null` if any prop is complex, otherwise returns the filled mock object; used for simpleObj atoms and shallow-complex array/ref handling in `genMockObject`). Exports: type introspection (`resolveType`, `isRefType`, `refTarget`), mixed-content detection (`unwrapMixed`), inheritance walking (`flattenAllOf`, `collectRequired`, `buildInheritanceChain`), deep type resolution (`resolveDefType`, `resolvePropertyType`, `resolveAtom`), interface inlining (`inlineSingleRefs` — expands 1-to-1 `$ref` properties by splicing the target's own props into the parent; skips collection-role, reference-role, and atom targets so transparent wrappers like `PrivateCodeStructure` stay as single properties), reverse index (`buildReverseIndex`, `findTransitiveEntityUsers` — takes an `isTarget` predicate), relations tab helpers (`resolveRefEntity` — resolves a reference def to its target entity/entities with cycle-safe abstract expansion via `x-netex-sg-members`; `collectRefProps` — walks `flattenAllOf` to find ref-typed properties with resolvable entity targets; `collectExtraProps` — finds properties an entity's structure adds beyond a base structure by walking the allOf chain), role filter logic (`defRole`, `countRoles`, `presentRoles`, `ROLE_DISPLAY_ORDER`, `ROLE_LABELS`), code-generation helpers (`defaultForType`, `lcFirst`), sample data generation (`serializeValue` — converts canonical `$`-prefixed props to fast-xml-parser `@_`-prefixed shape; `genMockObject` — builds a fully populated mock object from JSON Schema defs using `flattenAllOf` and type resolution; `buildXmlString` — formats a mock object as XML via `fast-xml-parser`'s `XMLBuilder`). `resolveDefType` uses `x-netex-*` stamps to drive resolution: `x-netex-atom:"array"` resolves list items, `x-netex-role:"enumeration"` stops at the enum name, `x-netex-atom` collapses simpleContent wrappers. Bundled via esbuild into an IIFE with `globalName: "_viewerBundle"` (including `fast-xml-parser`) and embedded in the HTML page via the `/*@@VIEWER_FNS@@*/` placeholder in `schema-viewer-host-app.js`. Bound wrappers close over the page-level `defs` variable so the host app can call functions without passing `defs` explicitly
- `scripts/lib/schema-viewer-bundle-entry.ts` — esbuild entry point that re-exports all public functions from `schema-viewer-fns.ts`. esbuild bundles this into a single IIFE for embedding in the HTML page
- `scripts/lib/schema-viewer-host-app.js` — browser-side controller for the self-contained `netex-schema.html` page. Read by `build-schema-html.ts` and embedded verbatim inside a `<script>` tag after the `/*@@VIEWER_FNS@@*/` placeholder is replaced with the esbuild-bundled viewer-fns IIFE. Key internal structures: `TAB_MAP` (maps tab `data-tab` keys to panel element IDs — includes `relations` for the bipartite entity graph), `attachCopyHandler(container)` (shared copy-to-clipboard wiring for code blocks). Responsibilities: sidebar search and role-chip filtering, explorer panel lifecycle (open/close, tab switching via `TAB_MAP`, resize), HTML builders for explorer tabs (graph SVG diagram, relations bipartite graph with ref-property dropdown, interface, mapping converters, utilities with type guard/factory/references, sample data with JS/XML toggle), "Used by entities" dropdown (BFS via `findTransitiveEntityUsers`), via-chain hover popup on interface properties
- `scripts/lib/schema-viewer.css` — extracted CSS for the schema HTML viewer page (variables, sidebar, main content, explorer panel, tabs, buttons, resize handles, dark/light mode). Read by `build-schema-html.ts` and embedded in a `<style>` tag
- `scripts/generate.ts` — JSON Schema → TypeScript transformer. Takes a positional schema path argument. Builds the type source map from per-definition `x-netex-source` annotations in the schema, then generates monolithic TypeScript, splits into per-category modules, and type-checks. Injects `@see` links into each definition's JSDoc pointing to the published JSON Schema HTML viewer (the persisted JSON stays clean — only the TypeScript output gets the links)
- `scripts/split-output.ts` — post-processes the monolithic TypeScript output into per-category module files with cross-imports. Categories are derived from XSD source directory structure (siri, reusable, responsibility, generic, core; plus network/timetable/fares/new-modes when enabled). Produces a barrel `index.ts` re-exporting all modules
- `scripts/validate-generated-schemas.ts` — validates all generated JSON Schema files in `generated-src/` against the Draft 07 meta-schema using ajv
- `scripts/generate-docs.ts` — generates TypeDoc HTML documentation per assembly. Discovers assemblies in `generated-src/`, creates an assembly-specific README for the landing page, runs TypeDoc on the split module files. Output: `generated-src/<assembly>/docs/` (gitignored)
- `scripts/build-schema-html.ts` — generates a self-contained HTML viewer per assembly from `generated-src/<assembly>/<assembly>.schema.json`. Assembles the page from three extracted files: `schema-viewer.css` (embedded in `<style>`), `schema-viewer-bundle-entry.ts` (bundled via esbuild into an IIFE including `fast-xml-parser`, spliced into `/*@@VIEWER_FNS@@*/`), and `schema-viewer-host-app.js` (embedded in `<script>`). Also generates the HTML structure: sidebar with search and role-based filter chips, per-definition sections with permalink anchors, syntax-highlighted JSON with clickable `$ref` links, explorer panel, role help popup. Output: `generated-src/<assembly>/netex-schema.html`
- `scripts/build-docs-index.ts` — assembles a `docs-site/` directory for GitHub Pages deployment. Copies each assembly's TypeDoc output and schema HTML into `docs-site/<assembly>/` and generates a welcome `index.html` listing all assemblies with descriptions, stats, and links to both TypeDoc and JSON Schema viewer
- `.github/workflows/docs.yml` — CI workflow that builds `base`, `network+timetable`, and `base@ResourceFrame@tiny` assemblies via `make all`, then deploys TypeDoc + schema HTML to GitHub Pages
- `.github/workflows/release.yml` — tag-triggered (`v*`) release workflow: builds the same assemblies, packages `.tgz` tarballs, creates GitHub Release

### json-schema/

- `pom.xml` — Maven POM with `pom` packaging (no Java source). Downloads NeTEx XSDs via `maven-antrun-plugin` in `initialize` phase (Ant `<get>` + `<unzip>`). Declares GraalJS + Xerces dependencies, uses `maven-dependency-plugin` to write classpath, `exec-maven-plugin` to invoke `JSLauncher` on stock JDK 21+
- `xsd-to-jsonschema.js` — **primary** XSD → JSON Schema converter (invoked via Makefile). Uses `Java.type()` for DOM parsing (`DocumentBuilderFactory`, `org.w3c.dom.Node`). Plain JavaScript, no modules, no npm. The canonical implementation. Stamps ten `x-netex-*` annotations on definitions: `x-netex-source`, `x-netex-assembly`, `x-netex-role`, `x-netex-atom`, `x-netex-frames`, `x-netex-mixed`, `x-netex-substitutionGroup`, `x-netex-sg-members`, `x-netex-refTarget`, `x-netex-collapsed`. Supports `--parts` (config keys or natural names), `--sub-graph <TypeName>` (prune to reachable definitions), and `--collapse` (collapse transparent wrappers in sub-graphs). See `json-schema/README.md` for full annotation documentation

## Architecture

### Configuration-Driven

Everything flows from `assembly-config.json` at the repo root. Scripts read this file to determine:
- Which NeTEx version/branch to download
- Where to put XSDs and generated code
- Which NeTEx parts are enabled (`parts.<key>.enabled`)

### XSD Subset

Full NeTEx 2.0 has 458+ XSD files. The `parts` config toggles which parts to include in generation. All files are loaded (cross-references need to resolve), but only enabled parts produce TypeScript output.

Each part has an `enabled` flag. Framework, GML, SIRI, and service are always required. Domain parts (`part1_network`, `part2_timetable`, `part3_fares`, `part5_new_modes`) are toggled per use case. See `docs/subset-selection-guide.md` for details.

### Output Assemblies

Generated output is written to `generated-src/<assembly>/` where the assembly name reflects which optional parts are enabled:
- `base` — only required parts (no optional parts enabled)
- `network` — base + part1_network
- `fares+network` — base + part1_network + part3_fares
- etc.

The CI workflow (`docs.yml`) builds `base`, `network+timetable`, and `base@ResourceFrame@tiny` (collapsed sub-graph) assemblies. The release workflow (`release.yml`) builds the same assemblies and packages them as tarballs on `v*` tag push.

### Generation Pipeline

The pipeline is split into two decoupled stages:

**Stage 1: XSD → JSON Schema (Makefile / json-schema/)**
```
XSD (all files) → xsd-to-jsonschema.js (Java DOM) → JSON Schema (with descriptions, x-netex-source)
  → validate-generated-schemas.ts (JSON Schema validation)
  → build-schema-html.ts → netex-schema.html
```

**Stage 2: JSON Schema → TypeScript (typescript/)**
```
JSON Schema → generate.ts → inject @see links into clone
  → json-schema-to-typescript → monolithic .ts
  → split-output.ts → per-category modules
  → tsc --noEmit -p tsconfig.generated.json (type-check)
```

Each definition in the JSON Schema carries an `x-netex-source` annotation identifying the XSD file it came from. `generate.ts` reads these to build the source map for splitting into per-category modules.

### Generation Pipeline (json-schema/)

```
XSD (all files) → xsd-to-jsonschema.js (Java DOM) → JSON Schema (with descriptions, annotations)
```

Primary conversion path. Uses Java standard library DOM APIs via GraalVM interop. Stamps ten per-definition annotations: `x-netex-source` (origin XSD file), `x-netex-role` (entity, structure, reference, enumeration, abstract, collection, view, frameMember), `x-netex-atom` (atom type for transparent wrappers — primitive string for value-only simpleContent types, `"simpleObj"` for multi-prop simpleContent, `"array"` for `xsd:list` types), `x-netex-frames` (frame membership list), `x-netex-mixed` (mixed content flag), `x-netex-substitutionGroup` (head element name), `x-netex-sg-members` (member list on head elements), `x-netex-refTarget` (target element name for reference-role defs, e.g. `TransportTypeRef` → `"TransportType"`), and `x-netex-collapsed` (count, set by `--collapse` pass). The schema HTML viewer uses these annotations for role filtering, type resolution (stamped enumerations stop at the name rather than expanding to literal unions; stamped arrays resolve their items), and transitive entity usage lookups. Optional `--sub-graph <TypeName>` prunes the schema to definitions reachable from a root type; `--collapse` then inlines transparent wrappers.

### Documentation Pipeline

```
npm run docs → generate-docs.ts → TypeDoc HTML per assembly → generated-src/<assembly>/docs/
build-schema-html.ts → generated-src/<assembly>/netex-schema.html (per assembly)
build-docs-index.ts → docs-site/ (welcome page + assembly TypeDoc + schema HTML)
```

The CI workflow (`.github/workflows/docs.yml`) runs all three, then deploys `docs-site/` to GitHub Pages. Generated TypeScript JSDoc includes `@see` links to the schema HTML viewer, creating a two-way bridge between TypeDoc and JSON Schema.

### Release Pipeline

Triggered by pushing a `v*` tag. Builds each assembly via `make all tarball`, runs tests, and creates a GitHub Release with `.tgz` tarballs attached. Tarball naming: `netex-<netex_version>-<branch>-<assembly>-v<tag>.tgz`. The `VERSION` variable is extracted from the tag by stripping the `v` prefix.

### Custom XSD Parser — Known Limitations

`json-schema/xsd-to-jsonschema.js` is a purpose-built converter, not a full XSD implementation. Areas that may need revisiting:

- **Substitution groups** — partially modeled. The converter reads `substitutionGroup` attributes, builds a reverse registry, and stamps `x-netex-substitutionGroup` / `x-netex-sg-members` annotations. These drive entity classification (rule 8) and sub-graph pruning. However, polymorphic element references (e.g., `<xsd:element ref="Place_"/>` accepting any subtype) don't yet generate `oneOf`/`anyOf` union types.
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

`json-schema/pom.xml` handles XSD download via `maven-antrun-plugin` bound to the `initialize` phase:
1. Ant `<get skipexisting="true">` downloads the GitHub ZIP (cached in `target/`)
2. Ant `<unzip>` extracts `xsd/` entries with a glob mapper to strip the archive prefix

Run with `cd json-schema && mvn initialize` or `make xsd/2.0/NeTEx_publication.xsd`. Annotations (`xsd:documentation`) are preserved — the converter reads them for JSDoc propagation.

## Relationship to netex-java-model

This project mirrors the XSD download step of `netex-java-model` but replaces:
- Shell scripts (`netex-download-extract.sh`, `annotation-replacer.sh`) → `maven-antrun-plugin` in `json-schema/pom.xml` (annotations preserved, not stripped)
- JAXB/cxf-xjc-plugin → custom XSD parser + json-schema-to-typescript

Same upstream source: `https://github.com/NeTEx-CEN/NeTEx` branch `v2.0`.

## Gitignored Artifacts

- `xsd/` — downloaded XSD schemas
- `NeTEx-*.zip` — cached download
- `generated-src/` — generated output (per-assembly directories)
- `typescript/dist/` — compiled TypeScript
- `docs-site/` — assembled GitHub Pages site
- `node_modules/`
- `json-schema/target/` — Maven build output
