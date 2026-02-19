# netex-typescript-model

TypeScript types and Zod validation schemas generated from [NeTEx](http://netex-cen.eu/) (Network Timetable Exchange) XSD schemas. Sibling project to [netex-java-model](https://github.com/entur/netex-java-model).

See the [Subset Selection Guide](docs/subset-selection-guide.md) for how to choose which parts of the NeTEx standard to include and deployment options.

## Quick Start

```bash
npm install
npm run download   # fetch NeTEx 2.0 XSDs from GitHub
npm run generate   # generate TypeScript types from XSD subset
```

## How It Works

### Download Pipeline (`npm run download`)

1. Downloads the NeTEx XSD ZIP from GitHub (`next` branch)
2. Extracts only the `xsd/` directory into `xsd/2.0/`
3. Strips `<xsd:annotation>` elements from all XSD files

The ZIP is cached locally (`NeTEx-next.zip`) — delete it to force re-download.

### Generation Pipeline (`npm run generate`)

1. **Parse all XSD files** — recursively loads all 433 XSD files starting from `NeTEx_publication.xsd` (cross-references need the full set)
2. **XSD → JSON Schema** — custom converter (`scripts/xsd-to-jsonschema.ts`) using `fast-xml-parser`, filtered to enabled parts
3. **JSON Schema → TypeScript interfaces** — via `json-schema-to-typescript`
4. **(Future) TypeScript interfaces → Zod schemas** — via ts-to-zod

Only definitions from enabled parts are included in the output. References to disabled-part types become `unknown` placeholders.

## XSD Subset

NeTEx 2.0 contains 458+ XSD files across several functional parts. Generation is restricted to the parts you enable in `inputs/config.json`. The framework, GML, and publication entry point are always required; the domain-specific parts are toggled individually:

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
  config.json              # all configuration (version, URLs, subset)
scripts/
  download.ts              # download + extract + strip annotations
  generate.ts              # TypeScript generation from XSD subset
  xsd-to-jsonschema.ts     # custom XSD → JSON Schema converter
xsd/                       # downloaded XSDs (gitignored)
src/generated/             # generated output (gitignored)
  interfaces/              # TypeScript interfaces
  zod/                     # Zod schemas
```

## npm Scripts

| Script | Description |
|---|---|
| `npm run download` | Download and prepare XSD schemas |
| `npm run generate` | Generate TypeScript types from XSD subset. Use `-- --part <key>` to enable one optional part for a single run |
| `npm run build` | Compile TypeScript |
| `npm run test` | Run tests |

## Related Projects

- [netex-java-model](https://github.com/entur/netex-java-model) — Java/JAXB bindings for NeTEx
- [NeTEx](https://github.com/NeTEx-CEN/NeTEx) — upstream XSD schemas
