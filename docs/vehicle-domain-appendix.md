# Vehicle Domain — Entur Service Mapping

## uttu (nplan backend)

Timetable editor backend for flexible/fixed transport. Focused entirely on the passenger journey side — no vehicle/rolling stock domain.

### Current state

- **Domain model**: Line, FlexibleLine, FixedLine, JourneyPattern, ServiceJourney, StopPointInJourneyPattern, TimetabledPassingTime, DayType, Network, DestinationDisplay, Notice, BookingArrangement
- **NeTEx export**: CompositeFrame with ResourceFrame (organisations + brandings only), SiteFrame, ServiceFrame, ServiceCalendarFrame, TimetableFrame
- **ResourceFrame content**: `organisations` (Operators, Authorities) and `typesOfValue` (Brandings). The `vehicleTypes`, `vehicles`, and `trainElementTypes` collections are empty

Zero references to VehicleType, Train, CompoundTrain, TrainElement, or VehicleScheduleFrame.

### Vehicle domain fit

Uttu already owns the shared NeTEx file and its ResourceFrame. Adding vehicle type definitions here is a natural extension:

- **New model entities**: VehicleType, Train, CompoundTrain, TractiveElementType, TrailingElementType, TrainComponent — persisted in uttu's database
- **ResourceFrame expansion**: populate `vehicleTypes` and `trainElementTypes` alongside existing organisations
- **GraphQL schema additions**: types and mutations for managing vehicle types through hathor (nplan frontend)
- **Not in scope**: VehicleScheduleFrame (operational assignment of formations to journeys) — that concern belongs downstream

Uttu would manage the **type catalogue** ("what kinds of vehicles/formations exist"), not the **operational deployment** ("which formation runs journey X on date Y").

## scheduled-stock

Primary consumer of VehicleScheduleFrame at Entur. **Train-only** — no bus, ferry, tram, or coach handling.

### Current state

- Kotlin/Spring Boot service
- Parses VehicleScheduleFrame from NeTEx deliveries
- `TrainHandler` extracts `Train` and `CompoundTrain` from `ResourceFrame.vehicleTypes` — ignores plain `VehicleType`
- `MaterialEntity` (persisted) maps to a Train/CompoundTrain, with `ElementEntity` children for individual coaches (series, version, orientation, status)
- Calls an external `RollingStockService` to validate coach series/version against a rolling stock registry
- Links formations to journeys via `TrainBlock` → `ServiceJourney` from VehicleScheduleFrame

### NeTEx path through the code

```
ResourceFrame.vehicleTypes
  → Train / CompoundTrain              → MaterialEntity
    → TrainComponent                   → ElementEntity
      → TrainElementRefStructure       → logicalElementSeries + version

VehicleScheduleFrame.blocks
  → TrainBlock                         → DatedServiceJourneyEntity
    → TrainBlockPart → JourneyPartRef
```

### Relationship to uttu

If uttu were to manage vehicle type definitions in ResourceFrame, scheduled-stock would consume them as reference data — the same way it already consumes ServiceJourneys authored in uttu. The data flow would be:

```
uttu (authoring)                    scheduled-stock (operations)
──────────────                      ────────────────────────────
ResourceFrame                       VehicleScheduleFrame
 ├─ organisations                    ├─ TrainBlock
 ├─ vehicleTypes (new)       ──▶     │   └─ CompoundTrainRef ──▶ ResourceFrame.vehicleTypes
 └─ trainElementTypes (new)          └─ Fleet

TimetableFrame                      TrainBlock.journeyRef ──▶ TimetableFrame.ServiceJourney
 └─ ServiceJourney
```

Uttu defines *what*. Scheduled-stock assigns *when and where*.
