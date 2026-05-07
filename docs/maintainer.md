# Maintainer guide

Building from source, generating custom assemblies, working on the codegen.

For end-user docs (install + `netex-ts-gen` usage), see the root [`README.md`](../README.md).

## Prerequisites

- JDK 21+ (any distribution — GraalVM not required)
- Maven 3+
- Node.js 22+

```bash
cd html-ts-gen && npm install   # once
```

## Repo layout

```
Makefile                    # build orchestrator
assembly-config.json        # NeTEx version, parts, output paths
tsconfig.generated.json     # type-check config for generated output
gen-samples/                # example codegen invocations (vehicle, deck plan, etc.)
docs/                       # design notes, this guide, subset selection
html-ts-gen/                # Node.js/TypeScript pipeline (codegen, viewer, tests)
json-schema/                # GraalVM/Java DOM pipeline (XSD → JSON Schema)
generated-src/              # output (gitignored)
```

Sub-directory docs:
- [`html-ts-gen/CLAUDE.md`](../html-ts-gen/CLAUDE.md) — TypeScript pipeline architecture
- [`json-schema/README.md`](../json-schema/README.md) — XSD parser and `x-netex-*` annotation reference

## Quick start

```bash
make all                          # full pipeline: XSD → JSON Schema → HTML → TypeScript → TypeDoc
make all ASSEMBLY=network         # build a variant
```

`make all` downloads NeTEx XSDs from GitHub, converts them to JSON Schema via a Java DOM parser, validates the schema, generates an interactive HTML viewer, TypeScript interfaces, and TypeDoc documentation. The Makefile is incremental — re-running `make` after a successful build is a no-op.

## Assemblies

Pass `ASSEMBLY` to build a different NeTEx subset. Parts are derived automatically from the assembly name:

```bash
make all ASSEMBLY=base                  # only required parts (framework, gml, siri, service)
make all ASSEMBLY=network               # base + part1_network
make all ASSEMBLY=network+timetable     # base + part1_network + part2_timetable
make all ASSEMBLY=fares+network+new-modes+timetable   # all parts
```

Available parts: `network`, `timetable`, `fares`, `new-modes` (also accepted as `part1_network`, `part2_timetable`, `part3_fares`, `part5_new_modes`). Multi-part assemblies use `+` separators and are sorted alphabetically. See [`docs/subset-selection-guide.md`](subset-selection-guide.md) for dependencies between parts.

Output is written to `generated-src/<assembly>/`.

## Makefile targets

| Command                               | What it does                                           |
| ------------------------------------- | ------------------------------------------------------ |
| `make all`                            | Full pipeline: schema + types + docs (default: base)   |
| `make all ASSEMBLY=network`           | Full pipeline for a named variant                      |
| `make schema`                         | JSON Schema + schema HTML only                         |
| `make types`                          | TypeScript interfaces only                             |
| `make docs`                           | TypeDoc HTML only                                      |
| `make tarball-generator VERSION=…`    | Package the codegen CLI as `netex-ts-gen-v<ver>.tgz`   |
| `make clean`                          | Remove `generated-src/`, `xsd/`, `json-schema/target/` |

## Pipeline

### Stage 1: XSD → JSON Schema

1. Maven Ant plugin downloads the NeTEx ZIP from GitHub
2. GraalJS runs `json-schema/xsd-to-jsonschema.js` on stock JDK via Java DOM APIs
3. Each definition is stamped with `x-netex-*` annotations (source, role, atom, frames, mixed, substitutionGroup, sg-members, refTarget, collapsed) plus per-property `x-netex-choice` and `x-netex-deprecated` — see [`json-schema/README.md`](../json-schema/README.md)
4. JSON Schema is validated against the Draft 07 meta-schema
5. An interactive HTML viewer is generated per assembly

### Stage 2: JSON Schema → TypeScript

Used internally to generate the `interfaces/` tree consumed by TypeDoc. The `netex-ts-gen` CLI (the public-facing tool) takes the same JSON Schema and emits per-entity TypeScript on demand — see the root [`README.md`](../README.md) for end-user docs.

```
JSON Schema → primitive-ts-gen.ts → json-schema-to-typescript → monolithic .ts
            → split-output.ts → per-category modules → tsc --noEmit (type-check)
```

## Configuration

All settings live in [`assembly-config.json`](../assembly-config.json):

- `netex.version` / `netex.branch` — which NeTEx release to download
- `paths.generated` — output directory (`generated-src`)
- `parts.<key>.enabled` — toggle NeTEx parts on/off
- `rootXsds.<key>.enabled` — toggle root-level XSD files

## XSD subset

NeTEx 2.0 contains 458+ XSD files across several functional parts. Generation is restricted to the parts you enable in `assembly-config.json`. Framework, GML, SIRI, service, and the publication entry point are always required; the domain-specific parts are toggled individually:

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

Enable a part by setting `"enabled": true` in its config entry. See [`docs/subset-selection-guide.md`](subset-selection-guide.md) for dependency info between parts.

## Convenience scripts

`gen-samples/` contains shell wrappers around `ts-gen.ts` that demonstrate realistic codegen invocations for known consumer use cases:

| Script | Entity | Notes |
|--------|--------|-------|
| `gen-samples/gen-vehicle.sh` | Vehicle | `--collapse-refs --collapse-collections` |
| `gen-samples/gen-vehicletype.sh` | VehicleType | `--collapse-*` plus a hathor-specific `--exclude` list |
| `gen-samples/gen-deckplan.sh` | DeckPlan | `--exclude` list matching the NeTEx-Deckplan-Editor |

These run from a clone (they `cd` into `html-ts-gen/`). They're maintainer-facing examples; end users invoke the published `netex-ts-gen` CLI from an installed tarball — see the root README.

## npm scripts (`html-ts-gen/`)

| Script                        | Description                                 |
| ----------------------------- | ------------------------------------------- |
| `npm run test`                | Run tests (vitest)                          |
| `npm run validate:jsonschema` | Validate generated schemas against Draft 07 |
| `npm run docs`                | Generate TypeDoc HTML per assembly          |

## Releases

Pushing a `v*` tag triggers `release.yml`, which builds the full assembly, packages the codegen CLI as an npm tarball, attaches the JSON Schema file directly, and creates a GitHub Release.

Release artifacts (per tag, e.g. `v0.5.0`):

- `netex-ts-gen-v0.5.0.tgz` — npm package (codegen CLI, no schema)
- `netex-ts-gen.tgz` — versionless alias (same content)
- `netex-jsonschema-full-2.0-v0.5.0.json` — JSON Schema (full assembly)
- `netex-jsonschema-full-2.0.json` — versionless alias

The `2.0` in the schema filename is the NeTEx version (from `assembly-config.json`); the trailing `v0.5.0` is the project release tag. Versionless aliases are uploaded so the README's install URLs stay stable across releases — pin a specific version by using the versioned filename instead.

## Documentation

```bash
cd html-ts-gen
npm run docs                          # TypeDoc HTML per assembly
npx tsx scripts/build-docs-index.ts   # assemble docs-site/ with welcome page
```

CI (`docs.yml`) builds `base`, `network+timetable`, and the full `fares+network+new-modes+timetable` assembly, generates TypeDoc + schema HTML, and deploys to GitHub Pages on push to `main`.
