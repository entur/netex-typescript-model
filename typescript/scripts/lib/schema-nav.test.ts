import { describe, it, expect } from "vitest";
import { flattenAllOf, collectRequired, buildInheritanceChain, inlineSingleRefs } from "./schema-nav.js";
import type { NetexLibrary } from "./types.js";


describe("flattenAllOf", () => {
  it("flattens simple properties", () => {
    const lib: NetexLibrary = {
      A: { properties: { x: { type: "string" } } },
    };
    const result = flattenAllOf(lib, "A");
    expect(result).toHaveLength(1);
    expect(result[0].prop).toEqual(["x", "x"]);
    expect(result[0].origin).toBe("A");
  });

  it("flattens allOf inheritance", () => {
    const lib: NetexLibrary = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { y: { type: "number" } } },
        ],
      },
      Parent: { properties: { x: { type: "string" } } },
    };
    const result = flattenAllOf(lib, "Child");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ prop: ["x", "x"], origin: "Parent" });
    expect(result[1]).toMatchObject({ prop: ["y", "y"], origin: "Child" });
  });

  it("follows $ref aliases", () => {
    const lib: NetexLibrary = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { properties: { z: { type: "boolean" } } },
    };
    const result = flattenAllOf(lib, "Alias");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ prop: ["z", "z"], origin: "Real" });
  });

  it("handles circular references without infinite loop", () => {
    const lib: NetexLibrary = {
      A: { allOf: [{ $ref: "#/definitions/B" }, { properties: { x: { type: "string" } } }] },
      B: { allOf: [{ $ref: "#/definitions/A" }, { properties: { y: { type: "string" } } }] },
    };
    const result = flattenAllOf(lib, "A");
    expect(result.length).toBeGreaterThan(0);
  });
});


describe("collectRequired", () => {
  it("collects from direct required", () => {
    const lib: NetexLibrary = { A: { required: ["x", "y"] } };
    expect(collectRequired(lib, "A")).toEqual(new Set(["x", "y"]));
  });

  it("collects from allOf entries", () => {
    const lib: NetexLibrary = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { required: ["b"] },
        ],
      },
      Parent: { required: ["a"] },
    };
    expect(collectRequired(lib, "Child")).toEqual(new Set(["a", "b"]));
  });

  it("follows $ref aliases", () => {
    const lib: NetexLibrary = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { required: ["z"] },
    };
    expect(collectRequired(lib, "Alias")).toEqual(new Set(["z"]));
  });
});


describe("buildInheritanceChain", () => {
  it("returns single node for type with only properties", () => {
    const lib: NetexLibrary = {
      Foo: { properties: { x: { type: "string" }, y: { type: "number" } } },
    };
    const chain = buildInheritanceChain(lib, "Foo");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("Foo");
    expect(chain[0].ownProps).toHaveLength(2);
    expect(chain[0].ownProps[0].name).toBe("x");
  });

  it("builds chain with allOf inheritance (root first)", () => {
    const lib: NetexLibrary = {
      Child: {
        allOf: [
          { $ref: "#/definitions/Parent" },
          { properties: { b: { type: "number" } } },
        ],
      },
      Parent: { properties: { a: { type: "string" } } },
    };
    const chain = buildInheritanceChain(lib, "Child");
    expect(chain).toHaveLength(2);
    expect(chain[0].name).toBe("Parent");
    expect(chain[1].name).toBe("Child");
    expect(chain[0].ownProps[0].name).toBe("a");
    expect(chain[1].ownProps[0].name).toBe("b");
  });

  it("follows $ref aliases", () => {
    const lib: NetexLibrary = {
      Alias: { $ref: "#/definitions/Real" },
      Real: { properties: { x: { type: "string" } } },
    };
    const chain = buildInheritanceChain(lib, "Alias");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("Real");
  });

  it("handles circular references without infinite loop", () => {
    const lib: NetexLibrary = {
      A: { allOf: [{ $ref: "#/definitions/B" }, { properties: { x: { type: "string" } } }] },
      B: { allOf: [{ $ref: "#/definitions/A" }, { properties: { y: { type: "string" } } }] },
    };
    const chain = buildInheritanceChain(lib, "A");
    expect(chain.length).toBeGreaterThan(0);
  });

  it("deduplicates own properties from allOf and direct properties", () => {
    const lib: NetexLibrary = {
      T: {
        allOf: [{ properties: { x: { type: "string" } } }],
        properties: { x: { type: "string" }, y: { type: "number" } },
      },
    };
    const chain = buildInheritanceChain(lib, "T");
    expect(chain).toHaveLength(1);
    const propNames = chain[0].ownProps.map(p => p.name);
    expect(propNames).toEqual(["x", "y"]);
  });

  it("returns empty chain for missing definition", () => {
    const chain = buildInheritanceChain({}, "Missing");
    expect(chain).toHaveLength(0);
  });
});


describe("inlineSingleRefs", () => {
  it("inlines a single-$ref target's inner properties", () => {
    const lib: NetexLibrary = {
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
    const props = flattenAllOf(lib, "Root");
    const result = inlineSingleRefs(lib, props);
    expect(result.some((p) => p.prop[1] === "Code")).toBe(false);
    expect(result.some((p) => p.prop[1] === "value")).toBe(true);
    expect(result.some((p) => p.prop[1] === "type")).toBe(true);
    const inlined = result.filter((p) => p.inlinedFrom);
    expect(inlined).toHaveLength(2);
    expect(inlined[0].inlinedFrom).toBe("Code");
  });

  it("uses parentProp_innerProp when name conflicts exist", () => {
    const lib: NetexLibrary = {
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
    const props = flattenAllOf(lib, "Root");
    const result = inlineSingleRefs(lib, props);
    expect(result.some((p) => p.prop[1] === "Code_value")).toBe(true);
    expect(result.some((p) => p.prop[1] === "extra")).toBe(true);
    expect(result.some((p) => p.prop[1] === "value" && !p.inlinedFrom)).toBe(true);
  });

  it("skips reference-role targets", () => {
    const lib: NetexLibrary = {
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
    const props = flattenAllOf(lib, "Root");
    const result = inlineSingleRefs(lib, props);
    expect(result).toHaveLength(1);
    expect(result[0].prop[1]).toBe("Ref");
    expect(result[0].inlinedFrom).toBeUndefined();
  });

  it("skips collection-role targets", () => {
    const lib: NetexLibrary = {
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
    const props = flattenAllOf(lib, "Root");
    const result = inlineSingleRefs(lib, props);
    expect(result).toHaveLength(1);
    expect(result[0].prop[1]).toBe("Items");
    expect(result[0].inlinedFrom).toBeUndefined();
  });

  it("skips atom targets", () => {
    const lib: NetexLibrary = {
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
    const props = flattenAllOf(lib, "Root");
    const result = inlineSingleRefs(lib, props);
    expect(result).toHaveLength(1);
    expect(result[0].prop[1]).toBe("Code");
    expect(result[0].inlinedFrom).toBeUndefined();
  });

  it("returns props unchanged when no candidates exist", () => {
    const lib: NetexLibrary = {
      Root: { properties: { x: { type: "string" }, y: { type: "number" } } },
    };
    const props = flattenAllOf(lib, "Root");
    const result = inlineSingleRefs(lib, props);
    expect(result).toEqual(props);
  });

  it("handles multiple inlined props with cross-conflict detection", () => {
    const lib: NetexLibrary = {
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
    const props = flattenAllOf(lib, "Root");
    const result = inlineSingleRefs(lib, props);
    expect(result.some((p) => p.prop[1] === "shared" && p.inlinedFrom === "A")).toBe(true);
    expect(result.some((p) => p.prop[1] === "B_shared" && p.inlinedFrom === "B")).toBe(true);
  });

  it("filters shared-ancestor props when target and parent share a common base", () => {
    const lib: NetexLibrary = {
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
    const props = flattenAllOf(lib, "Parent");
    const result = inlineSingleRefs(lib, props);

    const detailInlined = result.filter((p) => p.inlinedFrom === "Detail");
    const detailNames = detailInlined.map((p) => p.prop[1]);

    expect(detailNames).not.toContain("id");
    expect(detailNames).not.toContain("version");
    expect(detailNames).not.toContain("created");
    expect(detailNames).not.toContain("keyList");

    expect(detailNames).toContain("Capacity");
    expect(detailNames).toContain("Class");
    expect(detailInlined).toHaveLength(2);

    expect(result.some((p) => p.prop[1] === "Name" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "id" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "version" && !p.inlinedFrom)).toBe(true);
  });
});
