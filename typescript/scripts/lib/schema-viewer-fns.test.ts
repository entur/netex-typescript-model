import { describe, it, expect } from "vitest";
import {
  resolveType,
  isRefType,
  refTarget,
  flattenAllOf,
  collectRequired,
  resolveLeafType,
  resolvePropertyType,
  resolveValueLeaf,
  buildReverseIndex,
  defaultForType,
  type Defs,
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
    expect(result[0].prop).toBe("x");
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
    expect(result[0]).toMatchObject({ prop: "x", origin: "Parent" });
    expect(result[1]).toMatchObject({ prop: "y", origin: "Child" });
  });

  it("follows $ref aliases", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { properties: { z: { type: "boolean" } } },
    };
    const result = flattenAllOf(defs, "Alias");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ prop: "z", origin: "Real" });
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

// ── resolveLeafType ──────────────────────────────────────────────────────────

describe("resolveLeafType", () => {
  it("resolves primitive type", () => {
    const defs: Defs = { StringType: { type: "string" } };
    expect(resolveLeafType(defs, "StringType")).toEqual({ ts: "string", complex: false });
  });

  it("follows $ref alias to primitive", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Target" },
      Target: { type: "string" },
    };
    expect(resolveLeafType(defs, "Alias")).toEqual({ ts: "string", complex: false });
  });

  it("follows allOf wrapper to primitive", () => {
    const defs: Defs = {
      Wrapper: { allOf: [{ $ref: "#/definitions/Inner" }] },
      Inner: { type: "integer" },
    };
    expect(resolveLeafType(defs, "Wrapper")).toEqual({ ts: "integer", complex: false });
  });

  it("resolves enum to union", () => {
    const defs: Defs = { E: { enum: ["a", "b", "c"] } };
    const result = resolveLeafType(defs, "E");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe('"a" | "b" | "c"');
  });

  it("returns complex for object with properties", () => {
    const defs: Defs = { Obj: { type: "object", properties: { x: { type: "string" } } } };
    expect(resolveLeafType(defs, "Obj")).toEqual({ ts: "Obj", complex: true });
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
    const result = resolveLeafType(defs, "RefStruct");
    expect(result).toEqual({ ts: "string", complex: false });
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
    expect(resolveLeafType(defs, "Child").complex).toBe(true);
  });

  it("includes format comment for formatted primitives", () => {
    const defs: Defs = { DT: { type: "string", format: "date-time" } };
    expect(resolveLeafType(defs, "DT")).toEqual({ ts: "string /* date-time */", complex: false });
  });

  it("handles circular references", () => {
    const defs: Defs = {
      A: { $ref: "#/definitions/B" },
      B: { $ref: "#/definitions/A" },
    };
    const result = resolveLeafType(defs, "A");
    expect(result.complex).toBe(true);
  });
});

// ── resolvePropertyType ──────────────────────────────────────────────────────

describe("resolvePropertyType", () => {
  it("resolves $ref through resolveLeafType", () => {
    const defs: Defs = { T: { type: "string" } };
    expect(resolvePropertyType(defs, { $ref: "#/definitions/T" })).toEqual({
      ts: "string",
      complex: false,
    });
  });

  it("resolves array of $ref", () => {
    const defs: Defs = { T: { type: "string" } };
    const result = resolvePropertyType(defs, { type: "array", items: { $ref: "#/definitions/T" } });
    expect(result).toEqual({ ts: "string[]", complex: false });
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

// ── resolveValueLeaf ─────────────────────────────────────────────────────────

describe("resolveValueLeaf", () => {
  it("reads x-netex-leaf annotation", () => {
    const defs: Defs = { T: { type: "object", "x-netex-leaf": "string" } };
    expect(resolveValueLeaf(defs, "T")).toBe("string");
  });

  it("follows $ref alias to find annotation", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { type: "object", "x-netex-leaf": "number" },
    };
    expect(resolveValueLeaf(defs, "Alias")).toBe("number");
  });

  it("returns null when no annotation", () => {
    const defs: Defs = { T: { type: "object", properties: { x: { type: "string" } } } };
    expect(resolveValueLeaf(defs, "T")).toBeNull();
  });

  it("returns null for missing definition", () => {
    expect(resolveValueLeaf({}, "Missing")).toBeNull();
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

