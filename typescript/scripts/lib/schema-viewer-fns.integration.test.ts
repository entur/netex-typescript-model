import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  resolveDefType,
  resolveAtom,
  resolvePropertyType,
  flattenAllOf,
  buildReverseIndex,
  findTransitiveEntityUsers,
  defRole,
  unwrapMixed,
  inlineSingleRefs,
  type Defs,
  type ViaHop,
} from "./schema-viewer-fns.js";

const jsonschemaDir = resolve(import.meta.dirname, "../../../generated-src/base");

let defs: Defs;

beforeAll(() => {
  if (!existsSync(jsonschemaDir)) {
    throw new Error(
      `Base jsonschema dir not found at ${jsonschemaDir}.\nRun "npm run generate" first.`,
    );
  }
  const schemaFile = readdirSync(jsonschemaDir).find((f) => f.endsWith(".schema.json"));
  if (!schemaFile) {
    throw new Error(`No *.schema.json found in ${jsonschemaDir}.\nRun "npm run generate" first.`);
  }
  defs = JSON.parse(readFileSync(join(jsonschemaDir, schemaFile), "utf-8")).definitions;
});

describe("integration with real schema", () => {
  it("resolves NaturalLanguageStringStructure atom to simpleObj (value + lang)", () => {
    expect(resolveAtom(defs, "NaturalLanguageStringStructure")).toBe("simpleObj");
  });

  it("resolves VersionOfObjectRefStructure atom to simpleObj (value + 8 attrs)", () => {
    expect(resolveAtom(defs, "VersionOfObjectRefStructure")).toBe("simpleObj");
  });

  it("resolves GroupOfEntitiesRefStructure_Dummy atom", () => {
    const atom = resolveAtom(defs, "GroupOfEntitiesRefStructure_Dummy");
    expect(atom).toBeTruthy();
    // If it has extra props it'll be simpleObj, otherwise a primitive
    expect(typeof atom).toBe("string");
  });

  it("MultilingualString has no atom (no value property)", () => {
    expect(resolveAtom(defs, "MultilingualString")).toBeNull();
  });

  it("PrivateCodeStructure is simpleObj (value + type attr)", () => {
    // PrivateCodeStructure has { value, type } — two props → simpleObj
    expect(resolveAtom(defs, "PrivateCodeStructure")).toBe("simpleObj");
    // resolveDefType treats simpleObj as complex
    const result = resolveDefType(defs, "PrivateCodeStructure");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "PrivateCodeStructure", rule: "complex" }]);
  });

  it("flattenAllOf produces properties for a real type", () => {
    const props = flattenAllOf(defs, "VersionOfObjectRefStructure");
    expect(props.length).toBeGreaterThan(0);
    expect(props.some((p) => p.prop[0] === "value")).toBe(true);
  });
});

describe("resolvePropertyType — real schema (Interface tab)", () => {
  it("resolves a $ref property to its primitive with via chain", () => {
    // VersionOfObjectRefStructure.value → $ref ObjectIdType → string
    const schema = defs["VersionOfObjectRefStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(1);
    expect(result.via![result.via!.length - 1].rule).toBe("primitive");
  });

  it("resolves an allOf-wrapped $ref to a stamped enum name with via", () => {
    // VersionOfObjectRefStructure.modification → allOf[$ref ModificationEnumeration]
    const schema = defs["VersionOfObjectRefStructure"]?.properties?.["modification"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("ModificationEnumeration");
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });

  it("resolves an inline primitive with format (no via — inline schema)", () => {
    // VersionOfObjectRefStructure.created → { type: "string", format: "date-time" }
    const schema = defs["VersionOfObjectRefStructure"]?.properties?.["created"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    // Inline primitives go through classifySchema → "primitive" branch, no resolveDefType → no via
    expect(result.ts).toBe("string /* date-time */");
    expect(result.complex).toBe(false);
    expect(result.via).toBeUndefined();
  });

  it("resolves an array of $ref items", () => {
    // MultilingualString.Text → { type: "array", items: { $ref: TextType } }
    const schema = defs["MultilingualString"]?.properties?.["Text"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result.ts).toMatch(/\[\]$/);
  });

  it("resolves an inline string property (no via — inline schema)", () => {
    // PrivateCodeStructure.value → { type: "string" }
    const schema = defs["PrivateCodeStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    // Inline primitives don't go through resolveDefType → no via
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via).toBeUndefined();
  });

  it("works end-to-end: flattenAllOf + resolvePropertyType + resolveAtom", () => {
    // Simulates what the Interface tab does for each property
    const props = flattenAllOf(defs, "VersionOfObjectRefStructure");
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      const resolved = resolvePropertyType(defs, p.schema);
      expect(resolved.ts).toBeTruthy();
      // If complex, resolveAtom should be callable without error
      if (resolved.complex) {
        const typeName = resolved.ts.endsWith("[]") ? resolved.ts.slice(0, -2) : resolved.ts;
        resolveAtom(defs, typeName); // should not throw
      }
    }
  });
});

describe("VehicleType — deep entity scenario (Interface tab)", () => {
  it("flattenAllOf collects properties from entire 5-level chain", () => {
    const props = flattenAllOf(defs, "VehicleType");
    expect(props.length).toBeGreaterThan(20);
    // Own properties from VehicleType_VersionStructure
    expect(props.some((p) => p.prop[1] === "lowFloor")).toBe(true);
    expect(props.some((p) => p.prop[1] === "length")).toBe(true);
    // Inherited from TransportType_VersionStructure
    expect(
      props.some((p) => p.prop[1] === "name" && p.origin === "TransportType_VersionStructure"),
    ).toBe(true);
    expect(props.some((p) => p.prop[1] === "transportMode")).toBe(true);
    // Deep inherited from EntityInVersionStructure
    expect(props.some((p) => p.prop[1] === "created")).toBe(true);
    expect(props.some((p) => p.prop[1] === "version")).toBe(true);
  });

  it("flattenAllOf origin chain documents exactly 5 types and why", () => {
    // VehicleType is a pure $ref alias to VehicleType_VersionStructure — it contributes
    // no own properties and therefore never appears as an origin.
    //
    // The chain terminates at EntityStructure because it is a plain object with
    // properties but no allOf and no $ref — flattenAllOf has nothing further to walk.
    //
    // Full chain (innermost → outermost):
    //   EntityStructure                  (ROOT — plain object, 2 props: id, nameOfClass)
    //   EntityInVersionStructure         (allOf → EntityStructure, 12 own props)
    //   DataManagedObjectStructure       (allOf → EntityInVersionStructure, 5 own props)
    //   TransportType_VersionStructure   (allOf → DataManagedObjectStructure, 17 own props)
    //   VehicleType_VersionStructure     (allOf → TransportType_VersionStructure, 19 own props)
    const props = flattenAllOf(defs, "VehicleType");
    const origins = [...new Set(props.map((p) => p.origin))];

    expect(origins).toHaveLength(5);
    expect(origins).toEqual([
      "EntityStructure",
      "EntityInVersionStructure",
      "DataManagedObjectStructure",
      "TransportType_VersionStructure",
      "VehicleType_VersionStructure",
    ]);

    // Single-$ref properties: 1-to-1 relations (not collections or arrays).
    // Schema is { allOf: [{ $ref }] } or { $ref } — exactly one target type.
    // _RelStructure types are collection wrappers, not 1-to-1 relations.
    const singleRefs = props.filter((p) => {
      const s = p.schema as Record<string, unknown>;
      const hasSingleRef =
        !!s.$ref ||
        (Array.isArray(s.allOf) &&
          s.allOf.length === 1 &&
          !!(s.allOf[0] as Record<string, unknown>)?.$ref);
      if (!hasSingleRef) return false;
      const result = resolvePropertyType(defs, p.schema);
      return result.complex && !result.ts.endsWith("[]") && !result.ts.endsWith("_RelStructure");
    });

    const refsByOrigin: Record<string, string[]> = {};
    for (const o of origins) {
      const refs = singleRefs.filter((p) => p.origin === o).map((p) => p.prop[0]);
      if (refs.length > 0) refsByOrigin[o] = refs;
    }

    // EntityStructure has no single-$ref properties (only id: string, nameOfClass: enum)
    expect(refsByOrigin["EntityStructure"]).toBeUndefined();
    // EntityInVersionStructure: none after excluding _RelStructure collections
    expect(refsByOrigin["EntityInVersionStructure"]).toBeUndefined();

    expect(refsByOrigin).toEqual({
      DataManagedObjectStructure: ["BrandingRef"],
      TransportType_VersionStructure: ["PrivateCode", "DeckPlanRef", "PassengerCapacity"],
      VehicleType_VersionStructure: ["IncludedIn", "ClassifiedAsRef"],
    });
  });

  it("resolvePropertyType handles booleans from VehicleType", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const lowFloor = props.find((p) => p.prop[1] === "lowFloor");
    expect(lowFloor).toBeDefined();
    expect(resolvePropertyType(defs, lowFloor!.schema)).toEqual({ ts: "boolean", complex: false });
  });

  it("resolvePropertyType resolves allOf-wrapped measurement types", () => {
    // Length → allOf[$ref LengthType] → should resolve to an atom
    const props = flattenAllOf(defs, "VehicleType");
    const length = props.find((p) => p.prop[1] === "length");
    expect(length).toBeDefined();
    const result = resolvePropertyType(defs, length!.schema);
    expect(result.ts).toBeTruthy();
    // LengthType is a simpleContent wrapper — resolveAtom exposes the primitive
    const atom = resolveAtom(defs, "LengthType");
    if (atom) expect(typeof atom).toBe("string");
  });

  it("resolvePropertyType resolves enum from inherited TransportMode to enum name", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const mode = props.find((p) => p.prop[1] === "transportMode");
    expect(mode).toBeDefined();
    const result = resolvePropertyType(defs, mode!.schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("AllPublicTransportModesEnumeration");
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });

  it("resolvePropertyType resolves array from deep-inherited ValidBetween", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const vb = props.find((p) => p.prop[1] === "validBetween");
    expect(vb).toBeDefined();
    const result = resolvePropertyType(defs, vb!.schema);
    expect(result.ts).toMatch(/\[\]$/);
  });

  it("resolvePropertyType resolves BrandingRef as complex via x-netex-atom simpleObj", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const branding = props.find((p) => p.prop[1] === "brandingRef");
    expect(branding).toBeDefined();
    const result = resolvePropertyType(defs, branding!.schema);
    // BrandingRef chain ends at a simpleObj (value + attrs) — stays complex
    expect(result.complex).toBe(true);
  });

  it("resolvePropertyType resolves complex ref types", () => {
    // capacities → allOf[$ref passengerCapacities_RelStructure] — a complex structure
    const props = flattenAllOf(defs, "VehicleType");
    const cap = props.find((p) => p.prop[1] === "capacities");
    expect(cap).toBeDefined();
    const result = resolvePropertyType(defs, cap!.schema);
    expect(result.complex).toBe(true);
  });

  it("resolvePropertyType unwraps keyList to KeyValueStructure[] (simpleObj atom as [])", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const kl = props.find((p) => p.prop[1] === "keyList");
    expect(kl).toBeDefined();
    const result = resolvePropertyType(defs, kl!.schema);
    // keyList → KeyListStructure (single-prop, no role) → KeyValue: KeyValueStructure[] (simpleObj)
    expect(result.ts).toBe("KeyValueStructure[]");
    expect(result.complex).toBe(true);
    // keyList def → allOf-passthrough → KeyListStructure → array-unwrap → KeyValueStructure (complex)
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via!.some((h) => h.name === "KeyListStructure" && h.rule === "array-unwrap")).toBe(
      true,
    );
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "KeyValueStructure",
      rule: "complex",
    });
  });

  it("resolvePropertyType unwraps privateCodes to PrivateCodeStructure[] (simpleObj atom as [])", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const pc = props.find((p) => p.prop[1] === "privateCodes");
    expect(pc).toBeDefined();
    const result = resolvePropertyType(defs, pc!.schema);
    // privateCodes → PrivateCodesStructure (single-prop, no role) → PrivateCode → PrivateCodeStructure (simpleObj)
    expect(result.ts).toBe("PrivateCodeStructure[]");
    expect(result.complex).toBe(true);
    // privateCodes → allOf-passthrough → PrivateCodesStructure → array-unwrap → PrivateCode → allOf-passthrough → PrivateCodeStructure (complex)
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(
      result.via!.some((h) => h.name === "PrivateCodesStructure" && h.rule === "array-unwrap"),
    ).toBe(true);
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "PrivateCodeStructure",
      rule: "complex",
    });
  });

  it("complex props: most resolve to shallow types, few have further complexity", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const complexProps: { name: string; ts: string }[] = [];
    const furtherComplexity: { name: string; ts: string; deepComplex: string[] }[] = [];

    for (const p of props) {
      const resolved = resolvePropertyType(defs, p.schema);
      if (!resolved.complex) continue;

      const typeName = resolved.ts.endsWith("[]") ? resolved.ts.slice(0, -2) : resolved.ts;
      complexProps.push({ name: p.prop[0], ts: resolved.ts });

      // Resolve one level deeper — are this type's own props all non-complex?
      const innerProps = flattenAllOf(defs, typeName);
      const deepComplex: string[] = [];
      for (const ip of innerProps) {
        const innerResolved = resolvePropertyType(defs, ip.schema);
        if (innerResolved.complex) deepComplex.push(ip.prop[0]);
      }
      if (deepComplex.length > 0) {
        furtherComplexity.push({ name: p.prop[0], ts: resolved.ts, deepComplex });
      }
    }

    // VehicleType has 19 complex props: 10 shallow, 9 with further complexity.
    //
    // Shallow (all inner props resolve to primitives/enums/arrays):
    //   keyList, privateCodes, BrandingRef, Name, ShortName, Description,
    //   PrivateCode, DeckPlanRef, IncludedIn, ClassifiedAsRef
    //
    // Further complexity (inner props that are themselves complex):
    //   alternativeTexts, validityConditions, ValidBetween, PassengerCapacity,
    //   facilities, capacities, canCarry, canManoeuvre, satisfiesFacilityRequirements
    //
    // These are _RelStructure collections and deep entity structures whose inner
    // types reference further entities/structures — inherent domain complexity.
    expect(complexProps.length).toBeGreaterThan(3);
    const shallowCount = complexProps.length - furtherComplexity.length;
    expect(shallowCount).toBeGreaterThan(0);
    // Pin: resolution improvements should decrease this, regressions increase it
    expect(furtherComplexity.length).toBe(9);
  });

  it("resolvePropertyType unpacks Extensions as non-complex object", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const ext = props.find((p) => p.prop[1] === "extensions");
    expect(ext).toBeDefined();
    const result = resolvePropertyType(defs, ext!.schema);
    // Extensions → ExtensionsStructure (xsd:any wrapper — no properties, no role)
    expect(result.ts).toBe("any");
    expect(result.complex).toBe(false);
    // Extensions → allOf-passthrough → ExtensionsStructure (empty-object)
    expect(result.via!.length).toBeGreaterThanOrEqual(1);
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "ExtensionsStructure",
      rule: "empty-object",
    });
  });
});

describe("resolvePropertyType — uncovered shape kinds", () => {
  it("direct $ref (not allOf-wrapped): OrderedVersionOfObjectRefStructure.value", () => {
    const schema = defs["OrderedVersionOfObjectRefStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    expect(schema.$ref).toBeDefined(); // confirm direct $ref, not allOf
    const result = resolvePropertyType(defs, schema);
    expect(result.complex).toBe(true);
    expect(result.ts).toBe("VersionOfObjectRefStructure");
    expect(result.via).toEqual([{ name: "VersionOfObjectRefStructure", rule: "complex" }]);
  });

  it("integer primitive: OrderedVersionOfObjectRefStructure.order", () => {
    const schema = defs["OrderedVersionOfObjectRefStructure"]?.properties?.["order"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result).toEqual({ ts: "integer", complex: false });
  });

  it("number primitive: MeasureType.value", () => {
    const schema = defs["MeasureType"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result).toEqual({ ts: "number", complex: false });
  });

  it("anyOf union def: NilReasonType resolves to union", () => {
    const result = resolveDefType(defs, "NilReasonType");
    expect(result.complex).toBe(false);
    expect(result.ts).toContain("|");
  });

  it("anyOf union as property: MeasureType.uom → UomIdentifier", () => {
    const schema = defs["MeasureType"]?.properties?.["uom"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toContain("|");
  });

  it("inline array (no $ref items): CapabilityRequestPolicyStructure.NationalLanguage", () => {
    const schema =
      defs["CapabilityRequestPolicyStructure"]?.properties?.["NationalLanguage"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result.ts).toBe("string[]");
    expect(result.complex).toBe(false);
  });
});

describe("findTransitiveEntityUsers — real schema", () => {
  let reverseIdx: Record<string, string[]>;
  const isEntity = (name: string) => defRole(defs[name]) === "entity";

  beforeAll(() => {
    reverseIdx = buildReverseIndex(defs);
  });

  it("PostalAddress reaches entities through AddressablePlace chain", () => {
    // PostalAddress → AddressablePlace_VersionStructure → ... → entity
    const entities = findTransitiveEntityUsers("PostalAddress", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    // Every result must actually be an entity
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("MultilingualString is used by many entities (multi-hop, ubiquitous)", () => {
    // 0 direct entity referrers but 97 total referrers — should find many entities transitively
    const entities = findTransitiveEntityUsers("MultilingualString", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(20);
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("PrivateCodeStructure reaches entities through wrappers", () => {
    // PrivateCodeStructure → PrivateCode/Country_VersionStructure → ... → entities
    const entities = findTransitiveEntityUsers("PrivateCodeStructure", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("GroupOfEntities_VersionStructure reaches entities (deep inheritance)", () => {
    // Sits deep in the inheritance chain, no direct entity refs
    const entities = findTransitiveEntityUsers(
      "GroupOfEntities_VersionStructure",
      reverseIdx,
      isEntity,
    );
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("an entity returns other entities that reference it (not itself)", () => {
    // Pick an entity that other entities likely reference (e.g. via Ref types)
    if (!defs["TopographicPlace"]) return; // skip if not in base
    const entities = findTransitiveEntityUsers("TopographicPlace", reverseIdx, isEntity);
    expect(entities).not.toContain("TopographicPlace");
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("an enumeration finds entities that use it", () => {
    // StopPlaceTypeEnumeration should be used by StopPlace (through _VersionStructure)
    if (!defs["StopPlaceTypeEnumeration"]) return; // skip if not in base
    const entities = findTransitiveEntityUsers("StopPlaceTypeEnumeration", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("completes in reasonable time for a heavily-referenced type", () => {
    const start = performance.now();
    findTransitiveEntityUsers("MultilingualString", reverseIdx, isEntity);
    const elapsed = performance.now() - start;
    // Should complete well under 1 second even for 3000+ defs
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("resolveDefType — $ref alias and allOf chains", () => {
  // VT prop: id (EntityStructure), also VersionOfObjectRefStructure.value/.ref
  it("ObjectIdType resolves to string primitive", () => {
    const result = resolveDefType(defs, "ObjectIdType");
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(1);
    expect(result.via![0].name).toBe("ObjectIdType");
    expect(result.via![result.via!.length - 1].rule).toBe("primitive");
  });

  // VT prop: version (EntityInVersionStructure), also VersionOfObjectRefStructure.version/.versionRef
  it("VersionIdType → ObjectIdType → string (multi-hop alias chain)", () => {
    const result = resolveDefType(defs, "VersionIdType");
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("VersionIdType");
    expect(result.via![result.via!.length - 1].rule).toBe("primitive");
  });

  // VT prop: nameOfClass (EntityStructure), also VersionOfObjectRefStructure.nameOfRefClass
  it("alias to enum: NameOfClass stops at enum name", () => {
    const result = resolveDefType(defs, "NameOfClass");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("NameOfClass");
    expect(result.via).toEqual([{ name: "NameOfClass", rule: "enum" }]);
  });

  // VT prop: modification (EntityInVersionStructure), also VersionOfObjectRefStructure.modification
  it("direct enum: ModificationEnumeration stops at enum name", () => {
    const result = resolveDefType(defs, "ModificationEnumeration");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("ModificationEnumeration");
    expect(result.via).toEqual([{ name: "ModificationEnumeration", rule: "enum" }]);
  });

  // Standalone schema type — not a VT prop
  it("1-hop alias to complex simpleObj: DataSourceRefStructure → VersionOfObjectRefStructure", () => {
    const result = resolveDefType(defs, "DataSourceRefStructure");
    expect(result.complex).toBe(true);
    expect(result.ts).toBe("VersionOfObjectRefStructure");
    // Chain: allOf-passthrough hops until terminal complex
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("DataSourceRefStructure");
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "VersionOfObjectRefStructure",
      rule: "complex",
    });
  });

  // Standalone schema type — not a VT prop
  it("2-hop alias to complex simpleObj: TypeOfFrameRefStructure → VersionOfObjectRefStructure", () => {
    const result = resolveDefType(defs, "TypeOfFrameRefStructure");
    expect(result.complex).toBe(true);
    expect(result.ts).toBe("VersionOfObjectRefStructure");
    expect(result.via!.length).toBeGreaterThanOrEqual(3);
    expect(result.via![0].name).toBe("TypeOfFrameRefStructure");
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "VersionOfObjectRefStructure",
      rule: "complex",
    });
  });

  // Standalone schema type — not a VT prop (framework ref with own props)
  it("allOf-extending stays complex: ClassInFrameRefStructure (has own props)", () => {
    const result = resolveDefType(defs, "ClassInFrameRefStructure");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "ClassInFrameRefStructure", rule: "complex" }]);
  });

  // VT prop: BrandingRef (DataManagedObjectStructure)
  it("allOf wrapper follows through: BrandingRef → VersionOfObjectRefStructure", () => {
    const result = resolveDefType(defs, "BrandingRef");
    expect(result.complex).toBe(true);
    expect(result.ts).toBe("VersionOfObjectRefStructure");
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("BrandingRef");
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "VersionOfObjectRefStructure",
      rule: "complex",
    });
  });

  // Standalone schema type — not a VT prop (deep ref chain)
  it("multi-hop via GroupOfEntities chain: GeneralGroupOfEntitiesRefStructure → complex", () => {
    const result = resolveDefType(defs, "GeneralGroupOfEntitiesRefStructure");
    expect(result.complex).toBe(true);
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("GeneralGroupOfEntitiesRefStructure");
    expect(result.via![result.via!.length - 1].rule).toBe("complex");
  });

  // Standalone SIRI type — not a VT prop (x-netex-atom: "string", collapses via withVia)
  it("single-prop atom collapses to primitive: ParticipantRefStructure → string", () => {
    const result = resolveDefType(defs, "ParticipantRefStructure");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("string");
    expect(result.via).toEqual([{ name: "ParticipantRefStructure", rule: "atom-collapse" }]);
  });
});

describe("x-netex-atom:array — ListOfEnumerations", () => {
  it("all xsd:list types carry the x-netex-atom:array stamp", () => {
    const arrays = Object.entries(defs).filter(
      ([, d]) => (d as Record<string, unknown>).type === "array",
    );
    expect(arrays.length).toBeGreaterThan(0);
    for (const [name, d] of arrays) {
      expect((d as Record<string, unknown>)["x-netex-atom"]).toBe("array");
    }
  });

  it("resolveDefType: ref-to-enum resolves to EnumName[]", () => {
    const result = resolveDefType(defs, "PropulsionTypeListOfEnumerations");
    expect(result.ts).toBe("PropulsionTypeEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "PropulsionTypeListOfEnumerations", rule: "array-of" },
      { name: "PropulsionTypeEnumeration", rule: "enum" },
    ]);
  });

  it("resolveDefType: inline primitive items resolve to string[]", () => {
    const result = resolveDefType(defs, "LanguageListOfEnumerations");
    expect(result.ts).toBe("string[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "LanguageListOfEnumerations", rule: "array-of" },
    ]);
  });

  it("resolvePropertyType: VehicleType.PropulsionTypes → PropulsionTypeEnumeration[]", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const pt = props.find((p) => p.prop[0] === "PropulsionTypes");
    expect(pt).toBeDefined();
    const result = resolvePropertyType(defs, pt!.schema);
    expect(result.ts).toBe("PropulsionTypeEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });

  it("resolvePropertyType: VehicleType.FuelTypes → FuelTypeEnumeration[]", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const ft = props.find((p) => p.prop[0] === "FuelTypes");
    expect(ft).toBeDefined();
    const result = resolvePropertyType(defs, ft!.schema);
    expect(result.ts).toBe("FuelTypeEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });
});

describe("defRole — edge cases", () => {
  it("GroupOfEntitiesRefStructure_Dummy is unclassified (no role annotation, no suffix match)", () => {
    expect(defRole(defs["GroupOfEntitiesRefStructure_Dummy"])).toBe("unclassified");
  });
});

// NOTE: This test validates an annotation set by xsd-to-jsonschema.js (the Java DOM
// converter). It lives here because integration tests already load the generated schema,
// but it may move to a json-schema/ test suite in the future.
describe("x-netex-mixed annotation", () => {
  it("MultilingualString is the only mixed-content type", () => {
    const mixed = Object.entries(defs).filter(
      ([, d]) => (d as Record<string, unknown>)["x-netex-mixed"] === true,
    );
    expect(mixed).toHaveLength(1);
    expect(mixed[0][0]).toBe("MultilingualString");
  });

  it("unwrapMixed resolves MultilingualString to TextType", () => {
    expect(unwrapMixed(defs, "MultilingualString")).toBe("TextType");
  });

  it("resolveDefType resolves MultilingualString as TextType[] via wrapper", () => {
    const result = resolveDefType(defs, "MultilingualString");
    expect(result.ts).toBe("TextType[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "MultilingualString", rule: "mixed-unwrap" }]);
  });

  it("resolvePropertyType shows TextType[] for a MultilingualString property", () => {
    // Name is a common MultilingualString property on many NeTEx types
    const props = flattenAllOf(defs, "DataManagedObjectStructure");
    const name = props.find((p) => p.prop[0] === "Name");
    if (!name) return; // skip if not present
    const result = resolvePropertyType(defs, name.schema);
    expect(result.ts).toBe("TextType[]");
    expect(result.complex).toBe(true);
    // via comes from resolveDefType on MultilingualString (mixed-unwrap)
    expect(result.via).toEqual([{ name: "MultilingualString", rule: "mixed-unwrap" }]);
  });
});

describe("inlineSingleRefs — VehicleType real schema", () => {
  it("replaces 1-to-1 ref candidates with inner props, excluding reference and atom roles", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const result = inlineSingleRefs(defs, props);

    // The 6 single-$ref props from the chain test:
    //   BrandingRef, PrivateCode, DeckPlanRef, PassengerCapacity, IncludedIn, ClassifiedAsRef
    //
    // BrandingRef, DeckPlanRef, IncludedIn, ClassifiedAsRef → VersionOfObjectRefStructure (role=reference) → SKIPPED
    // PrivateCode → PrivateCodeStructure (x-netex-atom: "simpleObj") → SKIPPED (atom)
    // PassengerCapacity → PassengerCapacityStructure (role=structure) → INLINED
    //
    // The 4 reference-role targets should remain as-is
    expect(result.some((p) => p.prop[1] === "brandingRef" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "deckPlanRef" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "includedIn" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "classifiedAsRef" && !p.inlinedFrom)).toBe(true);

    // PrivateCode → atom type, should remain as-is (not inlined)
    expect(result.some((p) => p.prop[1] === "privateCode" && !p.inlinedFrom)).toBe(true);

    // PassengerCapacity should be replaced by its inner props
    expect(result.some((p) => p.prop[1] === "passengerCapacity" && !p.inlinedFrom)).toBe(false);
    const capInlined = result.filter((p) => p.inlinedFrom === "passengerCapacity");
    expect(capInlined.length).toBeGreaterThan(0);

    // Shared-ancestor props (EntityStructure, EntityInVersionStructure,
    // DataManagedObjectStructure) should NOT be duplicated from PassengerCapacity —
    // they already exist in the parent chain.
    const capNames = capInlined.map((p) => p.prop[1]);
    const sharedAncestorProps = ["id", "version", "created", "changed", "keyList", "BrandingRef"];
    for (const name of sharedAncestorProps) {
      expect(capNames).not.toContain(name);
    }

    // Only PassengerCapacityStructure's own props should be inlined
    const expectedCapProps = [
      "fareClass",
      "totalCapacity",
      "seatingCapacity",
      "standingCapacity",
      "specialPlaceCapacity",
      "pushchairCapacity",
      "wheelchairPlaceCapacity",
    ];
    for (const name of expectedCapProps) {
      expect(capNames).toContain(name);
    }

    // All inlined props should have inlinedFrom set
    for (const ip of capInlined) {
      expect(ip.inlinedFrom).toBeTruthy();
    }
  });

  it("total prop count increases (inlined target expands)", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const result = inlineSingleRefs(defs, props);
    // 1 single-$ref prop (PassengerCapacity) replaced by its inner props (≥2)
    // So result should have more props than original
    expect(result.length).toBeGreaterThan(props.length);
  });
});
