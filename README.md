# netex-typescript-model

## Experimental / Work-in-progress !!

TypeScript interfaces generated from [NeTEx](http://netex-cen.eu/) (Network Timetable Exchange) XSD schemas. Sibling project to [netex-java-model](https://github.com/entur/netex-java-model).

**[API Documentation](https://entur.github.io/netex-typescript-model/)** — TypeDoc for every NeTEx part, generated and deployed automatically via GitHub Actions.

See the [Subset Selection Guide](docs/subset-selection-guide.md) for how to choose which parts of the NeTEx standard to include and deployment options.

## Quick Start

```bash
npm install
npm run download   # fetch NeTEx 2.0 XSDs from GitHub
npm run generate   # generate TypeScript types from XSD subset
npm run docs       # generate TypeDoc HTML per slug
```

## How It Works

### Download Pipeline (`npm run download`)

1. Downloads the NeTEx XSD ZIP from GitHub (`next` branch)
2. Extracts only the `xsd/` directory into `xsd/2.0/`

Annotations (`xsd:documentation`) are preserved — the converter reads them and propagates them as JSDoc comments in the generated TypeScript. The ZIP is cached locally (`NeTEx-next.zip`) — delete it to force re-download.

### Generation Pipeline (`npm run generate`)

1. **Parse all XSD files** — recursively loads all 433 XSD files starting from `NeTEx_publication.xsd` (cross-references need the full set)
2. **XSD → JSON Schema** — custom converter (`scripts/xsd-to-jsonschema.ts`) using `fast-xml-parser`, filtered to enabled parts. Extracts `xsd:documentation` into JSON Schema `description` fields
3. **JSON Schema → TypeScript** — via `json-schema-to-typescript`, producing a monolithic `.ts` file with JSDoc comments
4. **Split into modules** — `scripts/split-output.ts` splits the monolithic output into per-category modules (siri, reusable, responsibility, generic, core, plus domain parts) with cross-imports and a barrel `index.ts`
5. **Type-check** — runs `tsc --noEmit` to validate all split modules compile without errors
6. **Validate JSON Schema** — `scripts/validate-generated-schemas.ts` validates the generated JSON Schema against the Draft 07 meta-schema using ajv

Only definitions from enabled parts are included in the output. References to disabled-part types become `unknown` placeholders.

Output is written to `src/generated/<slug>/` where `<slug>` reflects the enabled parts (e.g. `base`, `network`, `fares+network`).

### Documentation Pipeline (`npm run docs`)

1. **TypeDoc generation** — `scripts/generate-docs.ts` discovers slugs in `src/generated/`, runs TypeDoc on the split module files. Output: `src/generated/<slug>/docs/`
2. **JSON Schema HTML viewer** — `scripts/build-schema-html.ts` generates a self-contained HTML page per slug with a searchable, syntax-highlighted JSON Schema browser. `$ref` values are rendered as clickable links. Output: `src/generated/<slug>/netex-schema.html`
3. **Docs site assembly** — `scripts/build-docs-index.ts` copies each slug's TypeDoc output and schema HTML into `docs-site/<slug>/` and generates a welcome `index.html` with links to both

Generated TypeScript JSDoc includes `@see` links pointing to the JSON Schema viewer, creating a two-way bridge between TypeDoc and JSON Schema definitions.

The [GitHub Actions workflow](.github/workflows/docs.yml) generates all parts (base + each optional part individually), builds TypeDoc and schema HTML per slug, and deploys to GitHub Pages on every push to `main`.

## XSD Subset

NeTEx 2.0 contains 458+ XSD files across several functional parts. Generation is restricted to the parts you enable in `inputs/config.json`. The framework, GML, SIRI, service, and publication entry point are always required; the domain-specific parts are toggled individually:

| Part key | XSD directory | Files | Domain |
|---|---|---|---|
| `framework` | `netex_framework` | 143 | Base types, reusable components, organizations (always required) |
| `gml` | `gml` | 7 | Geographic coordinates (always required) |
| `siri` | `siri` + `siri_utility` | 12 | Real-time updates (always required — imported by NeTEx_publication.xsd) |
| `service` | `netex_service` | 4 | NeTEx service definitions and filters (always required) |
| `part1_network` | `netex_part_1` | 93 | Routes, lines, stop places, timing patterns |
| `part2_timetable` | `netex_part_2` | 56 | Service journeys, passing times, vehicle services |
| `part3_fares` | `netex_part_3` | 92 | Fare products, pricing, distribution, sales |
| `part5_new_modes` | `netex_part_5` | 32 | Mobility services, vehicle meeting points (Part 4 was never published) |

Enable a part by setting `"enabled": true` in its config entry. See the [Subset Selection Guide](docs/subset-selection-guide.md) for dependency info between parts.

## Configuration

All settings live in [`inputs/config.json`](inputs/config.json):

- `netex.version` — NeTEx version (`2.0`)
- `netex.branch` — GitHub branch to download (`next`)
- `netex.githubUrl` — upstream repository
- `paths.*` — output directories for XSDs and generated code
- `parts.<key>.enabled` — toggle each NeTEx part on/off
- `rootXsds.<key>.enabled` — toggle root-level XSD files

## Project Structure

```
inputs/
  config.json                       # all configuration (version, URLs, subset)
scripts/
  download.ts                       # download + extract XSDs (annotations preserved)
  generate.ts                       # TypeScript generation orchestrator (with @see link injection)
  xsd-to-jsonschema.ts              # custom XSD → JSON Schema converter
  split-output.ts                   # split monolithic .ts into per-category modules
  validate-generated-schemas.ts     # validate JSON Schema against Draft 07 meta-schema
  generate-docs.ts                  # generate TypeDoc HTML per slug
  build-schema-html.ts              # generate JSON Schema HTML viewer per slug
  build-docs-index.ts               # assemble docs-site/ with welcome page for GitHub Pages
docs/
  subset-selection-guide.md         # guide to NeTEx parts and subset configuration
  npm-publishing.md                 # npm publishing instructions
xsd/                                # downloaded XSDs (gitignored)
src/generated/                      # generated output (gitignored)
  <slug>/
    jsonschema/netex.json           # intermediate JSON Schema
    interfaces/                     # TypeScript interfaces (split modules + barrel index.ts)
    docs/                           # TypeDoc HTML output
    netex-schema.html               # JSON Schema HTML viewer
docs-site/                          # assembled GitHub Pages site (gitignored)
.github/workflows/docs.yml         # CI: generate all parts, build TypeDoc, deploy to Pages
```

## npm Scripts

| Script | Description |
|---|---|
| `npm run download` | Download and prepare XSD schemas |
| `npm run generate` | Generate TypeScript types from XSD subset. Use `-- --part <key>` to enable one optional part for a single run |
| `npm run build` | Compile TypeScript |
| `npm run test` | Run tests (vitest) |
| `npm run docs` | Generate TypeDoc HTML per slug (requires `generate` first) |

## Related Projects

- [netex-java-model](https://github.com/entur/netex-java-model) — Java/JAXB bindings for NeTEx
- [NeTEx](https://github.com/NeTEx-CEN/NeTEx) — upstream XSD schemas
