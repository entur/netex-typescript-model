# netex-typescript-model

## Experimental / Work-in-progress !!

TypeScript interfaces generated from [NeTEx](http://netex-cen.eu/) (Network Timetable Exchange) XSD schemas. Sibling project to [netex-java-model](https://github.com/entur/netex-java-model).

**[API Documentation](https://entur.github.io/netex-typescript-model/)** — TypeDoc for every NeTEx part, generated and deployed automatically via GitHub Actions.

See the [Subset Selection Guide](docs/subset-selection-guide.md) for how to choose which parts of the NeTEx standard to include and deployment options.

## Quick Start

```bash
cd typescript && npm install       # install Node.js dependencies (once)
make                               # download XSDs, generate base JSON Schema + schema HTML
cd typescript
npx tsx scripts/generate.ts ../generated-src/base/base.schema.json  # generate TypeScript
```

Generate a variant (e.g. network):

```bash
make ASSEMBLY=network PARTS=part1_network
cd typescript
npx tsx scripts/generate.ts ../generated-src/network/network.schema.json
```

## How It Works

### Pipeline Overview

The pipeline is split into two decoupled stages:

**Stage 1: XSD → JSON Schema** (Makefile, runs `json-schema/` Maven pipeline)

1. Downloads the NeTEx XSD ZIP from GitHub (`next` branch) via Maven Ant plugin
2. Converts XSD → JSON Schema via Java DOM parser (`xsd-to-jsonschema.js`), filtered to enabled parts
3. Validates JSON Schema against Draft 07 meta-schema
4. Generates schema HTML viewer per assembly

**Stage 2: JSON Schema → TypeScript** (`typescript/scripts/generate.ts`)

1. Loads a pre-generated JSON Schema from `generated-src/<assembly>/`
2. Builds a type source map from per-definition `x-netex-source` annotations
3. Injects `@see` links into a clone (persisted JSON stays clean)
4. Compiles JSON Schema → TypeScript interfaces via `json-schema-to-typescript`
5. Splits monolithic output into per-category modules with cross-imports
6. Type-checks with `tsc --noEmit`

### Documentation Pipeline

```bash
cd typescript
npm run docs                           # generate TypeDoc HTML per assembly
npx tsx scripts/build-docs-index.ts    # assemble docs-site/ with welcome page
```

The [GitHub Actions workflow](.github/workflows/docs.yml) generates all parts (base + each optional part individually), builds TypeDoc and schema HTML per assembly, and deploys to GitHub Pages on every push to `main`.

## XSD Subset

NeTEx 2.0 contains 458+ XSD files across several functional parts. Generation is restricted to the parts you enable in `assembly-config.json`. The framework, GML, SIRI, service, and publication entry point are always required; the domain-specific parts are toggled individually:

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

All settings live in [`assembly-config.json`](assembly-config.json):

- `netex.version` — NeTEx version (`2.0`)
- `netex.branch` — GitHub branch to download (`next`)
- `netex.githubUrl` — upstream repository
- `paths.*` — output directories for XSDs and generated code
- `parts.<key>.enabled` — toggle each NeTEx part on/off
- `rootXsds.<key>.enabled` — toggle root-level XSD files

## Project Structure

```
assembly-config.json                  # all configuration (version, URLs, subset)
Makefile                              # build orchestrator (XSD → JSON Schema → schema HTML)
tsconfig.generated.json               # type-check config for generated output
typescript/                           # Node.js/TypeScript pipeline
  scripts/
    generate.ts                       # JSON Schema → TypeScript transformer (positional arg)
    xsd-to-jsonschema-1st-try.ts      # custom XSD → JSON Schema converter
    split-output.ts                   # split monolithic .ts into per-category modules
    validate-generated-schemas.ts     # validate JSON Schema against Draft 07 meta-schema
    generate-docs.ts                  # generate TypeDoc HTML per assembly
    build-schema-html.ts              # generate JSON Schema HTML viewer per assembly
    build-docs-index.ts               # assemble docs-site/ with welcome page for GitHub Pages
  docs/
    subset-selection-guide.md         # guide to NeTEx parts and subset configuration
    npm-publishing.md                 # npm publishing instructions
generated-src/                        # generated output (gitignored)
  <assembly>/
    <assembly>.schema.json            # intermediate JSON Schema
    interfaces/                       # TypeScript interfaces (split modules + barrel index.ts)
    docs/                             # TypeDoc HTML output
    netex-schema.html                 # JSON Schema HTML viewer
docs-site/                            # assembled GitHub Pages site (gitignored)
json-schema/                          # GraalVM/Java DOM pipeline
  pom.xml                             # Maven POM (GraalJS + Xerces dependencies)
  xsd-to-jsonschema.js                # feature-parity JS port (Java DOM, no Node.js)
  verify-parity.sh                    # compare output against typescript/ reference
xsd/                                  # downloaded XSDs (gitignored)
.github/workflows/docs.yml           # CI: generate all parts, build TypeDoc, deploy to Pages
```

## npm Scripts (typescript/)

| Script | Description |
|---|---|
| `npm run generate:ts -- <schema.json>` | Generate TypeScript interfaces from a pre-generated JSON Schema |
| `npm run generate:schema -- <args>` | Run the XSD → JSON Schema converter directly |
| `npm run test` | Run tests (vitest) |
| `npm run validate:jsonschema` | Validate generated JSON Schemas against Draft 07 meta-schema |
| `npm run docs` | Generate TypeDoc HTML per assembly (requires generated interfaces) |

## Makefile Targets

| Target | Description |
|---|---|
| `make` | Generate base JSON Schema + schema HTML (default) |
| `make ASSEMBLY=network PARTS=part1_network` | Generate a variant |
| `make clean` | Remove all generated output, XSDs, and Maven target |

## Related Projects

- [netex-java-model](https://github.com/entur/netex-java-model) — Java/JAXB bindings for NeTEx
- [NeTEx](https://github.com/NeTEx-CEN/NeTEx) — upstream XSD schemas
