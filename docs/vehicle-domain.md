# NeTEx Vehicle Domain — Type Graph

## Formation hierarchy

All defined in **ResourceFrame**.

```
CompoundTrain (top-level formation — always use, even for a single Train)
 └─ TrainInCompoundTrain (ordered front→back, carries OperationalOrientation)
      └─ Train (deployment unit — cannot be split operationally)
          └─ TrainComponent (wrapper: Label, OperationalOrientation)
               └─ TrainElementTypeRef ──▶ TractiveElementType (self-propelled: locomotive)
                                        │ TrailingElementType (non-self-propelled: carriage, wagon)
```

## Inheritance

```
VehicleType                          ← scheduling classification (mode, capacity, dimensions)
 ├─ Train                            ← ordered set of TrainComponents
 └─ CompoundTrain                    ← ordered set of Trains

TrainElementType_VersionStructure    ← coach type (capacities, fare class, facilities)
 ├─ TractiveElementType              ← self-propelled
 └─ TrailingElementType              ← non-self-propelled
```

`VehicleType` classifies a **whole vehicle**. `TractiveElementType`/`TrailingElementType` describe **one car** inside it.

## Cyclic references

Two edges in the type graph form potential cycles:

```
CompoundTrain ──IncludedIn──▶ VehicleType ◀── CompoundTrain (is-a)
CompoundTrain ──components──▶ TrainInCompoundTrain ──CompoundTrainRef──▶ CompoundTrain
```

Both are **refs** (ID pointers), not inline containment — cycles can exist in data but cannot cause infinite nesting. The XSD does not constrain against circular references; that is a business-logic concern.

**`IncludedIn`** — parent pointer for type classification ("I'm a variant of that VehicleType"). Not fleet grouping.

**`CompoundTrainRef`** — a component within one compound train can reference another compound train it belongs to.

## Type vs instance vs schedule

| Concern | Entity | Frame | Abstraction |
|---------|--------|-------|-------------|
| What kind of vehicle | VehicleType, Train, CompoundTrain | ResourceFrame | Anonymous type |
| What coach types exist | TractiveElementType, TrailingElementType | ResourceFrame | Anonymous type |
| Which physical vehicle | Vehicle | ResourceFrame | Named instance |
| Which formation runs | TrainBlock → CompoundTrain | VehicleScheduleFrame | Operational link |
| Which vehicles as a group | Fleet | VehicleScheduleFrame | Grouping |

**ResourceFrame** holds type definitions and individual vehicles. **VehicleScheduleFrame** links formations to journeys via TrainBlocks and groups vehicles into Fleets.

## Formation changes

A CompoundTrain is not static — it morphs at:
- **Reversals** — components reordered
- **Splits/joins** — trains coupled or decoupled (JourneyPartCouples)
- **Coach locking** — status changes without physical change
- **Couchette day/night** — capacity reconfiguration

Each change requires a new JourneyPart break and an updated CompoundTrain reference.
