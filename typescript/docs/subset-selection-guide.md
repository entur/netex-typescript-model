# NeTEx Subset Selection Guide

This project generates TypeScript types from NeTEx XSD schemas. NeTEx 2.0 contains 458+ XSD files across several functional parts. Rather than generating types for the entire standard, you configure a **subset** in `inputs/config.json` that matches your use case.

This guide explains the structure of the NeTEx XSD, how to choose which parts to include, and how to plan deployment of the generated package.

## NeTEx XSD Structure

After running `npm run download`, the `xsd/2.0/` directory contains:

| Directory | Files | Domain |
|---|---|---|
| `netex_framework` | 143 | Base types, reusable components, organizations, utility types, frames |
| `netex_part_1` | 93 | Network topology: routes, lines, stop places, scheduled stop points, timing patterns |
| `netex_part_2` | 56 | Timetables: service journeys, vehicle services, dated calls, passing times |
| `netex_part_3` | 92 | Fares: fare products, pricing, distribution, sales transactions |
| `netex_part_5` | 32 | New modes: mobility services, vehicle meeting points |
| `gml` | 7 | Geographic coordinates (GML standard) |
| `siri` + `siri_utility` | 12 | Real-time updates (SIRI standard) |
| `netex_service` + `wsdl*` | 12 | SOAP/WSDL service definitions |

Root-level XSD files:

| File | Purpose |
|---|---|
| `NeTEx_publication.xsd` | Top-level entry point — `PublicationDelivery` wraps all NeTEx data |
| `ifopt.xsd` | IFOPT standard for fixed objects in public transport (stops, access, equipment) |
| `NeTEx_publication-NoConstraint.xsd` | Relaxed variant without key/keyref constraints |
| `NeTEx_siri.xsd` | SIRI integration entry point |

## Required Baseline

Regardless of which parts you select, these are always included:

- **`netex_framework`** — The foundation of NeTEx. Contains `DataManagedObject`, `EntityInVersion`, `VersionFrame`, `ValidBetween`, `MultilingualString`, `PrivateCode`, and all the base types every other part inherits from. This is non-negotiable.
- **`gml`** — Defines `<gml:pos>`, `<gml:Polygon>`, and coordinate reference systems. Required unless your types have zero geographic content.
- **`siri`** + **`siri_utility`** — Real-time update types (SIRI standard). Required because `NeTEx_publication.xsd` unconditionally imports three SIRI files. Only 12 files / ~2,200 lines — making it optional adds stub complexity for no real benefit.
- **`netex_service`** — NeTEx service definitions (filters, aggregator `netex_all.xsd`). Required because `NeTEx_publication.xsd` includes them directly.
- **`NeTEx_publication.xsd`** — The `PublicationDelivery` document wrapper. Any consumer that reads or writes NeTEx XML needs this.

This matches `netex-java-model` which always includes SIRI and the service definitions.

The framework sub-directories:

| Sub-directory | Contains |
|---|---|
| `netex_genericFramework` | `DataManagedObject`, `EntityInVersion`, `VersionFrame`, `ValidBetween` |
| `netex_reusableComponents` | `VehicleType`, `Vehicle`, `TransportOrganisation`, `Equipment`, `PassengerCapacity` |
| `netex_responsibility` | `DataSource`, `GeneralOrganisation`, `Codespace` |
| `netex_utility` | `MultilingualString`, `PrivateCode`, `TypeOfValue` |
| `netex_frames` | `ResourceFrame`, `GeneralFrame` |

## Choosing Parts by Use Case

Map your domain to the parts you need:

| If you need... | Include |
|---|---|
| Stop places, quays, access, pathways | `netex_part_1` (specifically `part1_ifopt`, `part1_networkDescription`) |
| Routes, lines, networks, transport modes | `netex_part_1` (`part1_networkDescription`, `part1_tacticalPlanning`) |
| Timetables, service journeys, passing times | `netex_part_2` (`part2_journeyTimes`, `part2_vehicleService`) |
| Fares, pricing, tickets, distribution | `netex_part_3` (`part3_fares`, `part3_salesTransactions`) |
| Vehicle types, deck plans, capacity | `netex_framework` alone covers this |
| New modes, mobility services | `netex_part_5` |
| Real-time monitoring | `siri` + `siri_utility` |

Enable `ifopt` in `rootXsds` if you include Part 1 or anything referencing stop places.

## Cross-Part Dependencies

NeTEx parts are not fully independent. Common dependency chains:

```
Part 2 (timetables) ──references──► Part 1 (routes, stop points, timing patterns)
Part 3 (fares) ──references──► Part 1 (lines, scheduled stop points for fare zones)
Part 5 (new modes) ──references──► Framework only (mostly self-contained)
Part 1 ──references──► Framework + GML + IFOPT
```

**How the generator handles this:** All 433 XSD files are loaded for cross-reference resolution, but only definitions from enabled parts produce TypeScript output. References to types in disabled parts become `unknown` placeholders. This means you can enable Part 3 without Part 1, and types referencing Part 1 will compile (as `unknown`) — you just won't get the full type information for those cross-references.

## Configuring the Subset

Edit `inputs/config.json`. Each part has an `enabled` flag:

```json
{
  "parts": {
    "framework": { "enabled": true, "required": true, "dirs": ["netex_framework"] },
    "gml":       { "enabled": true, "required": true, "dirs": ["gml"] },
    "part1_network": { "enabled": true, "dirs": ["netex_part_1"] }
  },
  "rootXsds": {
    "ifopt":       { "enabled": true, "file": "ifopt.xsd" },
    "publication": { "enabled": true, "required": true, "file": "NeTEx_publication.xsd" }
  }
}
```

Then run `npm run generate` to generate TypeScript types from the enabled parts.

To try a part without editing config.json, use `xsd-to-jsonschema.ts --parts` and then pass the schema to `generate.ts`:

```bash
npx tsx scripts/xsd-to-jsonschema.ts ../xsd/2.0 /tmp/netex inputs/config.json --parts part1_network
npx tsx scripts/generate.ts --schema-source /tmp/netex/network.schema.json
```

This enables the part for that run only. Required parts (`framework`, `gml`, `siri`, `service`, `publication`) are hardwired in the generator and cannot be disabled — the script warns and re-enables them if config.json is tampered with.

## Deployment Strategy

Three viable models for publishing the generated types:

### Option A: Single package, single entry point

Generate everything in one `@entur/netex-typescript-model` package with a single `index.ts`.

**Pros:** Simple. One version, one dependency. Mirrors `netex-java-model` (single JAR).
**Cons:** Consumers pull in types they don't use. Zod schemas are runtime code and don't tree-shake as cleanly as pure type declarations.

### Option B: Scoped sub-packages

Publish separate packages per domain (`@entur/netex-model-framework`, `@entur/netex-model-stops`, `@entur/netex-model-fares`, etc.).

**Pros:** Consumers install only what they need. Clear ownership boundaries.
**Cons:** Cross-part references become cross-package imports. Versioning coordination is harder. Significantly more build/publish infrastructure.

### Option C: Single package, multiple entry points

One package with an `exports` map in `package.json`:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./framework": "./dist/framework/index.js",
    "./stops": "./dist/part1/index.js",
    "./timetables": "./dist/part2/index.js",
    "./fares": "./dist/part3/index.js"
  }
}
```

Consumers write:

```ts
import { StopPlace } from "@entur/netex-typescript-model/stops";
import { FareProduct } from "@entur/netex-typescript-model/fares";
```

**Pros:** One repo, one publish pipeline, logical separation for consumers. Tree-shaking works well.
**Cons:** One version number — a change in one part bumps the version for all consumers. Acceptable for generated code that regenerates from one XSD source.

### Recommended path

1. **Start with Option A.** Generate your initial subset, publish a single package. This gets consumers unblocked.
2. **Migrate to Option C** when multiple teams need different parts. The config-driven architecture already supports adding parts — introducing `exports` entry points is an additive change.
3. **Avoid Option B** unless there's a strong organizational reason. The cross-package dependency overhead isn't worth it for generated code from a single XSD source.

### Publishing considerations

- **Registry:** Use the same private npm registry as other `@entur` packages.
- **Versioning:** Tie to the NeTEx XSD version. Example: `2.0.0-next.1` while tracking the `next` branch, stable `2.0.x` when NeTEx cuts a release.
- **CI:** Generate on push, validate (do the types compile? do Zod schemas parse sample XML?), publish on tag.
- **Consumer migration:** Downstream projects (frontends, APIs) can replace hand-written NeTEx types with imports from this package incrementally — one type at a time.
