# Plan: NeTEx Type Classification Annotations (`x-netex-role`)

## Context

The `real-data-containers.md` skill reference defines heuristics for classifying NeTEx definitions into "real entities" vs "structural scaffolding". Currently the converter stamps `x-netex-source`, `x-netex-atom`, and `x-netex-assembly` but has no type classification. Adding `x-netex-role` enables downstream consumers (schema HTML viewer, split-output, future parser) to organize and filter types meaningfully.

**Only `json-schema/xsd-to-jsonschema.js` is modified** — the TypeScript converter is deprecated.

## Classification Values

| Value | Meaning | Detection |
|---|---|---|
| `"frameMember"` | Top-tier entity in a frame | Frame registry lookup |
| `"entity"` | Concrete element with substitutionGroup + DMO ancestry | Element metadata + chain |
| `"abstract"` | Abstract element (`abstract="true"` in XSD) | `elementMeta.abstract` flag |
| `"structure"` | Type definition (`_VersionStructure`, `_BaseStructure`) | Suffix |
| `"collection"` | Collection wrapper (`_RelStructure`) | Suffix |
| `"reference"` | Reference type (`_RefStructure`, `XxxRef`) | Suffix |
| `"view"` | Denormalized view (`_DerivedViewStructure`) | Suffix |
| `"enumeration"` | Simple type with enum values | Has `enum` array |

Frame members also get `x-netex-frames: ["ResourceFrame", "ServiceFrame", ...]`.

## Edge Case: Using netex-validator-java as artifact

**Problem**: XSD frame groups reference abstract elements (e.g., `Organisation_`) via substitution groups. The converter doesn't model substitution groups, so XSD-only frame membership analysis yields abstract heads rather than concrete entities (Operator, Authority).

**Solution**: Use a **data file** (`json-schema/frame-members.json`) populated from the validator's explicit concrete entity lists. The validator's `Default*FrameValidationTreeFactory` classes use XPath paths like `"lines/Line"`, `"organisations/Operator"` — these name the actual concrete elements.

**Benefits**:
- Bypasses the substitution group problem entirely
- Concrete, curated entity lists (not heuristic guesses)
- Decoupled from converter logic — easy to extend with more frames later
- Two-phase path: seed from validator now (Nordic frames), extend with FareFrame/SiteFrame/etc. later

**Validator coverage** (5 frames, ~30 entities):

| Frame | Concrete Entities |
|---|---|
| ServiceFrame | Line, FlexibleLine, Route, Network, GroupOfLines, DestinationDisplay, RoutePoint, ServiceLink, JourneyPattern, StopPointInJourneyPattern, PassengerStopAssignment |
| TimetableFrame | ServiceJourney, DatedServiceJourney, DeadRun, ServiceJourneyInterchange, TimetabledPassingTime, FlexibleServiceProperties |
| ResourceFrame | Operator, Authority |
| ServiceCalendarFrame | DayType, ServiceCalendar, DayTypeAssignment, OperatingPeriod |
| VehicleScheduleFrame | Block, TrainBlock |

**Not yet covered** (extend later): FareFrame, SiteFrame (StopPlace, Quay, Parking, etc.), MobilityServiceFrame, MobilityJourneyFrame, DriverScheduleFrame, SalesTransactionFrame.

## File: `json-schema/xsd-to-jsonschema.js` (~846 lines)

All classification logic goes here. Key integration points:

- **Constructor** (line 140): add `this.elementMeta = {}`
- **`convert()`** (line 246): capture element metadata in pass 2, call `classifyDefinitions()` as pass 4
- **After `annotateAtoms()`** (line 287): wire in the new pass

## New file: `json-schema/frame-members.json`

Static data file with frame→entity mappings. Loaded by the converter.

```json
{
  "_comment": "Frame membership registry. Seeded from netex-validator-java.",
  "ServiceFrame": ["Line", "FlexibleLine", "Route", "Network", ...],
  "TimetableFrame": ["ServiceJourney", "DatedServiceJourney", ...],
  ...
}
```

## Implementation Steps

### 1. Create `json-schema/frame-members.json`

Populate from validator data (table above). Simple JSON object: frame name → array of concrete element names.

### 2. Add element metadata capture in `convert()`

During the element loop (lines 274-284), record `abstract` and `substitutionGroup` attributes from raw DOM elements before conversion:

```javascript
// In convert(), element iteration:
this.elementMeta[name] = {
  abstract: attr(raw, "abstract") === "true",
  substitutionGroup: attr(raw, "substitutionGroup")
    ? this.stripNs(attr(raw, "substitutionGroup"))
    : null,
};
```

### 3. Add `loadFrameRegistry()` method

Loads `frame-members.json` and builds inverse map: entity name → set of frame names.

```javascript
loadFrameRegistry(jsonPath) {
  const content = new java.lang.String(
    Files.readAllBytes(Paths.get(jsonPath)), StandardCharsets.UTF_8
  );
  const raw = JSON.parse("" + content);
  const registry = {};  // entity name → [frame names]
  for (const [frame, entities] of Object.entries(raw)) {
    if (frame.startsWith("_")) continue;
    for (const entity of entities) {
      if (!registry[entity]) registry[entity] = [];
      registry[entity].push(frame);
    }
  }
  return registry;
}
```

### 4. Add `extendsDataManagedObject()` method

Same chain-following pattern as `resolveValueAtom()` (lines 674-732): follow `$ref` and `allOf` chains through converted definitions, check for `DataManagedObjectStructure`.

### 5. Add `classifyDefinitions(frameRegistry)` method

Runs after `annotateAtoms()`. For each definition in `this.types` + `this.elements`:

**Priority order** (first match wins):
1. Suffix: `_VersionStructure` / `_BaseStructure` → `"structure"`
2. Suffix: `_RelStructure` → `"collection"`
3. Suffix: `_RefStructure` / `*RefStructure` → `"reference"`
4. Suffix: `_DerivedViewStructure` → `"view"`
5. Has `enum` array → `"enumeration"`
6. Abstract element → `"abstract"`
7. In frame registry → `"frameMember"` + `x-netex-frames`
8. Concrete element with substitutionGroup + DMO ancestry → `"entity"`
9. Name ends in `Ref` and exists in elements → `"reference"`

Stamps `x-netex-role` and optionally `x-netex-frames` on the definition schema.

### 6. Wire into `convert()` and `main()`

- In `convert()` after `this.annotateAtoms()`: call `this.classifyDefinitions(this.frameRegistry)`
- In `main()` after creating the converter: `converter.frameRegistry = converter.loadFrameRegistry(frameMembersPath)` (resolve path relative to script location)
- Or: pass the frame registry path as an optional CLI arg, or locate it automatically from `__dirname` equivalent

### 7. Update `main()` to locate frame-members.json

The script runs from `json-schema/` directory (Makefile does `cd json-schema`). Use the `Paths` API to resolve `frame-members.json` relative to CWD:

```javascript
// In main(), after converter creation:
const scriptDir = Paths.get("").toAbsolutePath().toString(); // CWD = json-schema/
const frameMembersPath = Paths.get(scriptDir, "frame-members.json").toString();
if (Files.exists(Paths.get(frameMembersPath))) {
  converter.frameRegistry = converter.loadFrameRegistry(frameMembersPath);
} else {
  converter.frameRegistry = {};
}
```

## Verification

1. `make` — full pipeline generates schema with new annotations
2. Spot-check `generated-src/base/base.schema.json` (all these definitions exist in base):
   - `"Operator"` → `"x-netex-role": "frameMember"`, `"x-netex-frames": ["ResourceFrame"]`
   - `"Authority"` → `"x-netex-role": "frameMember"`, `"x-netex-frames": ["ResourceFrame"]`
   - `"DayType"` → `"x-netex-role": "frameMember"`, `"x-netex-frames": ["ServiceCalendarFrame"]`
   - `"Operator_VersionStructure"` → `"x-netex-role": "structure"`
   - `"objectRefs_RelStructure"` → `"x-netex-role": "collection"`
   - `"OperatorRefStructure"` → `"x-netex-role": "reference"`
   - `"ModificationEnumeration"` → `"x-netex-role": "enumeration"`
   - `"DataManagedObject"` → `"x-netex-role": "abstract"` (element has `abstract="true"` in XSD, no trailing underscore)
   - `"OperatorRef"` → `"x-netex-role": "reference"` (ends in `Ref`, exists in elements)
3. Count annotations: `grep -c "x-netex-role" generated-src/base/base.schema.json`
4. For network assembly: `make ASSEMBLY=network PARTS=part1_network` and verify `"Line"` → `"frameMember"`

## Notes on abstract element naming

NeTEx abstract elements do NOT consistently use trailing underscore. Examples:
- `DataManagedObject` — abstract, no underscore
- `OperatingPeriod_Dummy` — abstract, `_Dummy` suffix
- `SecurityList` — abstract, no suffix
- `ModeOfOperation` — abstract, no suffix

The detection MUST use the `abstract="true"` attribute from `elementMeta`, not suffix matching.
