import { describe, it, expect } from "vitest";
import { resolveDefType, resolvePropertyType, resolveAtom } from "./type-res.js";
import type { NetexLibrary } from "./types.js";


describe("resolveDefType", () => {
  it("resolves primitive type", () => {
    const lib: NetexLibrary = { StringType: { type: "string" } };
    expect(resolveDefType(lib, "StringType")).toEqual({
      ts: "string",
      complex: false,
      via: [{ name: "StringType", rule: "primitive" }],
    });
  });

  it("follows $ref alias to primitive", () => {
    const lib: NetexLibrary = {
      Alias: { $ref: "#/definitions/Target" },
      Target: { type: "string" },
    };
    expect(resolveDefType(lib, "Alias")).toEqual({
      ts: "string",
      complex: false,
      via: [
        { name: "Alias", rule: "ref" },
        { name: "Target", rule: "primitive" },
      ],
    });
  });

  it("follows allOf wrapper to primitive", () => {
    const lib: NetexLibrary = {
      Wrapper: { allOf: [{ $ref: "#/definitions/Inner" }] },
      Inner: { type: "integer" },
    };
    expect(resolveDefType(lib, "Wrapper")).toEqual({
      ts: "number",
      complex: false,
      via: [
        { name: "Wrapper", rule: "allOf-passthrough" },
        { name: "Inner", rule: "primitive" },
      ],
    });
  });

  it("resolves unstamped enum to literal union", () => {
    const lib: NetexLibrary = { E: { enum: ["a", "b", "c"] } };
    const result = resolveDefType(lib, "E");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe('"a" | "b" | "c"');
    expect(result.via).toEqual([{ name: "E", rule: "enum" }]);
  });

  it("resolves stamped enumeration to its name", () => {
    const lib: NetexLibrary = {
      ModeEnumeration: {
        type: "string",
        enum: ["bus", "tram", "rail"],
        "x-netex-role": "enumeration",
      },
    };
    const result = resolveDefType(lib, "ModeEnumeration");
    expect(result.ts).toBe("ModeEnumeration");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "ModeEnumeration", rule: "enum" }]);
  });

  it("returns complex for object with properties", () => {
    const lib: NetexLibrary = { Obj: { type: "object", properties: { x: { type: "string" } } } };
    expect(resolveDefType(lib, "Obj")).toEqual({
      ts: "Obj",
      complex: true,
      via: [{ name: "Obj", rule: "complex" }],
    });
  });

  it("resolves x-netex-atom as primitive instead of complex, with via", () => {
    const lib: NetexLibrary = {
      Wrapper: { type: "object", properties: { value: { type: "string" } }, "x-netex-atom": "string" },
    };
    const result = resolveDefType(lib, "Wrapper");
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "Wrapper", rule: "atom-collapse" }]);
  });

  it("returns complex for x-netex-atom: simpleObj", () => {
    const lib: NetexLibrary = {
      Wrapper: {
        type: "object",
        properties: { value: { type: "string" }, type: { type: "string" } },
        "x-netex-atom": "simpleObj",
      },
    };
    expect(resolveDefType(lib, "Wrapper")).toEqual({
      ts: "Wrapper",
      complex: true,
      via: [{ name: "Wrapper", rule: "complex" }],
    });
  });

  it("speculatively follows allOf parent when own properties exist", () => {
    const lib: NetexLibrary = {
      RefStruct: {
        allOf: [
          { $ref: "#/definitions/Base" },
          { properties: { ref: { type: "string" } } },
        ],
      },
      Base: { type: "string" },
    };
    const result = resolveDefType(lib, "RefStruct");
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
    const lib: NetexLibrary = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { extra: { type: "string" } } },
        ],
      },
      Parent: { type: "object", properties: { x: { type: "string" } } },
    };
    const result = resolveDefType(lib, "Child");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "Child", rule: "complex" }]);
  });

  it("unwraps single-prop array wrapper with via", () => {
    const lib: NetexLibrary = {
      ListWrapper: {
        type: "object",
        properties: {
          Item: { type: "array", items: { $ref: "#/definitions/ItemStruct" } },
        },
      },
      ItemStruct: { type: "object", "x-netex-atom": "simpleObj", properties: { value: { type: "string" }, code: { type: "string" } } },
    };
    const result = resolveDefType(lib, "ListWrapper");
    expect(result.ts).toBe("ItemStruct[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([
      { name: "ListWrapper", rule: "array-unwrap" },
      { name: "ItemStruct", rule: "complex" },
    ]);
  });

  it("unwraps empty object with via", () => {
    const lib: NetexLibrary = {
      EmptyObj: { type: "object" },
    };
    const result = resolveDefType(lib, "EmptyObj");
    expect(result.ts).toBe("any");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "EmptyObj", rule: "empty-object" }]);
  });

  it("records full via chain for $ref alias", () => {
    const lib: NetexLibrary = {
      Alias: { $ref: "#/definitions/Target" },
      Target: { type: "string" },
    };
    const result = resolveDefType(lib, "Alias");
    expect(result.ts).toBe("string");
    expect(result.via).toEqual([
      { name: "Alias", rule: "ref" },
      { name: "Target", rule: "primitive" },
    ]);
  });

  it("includes format comment for formatted primitives", () => {
    const lib: NetexLibrary = { DT: { type: "string", format: "date-time" } };
    expect(resolveDefType(lib, "DT")).toEqual({
      ts: "string /* date-time */",
      complex: false,
      via: [{ name: "DT", rule: "primitive" }],
    });
  });

  it("handles circular references", () => {
    const lib: NetexLibrary = {
      A: { $ref: "#/definitions/B" },
      B: { $ref: "#/definitions/A" },
    };
    const result = resolveDefType(lib, "A");
    expect(result.complex).toBe(true);
  });

  it("multi-hop $ref chain produces [ref, ref, primitive]", () => {
    const lib: NetexLibrary = {
      A: { $ref: "#/definitions/B" },
      B: { $ref: "#/definitions/C" },
      C: { type: "string" },
    };
    const result = resolveDefType(lib, "A");
    expect(result.via).toEqual([
      { name: "A", rule: "ref" },
      { name: "B", rule: "ref" },
      { name: "C", rule: "primitive" },
    ]);
  });

  it("allOf-passthrough + inner ref chain", () => {
    const lib: NetexLibrary = {
      Outer: { allOf: [{ $ref: "#/definitions/Inner" }] },
      Inner: { $ref: "#/definitions/Leaf" },
      Leaf: { type: "integer" },
    };
    const result = resolveDefType(lib, "Outer");
    expect(result.via).toEqual([
      { name: "Outer", rule: "allOf-passthrough" },
      { name: "Inner", rule: "ref" },
      { name: "Leaf", rule: "primitive" },
    ]);
  });

  it("allOf-speculative records hop before inner chain", () => {
    const lib: NetexLibrary = {
      Outer: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { extra: { type: "string" } } },
        ],
      },
      Parent: { $ref: "#/definitions/Prim" },
      Prim: { type: "string" },
    };
    const result = resolveDefType(lib, "Outer");
    expect(result.via).toEqual([
      { name: "Outer", rule: "allOf-speculative" },
      { name: "Parent", rule: "ref" },
      { name: "Prim", rule: "primitive" },
    ]);
  });

  it("array-unwrap + inner atom-collapse chain", () => {
    const lib: NetexLibrary = {
      ListWrap: {
        type: "object",
        properties: {
          Item: { type: "array", items: { $ref: "#/definitions/AtomItem" } },
        },
      },
      AtomItem: { type: "object", properties: { value: { type: "string" } }, "x-netex-atom": "string" },
    };
    const result = resolveDefType(lib, "ListWrap");
    expect(result.ts).toBe("string[]");
    expect(result.via).toEqual([
      { name: "ListWrap", rule: "array-unwrap" },
      { name: "AtomItem", rule: "atom-collapse" },
    ]);
  });

  it("resolves x-netex-atom:array with ref items to EnumName[]", () => {
    const lib: NetexLibrary = {
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
    const result = resolveDefType(lib, "AccessFacilityListOfEnumerations");
    expect(result.ts).toBe("AccessFacilityEnumeration[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "AccessFacilityListOfEnumerations", rule: "array-of" },
      { name: "AccessFacilityEnumeration", rule: "enum" },
    ]);
  });

  it("resolves x-netex-atom:array with ref items to complex type[]", () => {
    const lib: NetexLibrary = {
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
    const result = resolveDefType(lib, "ThingList");
    expect(result.ts).toBe("ThingStructure[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([
      { name: "ThingList", rule: "array-of" },
      { name: "ThingStructure", rule: "complex" },
    ]);
  });

  it("resolves x-netex-atom:array with inline primitive items", () => {
    const lib: NetexLibrary = {
      LanguageListOfEnumerations: {
        type: "array",
        items: { type: "string" },
        "x-netex-atom": "array",
      },
    };
    const result = resolveDefType(lib, "LanguageListOfEnumerations");
    expect(result.ts).toBe("string[]");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([
      { name: "LanguageListOfEnumerations", rule: "array-of" },
    ]);
  });
});


describe("resolvePropertyType", () => {
  it("resolves $ref through resolveDefType", () => {
    const lib: NetexLibrary = { T: { type: "string" } };
    expect(resolvePropertyType(lib, { $ref: "#/definitions/T" })).toEqual({
      ts: "string",
      complex: false,
      via: [{ name: "T", rule: "primitive" }],
    });
  });

  it("resolves array of $ref and preserves via", () => {
    const lib: NetexLibrary = { T: { type: "string" } };
    const result = resolvePropertyType(lib, { type: "array", items: { $ref: "#/definitions/T" } });
    expect(result).toEqual({
      ts: "string[]",
      complex: false,
      via: [{ name: "T", rule: "primitive" }],
    });
  });

  it("resolves inline enum", () => {
    const lib: NetexLibrary = {};
    expect(resolvePropertyType(lib, { enum: ["x", "y"] })).toEqual({
      ts: '"x" | "y"',
      complex: false,
    });
  });

  it("resolves inline primitive", () => {
    const lib: NetexLibrary = {};
    expect(resolvePropertyType(lib, { type: "boolean" })).toEqual({
      ts: "boolean",
      complex: false,
    });
  });

  it("resolves x-fixed-single-enum as string literal when context is provided", () => {
    const lib: NetexLibrary = { MyEnum: { enum: ["A", "B", "C"], "x-netex-role": "enumeration" } };
    const schema = {
      allOf: [{ $ref: "#/definitions/MyEnum" }],
      description: "Fixed for each ENTITY type.",
      "x-fixed-single-enum": "MyEnum",
    };
    expect(resolvePropertyType(lib, schema, "ContextName")).toEqual({
      ts: '"ContextName"',
      complex: false,
      via: [{ name: "ContextName", rule: "fixed-for" }],
    });
  });

  it("resolves x-fixed-single-enum normally without context", () => {
    const lib: NetexLibrary = { MyEnum: { enum: ["A", "B", "C"], "x-netex-role": "enumeration" } };
    const schema = {
      allOf: [{ $ref: "#/definitions/MyEnum" }],
      description: "Fixed for each ENTITY type.",
      "x-fixed-single-enum": "MyEnum",
    };
    const result = resolvePropertyType(lib, schema);
    expect(result.ts).toBe("MyEnum");
    expect(result.via).toEqual([{ name: "MyEnum", rule: "enum" }]);
  });

  it("ignores x-fixed-single-enum stamp when absent", () => {
    const lib: NetexLibrary = { MyEnum: { enum: ["A", "B"], "x-netex-role": "enumeration" } };
    const schema = {
      allOf: [{ $ref: "#/definitions/MyEnum" }],
      description: "Some other description.",
    };
    const result = resolvePropertyType(lib, schema, "ContextName");
    expect(result.ts).toBe("MyEnum");
    expect(result.via).toEqual([{ name: "MyEnum", rule: "enum" }]);
  });

  it("resolves dynamic NameOfClass ref as string", () => {
    const lib: NetexLibrary = {
      NameOfClass: { enum: ["A", "B"], "x-netex-role": "enumeration" },
    };
    const schema = { allOf: [{ $ref: "#/definitions/NameOfClass" }] };
    const result = resolvePropertyType(lib, schema);
    expect(result.ts).toBe("string");
    expect(result.complex).toBe(false);
    expect(result.via).toEqual([{ name: "NameOfClass", rule: "dyn-class" }]);
  });

  it("does not short-circuit when x-fixed-single-enum is set", () => {
    const lib: NetexLibrary = {
      NameOfClass: { enum: ["A", "B"], "x-netex-role": "enumeration" },
    };
    const schema = {
      allOf: [{ $ref: "#/definitions/NameOfClass" }],
      "x-fixed-single-enum": "NameOfClass",
    };
    const result = resolvePropertyType(lib, schema, "MyEntity");
    expect(result.ts).toBe('"MyEntity"');
    expect(result.via).toEqual([{ name: "MyEntity", rule: "fixed-for" }]);
  });
});


describe("resolveAtom", () => {
  it("reads x-netex-atom annotation", () => {
    const lib: NetexLibrary = { T: { type: "object", "x-netex-atom": "string" } };
    expect(resolveAtom(lib, "T")).toBe("string");
  });

  it("follows $ref alias to find annotation", () => {
    const lib: NetexLibrary = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { type: "object", "x-netex-atom": "number" },
    };
    expect(resolveAtom(lib, "Alias")).toBe("number");
  });

  it("returns simpleObj for multi-prop types", () => {
    const lib: NetexLibrary = {
      T: { type: "object", "x-netex-atom": "simpleObj" },
    };
    expect(resolveAtom(lib, "T")).toBe("simpleObj");
  });

  it("returns null when no annotation", () => {
    const lib: NetexLibrary = { T: { type: "object", properties: { x: { type: "string" } } } };
    expect(resolveAtom(lib, "T")).toBeNull();
  });

  it("returns null for missing definition", () => {
    expect(resolveAtom({}, "Missing")).toBeNull();
  });
});

describe("resolveDefType — mixed-unwrap via unwrapMixed", () => {
  it("resolves mixed-content type as inner type array, with via", () => {
    const lib: NetexLibrary = {
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
    const result = resolveDefType(lib, "Mixed");
    expect(result.ts).toBe("ItemType[]");
    expect(result.complex).toBe(true);
    expect(result.via).toEqual([{ name: "Mixed", rule: "mixed-unwrap" }]);
  });
});
