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
  lcFirst,
  unwrapMixed,
  defRole,
  countRoles,
  presentRoles,
  ROLE_DISPLAY_ORDER,
  ROLE_LABELS,
  buildInheritanceChain,
  inlineSingleRefs,
  canonicalPropName,
  resolveRefEntity,
  collectRefProps,
  collectExtraProps,
  collectDependencyTree,
  isDynNocRef,
  type NetexLibrary,
  type ViaHop,
} from "./fns.js";

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
    const netexLibrary: NetexLibrary = {
      A: { properties: { x: { type: "string" } } },
    };
    const result = flattenAllOf(netexLibrary, "A");
    expect(result).toHaveLength(1);
    expect(result[0].prop).toEqual(["x", "x"]);
    expect(result[0].origin).toBe("A");
  });

  it("flattens allOf inheritance", () => {
    const netexLibrary: NetexLibrary = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { y: { type: "number" } } },
        ],
      },
      Parent: { properties: { x: { type: "string" } } },
    };
    const result = flattenAllOf(netexLibrary, "Child");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ prop: ["x", "x"], origin: "Parent" });
    expect(result[1]).toMatchObject({ prop: ["y", "y"], origin: "Child" });
  });

  it("follows $ref aliases", () => {
    const netexLibrary: NetexLibrary = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { properties: { z: { type: "boolean" } } },
    };
    const result = flattenAllOf(netexLibrary, "Alias");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ prop: ["z", "z"], origin: "Real" });
  });

  it("handles circular references without infinite loop", () => {
    const netexLibrary: NetexLibrary = {
      A: { allOf: [{ $ref: "#/definitions/B" }, { properties: { x: { type: "string" } } }] },
      B: { allOf: [{ $ref: "#/definitions/A" }, { properties: { y: { type: "string" } } }] },
    };
    const result = flattenAllOf(netexLibrary, "A");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── collectRequired ──────────────────────────────────────────────────────────

describe("collectRequired", () => {
  it("collects from direct required", () => {
    const netexLibrary: NetexLibrary = { A: { required: ["x", "y"] } };
    expect(collectRequired(netexLibrary, "A")).toEqual(new Set(["x", "y"]));
  });

  it("collects from allOf entries", () => {
    const netexLibrary: NetexLibrary = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { required: ["b"] },
        ],
      },
      Parent: { required: ["a"] },
    };
    expect(collectRequired(netexLibrary, "Child")).toEqual(new Set(["a", "b"]));
  });

  it("follows $ref aliases", () => {
    const netexLibrary: NetexLibrary = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { required: ["z"] },
    };
    expect(collectRequired(netexLibrary, "Alias")).toEqual(new Set(["z"]));
  });
});

// ── resolveDefType ──────────────────────────────────────────────────────────

describe("resolveDefType", () => {
  it("resolves primitive type", () => {
    const netexLibrary: NetexLibrary = { StringType: { type: "string" } };
    expect(resolveDefType(netexLibrary, "StringType")).toEqual({
      ts: "string",
      complex: false,
      via: [{ name: "StringType", rule: "primitive" }],
    });
  });

  it("follows $ref alias to primitive", () => {
    const netexLibrary: NetexLibrary = {
      Alias: { $ref: "#/definitions/Target" },
      Target: { type: "string" },
    };
    expect(resolveDefType(netexLibrary, "Alias")).toEqual({
      ts: "string",
      complex: false,
      via: [
        { name: "Alias", rule: "ref" },
        { name: "Target", rule: "primitive" },
      ],
    });
  });

  it("follows allOf wrapper to primitive", () => {
    const netexLibrary: NetexLibrary = {
      Wrapper: { allOf: [{ $ref: "#/definitions/Inner" }] },
      Inner: { type: "integer" },
    };
    expect(resolveDefType(netexLibrary, "Wrapper")).toEqual({
      ts: "number",
      complex: false,
      via: [
        { name: "Wrapper", rule: "allOf-passthrough" },
        { name: "Inner", rule: "primitive" },
      ],
    });
  });

  it("resolves unstamped enum to literal union", () => {
    const netexLibrary: NetexLibrary = { E: { enum: ["a", "b", "c"] } };
    const result = resolveDefType(netexLibrary, "E");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe('"a" | "b" | "c"');
    expect(result.via).toEqual([{ name: "E", rule: "enum" }]);
  });

  it("resolves stamped enumeration to its name", () => {
    const netexLibrary: NetexLibrary = {
      ModeEnumeration: {
        type: "string",
        enum: ["bus", "tram", "rail"],
        "x-netex-role": "enumeration",
      },
    };
    const result = resolveDefType(netexLibrary, "ModeEnumeration");
    expect(result.ts).toBe("ModeEnumeration");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "ModeEnumeration", rule: "enum" }]);
  });

  it("returns complex for object with properties", () => {
    const netexLibrary: NetexLibrary = { Obj: { type: "object", properties: { x: { type: "string" } } } };
    expect(resolveDefType(netexLibrary, "Obj")).toEqual({
      ts: "Obj",
      complex: true,
      via: [{ name: "Obj", rule: "complex" }],
    });
  });

  it("resolves x-netex-atom as primitive instead of complex, with via", () => {
    const netexLibrary: NetexLibrary = {
      Wrapper: { type: "object", properties: { value: { type: "string" } }, "x-netex-atom": "string" },
    };
    const result = resolveDefType(netexLibrary, "Wrapper");
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "Wrapper", rule: "atom-collapse" }]);
  });

  it("returns complex for x-netex-atom: simpleObj", () => {
    const netexLibrary: NetexLibrary = {
      Wrapper: {
        type: "object",
        properties: { value: { type: "string" }, type: { type: "string" } },
        "x-netex-atom": "simpleObj",
      },
    };
    expect(resolveDefType(netexLibrary, "Wrapper")).toEqual({
      ts: "Wrapper",
      complex: true,
      via: [{ name: "Wrapper", rule: "complex" }],
    });
  });

  it("speculatively follows allOf parent when own properties exist", () => {
    const netexLibrary: NetexLibrary = {
      RefStruct: {
        allOf: [
          { $ref: "#/definitions/Base" },
          { properties: { ref: { type: "string" } } },
        ],
      },
      Base: { type: "string" },
    };
    const result = resolveDefType(netexLibrary, "RefStruct");
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
    const netexLibrary: NetexLibrary = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { extra: { type: "string" } } },
        ],
      },
      Parent: { type: "object", properties: { x: { type: "string" } } },
    };
    const result = resolveDefType(netexLibrary, "Child");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "Child", rule: "complex" }]);
  });

  it("unwraps single-prop array wrapper with via", () => {
    const netexLibrary: NetexLibrary = {
      ListWrapper: {
        type: "object",
        properties: {
          Item: { type: "array", items: { $ref: "#/definitions/ItemStruct" } },
        },
      },
      ItemStruct: { type: "object", "x-netex-atom": "simpleObj", properties: { value: { type: "string" }, code: { type: "string" } } },
    };
    const result = resolveDefType(netexLibrary, "ListWrapper");
    expect(result.ts).toBe("ItemStruct[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([
      { name: "ListWrapper", rule: "array-unwrap" },
      { name: "ItemStruct", rule: "complex" },
    ]);
  });

  it("unwraps empty object with via", () => {
    const netexLibrary: NetexLibrary = {
      EmptyObj: { type: "object" },
    };
    const result = resolveDefType(netexLibrary, "EmptyObj");
    expect(result.ts).toBe("any");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "EmptyObj", rule: "empty-object" }]);
  });

  it("records full via chain for $ref alias", () => {
    const netexLibrary: NetexLibrary = {
      Alias: { $ref: "#/definitions/Target" },
      Target: { type: "string" },
    };
    const result = resolveDefType(netexLibrary, "Alias");
    expect(result.ts).toBe("string");
    expect(result.via).toEqual([
      { name: "Alias", rule: "ref" },
      { name: "Target", rule: "primitive" },
    ]);
  });

  it("includes format comment for formatted primitives", () => {
    const netexLibrary: NetexLibrary = { DT: { type: "string", format: "date-time" } };
    expect(resolveDefType(netexLibrary, "DT")).toEqual({
      ts: "string /* date-time */",
      complex: false,
      via: [{ name: "DT", rule: "primitive" }],
    });
  });

  it("handles circular references", () => {
    const netexLibrary: NetexLibrary = {
      A: { $ref: "#/definitions/B" },
      B: { $ref: "#/definitions/A" },
    };
    const result = resolveDefType(netexLibrary, "A");
    expect(result.complex).toBe(true);
  });

  it("multi-hop $ref chain produces [ref, ref, primitive]", () => {
    const netexLibrary: NetexLibrary = {
      A: { $ref: "#/definitions/B" },
      B: { $ref: "#/definitions/C" },
      C: { type: "string" },
    };
    const result = resolveDefType(netexLibrary, "A");
    expect(result.via).toEqual([
      { name: "A", rule: "ref" },
      { name: "B", rule: "ref" },
      { name: "C", rule: "primitive" },
    ]);
  });

  it("allOf-passthrough + inner ref chain", () => {
    const netexLibrary: NetexLibrary = {
      Outer: { allOf: [{ $ref: "#/definitions/Inner" }] },
      Inner: { $ref: "#/definitions/Leaf" },
      Leaf: { type: "integer" },
    };
    const result = resolveDefType(netexLibrary, "Outer");
    expect(result.via).toEqual([
      { name: "Outer", rule: "allOf-passthrough" },
      { name: "Inner", rule: "ref" },
      { name: "Leaf", rule: "primitive" },
    ]);
  });

  it("allOf-speculative records hop before inner chain", () => {
    const netexLibrary: NetexLibrary = {
      Outer: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { extra: { type: "string" } } },
        ],
      },
      Parent: { $ref: "#/definitions/Prim" },
      Prim: { type: "string" },
    };
    const result = resolveDefType(netexLibrary, "Outer");
    expect(result.via).toEqual([
      { name: "Outer", rule: "allOf-speculative" },
      { name: "Parent", rule: "ref" },
      { name: "Prim", rule: "primitive" },
    ]);
  });

  it("array-unwrap + inner atom-collapse chain", () => {
    const netexLibrary: NetexLibrary = {
      ListWrap: {
        type: "object",
        properties: {
          Item: { type: "array", items: { $ref: "#/definitions/AtomItem" } },
        },
      },
      AtomItem: { type: "object", properties: { value: { type: "string" } }, "x-netex-atom": "string" },
    };
    const result = resolveDefType(netexLibrary, "ListWrap");
    expect(result.ts).toBe("string[]");
    expect(result.via).toEqual([
      { name: "ListWrap", rule: "array-unwrap" },
      { name: "AtomItem", rule: "atom-collapse" },
    ]);
  });

  it("resolves x-netex-atom:array with ref items to EnumName[]", () => {
    const netexLibrary: NetexLibrary = {
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
    const result = resolveDefType(netexLibrary, "AccessFacilityListOfEnumerations");
    expect(result.ts).toBe("AccessFacilityEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "AccessFacilityListOfEnumerations", rule: "array-of" },
      { name: "AccessFacilityEnumeration", rule: "enum" },
    ]);
  });

  it("resolves x-netex-atom:array with ref items to complex type[]", () => {
    const netexLibrary: NetexLibrary = {
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
    const result = resolveDefType(netexLibrary, "ThingList");
    expect(result.ts).toBe("ThingStructure[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([
      { name: "ThingList", rule: "array-of" },
      { name: "ThingStructure", rule: "complex" },
    ]);
  });

  it("resolves x-netex-atom:array with inline primitive items", () => {
    const netexLibrary: NetexLibrary = {
      LanguageListOfEnumerations: {
        type: "array",
        items: { type: "string" },
        "x-netex-atom": "array",
      },
    };
    const result = resolveDefType(netexLibrary, "LanguageListOfEnumerations");
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
    const netexLibrary: NetexLibrary = { T: { type: "string" } };
    expect(resolvePropertyType(netexLibrary, { $ref: "#/definitions/T" })).toEqual({
      ts: "string",
      complex: false,
      via: [{ name: "T", rule: "primitive" }],
    });
  });

  it("resolves array of $ref and preserves via", () => {
    const netexLibrary: NetexLibrary = { T: { type: "string" } };
    const result = resolvePropertyType(netexLibrary, { type: "array", items: { $ref: "#/definitions/T" } });
    expect(result).toEqual({
      ts: "string[]",
      complex: false,
      via: [{ name: "T", rule: "primitive" }],
    });
  });

  it("resolves inline enum", () => {
    const netexLibrary: NetexLibrary = {};
    expect(resolvePropertyType(netexLibrary, { enum: ["x", "y"] })).toEqual({
      ts: '"x" | "y"',
      complex: false,
    });
  });

  it("resolves inline primitive", () => {
    const netexLibrary: NetexLibrary = {};
    expect(resolvePropertyType(netexLibrary, { type: "boolean" })).toEqual({
      ts: "boolean",
      complex: false,
    });
  });

  it("resolves x-fixed-single-enum as string literal when context is provided", () => {
    const netexLibrary: NetexLibrary = { MyEnum: { enum: ["A", "B", "C"], "x-netex-role": "enumeration" } };
    const schema = {
      allOf: [{ $ref: "#/definitions/MyEnum" }],
      description: "Fixed for each ENTITY type.",
      "x-fixed-single-enum": "MyEnum",
    };
    expect(resolvePropertyType(netexLibrary, schema, "ContextName")).toEqual({
      ts: '"ContextName"',
      complex: false,
      via: [{ name: "ContextName", rule: "fixed-for" }],
    });
  });

  it("resolves x-fixed-single-enum normally without context", () => {
    const netexLibrary: NetexLibrary = { MyEnum: { enum: ["A", "B", "C"], "x-netex-role": "enumeration" } };
    const schema = {
      allOf: [{ $ref: "#/definitions/MyEnum" }],
      description: "Fixed for each ENTITY type.",
      "x-fixed-single-enum": "MyEnum",
    };
    const result = resolvePropertyType(netexLibrary, schema);
    // Without context, falls through to normal enum resolution (stamped enum → name)
    expect(result.ts).toBe("MyEnum");
    expect(result.via).toEqual([{ name: "MyEnum", rule: "enum" }]);
  });

  it("ignores x-fixed-single-enum stamp when absent", () => {
    const netexLibrary: NetexLibrary = { MyEnum: { enum: ["A", "B"], "x-netex-role": "enumeration" } };
    const schema = {
      allOf: [{ $ref: "#/definitions/MyEnum" }],
      description: "Some other description.",
    };
    const result = resolvePropertyType(netexLibrary, schema, "ContextName");
    // No stamp → normal resolution regardless of context (stamped enum → name)
    expect(result.ts).toBe("MyEnum");
    expect(result.via).toEqual([{ name: "MyEnum", rule: "enum" }]);
  });
});

// ── isDynNocRef ──────────────────────────────────────────────────────────────

describe("isDynNocRef", () => {
  it("returns true for direct $ref to NameOfClass", () => {
    expect(isDynNocRef({ $ref: "#/definitions/NameOfClass" })).toBe(true);
  });

  it("returns true for allOf ref to NameOfClass", () => {
    expect(isDynNocRef({ allOf: [{ $ref: "#/definitions/NameOfClass" }] })).toBe(true);
  });

  it("returns false when x-fixed-single-enum is set", () => {
    expect(isDynNocRef({
      allOf: [{ $ref: "#/definitions/NameOfClass" }],
      "x-fixed-single-enum": "NameOfClass",
    })).toBe(false);
  });

  it("returns false for other enum refs", () => {
    expect(isDynNocRef({ $ref: "#/definitions/AllModesEnumeration" })).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isDynNocRef({ type: "string" })).toBe(false);
  });
});

// ── resolvePropertyType + isDynNocRef ────────────────────────────────────────

describe("resolvePropertyType with dynamic NameOfClass", () => {
  it("resolves dynamic NameOfClass ref as string", () => {
    const netexLibrary: NetexLibrary = {
      NameOfClass: { enum: ["A", "B"], "x-netex-role": "enumeration" },
    };
    const schema = { allOf: [{ $ref: "#/definitions/NameOfClass" }] };
    const result = resolvePropertyType(netexLibrary, schema);
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "NameOfClass", rule: "dyn-class" }]);
  });

  it("does not short-circuit when x-fixed-single-enum is set", () => {
    const netexLibrary: NetexLibrary = {
      NameOfClass: { enum: ["A", "B"], "x-netex-role": "enumeration" },
    };
    const schema = {
      allOf: [{ $ref: "#/definitions/NameOfClass" }],
      "x-fixed-single-enum": "NameOfClass",
    };
    const result = resolvePropertyType(netexLibrary, schema, "MyEntity");
    expect(result.ts).toBe('"MyEntity"');
    expect(result.via).toEqual([{ name: "MyEntity", rule: "fixed-for" }]);
  });
});

// ── resolveAtom ──────────────────────────────────────────────────────────────

describe("resolveAtom", () => {
  it("reads x-netex-atom annotation", () => {
    const netexLibrary: NetexLibrary = { T: { type: "object", "x-netex-atom": "string" } };
    expect(resolveAtom(netexLibrary, "T")).toBe("string");
  });

  it("follows $ref alias to find annotation", () => {
    const netexLibrary: NetexLibrary = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { type: "object", "x-netex-atom": "number" },
    };
    expect(resolveAtom(netexLibrary, "Alias")).toBe("number");
  });

  it("returns simpleObj for multi-prop types", () => {
    const netexLibrary: NetexLibrary = {
      T: { type: "object", "x-netex-atom": "simpleObj" },
    };
    expect(resolveAtom(netexLibrary, "T")).toBe("simpleObj");
  });

  it("returns null when no annotation", () => {
    const netexLibrary: NetexLibrary = { T: { type: "object", properties: { x: { type: "string" } } } };
    expect(resolveAtom(netexLibrary, "T")).toBeNull();
  });

  it("returns null for missing definition", () => {
    expect(resolveAtom({}, "Missing")).toBeNull();
  });
});

// ── buildReverseIndex ────────────────────────────────────────────────────────

describe("buildReverseIndex", () => {
  it("builds incoming reference map", () => {
    const netexLibrary: NetexLibrary = {
      A: { $ref: "#/definitions/B" },
      B: { type: "string" },
      C: { properties: { x: { $ref: "#/definitions/B" } } },
    };
    const idx = buildReverseIndex(netexLibrary);
    expect(idx["B"]).toEqual(expect.arrayContaining(["A", "C"]));
    expect(idx["B"]).toHaveLength(2);
  });

  it("excludes self-references", () => {
    const netexLibrary: NetexLibrary = { A: { allOf: [{ $ref: "#/definitions/A" }] } };
    const idx = buildReverseIndex(netexLibrary);
    expect(idx["A"]).toBeUndefined();
  });
});

// ── findTransitiveEntityUsers ─────────────────────────────────────────────────

describe("findTransitiveEntityUsers", () => {
  /** Helper: build the isEntity predicate from netexLibrary (the common call-site pattern). */
  const isEntity = (netexLibrary: NetexLibrary) => (name: string) => defRole(netexLibrary[name]) === "entity";

  it("finds direct entity referrer", () => {
    const netexLibrary: NetexLibrary = {
      Leaf: { type: "string" },
      MyEntity: { "x-netex-role": "entity", properties: { x: { $ref: "#/definitions/Leaf" } } },
    };
    const idx = buildReverseIndex(netexLibrary);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(netexLibrary))).toEqual(["MyEntity"]);
  });

  it("finds entity through intermediate structure", () => {
    const netexLibrary: NetexLibrary = {
      Leaf: { type: "string" },
      Middle: { "x-netex-role": "structure", properties: { x: { $ref: "#/definitions/Leaf" } } },
      MyEntity: { "x-netex-role": "entity", properties: { m: { $ref: "#/definitions/Middle" } } },
    };
    const idx = buildReverseIndex(netexLibrary);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(netexLibrary))).toEqual(["MyEntity"]);
  });

  it("does not traverse beyond entities", () => {
    const netexLibrary: NetexLibrary = {
      Leaf: { type: "string" },
      EntityA: { "x-netex-role": "entity", properties: { x: { $ref: "#/definitions/Leaf" } } },
      EntityB: { "x-netex-role": "entity", properties: { a: { $ref: "#/definitions/EntityA" } } },
    };
    const idx = buildReverseIndex(netexLibrary);
    // EntityA uses Leaf directly; EntityB uses EntityA but not Leaf
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(netexLibrary))).toEqual(["EntityA"]);
  });

  it("excludes the input name from results even if it is an entity", () => {
    const netexLibrary: NetexLibrary = {
      Self: { "x-netex-role": "entity", properties: { x: { type: "string" } } },
      Other: { "x-netex-role": "entity", properties: { s: { $ref: "#/definitions/Self" } } },
    };
    const idx = buildReverseIndex(netexLibrary);
    expect(findTransitiveEntityUsers("Self", idx, isEntity(netexLibrary))).toEqual(["Other"]);
  });

  it("handles cycles without infinite loop", () => {
    const netexLibrary: NetexLibrary = {
      A: { "x-netex-role": "structure", properties: { b: { $ref: "#/definitions/B" } } },
      B: { "x-netex-role": "structure", properties: { a: { $ref: "#/definitions/A" } } },
      E: { "x-netex-role": "entity", properties: { a: { $ref: "#/definitions/A" } } },
    };
    const idx = buildReverseIndex(netexLibrary);
    expect(findTransitiveEntityUsers("A", idx, isEntity(netexLibrary))).toEqual(["E"]);
  });

  it("returns empty array when no entities reachable", () => {
    const netexLibrary: NetexLibrary = {
      Orphan: { type: "string" },
    };
    const idx = buildReverseIndex(netexLibrary);
    expect(findTransitiveEntityUsers("Orphan", idx, isEntity(netexLibrary))).toEqual([]);
  });

  it("finds multiple entities through branching paths", () => {
    const netexLibrary: NetexLibrary = {
      Leaf: { type: "string" },
      StructA: { "x-netex-role": "structure", properties: { x: { $ref: "#/definitions/Leaf" } } },
      StructB: { "x-netex-role": "structure", properties: { x: { $ref: "#/definitions/Leaf" } } },
      EntityX: { "x-netex-role": "entity", properties: { a: { $ref: "#/definitions/StructA" } } },
      EntityY: { "x-netex-role": "entity", properties: { b: { $ref: "#/definitions/StructB" } } },
    };
    const idx = buildReverseIndex(netexLibrary);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(netexLibrary))).toEqual(["EntityX", "EntityY"]);
  });
});

// ── resolveRefEntity ─────────────────────────────────────────────────────────

describe("resolveRefEntity", () => {
  it("resolves direct entity target via stamp", () => {
    const netexLibrary: NetexLibrary = {
      FooRef: { "x-netex-role": "reference", "x-netex-refTarget": "Foo" },
      Foo: { "x-netex-role": "entity" },
    };
    expect(resolveRefEntity(netexLibrary, "FooRef")).toBe("Foo");
  });

  it("expands abstract target to concrete entity sg-members", () => {
    const netexLibrary: NetexLibrary = {
      BarRef: { "x-netex-role": "reference", "x-netex-refTarget": "Bar" },
      Bar: { "x-netex-role": "abstract", "x-netex-sg-members": ["Baz", "Qux"] },
      BazRef: { "x-netex-role": "reference", "x-netex-refTarget": "Baz" },
      Baz: { "x-netex-role": "entity" },
      QuxRef: { "x-netex-role": "reference", "x-netex-refTarget": "Qux" },
      Qux: { "x-netex-role": "structure" },
    };
    expect(resolveRefEntity(netexLibrary, "BarRef")).toEqual(["Baz"]);
  });

  it("falls back to name stripping when no stamp", () => {
    const netexLibrary: NetexLibrary = {
      FooRef: { "x-netex-role": "reference" },
      Foo: { "x-netex-role": "entity" },
    };
    expect(resolveRefEntity(netexLibrary, "FooRef")).toBe("Foo");
  });

  it("returns null when no target found", () => {
    const netexLibrary: NetexLibrary = {
      UnknownRef: { "x-netex-role": "reference" },
    };
    expect(resolveRefEntity(netexLibrary, "UnknownRef")).toBeNull();
  });

  it("handles RefStructure suffix via stamp", () => {
    const netexLibrary: NetexLibrary = {
      Foo_RefStructure: { "x-netex-role": "reference", "x-netex-refTarget": "Foo" },
      Foo: { "x-netex-role": "entity" },
    };
    expect(resolveRefEntity(netexLibrary, "Foo_RefStructure")).toBe("Foo");
  });
});

// ── collectRefProps ──────────────────────────────────────────────────────────

describe("collectRefProps", () => {
  it("finds ref-typed properties with resolved targets", () => {
    const netexLibrary: NetexLibrary = {
      MyStruct: {
        properties: {
          FooRef: { $ref: "#/definitions/FooRef" },
          name: { type: "string" },
          BarRef: { allOf: [{ $ref: "#/definitions/BarRef" }] },
        },
      },
      FooRef: { "x-netex-role": "reference", "x-netex-refTarget": "Foo" },
      Foo: { "x-netex-role": "entity" },
      BarRef: { "x-netex-role": "reference", "x-netex-refTarget": "Bar" },
      Bar: { "x-netex-role": "entity" },
    };
    const result = collectRefProps(netexLibrary, "MyStruct");
    expect(result).toHaveLength(2);
    expect(result[0].propName).toBe("FooRef");
    expect(result[0].targetEntities).toEqual(["Foo"]);
    expect(result[1].propName).toBe("BarRef");
    expect(result[1].targetEntities).toEqual(["Bar"]);
  });

  it("walks allOf chain to find inherited ref props", () => {
    const netexLibrary: NetexLibrary = {
      Child: { allOf: [{ $ref: "#/definitions/Parent" }, { properties: { ChildRef: { $ref: "#/definitions/ChildRef" } } }] },
      Parent: { properties: { ParentRef: { $ref: "#/definitions/ParentRef" } } },
      ChildRef: { "x-netex-role": "reference", "x-netex-refTarget": "ChildEntity" },
      ChildEntity: { "x-netex-role": "entity" },
      ParentRef: { "x-netex-role": "reference", "x-netex-refTarget": "ParentEntity" },
      ParentEntity: { "x-netex-role": "entity" },
    };
    const result = collectRefProps(netexLibrary, "Child");
    expect(result).toHaveLength(2);
    expect(result.map(r => r.propName).sort()).toEqual(["ChildRef", "ParentRef"]);
  });

  it("excludes unresolvable refs", () => {
    const netexLibrary: NetexLibrary = {
      MyStruct: { properties: { BadRef: { $ref: "#/definitions/BadRef" } } },
      BadRef: { "x-netex-role": "reference" },
    };
    const result = collectRefProps(netexLibrary, "MyStruct");
    expect(result).toEqual([]);
  });

  it("returns empty for no ref props", () => {
    const netexLibrary: NetexLibrary = {
      MyStruct: { properties: { name: { type: "string" }, count: { type: "number" } } },
    };
    expect(collectRefProps(netexLibrary, "MyStruct")).toEqual([]);
  });
});

// ── collectExtraProps ────────────────────────────────────────────────────────

describe("collectExtraProps", () => {
  it("returns empty when entity maps directly to base structure", () => {
    const netexLibrary: NetexLibrary = {
      MyEntity: { $ref: "#/definitions/Base_VersionStructure", "x-netex-role": "entity" },
      Base_VersionStructure: { properties: { a: { type: "string" } } },
    };
    expect(collectExtraProps(netexLibrary, "MyEntity", "Base_VersionStructure")).toEqual([]);
  });

  it("collects props from one intermediate level", () => {
    const netexLibrary: NetexLibrary = {
      DerivedEntity: { $ref: "#/definitions/Derived_VersionStructure", "x-netex-role": "entity" },
      Derived_VersionStructure: {
        allOf: [{ $ref: "#/definitions/Base_VersionStructure" }, { properties: { x: { type: "string" }, y: { type: "number" }, z: { type: "boolean" } } }],
      },
      Base_VersionStructure: { properties: { a: { type: "string" } } },
    };
    expect(collectExtraProps(netexLibrary, "DerivedEntity", "Base_VersionStructure")).toEqual(["x", "y", "z"]);
  });

  it("collects props from two intermediate levels", () => {
    const netexLibrary: NetexLibrary = {
      DeepEntity: { $ref: "#/definitions/Deep_VersionStructure", "x-netex-role": "entity" },
      Deep_VersionStructure: {
        allOf: [{ $ref: "#/definitions/Mid_VersionStructure" }, { properties: { d1: { type: "string" } } }],
      },
      Mid_VersionStructure: {
        allOf: [{ $ref: "#/definitions/Base_VersionStructure" }, { properties: { m1: { type: "string" }, m2: { type: "number" } } }],
      },
      Base_VersionStructure: { properties: { a: { type: "string" } } },
    };
    const extras = collectExtraProps(netexLibrary, "DeepEntity", "Base_VersionStructure");
    expect(extras).toContain("d1");
    expect(extras).toContain("m1");
    expect(extras).toContain("m2");
    expect(extras).toHaveLength(3);
  });

  it("handles $ref alias entities (common NeTEx pattern)", () => {
    const netexLibrary: NetexLibrary = {
      AliasEntity: { $ref: "#/definitions/Alias_VersionStructure", "x-netex-role": "entity" },
      Alias_VersionStructure: {
        allOf: [{ $ref: "#/definitions/Base_VS" }, { properties: { extra: { type: "string" } } }],
      },
      Base_VS: { properties: { base: { type: "string" } } },
    };
    expect(collectExtraProps(netexLibrary, "AliasEntity", "Base_VS")).toEqual(["extra"]);
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

// ── canonicalPropName ─────────────────────────────────────────────────────────

describe("canonicalPropName", () => {
  it("returns PascalCase for XML elements", () => {
    expect(canonicalPropName("TransportMode", {})).toBe("TransportMode");
  });

  it("returns $-prefixed for XML attributes", () => {
    expect(canonicalPropName("id", { xml: { attribute: true } })).toBe("$id");
  });

  it("returns name unchanged when schema is undefined", () => {
    expect(canonicalPropName("Foo", undefined)).toBe("Foo");
  });

  it("returns name unchanged when schema has no xml property", () => {
    expect(canonicalPropName("Bar", { type: "string" })).toBe("Bar");
  });
});

// ── unwrapMixed ──────────────────────────────────────────────────────────────

describe("unwrapMixed", () => {
  it("returns inner element type for mixed-content wrapper", () => {
    const netexLibrary: NetexLibrary = {
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
    expect(unwrapMixed(netexLibrary, "Wrapper")).toBe("Inner");
  });

  it("returns null when x-netex-mixed is absent", () => {
    const netexLibrary: NetexLibrary = {
      Plain: {
        type: "object",
        description: "*Either* blah",
        properties: { Text: { type: "array", items: { $ref: "#/definitions/T" } } },
      },
    };
    expect(unwrapMixed(netexLibrary, "Plain")).toBeNull();
  });

  it("returns null when description lacks *Either*", () => {
    const netexLibrary: NetexLibrary = {
      NoSignal: {
        type: "object",
        "x-netex-mixed": true,
        description: "Some other description",
        properties: { Text: { type: "array", items: { $ref: "#/definitions/T" } } },
      },
    };
    expect(unwrapMixed(netexLibrary, "NoSignal")).toBeNull();
  });

  it("returns null for missing definition", () => {
    expect(unwrapMixed({}, "Missing")).toBeNull();
  });

  it("resolveDefType uses unwrapMixed to resolve as inner type array, with via", () => {
    const netexLibrary: NetexLibrary = {
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
    const result = resolveDefType(netexLibrary, "Mixed");
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
    const netexLibrary: NetexLibrary = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "structure" },
    };
    const counts = countRoles(["A", "B", "C"], netexLibrary);
    expect(counts.get("entity")).toBe(2);
    expect(counts.get("structure")).toBe(1);
  });

  it("groups missing roles under unclassified", () => {
    const netexLibrary: NetexLibrary = { A: { type: "object" }, B: {} };
    const counts = countRoles(["A", "B"], netexLibrary);
    expect(counts.get("unclassified")).toBe(2);
  });
});

// ── presentRoles ────────────────────────────────────────────────────────────

describe("presentRoles", () => {
  it("returns only roles present in the data", () => {
    const netexLibrary: NetexLibrary = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "reference" },
    };
    const roles = presentRoles(["A", "B"], netexLibrary);
    const keys = roles.map((r) => r.role);
    expect(keys).toContain("entity");
    expect(keys).toContain("reference");
    expect(keys).not.toContain("abstract");
  });

  it("includes unclassified when definitions lack x-netex-role", () => {
    const netexLibrary: NetexLibrary = { A: { "x-netex-role": "entity" }, B: { type: "object" } };
    const roles = presentRoles(["A", "B"], netexLibrary);
    expect(roles.map((r) => r.role)).toContain("unclassified");
  });

  it("respects ROLE_DISPLAY_ORDER", () => {
    const netexLibrary: NetexLibrary = {
      A: { "x-netex-role": "reference" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "abstract" },
    };
    const roles = presentRoles(["A", "B", "C"], netexLibrary);
    const keys = roles.map((r) => r.role);
    // entity < abstract < reference per ROLE_DISPLAY_ORDER
    expect(keys.indexOf("entity")).toBeLessThan(keys.indexOf("abstract"));
    expect(keys.indexOf("abstract")).toBeLessThan(keys.indexOf("reference"));
  });

  it("includes correct counts", () => {
    const netexLibrary: NetexLibrary = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "structure" },
    };
    const roles = presentRoles(["A", "B", "C"], netexLibrary);
    expect(roles.find((r) => r.role === "entity")?.count).toBe(2);
    expect(roles.find((r) => r.role === "structure")?.count).toBe(1);
  });

  it("uses ROLE_LABELS for display names", () => {
    const netexLibrary: NetexLibrary = {
      A: { "x-netex-role": "frameMember" },
      B: { "x-netex-role": "enumeration" },
    };
    const roles = presentRoles(["A", "B"], netexLibrary);
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
    const netexLibrary: NetexLibrary = {
      Foo: { properties: { x: { type: "string" }, y: { type: "number" } } },
    };
    const chain = buildInheritanceChain(netexLibrary, "Foo");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("Foo");
    expect(chain[0].ownProps).toHaveLength(2);
    expect(chain[0].ownProps[0].name).toBe("x");
  });

  it("builds chain with allOf inheritance (root first)", () => {
    const netexLibrary: NetexLibrary = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { b: { type: "number" } } },
        ],
      },
      Parent: { properties: { a: { type: "string" } } },
    };
    const chain = buildInheritanceChain(netexLibrary, "Child");
    expect(chain).toHaveLength(2);
    expect(chain[0].name).toBe("Parent");
    expect(chain[1].name).toBe("Child");
    expect(chain[0].ownProps[0].name).toBe("a");
    expect(chain[1].ownProps[0].name).toBe("b");
  });

  it("follows $ref aliases", () => {
    const netexLibrary: NetexLibrary = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { properties: { x: { type: "string" } } },
    };
    const chain = buildInheritanceChain(netexLibrary, "Alias");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("Real");
  });

  it("handles circular references without infinite loop", () => {
    const netexLibrary: NetexLibrary = {
      A: { allOf: [{ $ref: "#/definitions/B" }, { properties: { x: { type: "string" } } }] },
      B: { allOf: [{ $ref: "#/definitions/A" }, { properties: { y: { type: "string" } } }] },
    };
    const chain = buildInheritanceChain(netexLibrary, "A");
    expect(chain.length).toBeGreaterThan(0);
  });

  it("deduplicates own properties from allOf and direct properties", () => {
    const netexLibrary: NetexLibrary = {
      T: {
        allOf: [{ properties: { x: { type: "string" } } }],
        properties: { x: { type: "string" }, y: { type: "number" } },
      },
    };
    const chain = buildInheritanceChain(netexLibrary, "T");
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
    const netexLibrary: NetexLibrary = {
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
      },
    };
    const props = flattenAllOf(netexLibrary, "Root");
    const result = inlineSingleRefs(netexLibrary, props);
    // Code should be replaced by value and type
    expect(result.some((p) => p.prop[1] === "Code")).toBe(false);
    expect(result.some((p) => p.prop[1] === "value")).toBe(true);
    expect(result.some((p) => p.prop[1] === "type")).toBe(true);
    // inlinedFrom should be set
    const inlined = result.filter((p) => p.inlinedFrom);
    expect(inlined).toHaveLength(2);
    expect(inlined[0].inlinedFrom).toBe("Code");
  });

  it("uses parentProp_innerProp when name conflicts exist", () => {
    const netexLibrary: NetexLibrary = {
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
      },
    };
    const props = flattenAllOf(netexLibrary, "Root");
    const result = inlineSingleRefs(netexLibrary, props);
    // "value" is already taken → should become "Code_value"
    expect(result.some((p) => p.prop[1] === "Code_value")).toBe(true);
    // "extra" is free → should stay as-is
    expect(result.some((p) => p.prop[1] === "extra")).toBe(true);
    // Original "value" still present
    expect(result.some((p) => p.prop[1] === "value" && !p.inlinedFrom)).toBe(true);
  });

  it("skips reference-role targets", () => {
    const netexLibrary: NetexLibrary = {
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
    const props = flattenAllOf(netexLibrary, "Root");
    const result = inlineSingleRefs(netexLibrary, props);
    // Should NOT inline — Ref stays as-is
    expect(result).toHaveLength(1);
    expect(result[0].prop[1]).toBe("Ref");
    expect(result[0].inlinedFrom).toBeUndefined();
  });

  it("skips collection-role targets", () => {
    const netexLibrary: NetexLibrary = {
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
    const props = flattenAllOf(netexLibrary, "Root");
    const result = inlineSingleRefs(netexLibrary, props);
    expect(result).toHaveLength(1);
    expect(result[0].prop[1]).toBe("Items");
    expect(result[0].inlinedFrom).toBeUndefined();
  });

  it("skips atom targets", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        allOf: [
          {
            properties: {
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
    const props = flattenAllOf(netexLibrary, "Root");
    const result = inlineSingleRefs(netexLibrary, props);
    // Should NOT inline — atom types are transparent wrappers
    expect(result).toHaveLength(1);
    expect(result[0].prop[1]).toBe("Code");
    expect(result[0].inlinedFrom).toBeUndefined();
  });

  it("returns props unchanged when no candidates exist", () => {
    const netexLibrary: NetexLibrary = {
      Root: { properties: { x: { type: "string" }, y: { type: "number" } } },
    };
    const props = flattenAllOf(netexLibrary, "Root");
    const result = inlineSingleRefs(netexLibrary, props);
    expect(result).toEqual(props);
  });

  it("handles multiple inlined props with cross-conflict detection", () => {
    const netexLibrary: NetexLibrary = {
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
    const props = flattenAllOf(netexLibrary, "Root");
    const result = inlineSingleRefs(netexLibrary, props);
    // First "shared" from A is free
    expect(result.some((p) => p.prop[1] === "shared" && p.inlinedFrom === "A")).toBe(true);
    // Second "shared" from B conflicts → B_shared
    expect(result.some((p) => p.prop[1] === "B_shared" && p.inlinedFrom === "B")).toBe(true);
  });

  it("filters shared-ancestor props when target and parent share a common base", () => {
    // Simulates: Parent inherits BaseStruct → MiddleStruct, then has a single-$ref
    // to TargetStruct which also inherits BaseStruct → MiddleStruct.
    // Only TargetStruct's own props should be inlined.
    const netexLibrary: NetexLibrary = {
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
    const props = flattenAllOf(netexLibrary, "Parent");
    const result = inlineSingleRefs(netexLibrary, props);

    // Shared-ancestor props should NOT appear as inlined from Detail
    const detailInlined = result.filter((p) => p.inlinedFrom === "Detail");
    const detailNames = detailInlined.map((p) => p.prop[1]);

    // BaseStruct and MiddleStruct props should be filtered out
    expect(detailNames).not.toContain("id");
    expect(detailNames).not.toContain("version");
    expect(detailNames).not.toContain("created");
    expect(detailNames).not.toContain("keyList");

    // Only TargetStruct's own props should be inlined (canonical names)
    expect(detailNames).toContain("Capacity");
    expect(detailNames).toContain("Class");
    expect(detailInlined).toHaveLength(2);

    // Parent's own props should still be present (canonical names)
    expect(result.some((p) => p.prop[1] === "Name" && !p.inlinedFrom)).toBe(true);
    // Inherited props from the parent chain should still be present
    expect(result.some((p) => p.prop[1] === "id" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "version" && !p.inlinedFrom)).toBe(true);
  });
});

// ── collectDependencyTree ─────────────────────────────────────────────────────

describe("collectDependencyTree", () => {
  it("returns empty for an enumeration", () => {
    const netexLibrary: NetexLibrary = {
      MyEnum: { enum: ["a", "b"], "x-netex-role": "enumeration" },
    };
    expect(collectDependencyTree(netexLibrary, "MyEnum")).toHaveLength(0);
  });

  it("collects direct ref-typed dependencies", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        allOf: [
          {
            properties: {
              Name: { $ref: "#/definitions/NameType" },
              Code: { $ref: "#/definitions/CodeType" },
            },
          },
        ],
      },
      NameType: { type: "string", "x-netex-atom": "string" },
      CodeType: { type: "string", "x-netex-atom": "string" },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.name).sort()).toEqual(["CodeType", "NameType"]);
    expect(tree.every((n) => n.depth === 0)).toBe(true);
    expect(tree.every((n) => !n.duplicate)).toBe(true);
  });

  it("resolves $ref aliases before enqueuing", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        allOf: [{ properties: { Thing: { $ref: "#/definitions/Alias" } } }],
      },
      Alias: { $ref: "#/definitions/RealType" },
      RealType: { type: "string", "x-netex-atom": "string" },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("RealType");
    expect(tree[0].via).toBe("Thing");
  });

  it("marks duplicate entries and skips recursion", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        allOf: [
          {
            properties: {
              A: { $ref: "#/definitions/Shared" },
              B: { $ref: "#/definitions/Shared" },
            },
          },
        ],
      },
      Shared: { type: "string", "x-netex-atom": "string" },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    expect(tree).toHaveLength(2);
    const first = tree.find((n) => !n.duplicate)!;
    const second = tree.find((n) => n.duplicate)!;
    expect(first.name).toBe("Shared");
    expect(second.name).toBe("Shared");
    expect(second.duplicate).toBe(true);
  });

  it("recurses into complex types at increasing depth", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        allOf: [{ properties: { Child: { $ref: "#/definitions/ChildStruct" } } }],
      },
      ChildStruct: {
        type: "object",
        "x-netex-role": "structure",
        allOf: [{ properties: { Leaf: { $ref: "#/definitions/LeafType" } } }],
      },
      LeafType: { type: "string", "x-netex-atom": "string" },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    expect(tree).toHaveLength(2);
    const child = tree.find((n) => n.name === "ChildStruct")!;
    const leaf = tree.find((n) => n.name === "LeafType")!;
    expect(child.depth).toBe(0);
    expect(leaf.depth).toBe(1);
  });

  it("stops at references (x-netex-role: reference)", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        allOf: [
          {
            properties: {
              Ref: { $ref: "#/definitions/ThingRef" },
              Inner: { $ref: "#/definitions/InnerStruct" },
            },
          },
        ],
      },
      ThingRef: {
        "x-netex-role": "reference",
        allOf: [{ properties: { Nested: { $ref: "#/definitions/Nested" } } }],
      },
      InnerStruct: { type: "string", "x-netex-atom": "string" },
      Nested: { type: "string", "x-netex-atom": "string" },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    // ThingRef is emitted but not recursed — Nested should NOT appear
    expect(tree.find((n) => n.name === "ThingRef")).toBeDefined();
    expect(tree.find((n) => n.name === "Nested")).toBeUndefined();
  });

  it("excludes root from output", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        allOf: [{ properties: { X: { $ref: "#/definitions/Leaf" } } }],
      },
      Leaf: { type: "string", "x-netex-atom": "string" },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    expect(tree.every((n) => n.name !== "Root")).toBe(true);
  });

  it("handles refArray properties", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        allOf: [
          {
            properties: {
              Items: { type: "array", items: { $ref: "#/definitions/ItemType" } },
            },
          },
        ],
      },
      ItemType: { type: "string", "x-netex-atom": "string" },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("ItemType");
    expect(tree[0].via).toBe("Items");
  });

  it("resolves allOf-passthrough wrappers to the underlying definition", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        properties: {
          Code: { $ref: "#/definitions/PrivateCode" },
        },
        "x-netex-role": "entity",
      },
      // allOf with single $ref, no own properties → passthrough alias
      PrivateCode: {
        allOf: [{ $ref: "#/definitions/PrivateCodeStructure" }],
      },
      PrivateCodeStructure: {
        type: "object",
        properties: {
          value: { type: "string" },
          type: { type: "string", xml: { attribute: true } },
        },
        "x-netex-atom": "simpleObj",
      },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    // Should collect PrivateCodeStructure (the resolved target), not PrivateCode (the wrapper)
    const names = tree.filter((n) => !n.duplicate).map((n) => n.name);
    expect(names).toContain("PrivateCodeStructure");
    expect(names).not.toContain("PrivateCode");
  });

  it("collects enumeration targets from anyOf union properties", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        properties: {
          Category: {
            anyOf: [
              { $ref: "#/definitions/FooEnumeration" },
              { $ref: "#/definitions/BarEnumeration" },
            ],
          },
        },
        "x-netex-role": "entity",
      },
      FooEnumeration: { enum: ["a", "b"], "x-netex-role": "enumeration" },
      BarEnumeration: { enum: ["x", "y"], "x-netex-role": "enumeration" },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    const names = tree.filter((n) => !n.duplicate).map((n) => n.name);
    expect(names).toContain("FooEnumeration");
    expect(names).toContain("BarEnumeration");
  });

  it("skips x-fixed-single-enum refs in dependency tree", () => {
    const netexLibrary: NetexLibrary = {
      MyEntity: {
        properties: {
          nameOfClass: {
            allOf: [{ $ref: "#/definitions/BigEnum" }],
            "x-fixed-single-enum": "BigEnum",
          },
          mode: {
            allOf: [{ $ref: "#/definitions/SmallEnum" }],
          },
        },
        "x-netex-role": "entity",
      },
      BigEnum: { enum: ["A", "B", "C"], "x-netex-role": "enumeration" },
      SmallEnum: { enum: ["x", "y"], "x-netex-role": "enumeration" },
    };
    const deps = collectDependencyTree(netexLibrary, "MyEntity");
    const names = deps.map((d) => d.name);
    expect(names).toContain("SmallEnum");
    expect(names).not.toContain("BigEnum");
  });

  it("collects enumeration targets from array-of-enum list wrappers", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        properties: {
          Facilities: { $ref: "#/definitions/FacilityList" },
        },
        "x-netex-role": "entity",
      },
      FacilityList: {
        allOf: [{ $ref: "#/definitions/FacilityListOfEnumerations" }],
      },
      FacilityListOfEnumerations: {
        type: "array",
        items: { $ref: "#/definitions/FacilityEnumeration" },
        "x-netex-atom": "array",
      },
      FacilityEnumeration: { enum: ["wifi", "power"], "x-netex-role": "enumeration" },
    };
    const tree = collectDependencyTree(netexLibrary, "Root");
    const names = tree.filter((n) => !n.duplicate).map((n) => n.name);
    expect(names).toContain("FacilityEnumeration");
  });

  it("excludeRootProps skips matching seeds", () => {
    const netexLibrary: NetexLibrary = {
      Root: {
        allOf: [{
          properties: {
            A: { $ref: "#/definitions/OnlyViaA" },
            B: { $ref: "#/definitions/Shared" },
            C: { $ref: "#/definitions/Shared" },
          },
        }],
      },
      OnlyViaA: { type: "string", "x-netex-atom": "string" },
      Shared: { type: "string", "x-netex-atom": "string" },
    };
    // Without exclusion: OnlyViaA + Shared (+ duplicate Shared)
    const full = collectDependencyTree(netexLibrary, "Root");
    expect(full.filter(n => !n.duplicate)).toHaveLength(2);

    // Exclude A → OnlyViaA gone, Shared still reachable via B/C
    const excl = collectDependencyTree(netexLibrary, "Root", new Set(["A"]));
    expect(excl.filter(n => !n.duplicate).map(n => n.name)).toEqual(["Shared"]);
  });
});
