import { describe, it, expect } from "vitest";
import {
  resolveType,
  isRefType,
  refTarget,
  flattenAllOf,
  collectRequired,
  resolveDefType,
  resolvePropertyType,
  resolveAtom,
  buildReverseIndex,
  findTransitiveEntityUsers,
  defaultForType,
  lcFirst,
  unwrapMixed,
  defRole,
  countRoles,
  presentRoles,
  ROLE_DISPLAY_ORDER,
  ROLE_LABELS,
  buildInheritanceChain,
  inlineSingleRefs,
  type Defs,
  type ViaHop,
} from "./schema-viewer-fns.js";

// ── resolveType ──────────────────────────────────────────────────────────────

describe("resolveType", () => {
  it("returns $ref target name", () => {
    expect(resolveType({ $ref: "#/definitions/Foo" })).toBe("Foo");
  });

  it("follows allOf $ref", () => {
    expect(resolveType({ allOf: [{ $ref: "#/definitions/Bar" }] })).toBe("Bar");
  });

  it("returns enum as union", () => {
    expect(resolveType({ enum: ["a", "b"] })).toBe("a | b");
  });

  it("returns array type with $ref items", () => {
    expect(resolveType({ type: "array", items: { $ref: "#/definitions/X" } })).toBe("X[]");
  });

  it("returns array type with primitive items", () => {
    expect(resolveType({ type: "array", items: { type: "string" } })).toBe("string[]");
  });

  it("returns primitive type", () => {
    expect(resolveType({ type: "string" })).toBe("string");
  });

  it("returns 'unknown' for non-object", () => {
    expect(resolveType(null as any)).toBe("unknown");
  });

  it("returns 'object' for empty object", () => {
    expect(resolveType({})).toBe("object");
  });
});

// ── isRefType / refTarget ────────────────────────────────────────────────────

describe("isRefType", () => {
  it("detects $ref", () => {
    expect(isRefType({ $ref: "#/definitions/X" })).toBe(true);
  });

  it("detects allOf $ref", () => {
    expect(isRefType({ allOf: [{ $ref: "#/definitions/X" }] })).toBe(true);
  });

  it("detects array item $ref", () => {
    expect(isRefType({ type: "array", items: { $ref: "#/definitions/X" } })).toBe(true);
  });

  it("rejects primitive", () => {
    expect(isRefType({ type: "string" })).toBe(false);
  });
});

describe("refTarget", () => {
  it("extracts from $ref", () => {
    expect(refTarget({ $ref: "#/definitions/Foo" })).toBe("Foo");
  });

  it("extracts from allOf", () => {
    expect(refTarget({ allOf: [{ $ref: "#/definitions/Bar" }] })).toBe("Bar");
  });

  it("extracts from array items", () => {
    expect(refTarget({ type: "array", items: { $ref: "#/definitions/Baz" } })).toBe("Baz");
  });

  it("returns null for primitives", () => {
    expect(refTarget({ type: "string" })).toBeNull();
  });
});

// ── flattenAllOf ─────────────────────────────────────────────────────────────

describe("flattenAllOf", () => {
  it("flattens simple properties", () => {
    const defs: Defs = {
      A: { properties: { x: { type: "string" } } },
    };
    const result = flattenAllOf(defs, "A");
    expect(result).toHaveLength(1);
    expect(result[0].prop).toEqual(["x", "x"]);
    expect(result[0].origin).toBe("A");
  });

  it("flattens allOf inheritance", () => {
    const defs: Defs = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { y: { type: "number" } } },
        ],
      },
      Parent: { properties: { x: { type: "string" } } },
    };
    const result = flattenAllOf(defs, "Child");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ prop: ["x", "x"], origin: "Parent" });
    expect(result[1]).toMatchObject({ prop: ["y", "y"], origin: "Child" });
  });

  it("follows $ref aliases", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { properties: { z: { type: "boolean" } } },
    };
    const result = flattenAllOf(defs, "Alias");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ prop: ["z", "z"], origin: "Real" });
  });

  it("handles circular references without infinite loop", () => {
    const defs: Defs = {
      A: { allOf: [{ $ref: "#/definitions/B" }, { properties: { x: { type: "string" } } }] },
      B: { allOf: [{ $ref: "#/definitions/A" }, { properties: { y: { type: "string" } } }] },
    };
    const result = flattenAllOf(defs, "A");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── collectRequired ──────────────────────────────────────────────────────────

describe("collectRequired", () => {
  it("collects from direct required", () => {
    const defs: Defs = { A: { required: ["x", "y"] } };
    expect(collectRequired(defs, "A")).toEqual(new Set(["x", "y"]));
  });

  it("collects from allOf entries", () => {
    const defs: Defs = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { required: ["b"] },
        ],
      },
      Parent: { required: ["a"] },
    };
    expect(collectRequired(defs, "Child")).toEqual(new Set(["a", "b"]));
  });

  it("follows $ref aliases", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { required: ["z"] },
    };
    expect(collectRequired(defs, "Alias")).toEqual(new Set(["z"]));
  });
});

// ── resolveDefType ──────────────────────────────────────────────────────────

describe("resolveDefType", () => {
  it("resolves primitive type", () => {
    const defs: Defs = { StringType: { type: "string" } };
    expect(resolveDefType(defs, "StringType")).toEqual({
      ts: "string",
      complex: false,
      via: [{ name: "StringType", rule: "primitive" }],
    });
  });

  it("follows $ref alias to primitive", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Target" },
      Target: { type: "string" },
    };
    expect(resolveDefType(defs, "Alias")).toEqual({
      ts: "string",
      complex: false,
      via: [
        { name: "Alias", rule: "ref" },
        { name: "Target", rule: "primitive" },
      ],
    });
  });

  it("follows allOf wrapper to primitive", () => {
    const defs: Defs = {
      Wrapper: { allOf: [{ $ref: "#/definitions/Inner" }] },
      Inner: { type: "integer" },
    };
    expect(resolveDefType(defs, "Wrapper")).toEqual({
      ts: "integer",
      complex: false,
      via: [
        { name: "Wrapper", rule: "allOf-passthrough" },
        { name: "Inner", rule: "primitive" },
      ],
    });
  });

  it("resolves unstamped enum to literal union", () => {
    const defs: Defs = { E: { enum: ["a", "b", "c"] } };
    const result = resolveDefType(defs, "E");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe('"a" | "b" | "c"');
    expect(result.via).toEqual([{ name: "E", rule: "enum" }]);
  });

  it("resolves stamped enumeration to its name", () => {
    const defs: Defs = {
      ModeEnumeration: {
        type: "string",
        enum: ["bus", "tram", "rail"],
        "x-netex-role": "enumeration",
      },
    };
    const result = resolveDefType(defs, "ModeEnumeration");
    expect(result.ts).toBe("ModeEnumeration");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "ModeEnumeration", rule: "enum" }]);
  });

  it("returns complex for object with properties", () => {
    const defs: Defs = { Obj: { type: "object", properties: { x: { type: "string" } } } };
    expect(resolveDefType(defs, "Obj")).toEqual({
      ts: "Obj",
      complex: true,
      via: [{ name: "Obj", rule: "complex" }],
    });
  });

  it("resolves x-netex-atom as primitive instead of complex, with via", () => {
    const defs: Defs = {
      Wrapper: { type: "object", properties: { value: { type: "string" } }, "x-netex-atom": "string" },
    };
    const result = resolveDefType(defs, "Wrapper");
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "Wrapper", rule: "atom-collapse" }]);
  });

  it("returns complex for x-netex-atom: simpleObj", () => {
    const defs: Defs = {
      Wrapper: {
        type: "object",
        properties: { value: { type: "string" }, type: { type: "string" } },
        "x-netex-atom": "simpleObj",
      },
    };
    expect(resolveDefType(defs, "Wrapper")).toEqual({
      ts: "Wrapper",
      complex: true,
      via: [{ name: "Wrapper", rule: "complex" }],
    });
  });

  it("speculatively follows allOf parent when own properties exist", () => {
    const defs: Defs = {
      RefStruct: {
        allOf: [
          { $ref: "#/definitions/Base" },
          { properties: { ref: { type: "string" } } },
        ],
      },
      Base: { type: "string" },
    };
    const result = resolveDefType(defs, "RefStruct");
    expect(result).toEqual({
      ts: "string",
      complex: false,
      via: [
        { name: "RefStruct", rule: "allOf-speculative" },
        { name: "Base", rule: "primitive" },
      ],
    });
  });

  it("stays complex when parent is also complex", () => {
    const defs: Defs = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { extra: { type: "string" } } },
        ],
      },
      Parent: { type: "object", properties: { x: { type: "string" } } },
    };
    const result = resolveDefType(defs, "Child");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "Child", rule: "complex" }]);
  });

  it("unwraps single-prop array wrapper with via", () => {
    const defs: Defs = {
      ListWrapper: {
        type: "object",
        properties: {
          Item: { type: "array", items: { $ref: "#/definitions/ItemStruct" } },
        },
      },
      ItemStruct: { type: "object", "x-netex-atom": "simpleObj", properties: { value: { type: "string" }, code: { type: "string" } } },
    };
    const result = resolveDefType(defs, "ListWrapper");
    expect(result.ts).toBe("ItemStruct[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([
      { name: "ListWrapper", rule: "array-unwrap" },
      { name: "ItemStruct", rule: "complex" },
    ]);
  });

  it("unwraps empty object with via", () => {
    const defs: Defs = {
      EmptyObj: { type: "object" },
    };
    const result = resolveDefType(defs, "EmptyObj");
    expect(result.ts).toBe("any");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "EmptyObj", rule: "empty-object" }]);
  });

  it("records full via chain for $ref alias", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Target" },
      Target: { type: "string" },
    };
    const result = resolveDefType(defs, "Alias");
    expect(result.ts).toBe("string");
    expect(result.via).toEqual([
      { name: "Alias", rule: "ref" },
      { name: "Target", rule: "primitive" },
    ]);
  });

  it("includes format comment for formatted primitives", () => {
    const defs: Defs = { DT: { type: "string", format: "date-time" } };
    expect(resolveDefType(defs, "DT")).toEqual({
      ts: "string /* date-time */",
      complex: false,
      via: [{ name: "DT", rule: "primitive" }],
    });
  });

  it("handles circular references", () => {
    const defs: Defs = {
      A: { $ref: "#/definitions/B" },
      B: { $ref: "#/definitions/A" },
    };
    const result = resolveDefType(defs, "A");
    expect(result.complex).toBe(true);
  });

  it("multi-hop $ref chain produces [ref, ref, primitive]", () => {
    const defs: Defs = {
      A: { $ref: "#/definitions/B" },
      B: { $ref: "#/definitions/C" },
      C: { type: "string" },
    };
    const result = resolveDefType(defs, "A");
    expect(result.via).toEqual([
      { name: "A", rule: "ref" },
      { name: "B", rule: "ref" },
      { name: "C", rule: "primitive" },
    ]);
  });

  it("allOf-passthrough + inner ref chain", () => {
    const defs: Defs = {
      Outer: { allOf: [{ $ref: "#/definitions/Inner" }] },
      Inner: { $ref: "#/definitions/Leaf" },
      Leaf: { type: "integer" },
    };
    const result = resolveDefType(defs, "Outer");
    expect(result.via).toEqual([
      { name: "Outer", rule: "allOf-passthrough" },
      { name: "Inner", rule: "ref" },
      { name: "Leaf", rule: "primitive" },
    ]);
  });

  it("allOf-speculative records hop before inner chain", () => {
    const defs: Defs = {
      Outer: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { extra: { type: "string" } } },
        ],
      },
      Parent: { $ref: "#/definitions/Prim" },
      Prim: { type: "string" },
    };
    const result = resolveDefType(defs, "Outer");
    expect(result.via).toEqual([
      { name: "Outer", rule: "allOf-speculative" },
      { name: "Parent", rule: "ref" },
      { name: "Prim", rule: "primitive" },
    ]);
  });

  it("array-unwrap + inner atom-collapse chain", () => {
    const defs: Defs = {
      ListWrap: {
        type: "object",
        properties: {
          Item: { type: "array", items: { $ref: "#/definitions/AtomItem" } },
        },
      },
      AtomItem: { type: "object", properties: { value: { type: "string" } }, "x-netex-atom": "string" },
    };
    const result = resolveDefType(defs, "ListWrap");
    expect(result.ts).toBe("string[]");
    expect(result.via).toEqual([
      { name: "ListWrap", rule: "array-unwrap" },
      { name: "AtomItem", rule: "atom-collapse" },
    ]);
  });

  it("resolves x-netex-atom:array with ref items to EnumName[]", () => {
    const defs: Defs = {
      AccessFacilityListOfEnumerations: {
        type: "array",
        items: { $ref: "#/definitions/AccessFacilityEnumeration" },
        "x-netex-atom": "array",
      },
      AccessFacilityEnumeration: {
        type: "string",
        enum: ["unknown", "lift", "wheelchairLift"],
        "x-netex-role": "enumeration",
      },
    };
    const result = resolveDefType(defs, "AccessFacilityListOfEnumerations");
    expect(result.ts).toBe("AccessFacilityEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "AccessFacilityListOfEnumerations", rule: "array-of" },
      { name: "AccessFacilityEnumeration", rule: "enum" },
    ]);
  });

  it("resolves x-netex-atom:array with ref items to complex type[]", () => {
    const defs: Defs = {
      ThingList: {
        type: "array",
        items: { $ref: "#/definitions/ThingStructure" },
        "x-netex-atom": "array",
      },
      ThingStructure: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    };
    const result = resolveDefType(defs, "ThingList");
    expect(result.ts).toBe("ThingStructure[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([
      { name: "ThingList", rule: "array-of" },
      { name: "ThingStructure", rule: "complex" },
    ]);
  });

  it("resolves x-netex-atom:array with inline primitive items", () => {
    const defs: Defs = {
      LanguageListOfEnumerations: {
        type: "array",
        items: { type: "string" },
        "x-netex-atom": "array",
      },
    };
    const result = resolveDefType(defs, "LanguageListOfEnumerations");
    expect(result.ts).toBe("string[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "LanguageListOfEnumerations", rule: "array-of" },
    ]);
  });
});

// ── resolvePropertyType ──────────────────────────────────────────────────────

describe("resolvePropertyType", () => {
  it("resolves $ref through resolveDefType", () => {
    const defs: Defs = { T: { type: "string" } };
    expect(resolvePropertyType(defs, { $ref: "#/definitions/T" })).toEqual({
      ts: "string",
      complex: false,
      via: [{ name: "T", rule: "primitive" }],
    });
  });

  it("resolves array of $ref and preserves via", () => {
    const defs: Defs = { T: { type: "string" } };
    const result = resolvePropertyType(defs, { type: "array", items: { $ref: "#/definitions/T" } });
    expect(result).toEqual({
      ts: "string[]",
      complex: false,
      via: [{ name: "T", rule: "primitive" }],
    });
  });

  it("resolves inline enum", () => {
    const defs: Defs = {};
    expect(resolvePropertyType(defs, { enum: ["x", "y"] })).toEqual({
      ts: '"x" | "y"',
      complex: false,
    });
  });

  it("resolves inline primitive", () => {
    const defs: Defs = {};
    expect(resolvePropertyType(defs, { type: "boolean" })).toEqual({
      ts: "boolean",
      complex: false,
    });
  });
});

// ── resolveAtom ──────────────────────────────────────────────────────────────

describe("resolveAtom", () => {
  it("reads x-netex-atom annotation", () => {
    const defs: Defs = { T: { type: "object", "x-netex-atom": "string" } };
    expect(resolveAtom(defs, "T")).toBe("string");
  });

  it("follows $ref alias to find annotation", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { type: "object", "x-netex-atom": "number" },
    };
    expect(resolveAtom(defs, "Alias")).toBe("number");
  });

  it("returns simpleObj for multi-prop types", () => {
    const defs: Defs = {
      T: { type: "object", "x-netex-atom": "simpleObj" },
    };
    expect(resolveAtom(defs, "T")).toBe("simpleObj");
  });

  it("returns null when no annotation", () => {
    const defs: Defs = { T: { type: "object", properties: { x: { type: "string" } } } };
    expect(resolveAtom(defs, "T")).toBeNull();
  });

  it("returns null for missing definition", () => {
    expect(resolveAtom({}, "Missing")).toBeNull();
  });
});

// ── buildReverseIndex ────────────────────────────────────────────────────────

describe("buildReverseIndex", () => {
  it("builds incoming reference map", () => {
    const defs: Defs = {
      A: { $ref: "#/definitions/B" },
      B: { type: "string" },
      C: { properties: { x: { $ref: "#/definitions/B" } } },
    };
    const idx = buildReverseIndex(defs);
    expect(idx["B"]).toEqual(expect.arrayContaining(["A", "C"]));
    expect(idx["B"]).toHaveLength(2);
  });

  it("excludes self-references", () => {
    const defs: Defs = { A: { allOf: [{ $ref: "#/definitions/A" }] } };
    const idx = buildReverseIndex(defs);
    expect(idx["A"]).toBeUndefined();
  });
});

// ── findTransitiveEntityUsers ─────────────────────────────────────────────────

describe("findTransitiveEntityUsers", () => {
  /** Helper: build the isEntity predicate from defs (the common call-site pattern). */
  const isEntity = (defs: Defs) => (name: string) => defRole(defs[name]) === "entity";

  it("finds direct entity referrer", () => {
    const defs: Defs = {
      Leaf: { type: "string" },
      MyEntity: { "x-netex-role": "entity", properties: { x: { $ref: "#/definitions/Leaf" } } },
    };
    const idx = buildReverseIndex(defs);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(defs))).toEqual(["MyEntity"]);
  });

  it("finds entity through intermediate structure", () => {
    const defs: Defs = {
      Leaf: { type: "string" },
      Middle: { "x-netex-role": "structure", properties: { x: { $ref: "#/definitions/Leaf" } } },
      MyEntity: { "x-netex-role": "entity", properties: { m: { $ref: "#/definitions/Middle" } } },
    };
    const idx = buildReverseIndex(defs);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(defs))).toEqual(["MyEntity"]);
  });

  it("does not traverse beyond entities", () => {
    const defs: Defs = {
      Leaf: { type: "string" },
      EntityA: { "x-netex-role": "entity", properties: { x: { $ref: "#/definitions/Leaf" } } },
      EntityB: { "x-netex-role": "entity", properties: { a: { $ref: "#/definitions/EntityA" } } },
    };
    const idx = buildReverseIndex(defs);
    // EntityA uses Leaf directly; EntityB uses EntityA but not Leaf
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(defs))).toEqual(["EntityA"]);
  });

  it("excludes the input name from results even if it is an entity", () => {
    const defs: Defs = {
      Self: { "x-netex-role": "entity", properties: { x: { type: "string" } } },
      Other: { "x-netex-role": "entity", properties: { s: { $ref: "#/definitions/Self" } } },
    };
    const idx = buildReverseIndex(defs);
    expect(findTransitiveEntityUsers("Self", idx, isEntity(defs))).toEqual(["Other"]);
  });

  it("handles cycles without infinite loop", () => {
    const defs: Defs = {
      A: { "x-netex-role": "structure", properties: { b: { $ref: "#/definitions/B" } } },
      B: { "x-netex-role": "structure", properties: { a: { $ref: "#/definitions/A" } } },
      E: { "x-netex-role": "entity", properties: { a: { $ref: "#/definitions/A" } } },
    };
    const idx = buildReverseIndex(defs);
    expect(findTransitiveEntityUsers("A", idx, isEntity(defs))).toEqual(["E"]);
  });

  it("returns empty array when no entities reachable", () => {
    const defs: Defs = {
      Orphan: { type: "string" },
    };
    const idx = buildReverseIndex(defs);
    expect(findTransitiveEntityUsers("Orphan", idx, isEntity(defs))).toEqual([]);
  });

  it("finds multiple entities through branching paths", () => {
    const defs: Defs = {
      Leaf: { type: "string" },
      StructA: { "x-netex-role": "structure", properties: { x: { $ref: "#/definitions/Leaf" } } },
      StructB: { "x-netex-role": "structure", properties: { x: { $ref: "#/definitions/Leaf" } } },
      EntityX: { "x-netex-role": "entity", properties: { a: { $ref: "#/definitions/StructA" } } },
      EntityY: { "x-netex-role": "entity", properties: { b: { $ref: "#/definitions/StructB" } } },
    };
    const idx = buildReverseIndex(defs);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(defs))).toEqual(["EntityX", "EntityY"]);
  });
});

// ── defaultForType ───────────────────────────────────────────────────────────

describe("defaultForType", () => {
  it('returns "" for string', () => {
    expect(defaultForType("string")).toBe('""');
  });

  it("returns 0 for number", () => {
    expect(defaultForType("number")).toBe("0");
  });

  it("returns 0 for integer", () => {
    expect(defaultForType("integer")).toBe("0");
  });

  it("returns false for boolean", () => {
    expect(defaultForType("boolean")).toBe("false");
  });

  it("returns [] for arrays", () => {
    expect(defaultForType("string[]")).toBe("[]");
  });

  it("returns first literal for unions", () => {
    expect(defaultForType('"a" | "b"')).toBe('"a"');
  });

  it('returns "" for string with format', () => {
    expect(defaultForType("string /* date-time */")).toBe('""');
  });

  it("returns cast for complex types", () => {
    expect(defaultForType("MyType")).toBe("{} as MyType");
  });
});

// ── lcFirst ──────────────────────────────────────────────────────────────────

describe("lcFirst", () => {
  it("lowercases PascalCase property name", () => {
    expect(lcFirst("BrandingRef")).toBe("brandingRef");
  });

  it("keeps already-lowercase name unchanged", () => {
    expect(lcFirst("version")).toBe("version");
  });

  it("handles single character", () => {
    expect(lcFirst("X")).toBe("x");
  });

  it("handles empty string", () => {
    expect(lcFirst("")).toBe("");
  });
});

// ── unwrapMixed ──────────────────────────────────────────────────────────────

describe("unwrapMixed", () => {
  it("returns inner element type for mixed-content wrapper", () => {
    const defs: Defs = {
      Wrapper: {
        type: "object",
        "x-netex-mixed": true,
        description: "*Either* use old way or new way",
        properties: {
          Text: { type: "array", items: { $ref: "#/definitions/Inner" } },
          lang: { type: "string", xml: { attribute: true } },
        },
      },
      Inner: { type: "object" },
    };
    expect(unwrapMixed(defs, "Wrapper")).toBe("Inner");
  });

  it("returns null when x-netex-mixed is absent", () => {
    const defs: Defs = {
      Plain: {
        type: "object",
        description: "*Either* blah",
        properties: { Text: { type: "array", items: { $ref: "#/definitions/T" } } },
      },
    };
    expect(unwrapMixed(defs, "Plain")).toBeNull();
  });

  it("returns null when description lacks *Either*", () => {
    const defs: Defs = {
      NoSignal: {
        type: "object",
        "x-netex-mixed": true,
        description: "Some other description",
        properties: { Text: { type: "array", items: { $ref: "#/definitions/T" } } },
      },
    };
    expect(unwrapMixed(defs, "NoSignal")).toBeNull();
  });

  it("returns null for missing definition", () => {
    expect(unwrapMixed({}, "Missing")).toBeNull();
  });

  it("resolveDefType uses unwrapMixed to resolve as inner type array, with via", () => {
    const defs: Defs = {
      Mixed: {
        type: "object",
        "x-netex-mixed": true,
        description: "*Either* old or new",
        properties: {
          Items: { type: "array", items: { $ref: "#/definitions/ItemType" } },
          attr: { type: "string", xml: { attribute: true } },
        },
      },
      ItemType: { type: "object", properties: { value: { type: "string" } } },
    };
    const result = resolveDefType(defs, "Mixed");
    expect(result.ts).toBe("ItemType[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "Mixed", rule: "mixed-unwrap" }]);
  });
});

// ── defRole ─────────────────────────────────────────────────────────────────

describe("defRole", () => {
  it("reads x-netex-role from a definition", () => {
    expect(defRole({ "x-netex-role": "entity" })).toBe("entity");
  });

  it('returns "unclassified" when x-netex-role is missing', () => {
    expect(defRole({ type: "object" })).toBe("unclassified");
  });

  it('returns "unclassified" for undefined input', () => {
    expect(defRole(undefined)).toBe("unclassified");
  });

  it('returns "unclassified" when x-netex-role is not a string', () => {
    expect(defRole({ "x-netex-role": 42 })).toBe("unclassified");
  });
});

// ── countRoles ──────────────────────────────────────────────────────────────

describe("countRoles", () => {
  it("counts definitions per role", () => {
    const defs: Defs = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "structure" },
    };
    const counts = countRoles(["A", "B", "C"], defs);
    expect(counts.get("entity")).toBe(2);
    expect(counts.get("structure")).toBe(1);
  });

  it("groups missing roles under unclassified", () => {
    const defs: Defs = { A: { type: "object" }, B: {} };
    const counts = countRoles(["A", "B"], defs);
    expect(counts.get("unclassified")).toBe(2);
  });
});

// ── presentRoles ────────────────────────────────────────────────────────────

describe("presentRoles", () => {
  it("returns only roles present in the data", () => {
    const defs: Defs = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "reference" },
    };
    const roles = presentRoles(["A", "B"], defs);
    const keys = roles.map((r) => r.role);
    expect(keys).toContain("entity");
    expect(keys).toContain("reference");
    expect(keys).not.toContain("abstract");
  });

  it("includes unclassified when definitions lack x-netex-role", () => {
    const defs: Defs = { A: { "x-netex-role": "entity" }, B: { type: "object" } };
    const roles = presentRoles(["A", "B"], defs);
    expect(roles.map((r) => r.role)).toContain("unclassified");
  });

  it("respects ROLE_DISPLAY_ORDER", () => {
    const defs: Defs = {
      A: { "x-netex-role": "reference" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "abstract" },
    };
    const roles = presentRoles(["A", "B", "C"], defs);
    const keys = roles.map((r) => r.role);
    // entity < abstract < reference per ROLE_DISPLAY_ORDER
    expect(keys.indexOf("entity")).toBeLessThan(keys.indexOf("abstract"));
    expect(keys.indexOf("abstract")).toBeLessThan(keys.indexOf("reference"));
  });

  it("includes correct counts", () => {
    const defs: Defs = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "structure" },
    };
    const roles = presentRoles(["A", "B", "C"], defs);
    expect(roles.find((r) => r.role === "entity")?.count).toBe(2);
    expect(roles.find((r) => r.role === "structure")?.count).toBe(1);
  });

  it("uses ROLE_LABELS for display names", () => {
    const defs: Defs = {
      A: { "x-netex-role": "frameMember" },
      B: { "x-netex-role": "enumeration" },
    };
    const roles = presentRoles(["A", "B"], defs);
    expect(roles.find((r) => r.role === "frameMember")?.label).toBe("Frame member");
    expect(roles.find((r) => r.role === "enumeration")?.label).toBe("Enum");
  });

  it("returns empty array when no definitions", () => {
    expect(presentRoles([], {})).toEqual([]);
  });
});

// ── ROLE constants ──────────────────────────────────────────────────────────

describe("ROLE_DISPLAY_ORDER", () => {
  it("includes unclassified as the last entry", () => {
    expect(ROLE_DISPLAY_ORDER[ROLE_DISPLAY_ORDER.length - 1]).toBe("unclassified");
  });

  it("has a label for every role", () => {
    for (const role of ROLE_DISPLAY_ORDER) {
      expect(ROLE_LABELS[role]).toBeDefined();
    }
  });
});

// ── buildInheritanceChain ───────────────────────────────────────────────────

describe("buildInheritanceChain", () => {
  it("returns single node for type with only properties", () => {
    const defs: Defs = {
      Foo: { properties: { x: { type: "string" }, y: { type: "number" } } },
    };
    const chain = buildInheritanceChain(defs, "Foo");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("Foo");
    expect(chain[0].ownProps).toHaveLength(2);
    expect(chain[0].ownProps[0].name).toBe("x");
  });

  it("builds chain with allOf inheritance (root first)", () => {
    const defs: Defs = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { b: { type: "number" } } },
        ],
      },
      Parent: { properties: { a: { type: "string" } } },
    };
    const chain = buildInheritanceChain(defs, "Child");
    expect(chain).toHaveLength(2);
    expect(chain[0].name).toBe("Parent");
    expect(chain[1].name).toBe("Child");
    expect(chain[0].ownProps[0].name).toBe("a");
    expect(chain[1].ownProps[0].name).toBe("b");
  });

  it("follows $ref aliases", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { properties: { x: { type: "string" } } },
    };
    const chain = buildInheritanceChain(defs, "Alias");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("Real");
  });

  it("handles circular references without infinite loop", () => {
    const defs: Defs = {
      A: { allOf: [{ $ref: "#/definitions/B" }, { properties: { x: { type: "string" } } }] },
      B: { allOf: [{ $ref: "#/definitions/A" }, { properties: { y: { type: "string" } } }] },
    };
    const chain = buildInheritanceChain(defs, "A");
    expect(chain.length).toBeGreaterThan(0);
  });

  it("deduplicates own properties from allOf and direct properties", () => {
    const defs: Defs = {
      T: {
        allOf: [{ properties: { x: { type: "string" } } }],
        properties: { x: { type: "string" }, y: { type: "number" } },
      },
    };
    const chain = buildInheritanceChain(defs, "T");
    expect(chain).toHaveLength(1);
    // x appears in allOf entry, so the direct x should be deduped
    const propNames = chain[0].ownProps.map(p => p.name);
    expect(propNames).toEqual(["x", "y"]);
  });

  it("returns empty chain for missing definition", () => {
    const chain = buildInheritanceChain({}, "Missing");
    expect(chain).toHaveLength(0);
  });
});

// ── inlineSingleRefs ─────────────────────────────────────────────────────────

describe("inlineSingleRefs", () => {
  it("inlines a single-$ref target's inner properties", () => {
    const defs: Defs = {
      Root: {
        allOf: [
          {
            properties: {
              Name: { type: "string" },
              Code: { allOf: [{ $ref: "#/definitions/CodeStruct" }] },
            },
          },
        ],
      },
      CodeStruct: {
        type: "object",
        properties: {
          value: { type: "string" },
          type: { type: "string" },
        },
        "x-netex-atom": "simpleObj",
      },
    };
    const props = flattenAllOf(defs, "Root");
    const result = inlineSingleRefs(defs, props);
    // Code should be replaced by value and type
    expect(result.some((p) => p.prop[1] === "code")).toBe(false);
    expect(result.some((p) => p.prop[1] === "value")).toBe(true);
    expect(result.some((p) => p.prop[1] === "type")).toBe(true);
    // inlinedFrom should be set
    const inlined = result.filter((p) => p.inlinedFrom);
    expect(inlined).toHaveLength(2);
    expect(inlined[0].inlinedFrom).toBe("code");
  });

  it("uses parentProp_innerProp when name conflicts exist", () => {
    const defs: Defs = {
      Root: {
        allOf: [
          {
            properties: {
              value: { type: "string" },
              Code: { allOf: [{ $ref: "#/definitions/CodeStruct" }] },
            },
          },
        ],
      },
      CodeStruct: {
        type: "object",
        properties: {
          value: { type: "string" },
          extra: { type: "number" },
        },
        "x-netex-atom": "simpleObj",
      },
    };
    const props = flattenAllOf(defs, "Root");
    const result = inlineSingleRefs(defs, props);
    // "value" is already taken → should become "code_value"
    expect(result.some((p) => p.prop[1] === "code_value")).toBe(true);
    // "extra" is free → should stay as-is
    expect(result.some((p) => p.prop[1] === "extra")).toBe(true);
    // Original "value" still present
    expect(result.some((p) => p.prop[1] === "value" && !p.inlinedFrom)).toBe(true);
  });

  it("skips reference-role targets", () => {
    const defs: Defs = {
      Root: {
        allOf: [
          {
            properties: {
              Ref: { allOf: [{ $ref: "#/definitions/RefStruct" }] },
            },
          },
        ],
      },
      RefStruct: {
        type: "object",
        "x-netex-role": "reference",
        properties: {
          value: { type: "string" },
          ref: { type: "string" },
        },
        "x-netex-atom": "simpleObj",
      },
    };
    const props = flattenAllOf(defs, "Root");
    const result = inlineSingleRefs(defs, props);
    // Should NOT inline — Ref stays as-is
    expect(result).toHaveLength(1);
    expect(result[0].prop[1]).toBe("ref");
    expect(result[0].inlinedFrom).toBeUndefined();
  });

  it("skips collection-role targets", () => {
    const defs: Defs = {
      Root: {
        allOf: [
          {
            properties: {
              Items: { allOf: [{ $ref: "#/definitions/ItemsRel" }] },
            },
          },
        ],
      },
      ItemsRel: {
        type: "object",
        "x-netex-role": "collection",
        properties: {
          Item: { type: "array", items: { $ref: "#/definitions/Thing" } },
        },
      },
      Thing: { type: "object", properties: { name: { type: "string" } } },
    };
    const props = flattenAllOf(defs, "Root");
    const result = inlineSingleRefs(defs, props);
    expect(result).toHaveLength(1);
    expect(result[0].prop[1]).toBe("items");
    expect(result[0].inlinedFrom).toBeUndefined();
  });

  it("returns props unchanged when no candidates exist", () => {
    const defs: Defs = {
      Root: { properties: { x: { type: "string" }, y: { type: "number" } } },
    };
    const props = flattenAllOf(defs, "Root");
    const result = inlineSingleRefs(defs, props);
    expect(result).toEqual(props);
  });

  it("handles multiple inlined props with cross-conflict detection", () => {
    const defs: Defs = {
      Root: {
        allOf: [
          {
            properties: {
              A: { allOf: [{ $ref: "#/definitions/AStruct" }] },
              B: { allOf: [{ $ref: "#/definitions/BStruct" }] },
            },
          },
        ],
      },
      AStruct: {
        type: "object",
        properties: { shared: { type: "string" } },
      },
      BStruct: {
        type: "object",
        properties: { shared: { type: "number" } },
      },
    };
    const props = flattenAllOf(defs, "Root");
    const result = inlineSingleRefs(defs, props);
    // First "shared" from A is free
    expect(result.some((p) => p.prop[1] === "shared" && p.inlinedFrom === "a")).toBe(true);
    // Second "shared" from B conflicts → b_shared
    expect(result.some((p) => p.prop[1] === "b_shared" && p.inlinedFrom === "b")).toBe(true);
  });

  it("filters shared-ancestor props when target and parent share a common base", () => {
    // Simulates: Parent inherits BaseStruct → MiddleStruct, then has a single-$ref
    // to TargetStruct which also inherits BaseStruct → MiddleStruct.
    // Only TargetStruct's own props should be inlined.
    const defs: Defs = {
      BaseStruct: {
        type: "object",
        properties: {
          id: { type: "string" },
          version: { type: "string" },
        },
      },
      MiddleStruct: {
        allOf: [
          { $ref: "#/definitions/BaseStruct" },
          {
            type: "object",
            properties: {
              created: { type: "string" },
              keyList: { type: "object" },
            },
          },
        ],
      },
      Parent: {
        allOf: [
          { $ref: "#/definitions/MiddleStruct" },
          {
            type: "object",
            properties: {
              Name: { type: "string" },
              Detail: { allOf: [{ $ref: "#/definitions/TargetStruct" }] },
            },
          },
        ],
      },
      TargetStruct: {
        allOf: [
          { $ref: "#/definitions/MiddleStruct" },
          {
            type: "object",
            properties: {
              Capacity: { type: "number" },
              Class: { type: "string" },
            },
          },
        ],
      },
    };
    const props = flattenAllOf(defs, "Parent");
    const result = inlineSingleRefs(defs, props);

    // Shared-ancestor props should NOT appear as inlined from Detail
    const detailInlined = result.filter((p) => p.inlinedFrom === "detail");
    const detailNames = detailInlined.map((p) => p.prop[1]);

    // BaseStruct and MiddleStruct props should be filtered out
    expect(detailNames).not.toContain("id");
    expect(detailNames).not.toContain("version");
    expect(detailNames).not.toContain("created");
    expect(detailNames).not.toContain("keyList");

    // Only TargetStruct's own props should be inlined (lcFirst-normalised)
    expect(detailNames).toContain("capacity");
    expect(detailNames).toContain("class");
    expect(detailInlined).toHaveLength(2);

    // Parent's own props should still be present (lcFirst-normalised)
    expect(result.some((p) => p.prop[1] === "name" && !p.inlinedFrom)).toBe(true);
    // Inherited props from the parent chain should still be present
    expect(result.some((p) => p.prop[1] === "id" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "version" && !p.inlinedFrom)).toBe(true);
  });
});
