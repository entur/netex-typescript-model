import { describe, it, expect } from "vitest";
import { flattenAllOf, collectRequired, buildInheritanceChain, buildExclSet } from "../schema-nav.js";
import type { NetexLibrary } from "../types.js";


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


describe("buildExclSet", () => {
  const mkProp = (name: string, origin: string) =>
    ({ prop: [name, name], type: "string", desc: "", origin, schema: {} }) as any;

  it("returns undefined when no exclusions apply", () => {
    const props = [mkProp("foo", "SomeType")];
    expect(buildExclSet(props)).toBeUndefined();
    expect(buildExclSet(props, {})).toBeUndefined();
    expect(buildExclSet(props, { omni: false })).toBeUndefined();
  });

  it("explicit-only: excludes named props", () => {
    const props = [mkProp("a", "X"), mkProp("b", "X")];
    const excl = buildExclSet(props, { explicit: new Set(["a"]) });
    expect(excl).toEqual(new Set(["a"]));
  });

  it("omni-only: excludes non-essential props solely from omnipresent origins", () => {
    const props = [
      mkProp("$id", "EntityStructure"),
      mkProp("$nameOfClass", "EntityStructure"),
      mkProp("$version", "EntityInVersionStructure"),
      mkProp("$status", "EntityInVersionStructure"),
      mkProp("Name", "SomeType"),
    ];
    const excl = buildExclSet(props, { omni: true });
    expect(excl).toBeDefined();
    expect(excl!.has("$id")).toBe(false);
    expect(excl!.has("$version")).toBe(false);
    expect(excl!.has("$nameOfClass")).toBe(true);
    expect(excl!.has("$status")).toBe(true);
    expect(excl!.has("Name")).toBe(false);
  });

  it("omni: keeps props that appear in both omnipresent and non-omnipresent origins", () => {
    const props = [
      mkProp("id", "EntityStructure"),
      mkProp("id", "CustomType"),
    ];
    const excl = buildExclSet(props, { omni: true });
    // id appears in non-omnipresent origin too, so it's kept
    expect(excl).toBeUndefined();
  });

  it("merges explicit and omni exclusions", () => {
    const props = [
      mkProp("$nameOfClass", "EntityStructure"),
      mkProp("Name", "SomeType"),
      mkProp("foo", "SomeType"),
    ];
    const excl = buildExclSet(props, { omni: true, explicit: new Set(["foo"]) });
    expect(excl).toBeDefined();
    expect(excl!.has("$nameOfClass")).toBe(true);
    expect(excl!.has("foo")).toBe(true);
    expect(excl!.has("Name")).toBe(false);
  });
});
