# netex-typescript-model

Generate self-contained, type-safe TypeScript for any [NeTEx](http://netex-cen.eu/) entity from a JSON Schema derived from the official XSDs.

This is **not** a TypeScript library you import. It's a JSON Schema artifact plus a codegen CLI: pick the entities you actually need, generate `.ts` files into your project, commit them. Sibling project to [netex-java-model](https://github.com/entur/netex-java-model).

## What you get

Each release ships two artifacts:

- **`netex-jsonschema-full-2.0.json`** — full NeTEx 2.0 JSON Schema (Draft 07) with `x-netex-*` annotations describing roles, frames, substitution groups, and refs. Use it directly for validation (ajv, etc.) or as input to your own codegen.
- **`netex-ts-gen.tgz`** — npm package exposing the `netex-ts-gen` CLI. Reads the schema, emits per-entity TypeScript on demand.

Plus, browseable on GitHub Pages:

- **[Schema HTML viewer](https://entur.github.io/netex-typescript-model/)** — interactive entity explorer (search, role filters, dependency graph, sample data, copy-to-clipboard codegen)

## Quick start

```bash
# 1. Get the schema
curl -L -O https://github.com/entur/netex-typescript-model/releases/latest/download/netex-jsonschema-full-2.0.json

# 2. Install the codegen CLI
npm install https://github.com/entur/netex-typescript-model/releases/latest/download/netex-ts-gen.tgz

# 3. Generate
npx netex-ts-gen --schema ./netex-jsonschema-full-2.0.json --dest-dir ./src/netex VehicleType
```

You now have `src/netex/VehicleType.ts` (interface + transitive types) and `src/netex/VehicleType-mapping.ts` (XML serialization). Both are type-checked with `tsc --strict` before being written.

## Demo: `VehicleType`

The codegen produces two files per entity. Here's what `VehicleType` looks like.

### `VehicleType.ts` (excerpt)

```ts
export interface VehicleType {
  $id?: string;
  Name?: TextType[];
  ShortName?: TextType[];
  Description?: TextType[];
  EuroClass?: string;
  PropulsionTypes?: PropulsionTypeEnumeration[];
  FuelTypes?: FuelTypeEnumeration[];
  MaximumVelocity?: number;
  PassengerCapacity?: PassengerCapacityStructure;
  Length?: number;
  Width?: number;
  Height?: number;
  Weight?: number;
  // ...
}
```

All transitive types (`TextType`, `PropulsionTypeEnumeration`, `PassengerCapacityStructure`, ...) are inlined into the same file. No import wiring across modules — the file stands alone.

### `VehicleType-mapping.ts` (excerpt)

```ts
export function vehicleTypeToXmlShape(obj: Obj): Obj {
  return {
    ...attr(obj, 'id'),
    ...mapArr(obj, 'Name', 'TextType', reshapeComplex),
    ...elem(obj, 'EuroClass'),
    ...elem(obj, 'PropulsionTypes'),
    ...child(obj, 'PassengerCapacity', 'PassengerCapacityStructure', reshapeComplex),
    ...elem(obj, 'Length'), ...elem(obj, 'Width'),
    // ...
  };
}
```

Pair this with [`fast-xml-parser`'s XMLBuilder](https://github.com/NaturalIntelligence/fast-xml-parser) to produce NeTEx-compliant XML from a typed `VehicleType` instance.

### Collapse refs and one-child collections

By default, NeTEx ref types and `_RelStructure` collection wrappers come through verbatim:

```ts
DeckPlanRef?: VersionOfObjectRefStructure;
BrandingRef?: VersionOfObjectRefStructure;
capacities?: passengerCapacities_RelStructure;
```

With `--collapse-refs --collapse-collections`, those become ergonomic, target-aware shapes:

```ts
DeckPlanRef?: Ref<'DeckPlan'>;
BrandingRef?: Ref<'Branding'>;
capacities?: SimpleRef;
```

`Ref<'X'>` carries the target entity name in the type system, so a `DeckPlanRef` can't be assigned where a `BrandingRef` is expected. The mapping code is regenerated to produce the same XML either way.

### Strip noise with `--exclude`

NeTEx structures inherit a long base-prop chain (`$changed`, `$created`, `$modification`, `Extensions`, `alternativeTexts`, ...). Most projects don't use all of them. Pass `--exclude` to strip listed properties from both the interface and the mapping:

```bash
npx netex-ts-gen --schema ./netex-jsonschema-full-2.0.json \
  --collapse-refs --collapse-collections \
  --exclude '$changed,$created,$modification,Extensions,alternativeTexts' \
  --dest-dir ./src/netex \
  VehicleType
```

## CLI reference

```
netex-ts-gen [flags] <Entity> [Entity ...]
```

| Flag                       | Default     | Description                                                          |
| -------------------------- | ----------- | -------------------------------------------------------------------- |
| `--schema <path>`          | (required)  | Path to the JSON Schema file                                         |
| `--dest-dir <path>`        | `/tmp`      | Directory to write `<Entity>.ts` and `<Entity>-mapping.ts`           |
| `--overwrite`              | `false`     | Replace existing output files (otherwise skipped)                    |
| `--exclude <a,b,...>`      | (none)      | Comma-separated list of property names to strip                      |
| `--suffix <s>`             | `""`        | Append to output filenames (`Vehicle.ts` → `Vehicle-hathor.ts`)      |
| `--collapse-refs`          | `false`     | Replace `VersionOfObjectRefStructure` with `Ref<'Entity'>` / `SimpleRef` |
| `--collapse-collections`   | `false`     | Replace single-child `_RelStructure` wrappers with the child entity type |

Entity names are case-sensitive and must match definitions in the schema (e.g. `VehicleType`, not `vehicleType`). Unknown targets are skipped with a warning. Each output file is type-checked with `tsc --strict --skipLibCheck` automatically; exit code is 0 if all targets pass, 1 otherwise.

## The JSON Schema as a product

`netex-jsonschema-full-2.0.json` is a standard Draft 07 JSON Schema — useful for validation tooling regardless of language:

```js
import Ajv from 'ajv';
import schema from './netex-jsonschema-full-2.0.json' with { type: 'json' };

const ajv = new Ajv({ strict: false });
const validate = ajv.compile({ $ref: '#/definitions/VehicleType', ...schema });
if (!validate(data)) console.error(validate.errors);
```

Each definition carries `x-netex-*` annotations (role, frames, refTarget, deprecated, ...) that downstream tooling can use to reconstruct NeTEx semantics. See [`json-schema/README.md`](json-schema/README.md) for the full annotation reference.

For interactive browsing, open the [schema viewer on GitHub Pages](https://entur.github.io/netex-typescript-model/).

## Pin a version

Quick-start URLs use the `latest` redirect for stability. For reproducible builds, pin to a specific tag:

```bash
TAG=v0.5.0
curl -L -O https://github.com/entur/netex-typescript-model/releases/download/$TAG/netex-jsonschema-full-2.0-$TAG.json
npm install https://github.com/entur/netex-typescript-model/releases/download/$TAG/netex-ts-gen-$TAG.tgz
```

## Build from source

For local development, contributing, or building custom NeTEx subset assemblies, see [`docs/maintainer.md`](docs/maintainer.md).

## Related projects

- [netex-java-model](https://github.com/entur/netex-java-model) — Java/JAXB bindings for NeTEx
- [NeTEx](https://github.com/NeTEx-CEN/NeTEx) — upstream XSD schemas
