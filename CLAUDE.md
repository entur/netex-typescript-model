# CLAUDE.md

## Project Overview

netex-typescript-model generates TypeScript types and Zod schemas from NeTEx XSD schemas. It is the TypeScript counterpart to `netex-java-model` (which uses JAXB).

## Build Commands

```bash
npm install                # install dependencies
npm run download           # download XSDs from GitHub, extract, strip annotations
npm run generate           # generate TypeScript from XSD subset (stub)
npm run build              # compile TypeScript
npm run test               # run tests
```

## Key Files

- `inputs/config.json` — single source of truth for NeTEx version, GitHub URL, output paths, and XSD subset selection
- `scripts/download.ts` — downloads ZIP from GitHub, extracts `xsd/` directory, strips `<xsd:annotation>` elements. Uses `adm-zip` for extraction and regex for annotation stripping (no shell/xmlstarlet dependencies)
- `scripts/generate.ts` — orchestrates TypeScript generation from the configured XSD subset. Currently a stub that reports subset statistics

## Architecture

### Configuration-Driven

Everything flows from `inputs/config.json`. Scripts read this file to determine:
- Which NeTEx version/branch to download
- Where to put XSDs and generated code
- Which XSD directories to include in generation (`subset.includeParts`)

### XSD Subset

Full NeTEx 2.0 has 458+ XSD files. The `subset` config limits generation to ~184 files (framework + part_5 + gml) to avoid overwhelming the XSD-to-TypeScript tooling. The full set is still downloaded (cross-references need to resolve), but only the subset is fed to the generator.

Default subset targets vehicle registry types (Sobek use case):
- `netex_framework` — base types including VehicleType, Vehicle, DeckPlan
- `netex_part_5` — new modes, mobility services
- `gml` — geographic coordinates
- `ifopt.xsd`, `NeTEx_publication.xsd` — entry points

### Generation Pipeline (Planned)

```
XSD (subset) → cxsd → TypeScript interfaces → ts-to-zod → Zod schemas
```

The generator step is not yet wired up. When implementing:
1. cxsd may struggle with NeTEx complexity — fallback: XSD → JSON Schema → Zod
2. Circular references are common in NeTEx — use `z.lazy()` / `--lazy-unions`
3. Start with a single XSD file to validate tooling before running on the full subset

### Download Pipeline

`scripts/download.ts` does three things in sequence:
1. `fetch()` the GitHub ZIP (cached as `NeTEx-{branch}.zip`)
2. Extract `xsd/*` entries via `adm-zip`
3. Strip `<xsd:annotation>` blocks via regex (originally needed for JAXB, kept for cleaner schemas)

## Relationship to netex-java-model

This project mirrors the XSD download step of `netex-java-model` but replaces:
- Maven `exec-maven-plugin` → npm scripts + TypeScript
- Shell scripts (`netex-download-extract.sh`, `annotation-replacer.sh`) → `scripts/download.ts`
- `pom.xml` properties → `inputs/config.json`
- JAXB/cxf-xjc-plugin → cxsd + ts-to-zod (planned)

Same upstream source: `https://github.com/NeTEx-CEN/NeTEx` branch `next`.

## Gitignored Artifacts

- `xsd/` — downloaded XSD schemas
- `NeTEx-*.zip` — cached download
- `src/generated/` — generated TypeScript/Zod output
- `node_modules/`, `dist/`
