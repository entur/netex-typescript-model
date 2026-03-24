import { describe, it, expect } from "vitest";
import { defRole } from "./classify.js";
import { buildReverseIndex, findTransitiveEntityUsers, resolveRefEntity, collectRefProps, collectExtraProps, collectDependencyTree } from "./dep-graph.js";
import type { NetexLibrary } from "./types.js";


describe("buildReverseIndex", () => {
  it("builds incoming reference map", () => {
    const lib: NetexLibrary = {
      A: { $ref: "#/definitions/B" },
      B: { type: "string" },
      C: { properties: { x: { $ref: "#/definitions/B" } } },
    };
    const idx = buildReverseIndex(lib);
    expect(idx["B"]).toEqual(expect.arrayContaining(["A", "C"]));
    expect(idx["B"]).toHaveLength(2);
  });

  it("excludes self-references", () => {
    const lib: NetexLibrary = { A: { allOf: [{ $ref: "#/definitions/A" }] } };
    const idx = buildReverseIndex(lib);
    expect(idx["A"]).toBeUndefined();
  });
});


describe("findTransitiveEntityUsers", () => {
  const isEntity = (lib: NetexLibrary) => (name: string) => defRole(lib[name]) === "entity";

  it("finds direct entity referrer", () => {
    const lib: NetexLibrary = {
      Leaf: { type: "string" },
      MyEntity: { "x-netex-role": "entity", properties: { x: { $ref: "#/definitions/Leaf" } } },
    };
    const idx = buildReverseIndex(lib);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(lib))).toEqual(["MyEntity"]);
  });

  it("finds entity through intermediate structure", () => {
    const lib: NetexLibrary = {
      Leaf: { type: "string" },
      Middle: { "x-netex-role": "structure", properties: { x: { $ref: "#/definitions/Leaf" } } },
      MyEntity: { "x-netex-role": "entity", properties: { m: { $ref: "#/definitions/Middle" } } },
    };
    const idx = buildReverseIndex(lib);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(lib))).toEqual(["MyEntity"]);
  });

  it("does not traverse beyond entities", () => {
    const lib: NetexLibrary = {
      Leaf: { type: "string" },
      EntityA: { "x-netex-role": "entity", properties: { x: { $ref: "#/definitions/Leaf" } } },
      EntityB: { "x-netex-role": "entity", properties: { a: { $ref: "#/definitions/EntityA" } } },
    };
    const idx = buildReverseIndex(lib);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(lib))).toEqual(["EntityA"]);
  });

  it("excludes the input name from results even if it is an entity", () => {
    const lib: NetexLibrary = {
      Self: { "x-netex-role": "entity", properties: { x: { type: "string" } } },
      Other: { "x-netex-role": "entity", properties: { s: { $ref: "#/definitions/Self" } } },
    };
    const idx = buildReverseIndex(lib);
    expect(findTransitiveEntityUsers("Self", idx, isEntity(lib))).toEqual(["Other"]);
  });

  it("handles cycles without infinite loop", () => {
    const lib: NetexLibrary = {
      A: { "x-netex-role": "structure", properties: { b: { $ref: "#/definitions/B" } } },
      B: { "x-netex-role": "structure", properties: { a: { $ref: "#/definitions/A" } } },
      E: { "x-netex-role": "entity", properties: { a: { $ref: "#/definitions/A" } } },
    };
    const idx = buildReverseIndex(lib);
    expect(findTransitiveEntityUsers("A", idx, isEntity(lib))).toEqual(["E"]);
  });

  it("returns empty array when no entities reachable", () => {
    const lib: NetexLibrary = {
      Orphan: { type: "string" },
    };
    const idx = buildReverseIndex(lib);
    expect(findTransitiveEntityUsers("Orphan", idx, isEntity(lib))).toEqual([]);
  });

  it("finds multiple entities through branching paths", () => {
    const lib: NetexLibrary = {
      Leaf: { type: "string" },
      StructA: { "x-netex-role": "structure", properties: { x: { $ref: "#/definitions/Leaf" } } },
      StructB: { "x-netex-role": "structure", properties: { x: { $ref: "#/definitions/Leaf" } } },
      EntityX: { "x-netex-role": "entity", properties: { a: { $ref: "#/definitions/StructA" } } },
      EntityY: { "x-netex-role": "entity", properties: { b: { $ref: "#/definitions/StructB" } } },
    };
    const idx = buildReverseIndex(lib);
    expect(findTransitiveEntityUsers("Leaf", idx, isEntity(lib))).toEqual(["EntityX", "EntityY"]);
  });
});


describe("resolveRefEntity", () => {
  it("resolves direct entity target via stamp", () => {
    const lib: NetexLibrary = {
      FooRef: { "x-netex-role": "reference", "x-netex-refTarget": "Foo" },
      Foo: { "x-netex-role": "entity" },
    };
    expect(resolveRefEntity(lib, "FooRef")).toBe("Foo");
  });

  it("expands abstract target to concrete entity sg-members", () => {
    const lib: NetexLibrary = {
      BarRef: { "x-netex-role": "reference", "x-netex-refTarget": "Bar" },
      Bar: { "x-netex-role": "abstract", "x-netex-sg-members": ["Baz", "Qux"] },
      BazRef: { "x-netex-role": "reference", "x-netex-refTarget": "Baz" },
      Baz: { "x-netex-role": "entity" },
      QuxRef: { "x-netex-role": "reference", "x-netex-refTarget": "Qux" },
      Qux: { "x-netex-role": "structure" },
    };
    expect(resolveRefEntity(lib, "BarRef")).toEqual(["Baz"]);
  });

  it("falls back to name stripping when no stamp", () => {
    const lib: NetexLibrary = {
      FooRef: { "x-netex-role": "reference" },
      Foo: { "x-netex-role": "entity" },
    };
    expect(resolveRefEntity(lib, "FooRef")).toBe("Foo");
  });

  it("returns null when no target found", () => {
    const lib: NetexLibrary = {
      UnknownRef: { "x-netex-role": "reference" },
    };
    expect(resolveRefEntity(lib, "UnknownRef")).toBeNull();
  });

  it("handles RefStructure suffix via stamp", () => {
    const lib: NetexLibrary = {
      Foo_RefStructure: { "x-netex-role": "reference", "x-netex-refTarget": "Foo" },
      Foo: { "x-netex-role": "entity" },
    };
    expect(resolveRefEntity(lib, "Foo_RefStructure")).toBe("Foo");
  });
});


describe("collectRefProps", () => {
  it("finds ref-typed properties with resolved targets", () => {
    const lib: NetexLibrary = {
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
    const result = collectRefProps(lib, "MyStruct");
    expect(result).toHaveLength(2);
    expect(result[0].propName).toBe("FooRef");
    expect(result[0].targetEntities).toEqual(["Foo"]);
    expect(result[1].propName).toBe("BarRef");
    expect(result[1].targetEntities).toEqual(["Bar"]);
  });

  it("walks allOf chain to find inherited ref props", () => {
    const lib: NetexLibrary = {
      Child: { allOf: [{ $ref: "#/definitions/Parent" }, { properties: { ChildRef: { $ref: "#/definitions/ChildRef" } } }] },
      Parent: { properties: { ParentRef: { $ref: "#/definitions/ParentRef" } } },
      ChildRef: { "x-netex-role": "reference", "x-netex-refTarget": "ChildEntity" },
      ChildEntity: { "x-netex-role": "entity" },
      ParentRef: { "x-netex-role": "reference", "x-netex-refTarget": "ParentEntity" },
      ParentEntity: { "x-netex-role": "entity" },
    };
    const result = collectRefProps(lib, "Child");
    expect(result).toHaveLength(2);
    expect(result.map(r => r.propName).sort()).toEqual(["ChildRef", "ParentRef"]);
  });

  it("excludes unresolvable refs", () => {
    const lib: NetexLibrary = {
      MyStruct: { properties: { BadRef: { $ref: "#/definitions/BadRef" } } },
      BadRef: { "x-netex-role": "reference" },
    };
    const result = collectRefProps(lib, "MyStruct");
    expect(result).toEqual([]);
  });

  it("returns empty for no ref props", () => {
    const lib: NetexLibrary = {
      MyStruct: { properties: { name: { type: "string" }, count: { type: "number" } } },
    };
    expect(collectRefProps(lib, "MyStruct")).toEqual([]);
  });
});


describe("collectExtraProps", () => {
  it("returns empty when entity maps directly to base structure", () => {
    const lib: NetexLibrary = {
      MyEntity: { $ref: "#/definitions/Base_VersionStructure", "x-netex-role": "entity" },
      Base_VersionStructure: { properties: { a: { type: "string" } } },
    };
    expect(collectExtraProps(lib, "MyEntity", "Base_VersionStructure")).toEqual([]);
  });

  it("collects props from one intermediate level", () => {
    const lib: NetexLibrary = {
      DerivedEntity: { $ref: "#/definitions/Derived_VersionStructure", "x-netex-role": "entity" },
      Derived_VersionStructure: {
        allOf: [{ $ref: "#/definitions/Base_VersionStructure" }, { properties: { x: { type: "string" }, y: { type: "number" }, z: { type: "boolean" } } }],
      },
      Base_VersionStructure: { properties: { a: { type: "string" } } },
    };
    expect(collectExtraProps(lib, "DerivedEntity", "Base_VersionStructure")).toEqual(["x", "y", "z"]);
  });

  it("collects props from two intermediate levels", () => {
    const lib: NetexLibrary = {
      DeepEntity: { $ref: "#/definitions/Deep_VersionStructure", "x-netex-role": "entity" },
      Deep_VersionStructure: {
        allOf: [{ $ref: "#/definitions/Mid_VersionStructure" }, { properties: { d1: { type: "string" } } }],
      },
      Mid_VersionStructure: {
        allOf: [{ $ref: "#/definitions/Base_VersionStructure" }, { properties: { m1: { type: "string" }, m2: { type: "number" } } }],
      },
      Base_VersionStructure: { properties: { a: { type: "string" } } },
    };
    const extras = collectExtraProps(lib, "DeepEntity", "Base_VersionStructure");
    expect(extras).toContain("d1");
    expect(extras).toContain("m1");
    expect(extras).toContain("m2");
    expect(extras).toHaveLength(3);
  });

  it("handles $ref alias entities (common NeTEx pattern)", () => {
    const lib: NetexLibrary = {
      AliasEntity: { $ref: "#/definitions/Alias_VersionStructure", "x-netex-role": "entity" },
      Alias_VersionStructure: {
        allOf: [{ $ref: "#/definitions/Base_VS" }, { properties: { extra: { type: "string" } } }],
      },
      Base_VS: { properties: { base: { type: "string" } } },
    };
    expect(collectExtraProps(lib, "AliasEntity", "Base_VS")).toEqual(["extra"]);
  });
});


describe("collectDependencyTree", () => {
  it("returns empty for an enumeration", () => {
    const lib: NetexLibrary = {
      MyEnum: { enum: ["a", "b"], "x-netex-role": "enumeration" },
    };
    expect(collectDependencyTree(lib, "MyEnum")).toHaveLength(0);
  });

  it("collects direct ref-typed dependencies", () => {
    const lib: NetexLibrary = {
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
    const tree = collectDependencyTree(lib, "Root");
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.name).sort()).toEqual(["CodeType", "NameType"]);
    expect(tree.every((n) => n.depth === 0)).toBe(true);
    expect(tree.every((n) => !n.duplicate)).toBe(true);
  });

  it("resolves $ref aliases before enqueuing", () => {
    const lib: NetexLibrary = {
      Root: {
        allOf: [{ properties: { Thing: { $ref: "#/definitions/Alias" } } }],
      },
      Alias: { $ref: "#/definitions/RealType" },
      RealType: { type: "string", "x-netex-atom": "string" },
    };
    const tree = collectDependencyTree(lib, "Root");
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("RealType");
    expect(tree[0].via).toBe("Thing");
  });

  it("marks duplicate entries and skips recursion", () => {
    const lib: NetexLibrary = {
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
    const tree = collectDependencyTree(lib, "Root");
    expect(tree).toHaveLength(2);
    const first = tree.find((n) => !n.duplicate)!;
    const second = tree.find((n) => n.duplicate)!;
    expect(first.name).toBe("Shared");
    expect(second.name).toBe("Shared");
    expect(second.duplicate).toBe(true);
  });

  it("recurses into complex types at increasing depth", () => {
    const lib: NetexLibrary = {
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
    const tree = collectDependencyTree(lib, "Root");
    expect(tree).toHaveLength(2);
    const child = tree.find((n) => n.name === "ChildStruct")!;
    const leaf = tree.find((n) => n.name === "LeafType")!;
    expect(child.depth).toBe(0);
    expect(leaf.depth).toBe(1);
  });

  it("stops at references (x-netex-role: reference)", () => {
    const lib: NetexLibrary = {
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
    const tree = collectDependencyTree(lib, "Root");
    expect(tree.find((n) => n.name === "ThingRef")).toBeDefined();
    expect(tree.find((n) => n.name === "Nested")).toBeUndefined();
  });

  it("excludes root from output", () => {
    const lib: NetexLibrary = {
      Root: {
        allOf: [{ properties: { X: { $ref: "#/definitions/Leaf" } } }],
      },
      Leaf: { type: "string", "x-netex-atom": "string" },
    };
    const tree = collectDependencyTree(lib, "Root");
    expect(tree.every((n) => n.name !== "Root")).toBe(true);
  });

  it("handles refArray properties", () => {
    const lib: NetexLibrary = {
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
    const tree = collectDependencyTree(lib, "Root");
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("ItemType");
    expect(tree[0].via).toBe("Items");
  });

  it("resolves allOf-passthrough wrappers to the underlying definition", () => {
    const lib: NetexLibrary = {
      Root: {
        properties: {
          Code: { $ref: "#/definitions/PrivateCode" },
        },
        "x-netex-role": "entity",
      },
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
    const tree = collectDependencyTree(lib, "Root");
    const names = tree.filter((n) => !n.duplicate).map((n) => n.name);
    expect(names).toContain("PrivateCodeStructure");
    expect(names).not.toContain("PrivateCode");
  });

  it("collects enumeration targets from anyOf union properties", () => {
    const lib: NetexLibrary = {
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
    const tree = collectDependencyTree(lib, "Root");
    const names = tree.filter((n) => !n.duplicate).map((n) => n.name);
    expect(names).toContain("FooEnumeration");
    expect(names).toContain("BarEnumeration");
  });

  it("skips x-fixed-single-enum refs in dependency tree", () => {
    const lib: NetexLibrary = {
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
    const deps = collectDependencyTree(lib, "MyEntity");
    const names = deps.map((d) => d.name);
    expect(names).toContain("SmallEnum");
    expect(names).not.toContain("BigEnum");
  });

  it("collects enumeration targets from array-of-enum list wrappers", () => {
    const lib: NetexLibrary = {
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
    const tree = collectDependencyTree(lib, "Root");
    const names = tree.filter((n) => !n.duplicate).map((n) => n.name);
    expect(names).toContain("FacilityEnumeration");
  });

  it("excludeRootProps skips matching seeds", () => {
    const lib: NetexLibrary = {
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
    const full = collectDependencyTree(lib, "Root");
    expect(full.filter(n => !n.duplicate)).toHaveLength(2);

    const excl = collectDependencyTree(lib, "Root", new Set(["A"]));
    expect(excl.filter(n => !n.duplicate).map(n => n.name)).toEqual(["Shared"]);
  });
});
