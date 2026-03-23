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
  genMockObject,
  serialize,
  resolveRefEntity,
  collectRefProps,
  collectExtraProps,
  collectDependencyTree,
  type NetexLibrary,
  type ViaHop,
} from "./fns.js";

const jsonschemaDir = resolve(import.meta.dirname, "../../../generated-src/base");

let netexLibrary: NetexLibrary;

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
  netexLibrary = JSON.parse(readFileSync(join(jsonschemaDir, schemaFile), "utf-8")).definitions;
});

describe("integration with real schema", () => {
  it("resolves NaturalLanguageStringStructure atom to simpleObj (value + lang)", () => {
    expect(resolveAtom(netexLibrary, "NaturalLanguageStringStructure")).toBe("simpleObj");
  });

  it("resolves VersionOfObjectRefStructure atom to simpleObj (value + 8 attrs)", () => {
    expect(resolveAtom(netexLibrary, "VersionOfObjectRefStructure")).toBe("simpleObj");
  });

  it("resolves GroupOfEntitiesRefStructure_Dummy atom", () => {
    const atom = resolveAtom(netexLibrary, "GroupOfEntitiesRefStructure_Dummy");
    expect(atom).toBeTruthy();
    // If it has extra props it'll be simpleObj, otherwise a primitive
    expect(typeof atom).toBe("string");
  });

  it("MultilingualString has no atom (no value property)", () => {
    expect(resolveAtom(netexLibrary, "MultilingualString")).toBeNull();
  });

  it("PrivateCodeStructure is simpleObj (value + type attr)", () => {
    // PrivateCodeStructure has { value, type } — two props → simpleObj
    expect(resolveAtom(netexLibrary, "PrivateCodeStructure")).toBe("simpleObj");
    // resolveDefType treats simpleObj as complex
    const result = resolveDefType(netexLibrary, "PrivateCodeStructure");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "PrivateCodeStructure", rule: "complex" }]);
  });

  it("flattenAllOf produces properties for a real type", () => {
    const props = flattenAllOf(netexLibrary, "VersionOfObjectRefStructure");
    expect(props.length).toBeGreaterThan(0);
    expect(props.some((p) => p.prop[0] === "value")).toBe(true);
  });
});

describe("resolvePropertyType — real schema (Interface tab)", () => {
  it("resolves a $ref property to its primitive with via chain", () => {
    // VersionOfObjectRefStructure.value → $ref ObjectIdType → string
    const schema = netexLibrary["VersionOfObjectRefStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(netexLibrary, schema);
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(1);
    expect(result.via![result.via!.length - 1].rule).toBe("primitive");
  });

  it("resolves an allOf-wrapped $ref to a stamped enum name with via", () => {
    // VersionOfObjectRefStructure.modification → allOf[$ref ModificationEnumeration]
    const schema = netexLibrary["VersionOfObjectRefStructure"]?.properties?.["modification"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(netexLibrary, schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("ModificationEnumeration");
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });

  it("resolves an inline primitive with format (no via — inline schema)", () => {
    // VersionOfObjectRefStructure.created → { type: "string", format: "date-time" }
    const schema = netexLibrary["VersionOfObjectRefStructure"]?.properties?.["created"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(netexLibrary, schema);
    // Inline primitives go through classifySchema → "primitive" branch, no resolveDefType → no via
    expect(result.ts).toBe("string /* date-time */");
    expect(result.complex).toBe(false);
    expect(result.via).toBeUndefined();
  });

  it("resolves an array of $ref items", () => {
    // MultilingualString.Text → { type: "array", items: { $ref: TextType } }
    const schema = netexLibrary["MultilingualString"]?.properties?.["Text"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(netexLibrary, schema);
    expect(result.ts).toMatch(/\[\]$/);
  });

  it("resolves an inline string property (no via — inline schema)", () => {
    // PrivateCodeStructure.value → { type: "string" }
    const schema = netexLibrary["PrivateCodeStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(netexLibrary, schema);
    // Inline primitives don't go through resolveDefType → no via
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via).toBeUndefined();
  });

  it("works end-to-end: flattenAllOf + resolvePropertyType + resolveAtom", () => {
    // Simulates what the Interface tab does for each property
    const props = flattenAllOf(netexLibrary, "VersionOfObjectRefStructure");
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      const resolved = resolvePropertyType(netexLibrary, p.schema);
      expect(resolved.ts).toBeTruthy();
      // If complex, resolveAtom should be callable without error
      if (resolved.complex) {
        const typeName = resolved.ts.endsWith("[]") ? resolved.ts.slice(0, -2) : resolved.ts;
        resolveAtom(netexLibrary, typeName); // should not throw
      }
    }
  });
});

describe("VehicleType — deep entity scenario (Interface tab)", () => {
  it("flattenAllOf collects properties from entire 5-level chain", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    expect(props.length).toBeGreaterThan(20);
    // Own properties from VehicleType_VersionStructure
    expect(props.some((p) => p.prop[1] === "LowFloor")).toBe(true);
    expect(props.some((p) => p.prop[1] === "Length")).toBe(true);
    // Inherited from TransportType_VersionStructure
    expect(
      props.some((p) => p.prop[1] === "Name" && p.origin === "TransportType_VersionStructure"),
    ).toBe(true);
    expect(props.some((p) => p.prop[1] === "TransportMode")).toBe(true);
    // Deep inherited from EntityInVersionStructure (XML attributes get $ prefix)
    expect(props.some((p) => p.prop[1] === "$created")).toBe(true);
    expect(props.some((p) => p.prop[1] === "$version")).toBe(true);
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
    const props = flattenAllOf(netexLibrary, "VehicleType");
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
      const result = resolvePropertyType(netexLibrary, p.schema);
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
      TransportType_VersionStructure: ["PrivateCode", "PassengerCapacity", "DeckPlanRef"],
      VehicleType_VersionStructure: ["IncludedIn", "ClassifiedAsRef"],
    });
  });

  it("resolvePropertyType handles booleans from VehicleType", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const lowFloor = props.find((p) => p.prop[1] === "LowFloor");
    expect(lowFloor).toBeDefined();
    expect(resolvePropertyType(netexLibrary, lowFloor!.schema)).toEqual({ ts: "boolean", complex: false });
  });

  it("resolvePropertyType resolves allOf-wrapped measurement types", () => {
    // Length → allOf[$ref LengthType] → should resolve to an atom
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const length = props.find((p) => p.prop[1] === "Length");
    expect(length).toBeDefined();
    const result = resolvePropertyType(netexLibrary, length!.schema);
    expect(result.ts).toBeTruthy();
    // LengthType is a simpleContent wrapper — resolveAtom exposes the primitive
    const atom = resolveAtom(netexLibrary, "LengthType");
    if (atom) expect(typeof atom).toBe("string");
  });

  it("resolvePropertyType resolves enum from inherited TransportMode to enum name", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const mode = props.find((p) => p.prop[1] === "TransportMode");
    expect(mode).toBeDefined();
    const result = resolvePropertyType(netexLibrary, mode!.schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("AllPublicTransportModesEnumeration");
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });

  it("resolvePropertyType resolves array from deep-inherited ValidBetween", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const vb = props.find((p) => p.prop[1] === "ValidBetween");
    expect(vb).toBeDefined();
    const result = resolvePropertyType(netexLibrary, vb!.schema);
    expect(result.ts).toMatch(/\[\]$/);
  });

  it("resolvePropertyType resolves BrandingRef as complex via x-netex-atom simpleObj", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const branding = props.find((p) => p.prop[1] === "BrandingRef");
    expect(branding).toBeDefined();
    const result = resolvePropertyType(netexLibrary, branding!.schema);
    // BrandingRef chain ends at a simpleObj (value + attrs) — stays complex
    expect(result.complex).toBe(true);
  });

  it("resolvePropertyType resolves complex ref types", () => {
    // capacities → allOf[$ref passengerCapacities_RelStructure] — a complex structure
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const cap = props.find((p) => p.prop[1] === "capacities"); // lowercase in XSD
    expect(cap).toBeDefined();
    const result = resolvePropertyType(netexLibrary, cap!.schema);
    expect(result.complex).toBe(true);
  });

  it("resolvePropertyType unwraps keyList to KeyValueStructure[] (simpleObj atom as [])", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const kl = props.find((p) => p.prop[1] === "keyList"); // lowercase in XSD
    expect(kl).toBeDefined();
    const result = resolvePropertyType(netexLibrary, kl!.schema);
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
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const pc = props.find((p) => p.prop[1] === "privateCodes"); // lowercase in XSD
    expect(pc).toBeDefined();
    const result = resolvePropertyType(netexLibrary, pc!.schema);
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
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const complexProps: { name: string; ts: string }[] = [];
    const furtherComplexity: { name: string; ts: string; deepComplex: string[] }[] = [];

    for (const p of props) {
      const resolved = resolvePropertyType(netexLibrary, p.schema);
      if (!resolved.complex) continue;

      const typeName = resolved.ts.endsWith("[]") ? resolved.ts.slice(0, -2) : resolved.ts;
      complexProps.push({ name: p.prop[0], ts: resolved.ts });

      // Resolve one level deeper — are this type's own props all non-complex?
      const innerProps = flattenAllOf(netexLibrary, typeName);
      const deepComplex: string[] = [];
      for (const ip of innerProps) {
        const innerResolved = resolvePropertyType(netexLibrary, ip.schema);
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
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const ext = props.find((p) => p.prop[1] === "Extensions");
    expect(ext).toBeDefined();
    const result = resolvePropertyType(netexLibrary, ext!.schema);
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
    const schema = netexLibrary["OrderedVersionOfObjectRefStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    expect(schema.$ref).toBeDefined(); // confirm direct $ref, not allOf
    const result = resolvePropertyType(netexLibrary, schema);
    expect(result.complex).toBe(true);
    expect(result.ts).toBe("VersionOfObjectRefStructure");
    expect(result.via).toEqual([{ name: "VersionOfObjectRefStructure", rule: "complex" }]);
  });

  it("integer primitive: OrderedVersionOfObjectRefStructure.order", () => {
    const schema = netexLibrary["OrderedVersionOfObjectRefStructure"]?.properties?.["order"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(netexLibrary, schema);
    expect(result).toEqual({ ts: "number", complex: false });
  });

  it("number primitive: MeasureType.value", () => {
    const schema = netexLibrary["MeasureType"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(netexLibrary, schema);
    expect(result).toEqual({ ts: "number", complex: false });
  });

  it("anyOf union def: NilReasonType resolves to union", () => {
    const result = resolveDefType(netexLibrary, "NilReasonType");
    expect(result.complex).toBe(false);
    expect(result.ts).toContain("|");
  });

  it("anyOf union as property: MeasureType.uom → UomIdentifier", () => {
    const schema = netexLibrary["MeasureType"]?.properties?.["uom"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(netexLibrary, schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toContain("|");
  });

  it("inline array (no $ref items): CapabilityRequestPolicyStructure.NationalLanguage", () => {
    const schema =
      netexLibrary["CapabilityRequestPolicyStructure"]?.properties?.["NationalLanguage"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(netexLibrary, schema);
    expect(result.ts).toBe("string[]");
    expect(result.complex).toBe(false);
  });
});

describe("findTransitiveEntityUsers — real schema", () => {
  let reverseIdx: Record<string, string[]>;
  const isEntity = (name: string) => defRole(netexLibrary[name]) === "entity";

  beforeAll(() => {
    reverseIdx = buildReverseIndex(netexLibrary);
  });

  it("PostalAddress reaches entities through AddressablePlace chain", () => {
    // PostalAddress → AddressablePlace_VersionStructure → ... → entity
    const entities = findTransitiveEntityUsers("PostalAddress", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    // Every result must actually be an entity
    for (const e of entities) {
      expect(defRole(netexLibrary[e])).toBe("entity");
    }
  });

  it("MultilingualString is used by many entities (multi-hop, ubiquitous)", () => {
    // 0 direct entity referrers but 97 total referrers — should find many entities transitively
    const entities = findTransitiveEntityUsers("MultilingualString", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(20);
    for (const e of entities) {
      expect(defRole(netexLibrary[e])).toBe("entity");
    }
  });

  it("PrivateCodeStructure reaches entities through wrappers", () => {
    // PrivateCodeStructure → PrivateCode/Country_VersionStructure → ... → entities
    const entities = findTransitiveEntityUsers("PrivateCodeStructure", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(netexLibrary[e])).toBe("entity");
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
      expect(defRole(netexLibrary[e])).toBe("entity");
    }
  });

  it("an entity returns other entities that reference it (not itself)", () => {
    // Pick an entity that other entities likely reference (e.g. via Ref types)
    if (!netexLibrary["TopographicPlace"]) return; // skip if not in base
    const entities = findTransitiveEntityUsers("TopographicPlace", reverseIdx, isEntity);
    expect(entities).not.toContain("TopographicPlace");
    for (const e of entities) {
      expect(defRole(netexLibrary[e])).toBe("entity");
    }
  });

  it("an enumeration finds entities that use it", () => {
    // StopPlaceTypeEnumeration should be used by StopPlace (through _VersionStructure)
    if (!netexLibrary["StopPlaceTypeEnumeration"]) return; // skip if not in base
    const entities = findTransitiveEntityUsers("StopPlaceTypeEnumeration", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(netexLibrary[e])).toBe("entity");
    }
  });

  it("completes in reasonable time for a heavily-referenced type", () => {
    const start = performance.now();
    findTransitiveEntityUsers("MultilingualString", reverseIdx, isEntity);
    const elapsed = performance.now() - start;
    // Should complete well under 1 second even for 3000+ definitions
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("resolveDefType — $ref alias and allOf chains", () => {
  // VT prop: id (EntityStructure), also VersionOfObjectRefStructure.value/.ref
  it("ObjectIdType resolves to string primitive", () => {
    const result = resolveDefType(netexLibrary, "ObjectIdType");
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(1);
    expect(result.via![0].name).toBe("ObjectIdType");
    expect(result.via![result.via!.length - 1].rule).toBe("primitive");
  });

  // VT prop: version (EntityInVersionStructure), also VersionOfObjectRefStructure.version/.versionRef
  it("VersionIdType → ObjectIdType → string (multi-hop alias chain)", () => {
    const result = resolveDefType(netexLibrary, "VersionIdType");
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("VersionIdType");
    expect(result.via![result.via!.length - 1].rule).toBe("primitive");
  });

  // VT prop: nameOfClass (EntityStructure), also VersionOfObjectRefStructure.nameOfRefClass
  it("alias to enum: NameOfClass stops at enum name", () => {
    const result = resolveDefType(netexLibrary, "NameOfClass");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("NameOfClass");
    expect(result.via).toEqual([{ name: "NameOfClass", rule: "enum" }]);
  });

  // VT prop: modification (EntityInVersionStructure), also VersionOfObjectRefStructure.modification
  it("direct enum: ModificationEnumeration stops at enum name", () => {
    const result = resolveDefType(netexLibrary, "ModificationEnumeration");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("ModificationEnumeration");
    expect(result.via).toEqual([{ name: "ModificationEnumeration", rule: "enum" }]);
  });

  // Standalone schema type — not a VT prop
  it("1-hop alias to complex simpleObj: DataSourceRefStructure → VersionOfObjectRefStructure", () => {
    const result = resolveDefType(netexLibrary, "DataSourceRefStructure");
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
    const result = resolveDefType(netexLibrary, "TypeOfFrameRefStructure");
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
    const result = resolveDefType(netexLibrary, "ClassInFrameRefStructure");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "ClassInFrameRefStructure", rule: "complex" }]);
  });

  // VT prop: BrandingRef (DataManagedObjectStructure)
  it("allOf wrapper follows through: BrandingRef → VersionOfObjectRefStructure", () => {
    const result = resolveDefType(netexLibrary, "BrandingRef");
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
    const result = resolveDefType(netexLibrary, "GeneralGroupOfEntitiesRefStructure");
    expect(result.complex).toBe(true);
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("GeneralGroupOfEntitiesRefStructure");
    expect(result.via![result.via!.length - 1].rule).toBe("complex");
  });

  // Standalone SIRI type — not a VT prop (x-netex-atom: "string", collapses via withVia)
  it("single-prop atom collapses to primitive: ParticipantRefStructure → string", () => {
    const result = resolveDefType(netexLibrary, "ParticipantRefStructure");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("string");
    expect(result.via).toEqual([{ name: "ParticipantRefStructure", rule: "atom-collapse" }]);
  });
});

describe("x-netex-atom:array — ListOfEnumerations", () => {
  it("all xsd:list types carry the x-netex-atom:array stamp", () => {
    const arrays = Object.entries(netexLibrary).filter(
      ([, d]) => (d as Record<string, unknown>).type === "array",
    );
    expect(arrays.length).toBeGreaterThan(0);
    for (const [name, d] of arrays) {
      expect((d as Record<string, unknown>)["x-netex-atom"]).toBe("array");
    }
  });

  it("resolveDefType: ref-to-enum resolves to EnumName[]", () => {
    const result = resolveDefType(netexLibrary, "PropulsionTypeListOfEnumerations");
    expect(result.ts).toBe("PropulsionTypeEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "PropulsionTypeListOfEnumerations", rule: "array-of" },
      { name: "PropulsionTypeEnumeration", rule: "enum" },
    ]);
  });

  it("resolveDefType: inline primitive items resolve to string[]", () => {
    const result = resolveDefType(netexLibrary, "LanguageListOfEnumerations");
    expect(result.ts).toBe("string[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "LanguageListOfEnumerations", rule: "array-of" },
    ]);
  });

  it("resolvePropertyType: VehicleType.PropulsionTypes → PropulsionTypeEnumeration[]", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const pt = props.find((p) => p.prop[0] === "PropulsionTypes");
    expect(pt).toBeDefined();
    const result = resolvePropertyType(netexLibrary, pt!.schema);
    expect(result.ts).toBe("PropulsionTypeEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });

  it("resolvePropertyType: VehicleType.FuelTypes → FuelTypeEnumeration[]", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const ft = props.find((p) => p.prop[0] === "FuelTypes");
    expect(ft).toBeDefined();
    const result = resolvePropertyType(netexLibrary, ft!.schema);
    expect(result.ts).toBe("FuelTypeEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });
});

describe("defRole — edge cases", () => {
  it("GroupOfEntitiesRefStructure_Dummy is unclassified (no role annotation, no suffix match)", () => {
    expect(defRole(netexLibrary["GroupOfEntitiesRefStructure_Dummy"])).toBe("unclassified");
  });
});

// NOTE: This test validates an annotation set by xsd-to-jsonschema.js (the Java DOM
// converter). It lives here because integration tests already load the generated schema,
// but it may move to a json-schema/ test suite in the future.
describe("x-netex-mixed annotation", () => {
  it("MultilingualString is the only mixed-content type", () => {
    const mixed = Object.entries(netexLibrary).filter(
      ([, d]) => (d as Record<string, unknown>)["x-netex-mixed"] === true,
    );
    expect(mixed).toHaveLength(1);
    expect(mixed[0][0]).toBe("MultilingualString");
  });

  it("unwrapMixed resolves MultilingualString to TextType", () => {
    expect(unwrapMixed(netexLibrary, "MultilingualString")).toBe("TextType");
  });

  it("resolveDefType resolves MultilingualString as TextType[] via wrapper", () => {
    const result = resolveDefType(netexLibrary, "MultilingualString");
    expect(result.ts).toBe("TextType[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "MultilingualString", rule: "mixed-unwrap" }]);
  });

  it("resolvePropertyType shows TextType[] for a MultilingualString property", () => {
    // Name is a common MultilingualString property on many NeTEx types
    const props = flattenAllOf(netexLibrary, "DataManagedObjectStructure");
    const name = props.find((p) => p.prop[0] === "Name");
    if (!name) return; // skip if not present
    const result = resolvePropertyType(netexLibrary, name.schema);
    expect(result.ts).toBe("TextType[]");
    expect(result.complex).toBe(true);
    // via comes from resolveDefType on MultilingualString (mixed-unwrap)
    expect(result.via).toEqual([{ name: "MultilingualString", rule: "mixed-unwrap" }]);
  });
});

describe("inlineSingleRefs — VehicleType real schema", () => {
  it("replaces 1-to-1 ref candidates with inner props, excluding reference and atom roles", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const result = inlineSingleRefs(netexLibrary, props);

    // The 6 single-$ref props from the chain test:
    //   BrandingRef, PrivateCode, DeckPlanRef, PassengerCapacity, IncludedIn, ClassifiedAsRef
    //
    // BrandingRef, DeckPlanRef, IncludedIn, ClassifiedAsRef → VersionOfObjectRefStructure (role=reference) → SKIPPED
    // PrivateCode → PrivateCodeStructure (x-netex-atom: "simpleObj") → SKIPPED (atom)
    // PassengerCapacity → PassengerCapacityStructure (role=structure) → INLINED
    //
    // The 4 reference-role targets should remain as-is
    expect(result.some((p) => p.prop[1] === "BrandingRef" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "DeckPlanRef" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "IncludedIn" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "ClassifiedAsRef" && !p.inlinedFrom)).toBe(true);

    // PrivateCode → atom type, should remain as-is (not inlined)
    expect(result.some((p) => p.prop[1] === "PrivateCode" && !p.inlinedFrom)).toBe(true);

    // PassengerCapacity should be replaced by its inner props
    expect(result.some((p) => p.prop[1] === "PassengerCapacity" && !p.inlinedFrom)).toBe(false);
    const capInlined = result.filter((p) => p.inlinedFrom === "PassengerCapacity");
    expect(capInlined.length).toBeGreaterThan(0);

    // Shared-ancestor props (EntityStructure, EntityInVersionStructure,
    // DataManagedObjectStructure) should NOT be duplicated from PassengerCapacity —
    // they already exist in the parent chain.
    const capNames = capInlined.map((p) => p.prop[1]);
    const sharedAncestorProps = ["$id", "$version", "$created", "$changed", "keyList", "BrandingRef"];
    for (const name of sharedAncestorProps) {
      expect(capNames).not.toContain(name);
    }

    // Only PassengerCapacityStructure's own props should be inlined
    const expectedCapProps = [
      "FareClass",
      "TotalCapacity",
      "SeatingCapacity",
      "StandingCapacity",
      "SpecialPlaceCapacity",
      "PushchairCapacity",
      "WheelchairPlaceCapacity",
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
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const result = inlineSingleRefs(netexLibrary, props);
    // 1 single-$ref prop (PassengerCapacity) replaced by its inner props (≥2)
    // So result should have more props than original
    expect(result.length).toBeGreaterThan(props.length);
  });
});

// ── x-fixed-single-enum resolution ──────────────────────────────────────────

describe("resolvePropertyType — x-fixed-single-enum (real schema)", () => {
  it("Operator.nameOfClass with context resolves to string literal", () => {
    const props = flattenAllOf(netexLibrary, "Operator");
    const noc = props.find((p) => p.prop[0] === "nameOfClass");
    expect(noc).toBeDefined();
    expect(noc!.schema["x-fixed-single-enum"]).toBe("NameOfClass");
    const result = resolvePropertyType(netexLibrary, noc!.schema, "Operator");
    expect(result).toEqual({
      ts: '"Operator"',
      complex: false,
      via: [{ name: "Operator", rule: "fixed-for" }],
    });
  });

  it("VehicleType.nameOfClass with context resolves to string literal", () => {
    const props = flattenAllOf(netexLibrary, "VehicleType");
    const noc = props.find((p) => p.prop[0] === "nameOfClass");
    expect(noc).toBeDefined();
    expect(noc!.schema["x-fixed-single-enum"]).toBe("NameOfClass");
    const result = resolvePropertyType(netexLibrary, noc!.schema, "VehicleType");
    expect(result).toEqual({
      ts: '"VehicleType"',
      complex: false,
      via: [{ name: "VehicleType", rule: "fixed-for" }],
    });
  });

  it("nameOfClass without context resolves to NameOfClass enum normally", () => {
    const props = flattenAllOf(netexLibrary, "Operator");
    const noc = props.find((p) => p.prop[0] === "nameOfClass");
    expect(noc).toBeDefined();
    const result = resolvePropertyType(netexLibrary, noc!.schema);
    // Without context, falls through to normal enum resolution
    expect(result.ts).toBe("NameOfClass");
    expect(result.via).toEqual([{ name: "NameOfClass", rule: "enum" }]);
  });
});

// ── genMockObject — real schema ─────────────────────────────────────────────

describe("genMockObject — VehicleType (real schema)", () => {
  it("has $id containing VehicleType", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    expect(mock.$id).toContain("VehicleType");
  });

  it("has $version set to '1'", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    expect(mock.$version).toBe("1");
  });

  it("has TransportMode as a valid enum value", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    expect(typeof mock.TransportMode).toBe("string");
    expect((mock.TransportMode as string).length).toBeGreaterThan(0);
  });

  it("has LowFloor as a boolean", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    expect(typeof mock.LowFloor).toBe("boolean");
  });

  it("has BrandingRef as ref-pattern object", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    const ref = mock.BrandingRef as Record<string, unknown>;
    expect(ref).toBeDefined();
    expect(typeof ref.value).toBe("string");
    expect(typeof ref.$ref).toBe("string");
  });

  it("has PropulsionTypes as array with enum value", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    const pt = mock.PropulsionTypes;
    expect(Array.isArray(pt)).toBe(true);
    expect((pt as unknown[]).length).toBeGreaterThan(0);
    expect(typeof (pt as unknown[])[0]).toBe("string");
  });

  it("has $nameOfClass matching the entity name (XML attribute)", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    // nameOfClass is an XML attribute → canonical name is $nameOfClass
    expect(mock.$nameOfClass).toBe("VehicleType");
  });

  it("includes properties from all 5 inherited origins", () => {
    // VehicleType chain (see flattenAllOf origin chain test):
    //   EntityStructure                  (ROOT — id, nameOfClass)
    //   EntityInVersionStructure         ($version, $created, $changed, $modification, ...)
    //   DataManagedObjectStructure       (keyList, BrandingRef, ...)
    //   TransportType_VersionStructure   (TransportMode, PrivateCode, ...)
    //   VehicleType_VersionStructure     (LowFloor, Length, PropulsionTypes, ...)
    //
    const mock = genMockObject(netexLibrary, "VehicleType");

    // EntityStructure
    expect(mock.$id).toBeDefined();
    expect(mock.$nameOfClass).toBeDefined();

    // EntityInVersionStructure
    expect(mock.$version).toBeDefined();
    expect(mock.$created).toBeDefined();
    expect(mock.$changed).toBeDefined();
    expect(mock.$modification).toBeDefined();

    // DataManagedObjectStructure
    expect(mock.BrandingRef).toBeDefined();

    // TransportType_VersionStructure — TransportMode (enum), PrivateCode (simpleObj atom),
    // Name (shallow-complex: TextType[])
    expect(mock.TransportMode).toBeDefined();
    expect(mock.PrivateCode).toBeDefined();
    expect(mock.Name).toBeDefined();
    expect(Array.isArray(mock.Name)).toBe(true);

    // VehicleType_VersionStructure
    expect(mock.LowFloor).toBeDefined();
    expect(mock.Length).toBeDefined();
    expect(mock.PropulsionTypes).toBeDefined();
    expect(mock.FuelTypes).toBeDefined();
  });

  it("fills Name as TextType[] array with value and $lang (shallow-complex via mixed-unwrap)", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    expect(Array.isArray(mock.Name)).toBe(true);
    const item = (mock.Name as Record<string, unknown>[])[0];
    expect(item).toBeDefined();
    expect("value" in item).toBe(true);
    expect("$lang" in item).toBe(true);
  });

  it("fills Description as TextType[] (same shallow-complex path as Name)", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    expect(Array.isArray(mock.Description)).toBe(true);
  });

  it("fills keyList as wrapper with KeyValue child array", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    const wrapper = mock.keyList as Record<string, unknown>;
    expect(wrapper).toBeDefined();
    expect(typeof wrapper).toBe("object");
    expect(Array.isArray(wrapper.KeyValue)).toBe(true);
    const item = (wrapper.KeyValue as Record<string, unknown>[])[0];
    expect(item).toBeDefined();
    expect("Key" in item).toBe(true);
    expect("Value" in item).toBe(true);
  });

  it("fills privateCodes as wrapper with PrivateCode child array", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    const wrapper = mock.privateCodes as Record<string, unknown>;
    expect(wrapper).toBeDefined();
    expect(typeof wrapper).toBe("object");
    expect(Array.isArray(wrapper.PrivateCode)).toBe(true);
    const item = (wrapper.PrivateCode as Record<string, unknown>[])[0];
    expect(item).toBeDefined();
    expect("value" in item).toBe(true);
  });

  it("fills plain string properties with \"string\" default", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    const pc = mock.PrivateCode as Record<string, unknown>;
    expect(pc.value).toBe("string");
  });

  it("fills $created as date-time string (inherited from EntityInVersionStructure)", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    expect(mock.$created).toBe("2025-01-01T00:00:00");
  });

  it("fills $modification as first enum value (inherited from EntityInVersionStructure)", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    expect(typeof mock.$modification).toBe("string");
    expect((mock.$modification as string).length).toBeGreaterThan(0);
  });

  it("fills Length as a number (inherited from VehicleType_VersionStructure)", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    // Length → LengthType → atom collapse to number
    expect(typeof mock.Length).toBe("number");
  });
});

describe("serialize — VehicleType (real schema)", () => {
  it("produces XML starting with <VehicleType", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    const xml = serialize(netexLibrary, "VehicleType", mock);
    expect(xml).toContain("<VehicleType");
  });

  it("contains id= attribute", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    const xml = serialize(netexLibrary, "VehicleType", mock);
    expect(xml).toContain('id=');
  });

  it("contains version= attribute", () => {
    const mock = genMockObject(netexLibrary, "VehicleType");
    const xml = serialize(netexLibrary, "VehicleType", mock);
    expect(xml).toContain('version=');
  });
});

// ── x-netex-refTarget annotation stamp ──────────────────────────────────────

describe("x-netex-refTarget annotation", () => {
  it("TransportTypeRef has stamp pointing to TransportType", () => {
    expect(netexLibrary["TransportTypeRef"]["x-netex-refTarget"]).toBe("TransportType");
  });

  it("TransportTypeRefStructure has stamp pointing to TransportType", () => {
    expect(netexLibrary["TransportTypeRefStructure"]["x-netex-refTarget"]).toBe("TransportType");
  });

  it("at least 160 reference-role definitions have the stamp", () => {
    const stamped = Object.entries(netexLibrary).filter(
      ([, d]) => d["x-netex-refTarget"] !== undefined,
    );
    expect(stamped.length).toBeGreaterThanOrEqual(160);
  });

  it("framework refs like VersionOfObjectRef have no stamp", () => {
    expect(netexLibrary["VersionOfObjectRef"]?.["x-netex-refTarget"]).toBeUndefined();
  });
});

// ── resolveRefEntity — real schema ──────────────────────────────────────────

describe("resolveRefEntity — real schema", () => {
  it("TransportTypeRef resolves to TransportType entity", () => {
    expect(resolveRefEntity(netexLibrary, "TransportTypeRef")).toBe("TransportType");
  });

  it("VehicleModelRef resolves to VehicleModel entity", () => {
    expect(resolveRefEntity(netexLibrary, "VehicleModelRef")).toBe("VehicleModel");
  });

  it("OrganisationRef resolves to concrete entity sg-members (abstract expansion)", () => {
    const result = resolveRefEntity(netexLibrary, "OrganisationRef");
    expect(Array.isArray(result)).toBe(true);
    expect((result as string[]).length).toBeGreaterThan(0);
    // Every result should be an entity
    for (const name of result as string[]) {
      expect(defRole(netexLibrary[name])).toBe("entity");
    }
  });

  it("VersionOfObjectRef returns null (framework ref)", () => {
    expect(resolveRefEntity(netexLibrary, "VersionOfObjectRef")).toBeNull();
  });
});

// ── collectRefProps — real schema ───────────────────────────────────────────

describe("collectRefProps — real schema", () => {
  it("Vehicle_VersionStructure has ref props including TransportTypeRef", () => {
    const result = collectRefProps(netexLibrary, "Vehicle_VersionStructure");
    expect(result.length).toBeGreaterThanOrEqual(3);
    const names = result.map((r) => r.propName);
    expect(names).toContain("TransportTypeRef");
    expect(names).toContain("VehicleModelRef");
  });

  it("all returned target entities have entity role", () => {
    const result = collectRefProps(netexLibrary, "Vehicle_VersionStructure");
    for (const entry of result) {
      for (const e of entry.targetEntities) {
        expect(defRole(netexLibrary[e])).toBe("entity");
      }
    }
  });
});

// ── collectExtraProps — real schema ─────────────────────────────────────────

describe("collectExtraProps — real schema", () => {
  it("TransportType at TransportType_VersionStructure base has no extras", () => {
    expect(collectExtraProps(netexLibrary, "TransportType", "TransportType_VersionStructure")).toEqual([]);
  });

  it("VehicleType at TransportType_VersionStructure base has ~19 extras", () => {
    const extras = collectExtraProps(netexLibrary, "VehicleType", "TransportType_VersionStructure");
    expect(extras.length).toBeGreaterThanOrEqual(15);
    expect(extras).toContain("LowFloor");
    expect(extras).toContain("Length");
    expect(extras).toContain("ClassifiedAsRef");
  });

  it("SimpleVehicleType at TransportType_VersionStructure base has ~11 extras", () => {
    const extras = collectExtraProps(netexLibrary, "SimpleVehicleType", "TransportType_VersionStructure");
    expect(extras.length).toBeGreaterThanOrEqual(8);
    expect(extras).toContain("VehicleCategory");
    expect(extras).toContain("NumberOfWheels");
    expect(extras).toContain("Portable");
  });

  it("VehicleType extras do not include TransportMode (ancestor prop)", () => {
    const extras = collectExtraProps(netexLibrary, "VehicleType", "TransportType_VersionStructure");
    expect(extras).not.toContain("TransportMode");
  });
});

// ── VehicleType_VersionStructure end-to-end relations ───────────────────────

describe("VehicleType_VersionStructure — relations end-to-end", () => {
  it("collectRefProps finds at least 4 ref props", () => {
    const refs = collectRefProps(netexLibrary, "VehicleType_VersionStructure");
    expect(refs.length).toBeGreaterThanOrEqual(4);
    const names = refs.map((r) => r.propName);
    expect(names).toContain("BrandingRef");
    expect(names).toContain("ClassifiedAsRef");
    expect(names).toContain("DeckPlanRef");
    expect(names).toContain("IncludedIn");
  });

  it("ClassifiedAsRef resolves to VehicleModel entity", () => {
    const refs = collectRefProps(netexLibrary, "VehicleType_VersionStructure");
    const classified = refs.find((r) => r.propName === "ClassifiedAsRef");
    expect(classified).toBeDefined();
    expect(classified!.targetEntities).toContain("VehicleModel");
  });

  it("DeckPlanRef resolves to DeckPlan entity", () => {
    const refs = collectRefProps(netexLibrary, "VehicleType_VersionStructure");
    const dp = refs.find((r) => r.propName === "DeckPlanRef");
    expect(dp).toBeDefined();
    expect(dp!.targetEntities).toContain("DeckPlan");
  });

  it("IncludedIn resolves to VehicleType entity", () => {
    const refs = collectRefProps(netexLibrary, "VehicleType_VersionStructure");
    const inc = refs.find((r) => r.propName === "IncludedIn");
    expect(inc).toBeDefined();
    expect(inc!.targetEntities).toContain("VehicleType");
  });

  it("BrandingRef resolves to Branding entity", () => {
    const refs = collectRefProps(netexLibrary, "VehicleType_VersionStructure");
    const br = refs.find((r) => r.propName === "BrandingRef");
    expect(br).toBeDefined();
    expect(br!.targetEntities).toContain("Branding");
  });

  it("findTransitiveEntityUsers finds VehicleType, Train, and CompoundTrain", () => {
    const reverseIndex = buildReverseIndex(netexLibrary);
    const entities = findTransitiveEntityUsers(
      "VehicleType_VersionStructure",
      reverseIndex,
      (n) => defRole(netexLibrary[n]) === "entity",
    );
    expect(entities).toContain("VehicleType");
    expect(entities).toContain("Train");
    expect(entities).toContain("CompoundTrain");
    // SimpleVehicleType does NOT extend VehicleType_VersionStructure
    expect(entities).not.toContain("SimpleVehicleType");
  });

  it("VehicleType has no extra props at VehicleType_VersionStructure base", () => {
    expect(collectExtraProps(netexLibrary, "VehicleType", "VehicleType_VersionStructure")).toEqual([]);
  });

  it("Train has TrainSize and components as extras beyond VehicleType_VersionStructure", () => {
    const extras = collectExtraProps(netexLibrary, "Train", "VehicleType_VersionStructure");
    expect(extras).toContain("TrainSize");
    expect(extras).toContain("components");
  });

  it("CompoundTrain has components as extra beyond VehicleType_VersionStructure", () => {
    const extras = collectExtraProps(netexLibrary, "CompoundTrain", "VehicleType_VersionStructure");
    expect(extras).toContain("components");
  });

  it("Train extras do not include VehicleType_VersionStructure props", () => {
    const extras = collectExtraProps(netexLibrary, "Train", "VehicleType_VersionStructure");
    // These are on VehicleType_VersionStructure itself, not on intermediate levels
    expect(extras).not.toContain("LowFloor");
    expect(extras).not.toContain("Length");
    expect(extras).not.toContain("PropulsionTypes");
  });
});

// ── collectDependencyTree ───────────────────────────────────────────────────

describe("collectDependencyTree", () => {
  it("enum returns empty", () => {
    expect(collectDependencyTree(netexLibrary, "ModificationEnumeration")).toHaveLength(0);
  });

  it("simple structure has expected deps", () => {
    const tree = collectDependencyTree(netexLibrary, "ContactStructure");
    const unique = tree.filter((n) => !n.duplicate);
    expect(unique.length).toBeGreaterThanOrEqual(3);
    const names = unique.map((n) => n.name);
    expect(names).toContain("MultilingualString");
    expect(names).toContain("PhoneType");
    expect(names).toContain("EmailAddressType");
  });

  it("ContactStructure tree has duplicates for reused types", () => {
    const tree = collectDependencyTree(netexLibrary, "ContactStructure");
    const duplicates = tree.filter((n) => n.duplicate);
    const dupNames = duplicates.map((n) => n.name);
    // Phone and MultilingualString are used by multiple properties
    expect(dupNames).toContain("PhoneType");
    expect(dupNames).toContain("MultilingualString");
  });

  it("deep entity has many deps — Authority", () => {
    const tree = collectDependencyTree(netexLibrary, "Authority");
    const unique = tree.filter((n) => !n.duplicate);
    const total = tree.length;
    expect(unique.length).toBeGreaterThan(10);
    expect(total).toBeGreaterThan(unique.length);
  });

  it("root excluded from output", () => {
    const tree = collectDependencyTree(netexLibrary, "Authority");
    // Authority itself should not appear; resolve its alias too
    expect(tree.every((n) => n.name !== "Authority")).toBe(true);
  });

  it("via paths reference known property names", () => {
    const tree = collectDependencyTree(netexLibrary, "ContactStructure");
    const first = tree[0];
    expect(first.via).toBeTruthy();
    expect(typeof first.via).toBe("string");
  });

  it("BFS depth ordering — all depth-0 before depth-1", () => {
    const tree = collectDependencyTree(netexLibrary, "Authority");
    if (tree.length === 0) return;
    let lastDepth0Idx = -1;
    let firstDepth1Idx = Infinity;
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].depth === 0) lastDepth0Idx = i;
      if (tree[i].depth === 1 && i < firstDepth1Idx) firstDepth1Idx = i;
    }
    if (firstDepth1Idx < Infinity) {
      expect(lastDepth0Idx).toBeLessThan(firstDepth1Idx);
    }
  });
});
