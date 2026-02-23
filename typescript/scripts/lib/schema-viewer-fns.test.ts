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
    expect(resolveDefType(defs, "StringType")).toEqual({ ts: "string", complex: false });
  });

  it("follows $ref alias to primitive", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/Target" },
      Target: { type: "string" },
    };
    expect(resolveDefType(defs, "Alias")).toEqual({ ts: "string", complex: false });
  });

  it("follows allOf wrapper to primitive", () => {
    const defs: Defs = {
      Wrapper: { allOf: [{ $ref: "#/definitions/Inner" }] },
      Inner: { type: "integer" },
    };
    expect(resolveDefType(defs, "Wrapper")).toEqual({ ts: "integer", complex: false });
  });

  it("resolves enum to union", () => {
    const defs: Defs = { E: { enum: ["a", "b", "c"] } };
    const result = resolveDefType(defs, "E");
    expect(result.complex).toBe(false);
    expect(result.ts).toBe('"a" | "b" | "c"');
  });

  it("returns complex for object with properties", () => {
    const defs: Defs = { Obj: { type: "object", properties: { x: { type: "string" } } } };
    expect(resolveDefType(defs, "Obj")).toEqual({ ts: "Obj", complex: true });
  });

  it("resolves x-netex-atom as primitive instead of complex", () => {
    const defs: Defs = {
      Wrapper: { type: "object", properties: { value: { type: "string" } }, "x-netex-atom": "string" },
    };
    expect(resolveDefType(defs, "Wrapper")).toEqual({ ts: "string", complex: false });
  });

  it("returns complex for x-netex-atom: simpleObj", () => {
    const defs: Defs = {
      Wrapper: {
        type: "object",
        properties: { value: { type: "string" }, type: { type: "string" } },
        "x-netex-atom": "simpleObj",
      },
    };
    expect(resolveDefType(defs, "Wrapper")).toEqual({ ts: "Wrapper", complex: true });
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
    expect(resolveDefType(defs, "Child").complex).toBe(true);
  });

  it("includes format comment for formatted primitives", () => {
    const defs: Defs = { DT: { type: "string", format: "date-time" } };
    expect(resolveDefType(defs, "DT")).toEqual({ ts: "string /* date-time */", complex: false });
  });

  it("handles circular references", () => {
    const defs: Defs = {
      A: { $ref: "#/definitions/B" },
      B: { $ref: "#/definitions/A" },
    };
    const result = resolveDefType(defs, "A");
    expect(result.complex).toBe(true);
  });
});

// ── resolvePropertyType ──────────────────────────────────────────────────────

describe("resolvePropertyType", () => {
  it("resolves $ref through resolveDefType", () => {
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

  it("resolveDefType uses unwrapMixed to resolve as inner type array", () => {
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
    expect(resolveDefType(defs, "Mixed")).toEqual({ ts: "ItemType[]", complex: true });
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
