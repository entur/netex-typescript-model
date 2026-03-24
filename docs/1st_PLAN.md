# netex-typescript-model — Project Plan

## Goal

Sibling project to `netex-java-model` that:
1. Downloads NeTEx 2.0 XSD schemas from GitHub (same source)
2. Generates TypeScript types + Zod validation schemas
3. Only processes a configurable XSD subset to stay within tooling limits

## Directory Structure

```
netex-typescript-model/
├── package.json
├── tsconfig.json
├── .gitignore
├── PLAN.md
├── inputs/
│   ├── config.json                    # Version, URLs, paths, subset selection
│   └── bin/
│       ├── netex-download-extract.sh  # Adapted from java project
│       └── strip-annotations.sh       # Adapted annotation-replacer.sh
├── xsd/                               # Downloaded XSDs (gitignored)
│   └── 2.0/
│       ├── NeTEx_publication.xsd
│       ├── netex_framework/
│       ├── netex_part_1/ .. part_5/
│       ├── siri/
│       └── gml/
├── scripts/
│   ├── download.ts                    # Reads config.json, invokes bin/ scripts
│   └── generate.ts                    # Orchestrates code generation on subset
├── src/
│   └── generated/                     # Generated output (gitignored)
│       ├── interfaces/                # Step 1: TS interfaces from cxsd
│       └── zod/                       # Step 2: Zod schemas from ts-to-zod
└── test/
    └── roundtrip.test.ts              # Smoke test (future)
```

## inputs/config.json

Central configuration replacing the Maven pom.xml properties:

```json
{
  "netex": {
    "version": "2.0",
    "branch": "next",
    "repoName": "NeTEx",
    "githubUrl": "https://github.com/NeTEx-CEN/NeTEx",
    "entryXsd": "NeTEx_publication.xsd"
  },
  "paths": {
    "xsdRoot": "xsd",
    "generatedInterfaces": "src/generated/interfaces",
    "generatedZod": "src/generated/zod"
  },
  "subset": {
    "includeParts": ["netex_framework", "netex_part_5", "gml"],
    "includeRootXsds": ["ifopt.xsd", "NeTEx_publication.xsd"]
  }
}
```

All XSDs are downloaded (the full ZIP), but only the subset directories/files
are fed into the TypeScript generator. This keeps cross-references intact while
limiting the scope of generated code.

## XSD Subset Rationale

Full NeTEx 2.0 has 458 XSD files. For vehicle registry types (Sobek use case):

| Directory | XSD files | Why included |
|---|---|---|
| `netex_framework` | ~143 | Base types: VehicleType, Vehicle, DeckPlan, equipment, organizations |
| `netex_part_5` | 32 | New modes: mobility services, vehicle meeting points |
| `gml` | 7 | Geographic coordinates (referenced by framework) |
| `ifopt.xsd` | 1 | IFOPT standard for places (referenced by framework) |
| `NeTEx_publication.xsd` | 1 | Entry point for schema resolution |
| **Total** | **~184** | **40% of full schema** |

Excluded (saves ~274 files):
- `netex_part_1` (93) — stop places, routes, lines
- `netex_part_2` (56) — journey times, vehicle services
- `netex_part_3` (92) — fares, monitoring, parking tariffs
- `siri/` (12) — real-time tracking
- `wsdl/`, `wsdl_model/`, `ynotation/`, `netex_service/` (16) — service definitions

To expand the subset, add entries to `config.subset.includeParts`.

## What Was Extracted from netex-java-model

| Source file | Target | Changes |
|---|---|---|
| `bin/netex-download-extract.sh` | `inputs/bin/netex-download-extract.sh` | `set -euo pipefail`, proper quoting, curl download re-enabled, caches ZIP |
| `bin/annotation-replacer.sh` | `inputs/bin/strip-annotations.sh` | Takes folder arg instead of version, better error messages |
| `bin/version_updater.sh` | Skipped | Not needed (no JAXB bindings) |
| pom.xml properties | `inputs/config.json` | `netexVersion`, `netexBranch`, `netexGithubUrl`, `netexRepoName` |

## Generation Pipeline

### Step 1: Download (`npm run download`)

`scripts/download.ts` reads `inputs/config.json`, sets env vars, calls shell scripts:
1. Downloads ZIP from GitHub (cached locally as `NeTEx-{branch}.zip`)
2. Extracts `xsd/*` to `xsd/2.0/`
3. Strips `<xsd:annotation>` elements via xmlstarlet

### Step 2: Generate (`npm run generate`)

`scripts/generate.ts` (currently a stub) will:
1. Collect XSD files matching `config.subset`
2. Run cxsd → TypeScript interfaces in `src/generated/interfaces/`
3. Run ts-to-zod → Zod schemas in `src/generated/zod/`

## Next Steps

1. Run `npm run download` to verify the download pipeline works
2. Try cxsd on the subset entry point and evaluate output quality
3. If cxsd struggles, try the JSON Schema intermediate path:
   `XSD → json-schema (xsd2json) → Zod (json-schema-to-zod)`
4. Wire up the chosen generator into `scripts/generate.ts`
5. Add smoke test with a sample VehicleType XML

## Risks & Mitigations

1. **cxsd can't handle NeTEx complexity** → fallback to JSON Schema intermediate
2. **Circular XSD references** → ts-to-zod `--lazy-unions` flag, or `z.lazy()` wrappers
3. **xmlstarlet required** → documented, available via `pacman -S xmlstarlet`

## Open Questions

- Should generated code be committed or stay gitignored?
- Publish to npm under `@entur/netex-typescript-model`?
- Support multiple NeTEx versions?
