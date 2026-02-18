# netex-typescript-model

TypeScript types and Zod validation schemas generated from [NeTEx](http://netex-cen.eu/) (Network Timetable Exchange) XSD schemas. Sibling project to [netex-java-model](https://github.com/entur/netex-java-model).

## Quick Start

```bash
npm install
npm run download   # fetch NeTEx 2.0 XSDs from GitHub
npm run generate   # generate TypeScript types (stub — not yet wired up)
```

## How It Works

### Download Pipeline (`npm run download`)

1. Downloads the NeTEx XSD ZIP from GitHub (`next` branch)
2. Extracts only the `xsd/` directory into `xsd/2.0/`
3. Strips `<xsd:annotation>` elements from all XSD files

The ZIP is cached locally (`NeTEx-next.zip`) — delete it to force re-download.

### Generation Pipeline (`npm run generate`)

Planned two-step pipeline (not yet implemented):

1. **XSD → TypeScript interfaces** via cxsd
2. **TypeScript interfaces → Zod schemas** via ts-to-zod

Only a configurable subset of XSDs is processed (see below).

## XSD Subset

NeTEx 2.0 contains 458+ XSD files. To stay within tooling limits, generation is restricted to a subset configured in `inputs/config.json`:

| Directory | Files | Contents |
|---|---|---|
| `netex_framework` | ~143 | Base types: VehicleType, Vehicle, DeckPlan, equipment, organizations |
| `netex_part_5` | 32 | New modes: mobility services, vehicle meeting points |
| `gml` | 7 | Geographic coordinates |
| `ifopt.xsd` | 1 | IFOPT standard for places |
| `NeTEx_publication.xsd` | 1 | Schema entry point |
| **Total** | **~184** | **40% of full schema** |

To include more parts, add entries to `subset.includeParts` in `inputs/config.json`.

## Configuration

All settings live in [`inputs/config.json`](inputs/config.json):

- `netex.version` — NeTEx version (`2.0`)
- `netex.branch` — GitHub branch to download (`next`)
- `netex.githubUrl` — upstream repository
- `paths.*` — output directories for XSDs and generated code
- `subset.*` — which XSD directories and root files to include in generation

## Project Structure

```
inputs/
  config.json              # all configuration (version, URLs, subset)
scripts/
  download.ts              # download + extract + strip annotations
  generate.ts              # TypeScript/Zod generation (stub)
xsd/                       # downloaded XSDs (gitignored)
src/generated/             # generated output (gitignored)
  interfaces/              # TypeScript interfaces
  zod/                     # Zod schemas
```

## npm Scripts

| Script | Description |
|---|---|
| `npm run download` | Download and prepare XSD schemas |
| `npm run generate` | Generate TypeScript types from XSD subset |
| `npm run build` | Compile TypeScript |
| `npm run test` | Run tests |

## Related Projects

- [netex-java-model](https://github.com/entur/netex-java-model) — Java/JAXB bindings for NeTEx
- [NeTEx](https://github.com/NeTEx-CEN/NeTEx) — upstream XSD schemas
- [Sobek](https://github.com/entur/sobek) — vehicle registry (consumer of this model)
