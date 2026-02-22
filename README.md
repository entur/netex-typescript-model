# netex-typescript-model

## Experimental / Work-in-progress !!

TypeScript interfaces generated from [NeTEx](http://netex-cen.eu/) (Network Timetable Exchange) XSD schemas. Sibling project to [netex-java-model](https://github.com/entur/netex-java-model).

**[API Documentation](https://entur.github.io/netex-typescript-model/)** — TypeDoc for every NeTEx part, generated and deployed automatically via GitHub Actions.

## Prerequisites

- JDK 21+ (any distribution — GraalVM not required)
- Maven 3+
- Node.js 22+

```bash
cd typescript && npm install   # once
```

## Quick Start

```bash
make                           # download XSDs → JSON Schema → schema HTML (base)
```

This runs the full Stage 1 pipeline: downloads NeTEx XSDs from GitHub, converts them to JSON Schema via a Java DOM parser, validates the schema, and generates an interactive HTML viewer.

Then generate TypeScript interfaces:

```bash
cd typescript
npx tsx scripts/generate.ts ../generated-src/base/base.schema.json
```

## Generating Variants

Pass `ASSEMBLY` and `PARTS` to build a different NeTEx subset:

```bash
make ASSEMBLY=network PARTS=part1_network
cd typescript
npx tsx scripts/generate.ts ../generated-src/network/network.schema.json
```

Available parts: `part1_network`, `part2_timetable`, `part3_fares`, `part5_new_modes`. See the [Subset Selection Guide](typescript/docs/subset-selection-guide.md) for dependencies between parts.

## Makefile Targets

| Command                            | What it does                                           |
| ---------------------------------- | ------------------------------------------------------ |
| `make`                             | Base JSON Schema + schema HTML (default)               |
| `make ASSEMBLY=<name> PARTS=<key>` | Named variant                                          |
| `make clean`                       | Remove `generated-src/`, `xsd/`, `json-schema/target/` |

The Makefile is incremental — re-running `make` after a successful build is a no-op.

## Pipeline

### Stage 1: XSD → JSON Schema (Makefile)

```
NeTEx XSDs (GitHub) → Java DOM parser → JSON Schema (Draft 07) → schema HTML viewer
```

1. Maven Ant plugin downloads the NeTEx ZIP from GitHub (`next` branch)
2. GraalJS runs `json-schema/xsd-to-jsonschema.js` on stock JDK via Java DOM APIs
3. Each definition is stamped with `x-netex-source` (provenance) and `x-netex-leaf` annotations
4. JSON Schema is validated against the Draft 07 meta-schema
5. An interactive HTML viewer is generated per assembly

### Stage 2: JSON Schema → TypeScript (`generate.ts`)

```
<assembly>.schema.json → json-schema-to-typescript → split modules → tsc --noEmit
```

1. Reads `x-netex-source` annotations to build a type→file source map
2. Injects `@see` links into a clone (persisted JSON stays clean)
3. Compiles to monolithic TypeScript via `json-schema-to-typescript`
4. Splits into per-category modules with cross-imports and a barrel `index.ts`
5. Type-checks with `tsc --noEmit`

### Documentation

```bash
cd typescript
npm run docs                          # TypeDoc HTML per assembly
npx tsx scripts/build-docs-index.ts   # assemble docs-site/ with welcome page
```

CI generates all variants, builds TypeDoc + schema HTML, and deploys to GitHub Pages on push to `main`.

## XSD Subset

NeTEx 2.0 contains 458+ XSD files across several functional parts. Generation is restricted to the parts you enable in `assembly-config.json`. The framework, GML, SIRI, service, and publication entry point are always required; the domain-specific parts are toggled individually:

#### Required

| Part key    | XSD directory           | Files | Domain                                                |
| ----------- | ----------------------- | ----- | ----------------------------------------------------- |
| `framework` | `netex_framework`       | 143   | Base types, reusable components, organizations        |
| `gml`       | `gml`                   | 7     | Geographic coordinates                                |
| `siri`      | `siri` + `siri_utility` | 12    | Real-time updates (imported by NeTEx_publication.xsd) |
| `service`   | `netex_service`         | 4     | NeTEx service definitions and filters                 |

#### Optional

| Part key          | XSD directory  | Files | Domain                                                                 |
| ----------------- | -------------- | ----- | ---------------------------------------------------------------------- |
| `part1_network`   | `netex_part_1` | 93    | Routes, lines, stop places, timing patterns                            |
| `part2_timetable` | `netex_part_2` | 56    | Service journeys, passing times, vehicle services                      |
| `part3_fares`     | `netex_part_3` | 92    | Fare products, pricing, distribution, sales                            |
| `part5_new_modes` | `netex_part_5` | 32    | Mobility services, vehicle meeting points (Part 4 was never published) |

Enable a part by setting `"enabled": true` in its config entry. See the [Subset Selection Guide](typescript/docs/subset-selection-guide.md) for dependency info between parts.

## Configuration

All settings live in [`assembly-config.json`](assembly-config.json):

- `netex.version` / `netex.branch` — which NeTEx release to download
- `paths.generated` — output directory (`generated-src`)
- `parts.<key>.enabled` — toggle NeTEx parts on/off
- `rootXsds.<key>.enabled` — toggle root-level XSD files

## Project Structure

```
Makefile                              # build entry point
assembly-config.json                  # NeTEx version, parts, output paths
tsconfig.generated.json               # type-check config for generated output
typescript/                           # Node.js/TypeScript tooling
  scripts/
    generate.ts                       # JSON Schema → TypeScript (positional arg)
    xsd-to-jsonschema-1st-try.ts      # reference XSD → JSON Schema converter (fast-xml-parser)
    split-output.ts                   # split monolithic .ts into per-category modules
    validate-generated-schemas.ts     # validate JSON Schema against Draft 07 meta-schema
    build-schema-html.ts              # interactive JSON Schema HTML viewer
    generate-docs.ts                  # TypeDoc HTML per assembly
    build-docs-index.ts               # docs-site/ welcome page
json-schema/                          # Java DOM pipeline (feature-parity port)
  pom.xml                             # Maven POM (GraalJS + Xerces, XSD download)
  xsd-to-jsonschema.js                # JS converter using Java DOM APIs
  verify-parity.sh                    # diff output against typescript/ reference
generated-src/                        # output (gitignored)
  <assembly>/
    <assembly>.schema.json            # JSON Schema
    interfaces/                       # TypeScript modules + barrel index.ts
    docs/                             # TypeDoc HTML
    netex-schema.html                 # interactive schema viewer
```

## npm Scripts (typescript/)

| Script                                 | Description                                 |
| -------------------------------------- | ------------------------------------------- |
| `npm run generate:ts -- <schema.json>` | Generate TypeScript from a JSON Schema      |
| `npm run test`                         | Run tests (vitest)                          |
| `npm run validate:jsonschema`          | Validate generated schemas against Draft 07 |
| `npm run docs`                         | Generate TypeDoc HTML per assembly          |

## Related Projects

- [netex-java-model](https://github.com/entur/netex-java-model) — Java/JAXB bindings for NeTEx
- [NeTEx](https://github.com/NeTEx-CEN/NeTEx) — upstream XSD schemas
