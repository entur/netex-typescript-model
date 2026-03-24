import { describe, it, expect } from "vitest";
import { resolveType, isRefType, refTarget, unwrapMixed, defRole, countRoles, presentRoles, ROLE_DISPLAY_ORDER, ROLE_LABELS, isDynNocRef } from "./classify.js";
import type { NetexLibrary } from "./types.js";

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


describe("unwrapMixed", () => {
  it("returns inner element type for mixed-content wrapper", () => {
    const lib: NetexLibrary = {
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
    expect(unwrapMixed(lib, "Wrapper")).toBe("Inner");
  });

  it("returns null when x-netex-mixed is absent", () => {
    const lib: NetexLibrary = {
      Plain: {
        type: "object",
        description: "*Either* blah",
        properties: { Text: { type: "array", items: { $ref: "#/definitions/T" } } },
      },
    };
    expect(unwrapMixed(lib, "Plain")).toBeNull();
  });

  it("returns null when description lacks *Either*", () => {
    const lib: NetexLibrary = {
      NoSignal: {
        type: "object",
        "x-netex-mixed": true,
        description: "Some other description",
        properties: { Text: { type: "array", items: { $ref: "#/definitions/T" } } },
      },
    };
    expect(unwrapMixed(lib, "NoSignal")).toBeNull();
  });

  it("returns null for missing definition", () => {
    expect(unwrapMixed({}, "Missing")).toBeNull();
  });
});


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


describe("countRoles", () => {
  it("counts definitions per role", () => {
    const lib: NetexLibrary = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "structure" },
    };
    const counts = countRoles(["A", "B", "C"], lib);
    expect(counts.get("entity")).toBe(2);
    expect(counts.get("structure")).toBe(1);
  });

  it("groups missing roles under unclassified", () => {
    const lib: NetexLibrary = { A: { type: "object" }, B: {} };
    const counts = countRoles(["A", "B"], lib);
    expect(counts.get("unclassified")).toBe(2);
  });
});


describe("presentRoles", () => {
  it("returns only roles present in the data", () => {
    const lib: NetexLibrary = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "reference" },
    };
    const roles = presentRoles(["A", "B"], lib);
    const keys = roles.map((r) => r.role);
    expect(keys).toContain("entity");
    expect(keys).toContain("reference");
    expect(keys).not.toContain("abstract");
  });

  it("includes unclassified when definitions lack x-netex-role", () => {
    const lib: NetexLibrary = { A: { "x-netex-role": "entity" }, B: { type: "object" } };
    const roles = presentRoles(["A", "B"], lib);
    expect(roles.map((r) => r.role)).toContain("unclassified");
  });

  it("respects ROLE_DISPLAY_ORDER", () => {
    const lib: NetexLibrary = {
      A: { "x-netex-role": "reference" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "abstract" },
    };
    const roles = presentRoles(["A", "B", "C"], lib);
    const keys = roles.map((r) => r.role);
    expect(keys.indexOf("entity")).toBeLessThan(keys.indexOf("abstract"));
    expect(keys.indexOf("abstract")).toBeLessThan(keys.indexOf("reference"));
  });

  it("includes correct counts", () => {
    const lib: NetexLibrary = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "structure" },
    };
    const roles = presentRoles(["A", "B", "C"], lib);
    expect(roles.find((r) => r.role === "entity")?.count).toBe(2);
    expect(roles.find((r) => r.role === "structure")?.count).toBe(1);
  });

  it("uses ROLE_LABELS for display names", () => {
    const lib: NetexLibrary = {
      A: { "x-netex-role": "frameMember" },
      B: { "x-netex-role": "enumeration" },
    };
    const roles = presentRoles(["A", "B"], lib);
    expect(roles.find((r) => r.role === "frameMember")?.label).toBe("Frame member");
    expect(roles.find((r) => r.role === "enumeration")?.label).toBe("Enum");
  });

  it("returns empty array when no definitions", () => {
    expect(presentRoles([], {})).toEqual([]);
  });
});


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
