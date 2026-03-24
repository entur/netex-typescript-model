import { describe, it, expect, beforeAll } from "vitest";
import { resolveDefType, resolveAtom, resolvePropertyType } from "./type-res.js";
import { unwrapMixed } from "./classify.js";
import { flattenAllOf } from "./schema-nav.js";
import { loadNetexLibrary } from "./test-helpers.js";
import type { NetexLibrary } from "./types.js";

let lib: NetexLibrary;
beforeAll(() => { lib = loadNetexLibrary(); });

describe("resolveAtom — real schema", () => {
  it("NaturalLanguageStringStructure → simpleObj (value + lang)", () => {
    expect(resolveAtom(lib, "NaturalLanguageStringStructure")).toBe("simpleObj");
  });

  it("VersionOfObjectRefStructure → simpleObj (value + 8 attrs)", () => {
    expect(resolveAtom(lib, "VersionOfObjectRefStructure")).toBe("simpleObj");
  });

  it("GroupOfEntitiesRefStructure_Dummy has an atom", () => {
    const atom = resolveAtom(lib, "GroupOfEntitiesRefStructure_Dummy");
    expect(atom).toBeTruthy();
    expect(typeof atom).toBe("string");
  });

  it("MultilingualString has no atom (no value property)", () => {
    expect(resolveAtom(lib, "MultilingualString")).toBeNull();
  });

  it("PrivateCodeStructure is simpleObj (value + type attr)", () => {
    expect(resolveAtom(lib, "PrivateCodeStructure")).toBe("simpleObj");
    const result = resolveDefType(lib, "PrivateCodeStructure");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "PrivateCodeStructure", rule: "complex" }]);
  });
});

describe("resolvePropertyType — real schema (Interface tab)", () => {
  it("resolves a $ref property to its primitive with via chain", () => {
    const schema = lib["VersionOfObjectRefStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(1);
    expect(result.via![result.via!.length - 1].rule).toBe("primitive");
  });

  it("resolves an allOf-wrapped $ref to a stamped enum name with via", () => {
    const schema = lib["VersionOfObjectRefStructure"]?.properties?.["modification"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("ModificationEnumeration");
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });

  it("resolves an inline primitive with format (no via — inline schema)", () => {
    const schema = lib["VersionOfObjectRefStructure"]?.properties?.["created"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result.ts).toBe("string /* date-time */");
    expect(result.complex).toBe(false);
    expect(result.via).toBeUndefined();
  });

  it("resolves an array of $ref items", () => {
    const schema = lib["MultilingualString"]?.properties?.["Text"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result.ts).toMatch(/\[\]$/);
  });

  it("resolves an inline string property (no via — inline schema)", () => {
    const schema = lib["PrivateCodeStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via).toBeUndefined();
  });

  it("works end-to-end: flattenAllOf + resolvePropertyType + resolveAtom", () => {
    const props = flattenAllOf(lib, "VersionOfObjectRefStructure");
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      const resolved = resolvePropertyType(lib, p.schema);
      expect(resolved.ts).toBeTruthy();
      if (resolved.complex) {
        const typeName = resolved.ts.endsWith("[]") ? resolved.ts.slice(0, -2) : resolved.ts;
        resolveAtom(lib, typeName);
      }
    }
  });
});

describe("VehicleType — deep entity scenario (Interface tab)", () => {
  it("flattenAllOf collects properties from entire 5-level chain", () => {
    const props = flattenAllOf(lib, "VehicleType");
    expect(props.length).toBeGreaterThan(20);
    expect(props.some((p) => p.prop[1] === "LowFloor")).toBe(true);
    expect(props.some((p) => p.prop[1] === "Length")).toBe(true);
    expect(
      props.some((p) => p.prop[1] === "Name" && p.origin === "TransportType_VersionStructure"),
    ).toBe(true);
    expect(props.some((p) => p.prop[1] === "TransportMode")).toBe(true);
    expect(props.some((p) => p.prop[1] === "$created")).toBe(true);
    expect(props.some((p) => p.prop[1] === "$version")).toBe(true);
  });

  it("flattenAllOf origin chain documents exactly 5 types and why", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const origins = [...new Set(props.map((p) => p.origin))];

    expect(origins).toHaveLength(5);
    expect(origins).toEqual([
      "EntityStructure",
      "EntityInVersionStructure",
      "DataManagedObjectStructure",
      "TransportType_VersionStructure",
      "VehicleType_VersionStructure",
    ]);

    const singleRefs = props.filter((p) => {
      const s = p.schema as Record<string, unknown>;
      const hasSingleRef =
        !!s.$ref ||
        (Array.isArray(s.allOf) &&
          s.allOf.length === 1 &&
          !!(s.allOf[0] as Record<string, unknown>)?.$ref);
      if (!hasSingleRef) return false;
      const result = resolvePropertyType(lib, p.schema);
      return result.complex && !result.ts.endsWith("[]") && !result.ts.endsWith("_RelStructure");
    });

    const refsByOrigin: Record<string, string[]> = {};
    for (const o of origins) {
      const refs = singleRefs.filter((p) => p.origin === o).map((p) => p.prop[0]);
      if (refs.length > 0) refsByOrigin[o] = refs;
    }

    expect(refsByOrigin["EntityStructure"]).toBeUndefined();
    expect(refsByOrigin["EntityInVersionStructure"]).toBeUndefined();
    expect(refsByOrigin).toEqual({
      DataManagedObjectStructure: ["BrandingRef"],
      TransportType_VersionStructure: ["PrivateCode", "PassengerCapacity", "DeckPlanRef"],
      VehicleType_VersionStructure: ["IncludedIn", "ClassifiedAsRef"],
    });
  });

  it("resolvePropertyType handles booleans from VehicleType", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const lowFloor = props.find((p) => p.prop[1] === "LowFloor");
    expect(lowFloor).toBeDefined();
    expect(resolvePropertyType(lib, lowFloor!.schema)).toEqual({ ts: "boolean", complex: false });
  });

  it("resolvePropertyType resolves allOf-wrapped measurement types", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const length = props.find((p) => p.prop[1] === "Length");
    expect(length).toBeDefined();
    const result = resolvePropertyType(lib, length!.schema);
    expect(result.ts).toBeTruthy();
    const atom = resolveAtom(lib, "LengthType");
    if (atom) expect(typeof atom).toBe("string");
  });

  it("resolvePropertyType resolves enum from inherited TransportMode to enum name", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const mode = props.find((p) => p.prop[1] === "TransportMode");
    expect(mode).toBeDefined();
    const result = resolvePropertyType(lib, mode!.schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("AllPublicTransportModesEnumeration");
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });

  it("resolvePropertyType resolves array from deep-inherited ValidBetween", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const vb = props.find((p) => p.prop[1] === "ValidBetween");
    expect(vb).toBeDefined();
    const result = resolvePropertyType(lib, vb!.schema);
    expect(result.ts).toMatch(/\[\]$/);
  });

  it("resolvePropertyType resolves BrandingRef as complex via x-netex-atom simpleObj", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const branding = props.find((p) => p.prop[1] === "BrandingRef");
    expect(branding).toBeDefined();
    const result = resolvePropertyType(lib, branding!.schema);
    expect(result.complex).toBe(true);
  });

  it("resolvePropertyType resolves complex ref types", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const cap = props.find((p) => p.prop[1] === "capacities");
    expect(cap).toBeDefined();
    const result = resolvePropertyType(lib, cap!.schema);
    expect(result.complex).toBe(true);
  });

  it("resolvePropertyType unwraps keyList to KeyValueStructure[] (simpleObj atom as [])", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const kl = props.find((p) => p.prop[1] === "keyList");
    expect(kl).toBeDefined();
    const result = resolvePropertyType(lib, kl!.schema);
    expect(result.ts).toBe("KeyValueStructure[]");
    expect(result.complex).toBe(true);
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
    const props = flattenAllOf(lib, "VehicleType");
    const pc = props.find((p) => p.prop[1] === "privateCodes");
    expect(pc).toBeDefined();
    const result = resolvePropertyType(lib, pc!.schema);
    expect(result.ts).toBe("PrivateCodeStructure[]");
    expect(result.complex).toBe(true);
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
    const props = flattenAllOf(lib, "VehicleType");
    const complexProps: { name: string; ts: string }[] = [];
    const furtherComplexity: { name: string; ts: string; deepComplex: string[] }[] = [];

    for (const p of props) {
      const resolved = resolvePropertyType(lib, p.schema);
      if (!resolved.complex) continue;

      const typeName = resolved.ts.endsWith("[]") ? resolved.ts.slice(0, -2) : resolved.ts;
      complexProps.push({ name: p.prop[0], ts: resolved.ts });

      const innerProps = flattenAllOf(lib, typeName);
      const deepComplex: string[] = [];
      for (const ip of innerProps) {
        const innerResolved = resolvePropertyType(lib, ip.schema);
        if (innerResolved.complex) deepComplex.push(ip.prop[0]);
      }
      if (deepComplex.length > 0) {
        furtherComplexity.push({ name: p.prop[0], ts: resolved.ts, deepComplex });
      }
    }

    expect(complexProps.length).toBeGreaterThan(3);
    const shallowCount = complexProps.length - furtherComplexity.length;
    expect(shallowCount).toBeGreaterThan(0);
    expect(furtherComplexity.length).toBe(9);
  });

  it("resolvePropertyType unpacks Extensions as non-complex object", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const ext = props.find((p) => p.prop[1] === "Extensions");
    expect(ext).toBeDefined();
    const result = resolvePropertyType(lib, ext!.schema);
    expect(result.ts).toBe("any");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(1);
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "ExtensionsStructure",
      rule: "empty-object",
    });
  });
});

describe("resolvePropertyType — uncovered shape kinds", () => {
  it("direct $ref (not allOf-wrapped): OrderedVersionOfObjectRefStructure.value", () => {
    const schema = lib["OrderedVersionOfObjectRefStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    expect(schema.$ref).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result.complex).toBe(true);
    expect(result.ts).toBe("VersionOfObjectRefStructure");
    expect(result.via).toEqual([{ name: "VersionOfObjectRefStructure", rule: "complex" }]);
  });

  it("integer primitive: OrderedVersionOfObjectRefStructure.order", () => {
    const schema = lib["OrderedVersionOfObjectRefStructure"]?.properties?.["order"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result).toEqual({ ts: "number", complex: false });
  });

  it("number primitive: MeasureType.value", () => {
    const schema = lib["MeasureType"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result).toEqual({ ts: "number", complex: false });
  });

  it("anyOf union def: NilReasonType resolves to union", () => {
    const result = resolveDefType(lib, "NilReasonType");
    expect(result.complex).toBe(false);
    expect(result.ts).toContain("|");
  });

  it("anyOf union as property: MeasureType.uom → UomIdentifier", () => {
    const schema = lib["MeasureType"]?.properties?.["uom"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toContain("|");
  });

  it("inline array (no $ref items): CapabilityRequestPolicyStructure.NationalLanguage", () => {
    const schema =
      lib["CapabilityRequestPolicyStructure"]?.properties?.["NationalLanguage"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(lib, schema);
    expect(result.ts).toBe("string[]");
    expect(result.complex).toBe(false);
  });
});

describe("resolveDefType — $ref alias and allOf chains", () => {
  it("ObjectIdType resolves to string primitive", () => {
    const result = resolveDefType(lib, "ObjectIdType");
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(1);
    expect(result.via![0].name).toBe("ObjectIdType");
    expect(result.via![result.via!.length - 1].rule).toBe("primitive");
  });

  it("VersionIdType → ObjectIdType → string (multi-hop alias chain)", () => {
    const result = resolveDefType(lib, "VersionIdType");
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("VersionIdType");
    expect(result.via![result.via!.length - 1].rule).toBe("primitive");
  });

  it("alias to enum: NameOfClass stops at enum name", () => {
    const result = resolveDefType(lib, "NameOfClass");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("NameOfClass");
    expect(result.via).toEqual([{ name: "NameOfClass", rule: "enum" }]);
  });

  it("direct enum: ModificationEnumeration stops at enum name", () => {
    const result = resolveDefType(lib, "ModificationEnumeration");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("ModificationEnumeration");
    expect(result.via).toEqual([{ name: "ModificationEnumeration", rule: "enum" }]);
  });

  it("1-hop alias to complex simpleObj: DataSourceRefStructure → VersionOfObjectRefStructure", () => {
    const result = resolveDefType(lib, "DataSourceRefStructure");
    expect(result.complex).toBe(true);
    expect(result.ts).toBe("VersionOfObjectRefStructure");
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("DataSourceRefStructure");
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "VersionOfObjectRefStructure",
      rule: "complex",
    });
  });

  it("2-hop alias to complex simpleObj: TypeOfFrameRefStructure → VersionOfObjectRefStructure", () => {
    const result = resolveDefType(lib, "TypeOfFrameRefStructure");
    expect(result.complex).toBe(true);
    expect(result.ts).toBe("VersionOfObjectRefStructure");
    expect(result.via!.length).toBeGreaterThanOrEqual(3);
    expect(result.via![0].name).toBe("TypeOfFrameRefStructure");
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "VersionOfObjectRefStructure",
      rule: "complex",
    });
  });

  it("allOf-extending stays complex: ClassInFrameRefStructure (has own props)", () => {
    const result = resolveDefType(lib, "ClassInFrameRefStructure");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "ClassInFrameRefStructure", rule: "complex" }]);
  });

  it("allOf wrapper follows through: BrandingRef → VersionOfObjectRefStructure", () => {
    const result = resolveDefType(lib, "BrandingRef");
    expect(result.complex).toBe(true);
    expect(result.ts).toBe("VersionOfObjectRefStructure");
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("BrandingRef");
    expect(result.via![result.via!.length - 1]).toEqual({
      name: "VersionOfObjectRefStructure",
      rule: "complex",
    });
  });

  it("multi-hop via GroupOfEntities chain: GeneralGroupOfEntitiesRefStructure → complex", () => {
    const result = resolveDefType(lib, "GeneralGroupOfEntitiesRefStructure");
    expect(result.complex).toBe(true);
    expect(result.via!.length).toBeGreaterThanOrEqual(2);
    expect(result.via![0].name).toBe("GeneralGroupOfEntitiesRefStructure");
    expect(result.via![result.via!.length - 1].rule).toBe("complex");
  });

  it("single-prop atom collapses to primitive: ParticipantRefStructure → string", () => {
    const result = resolveDefType(lib, "ParticipantRefStructure");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe("string");
    expect(result.via).toEqual([{ name: "ParticipantRefStructure", rule: "atom-collapse" }]);
  });
});

describe("x-netex-atom:array — ListOfEnumerations", () => {
  it("all xsd:list types carry the x-netex-atom:array stamp", () => {
    const arrays = Object.entries(lib).filter(
      ([, d]) => (d as Record<string, unknown>).type === "array",
    );
    expect(arrays.length).toBeGreaterThan(0);
    for (const [, d] of arrays) {
      expect((d as Record<string, unknown>)["x-netex-atom"]).toBe("array");
    }
  });

  it("resolveDefType: ref-to-enum resolves to EnumName[]", () => {
    const result = resolveDefType(lib, "PropulsionTypeListOfEnumerations");
    expect(result.ts).toBe("PropulsionTypeEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "PropulsionTypeListOfEnumerations", rule: "array-of" },
      { name: "PropulsionTypeEnumeration", rule: "enum" },
    ]);
  });

  it("resolveDefType: inline primitive items resolve to string[]", () => {
    const result = resolveDefType(lib, "LanguageListOfEnumerations");
    expect(result.ts).toBe("string[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "LanguageListOfEnumerations", rule: "array-of" },
    ]);
  });

  it("resolvePropertyType: VehicleType.PropulsionTypes → PropulsionTypeEnumeration[]", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const pt = props.find((p) => p.prop[0] === "PropulsionTypes");
    expect(pt).toBeDefined();
    const result = resolvePropertyType(lib, pt!.schema);
    expect(result.ts).toBe("PropulsionTypeEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });

  it("resolvePropertyType: VehicleType.FuelTypes → FuelTypeEnumeration[]", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const ft = props.find((p) => p.prop[0] === "FuelTypes");
    expect(ft).toBeDefined();
    const result = resolvePropertyType(lib, ft!.schema);
    expect(result.ts).toBe("FuelTypeEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via![result.via!.length - 1].rule).toBe("enum");
  });
});

describe("x-netex-mixed annotation", () => {
  it("MultilingualString is the only mixed-content type", () => {
    const mixed = Object.entries(lib).filter(
      ([, d]) => (d as Record<string, unknown>)["x-netex-mixed"] === true,
    );
    expect(mixed).toHaveLength(1);
    expect(mixed[0][0]).toBe("MultilingualString");
  });

  it("unwrapMixed resolves MultilingualString to TextType", () => {
    expect(unwrapMixed(lib, "MultilingualString")).toBe("TextType");
  });

  it("resolveDefType resolves MultilingualString as TextType[] via wrapper", () => {
    const result = resolveDefType(lib, "MultilingualString");
    expect(result.ts).toBe("TextType[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "MultilingualString", rule: "mixed-unwrap" }]);
  });

  it("resolvePropertyType shows TextType[] for a MultilingualString property", () => {
    const props = flattenAllOf(lib, "DataManagedObjectStructure");
    const name = props.find((p) => p.prop[0] === "Name");
    if (!name) return;
    const result = resolvePropertyType(lib, name.schema);
    expect(result.ts).toBe("TextType[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "MultilingualString", rule: "mixed-unwrap" }]);
  });
});

describe("resolvePropertyType — x-fixed-single-enum (real schema)", () => {
  it("Operator.nameOfClass with context resolves to string literal", () => {
    const props = flattenAllOf(lib, "Operator");
    const noc = props.find((p) => p.prop[0] === "nameOfClass");
    expect(noc).toBeDefined();
    expect(noc!.schema["x-fixed-single-enum"]).toBe("NameOfClass");
    const result = resolvePropertyType(lib, noc!.schema, "Operator");
    expect(result).toEqual({
      ts: '"Operator"',
      complex: false,
      via: [{ name: "Operator", rule: "fixed-for" }],
    });
  });

  it("VehicleType.nameOfClass with context resolves to string literal", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const noc = props.find((p) => p.prop[0] === "nameOfClass");
    expect(noc).toBeDefined();
    expect(noc!.schema["x-fixed-single-enum"]).toBe("NameOfClass");
    const result = resolvePropertyType(lib, noc!.schema, "VehicleType");
    expect(result).toEqual({
      ts: '"VehicleType"',
      complex: false,
      via: [{ name: "VehicleType", rule: "fixed-for" }],
    });
  });

  it("nameOfClass without context resolves to NameOfClass enum normally", () => {
    const props = flattenAllOf(lib, "Operator");
    const noc = props.find((p) => p.prop[0] === "nameOfClass");
    expect(noc).toBeDefined();
    const result = resolvePropertyType(lib, noc!.schema);
    expect(result.ts).toBe("NameOfClass");
    expect(result.via).toEqual([{ name: "NameOfClass", rule: "enum" }]);
  });
});

describe("flattenAllOf — real schema", () => {
  it("produces properties for a real type", () => {
    const props = flattenAllOf(lib, "VersionOfObjectRefStructure");
    expect(props.length).toBeGreaterThan(0);
    expect(props.some((p) => p.prop[0] === "value")).toBe(true);
  });
});
