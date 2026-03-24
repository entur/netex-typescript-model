# Sobek Entity Layer vs x-netex-role Annotations

Cross-referencing Sobek's handmade JPA entity/mapper layer against the `x-netex-role` annotations produced by the codegen pipeline. Goal: understand whether `x-netex-role` can predict which NeTEx types end up as persistence candidates, and what Sobek's choices reveal about gaps in the role model.

## Method

- Sobek entities: 29 `@Entity`-annotated classes in `sobek-model/.../model/vehicle/`
- Sobek mappers: 30+ MapStruct mappers in `sobek-service/.../netex/mapping/mapstruct/`
- NeTEx roles: extracted from `generated-src/base/base.schema.json` (`x-netex-role` per definition)

## Alignment Summary

| Match category | Count | Notes |
|---|---|---|
| Sobek entity maps to `x-netex-role: entity` | **23** | Strong alignment |
| Sobek entity maps to `x-netex-role: structure` | **3** | Sobek promotes structures to persistable entities |
| Sobek entity has no role (sub-element / grid) | **3** | SpotRow, SpotColumn, SchematicMapMember |
| `x-netex-role: entity` in vehicle domain but **not in Sobek** | **~15** | Sobek chose a subset |

## Detail: Sobek entities → x-netex-role

### Matches (entity → entity)

| Sobek JPA Entity | NeTEx Java Type | x-netex-role | XSD Source |
|---|---|---|---|
| Vehicle | Vehicle | entity | netex_vehicle_version.xsd |
| VehicleType | VehicleType | entity | netex_vehicleType_version.xsd |
| VehicleModel | VehicleModel | entity | netex_vehicleType_version.xsd |
| VehicleEquipmentProfile | VehicleEquipmentProfile | entity | netex_vehicleType_version.xsd |
| DeckPlan | DeckPlan | entity | netex_deckPlan_version.xsd |
| Deck | Deck | entity | netex_deckPlan_version.xsd |
| PassengerSpace | PassengerSpace | entity | netex_deckPlan_version.xsd |
| PassengerEntrance | PassengerEntrance | entity | netex_deckPlan_version.xsd |
| PassengerSpot | PassengerSpot | entity | netex_seatingPlan_version.xsd |
| LuggageSpot | LuggageSpot | entity | netex_seatingPlan_version.xsd |
| SpotAffinity | SpotAffinity | entity | netex_spotAffinity_version.xsd |
| SeatEquipment | SeatEquipment | entity | netex_spotEquipment_version.xsd |
| BedEquipment | BedEquipment | entity | netex_spotEquipment_version.xsd |
| SpotEquipment | SpotEquipment | entity | netex_spotEquipment_version.xsd |
| LuggageSpotEquipment | LuggageSpotEquipment | entity | netex_spotEquipment_version.xsd |
| AccessVehicleEquipment | AccessVehicleEquipment | entity | netex_equipmentVehiclePassenger_version.xsd |
| EntranceEquipment | EntranceEquipment | entity | netex_ifopt_equipmentAccess_version.xsd |
| StaircaseEquipment | StaircaseEquipment | entity | netex_ifopt_equipmentAccess_version.xsd |
| SchematicMap | SchematicMap | entity | netex_schematicMap_version.xsd |
| Train | Train | entity | netex_trainElement_version.xsd |

### Promoted structures (structure/abstract → persisted entity in Sobek)

| Sobek JPA Entity | NeTEx Java Type | x-netex-role | Why promoted |
|---|---|---|---|
| PassengerCapacity | PassengerCapacityStructure | **structure** | Sobek needs it as a first-class queryable entity (OneToOne with VehicleType) |
| DeckSpace | DeckComponent_VersionStructure | **abstract** | Base for PassengerSpace/OtherDeckSpace; Sobek persists it directly |
| DeckSpaceCapacity | — | **structure** | Capacity per space; Sobek tracks this independently |

### No role in schema (sub-elements without own NeTEx entity identity)

| Sobek JPA Entity | Notes |
|---|---|
| SpotRow | Grid positioning — NeTEx XSD defines it but no entity identity |
| SpotColumn | Grid positioning — same |
| SchematicMapMember | Child of SchematicMap — collection member, not standalone entity |
| VehicleEquipmentProfileMember | Child of VehicleEquipmentProfile |
| LocatableSpot | Abstract base for PassengerSpot/LuggageSpot |

## Vehicle-domain entities Sobek does NOT map

These have `x-netex-role: entity` in the schema but Sobek does not persist them. This is the "unused NeTEx surface" for the vehicle domain:

| NeTEx Entity | XSD Source | Why likely skipped |
|---|---|---|
| RollingStockInventory | netex_vehicle_version.xsd | Collection wrapper — Sobek queries directly |
| TractiveRollingStockItem | netex_vehicle_version.xsd | Locomotive-specific, not relevant for bus/tram |
| TrailingRollingStockItem | netex_vehicle_version.xsd | Unpowered stock, not in scope |
| TypeOfRollingStock | netex_vehicle_version.xsd | Classification not needed yet |
| CompoundTrain | netex_trainElement_version.xsd | Multi-unit trains — future scope |
| TrainComponent | netex_trainElement_version.xsd | Train ordering — Sobek has Train but not sub-components |
| TrainElement | netex_trainElement_version.xsd | Deprecated as concrete type |
| PoweredTrain | netex_trainElementType_version.xsd | Specialized train type, not yet needed |
| UnpoweredTrain | netex_trainElementType_version.xsd | Same |
| TransportType | netex_vehicleType_version.xsd | Abstract classification — Sobek uses VehicleType directly |
| SimpleVehicleType | netex_vehicleType_version.xsd | Personal vehicles (cars, bikes) — not public transport |
| AcceptedDriverPermit | netex_vehicleType_version.xsd | Driver license types — different domain |
| TypeOfDriverPermit | netex_vehicleType_version.xsd | Same |
| VehicleManoeuvringRequirement | netex_vehicleType_version.xsd | Turning radii etc — infrastructure concern |
| FacilityRequirement | netex_vehicleType_version.xsd | Generic facility — Sobek uses specific equipment entities |
| DeckNavigationPath | netex_deckPath_version.xsd | Pedestrian paths within deck — not persisted |
| DeckPathJunction | netex_deckPath_version.xsd | Path connection points |
| DeckPathLink | netex_deckPath_version.xsd | Path links |
| DeckLevel | netex_deckPlan_version.xsd | Level identification — Sobek flattens into Deck |
| DeckWindow | netex_deckPlan_version.xsd | Window positions — not persisted |
| DeckVehicleEntrance | netex_deckPlan_version.xsd | Vehicle entry (car ferry) — not in scope |
| OtherDeckEntrance | netex_deckPlan_version.xsd | Crew/emergency entrances |
| OtherDeckSpace | netex_deckPlan_version.xsd | Crew/luggage/equipment areas |
| PassengerVehicleSpot | netex_seatingPlan_version.xsd | Vehicle-on-vehicle spots (ferry) |
| TypeOfLocatableSpot | netex_seatingPlan_version.xsd | Classification — Sobek uses enum directly |
| TypeOfDeckEntrance | netex_deckPlan_version.xsd | Classification |
| TypeOfDeckEntranceUsage | netex_deckPlan_version.xsd | Classification |
| TypeOfDeckSpace | netex_deckPlan_version.xsd | Classification |
| ActualVehicleEquipment | netex_equipmentVehiclePassenger_version.xsd | Instance-level equipment — Sobek uses type-level profiles |

## Key Insights

### 1. x-netex-role: entity is a strong predictor

23 of Sobek's 29 entities (79%) map directly to definitions with `x-netex-role: entity`. The role annotation correctly identifies the persistence candidates. A codegen tool filtering by role would capture the core entity set.

### 2. Structures get promoted when they need independent identity

PassengerCapacity and DeckSpaceCapacity are `structure` in the XSD (no `id`/`version` attributes) but Sobek promotes them to `@Entity` because they need independent lifecycle (versioned, queryable, referenced by FK). This is a pattern the role system doesn't capture — **structures that gain entity status in a persistence context**.

### 3. "TypeOf" entities are mostly skipped

Sobek skips most `TypeOf*` NeTEx entities (TypeOfRollingStock, TypeOfLocatableSpot, TypeOfDeckSpace, etc.) and uses Java enums instead. The `x-netex-role: entity` annotation correctly marks these as entities, but in practice domain apps prefer enums for simple classifications.

### 4. Collection wrappers and path entities are skipped

NeTEx defines DeckNavigationPath, DeckPathLink, DeckPathJunction as entities, but Sobek doesn't persist navigation paths. Similarly, RollingStockInventory is a collection wrapper that Sobek replaces with direct queries. The `x-netex-role` annotation can't distinguish "structurally important entity" from "convenience wrapper."

### 5. MapStruct replaced Orika

Despite the workspace CLAUDE.md mentioning Orika, Sobek uses **MapStruct** exclusively with `@SobekMapperConfig`. The mappers are bidirectional (NeTEx ↔ Sobek) with `@AfterMapping` hooks for reference resolution. Each entity has a dedicated mapper.

### 6. Sobek's enum surface is large

~30 enumerations in `sobek-model`, all hand-written Java enums mirroring NeTEx `Enumeration` types. These correspond to `x-netex-role: enumeration` definitions in the schema. A codegen approach could generate these automatically.

## Implications for netex-typescript-model

1. **Role-filtered TypeScript generation** (TODO item) would correctly produce the core entity interfaces that a persistence layer needs. The `entity` + `frameMember` filter captures ~95% of what Sobek actually uses.

2. **Generating MapStruct-style mappers** from the schema is feasible — the `xml: { attribute: true }` annotations tell you attribute vs element, and `x-netex-role` tells you which types deserve mappers.

3. **Structure promotion** (PassengerCapacity, DeckSpaceCapacity) would need a supplementary config — the schema alone can't predict which structures an app will promote to entities.

4. **Enum generation** from `x-netex-role: enumeration` definitions could replace Sobek's 30 hand-written enum files.
