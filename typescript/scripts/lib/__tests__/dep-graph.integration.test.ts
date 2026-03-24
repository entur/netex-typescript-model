import { describe, it, expect, beforeAll } from "vitest";
import { defRole } from "../classify.js";
import { buildReverseIndex, findTransitiveEntityUsers, resolveRefEntity, collectRefProps, collectExtraProps, collectDependencyTree } from "../dep-graph.js";
import { loadNetexLibrary } from "./test-helpers.js";
import type { NetexLibrary } from "../types.js";

let lib: NetexLibrary;
beforeAll(() => { lib = loadNetexLibrary(); });

describe("findTransitiveEntityUsers — real schema", () => {
  let reverseIdx: Record<string, string[]>;
  const isEntity = (name: string) => defRole(lib[name]) === "entity";

  beforeAll(() => {
    reverseIdx = buildReverseIndex(lib);
  });

  it("PostalAddress reaches entities through AddressablePlace chain", () => {
    const entities = findTransitiveEntityUsers("PostalAddress", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(lib[e])).toBe("entity");
    }
  });

  it("MultilingualString is used by many entities (multi-hop, ubiquitous)", () => {
    const entities = findTransitiveEntityUsers("MultilingualString", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(20);
    for (const e of entities) {
      expect(defRole(lib[e])).toBe("entity");
    }
  });

  it("PrivateCodeStructure reaches entities through wrappers", () => {
    const entities = findTransitiveEntityUsers("PrivateCodeStructure", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(lib[e])).toBe("entity");
    }
  });

  it("GroupOfEntities_VersionStructure reaches entities (deep inheritance)", () => {
    const entities = findTransitiveEntityUsers(
      "GroupOfEntities_VersionStructure",
      reverseIdx,
      isEntity,
    );
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(lib[e])).toBe("entity");
    }
  });

  it("an entity returns other entities that reference it (not itself)", () => {
    if (!lib["TopographicPlace"]) return;
    const entities = findTransitiveEntityUsers("TopographicPlace", reverseIdx, isEntity);
    expect(entities).not.toContain("TopographicPlace");
    for (const e of entities) {
      expect(defRole(lib[e])).toBe("entity");
    }
  });

  it("an enumeration finds entities that use it", () => {
    if (!lib["StopPlaceTypeEnumeration"]) return;
    const entities = findTransitiveEntityUsers("StopPlaceTypeEnumeration", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(lib[e])).toBe("entity");
    }
  });

  it("completes in reasonable time for a heavily-referenced type", () => {
    const start = performance.now();
    findTransitiveEntityUsers("MultilingualString", reverseIdx, isEntity);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("x-netex-refTarget annotation", () => {
  it("TransportTypeRef has stamp pointing to TransportType", () => {
    expect(lib["TransportTypeRef"]["x-netex-refTarget"]).toBe("TransportType");
  });

  it("TransportTypeRefStructure has stamp pointing to TransportType", () => {
    expect(lib["TransportTypeRefStructure"]["x-netex-refTarget"]).toBe("TransportType");
  });

  it("at least 160 reference-role definitions have the stamp", () => {
    const stamped = Object.entries(lib).filter(
      ([, d]) => d["x-netex-refTarget"] !== undefined,
    );
    expect(stamped.length).toBeGreaterThanOrEqual(160);
  });

  it("framework refs like VersionOfObjectRef have no stamp", () => {
    expect(lib["VersionOfObjectRef"]?.["x-netex-refTarget"]).toBeUndefined();
  });
});

describe("resolveRefEntity — real schema", () => {
  it("TransportTypeRef resolves to TransportType entity", () => {
    expect(resolveRefEntity(lib, "TransportTypeRef")).toBe("TransportType");
  });

  it("VehicleModelRef resolves to VehicleModel entity", () => {
    expect(resolveRefEntity(lib, "VehicleModelRef")).toBe("VehicleModel");
  });

  it("OrganisationRef resolves to concrete entity sg-members (abstract expansion)", () => {
    const result = resolveRefEntity(lib, "OrganisationRef");
    expect(Array.isArray(result)).toBe(true);
    expect((result as string[]).length).toBeGreaterThan(0);
    for (const name of result as string[]) {
      expect(defRole(lib[name])).toBe("entity");
    }
  });

  it("VersionOfObjectRef returns null (framework ref)", () => {
    expect(resolveRefEntity(lib, "VersionOfObjectRef")).toBeNull();
  });
});

describe("collectRefProps — real schema", () => {
  it("Vehicle_VersionStructure has ref props including TransportTypeRef", () => {
    const result = collectRefProps(lib, "Vehicle_VersionStructure");
    expect(result.length).toBeGreaterThanOrEqual(3);
    const names = result.map((r) => r.propName);
    expect(names).toContain("TransportTypeRef");
    expect(names).toContain("VehicleModelRef");
  });

  it("all returned target entities have entity role", () => {
    const result = collectRefProps(lib, "Vehicle_VersionStructure");
    for (const entry of result) {
      for (const e of entry.targetEntities) {
        expect(defRole(lib[e])).toBe("entity");
      }
    }
  });
});

describe("collectExtraProps — real schema", () => {
  it("TransportType at TransportType_VersionStructure base has no extras", () => {
    expect(collectExtraProps(lib, "TransportType", "TransportType_VersionStructure")).toEqual([]);
  });

  it("VehicleType at TransportType_VersionStructure base has ~19 extras", () => {
    const extras = collectExtraProps(lib, "VehicleType", "TransportType_VersionStructure");
    expect(extras.length).toBeGreaterThanOrEqual(15);
    expect(extras).toContain("LowFloor");
    expect(extras).toContain("Length");
    expect(extras).toContain("ClassifiedAsRef");
  });

  it("SimpleVehicleType at TransportType_VersionStructure base has ~11 extras", () => {
    const extras = collectExtraProps(lib, "SimpleVehicleType", "TransportType_VersionStructure");
    expect(extras.length).toBeGreaterThanOrEqual(8);
    expect(extras).toContain("VehicleCategory");
    expect(extras).toContain("NumberOfWheels");
    expect(extras).toContain("Portable");
  });

  it("VehicleType extras do not include TransportMode (ancestor prop)", () => {
    const extras = collectExtraProps(lib, "VehicleType", "TransportType_VersionStructure");
    expect(extras).not.toContain("TransportMode");
  });
});

describe("VehicleType_VersionStructure — relations end-to-end", () => {
  it("collectRefProps finds at least 4 ref props", () => {
    const refs = collectRefProps(lib, "VehicleType_VersionStructure");
    expect(refs.length).toBeGreaterThanOrEqual(4);
    const names = refs.map((r) => r.propName);
    expect(names).toContain("BrandingRef");
    expect(names).toContain("ClassifiedAsRef");
    expect(names).toContain("DeckPlanRef");
    expect(names).toContain("IncludedIn");
  });

  it("ClassifiedAsRef resolves to VehicleModel entity", () => {
    const refs = collectRefProps(lib, "VehicleType_VersionStructure");
    const classified = refs.find((r) => r.propName === "ClassifiedAsRef");
    expect(classified).toBeDefined();
    expect(classified!.targetEntities).toContain("VehicleModel");
  });

  it("DeckPlanRef resolves to DeckPlan entity", () => {
    const refs = collectRefProps(lib, "VehicleType_VersionStructure");
    const dp = refs.find((r) => r.propName === "DeckPlanRef");
    expect(dp).toBeDefined();
    expect(dp!.targetEntities).toContain("DeckPlan");
  });

  it("IncludedIn resolves to VehicleType entity", () => {
    const refs = collectRefProps(lib, "VehicleType_VersionStructure");
    const inc = refs.find((r) => r.propName === "IncludedIn");
    expect(inc).toBeDefined();
    expect(inc!.targetEntities).toContain("VehicleType");
  });

  it("BrandingRef resolves to Branding entity", () => {
    const refs = collectRefProps(lib, "VehicleType_VersionStructure");
    const br = refs.find((r) => r.propName === "BrandingRef");
    expect(br).toBeDefined();
    expect(br!.targetEntities).toContain("Branding");
  });

  it("findTransitiveEntityUsers finds VehicleType, Train, and CompoundTrain", () => {
    const reverseIndex = buildReverseIndex(lib);
    const entities = findTransitiveEntityUsers(
      "VehicleType_VersionStructure",
      reverseIndex,
      (n) => defRole(lib[n]) === "entity",
    );
    expect(entities).toContain("VehicleType");
    expect(entities).toContain("Train");
    expect(entities).toContain("CompoundTrain");
    expect(entities).not.toContain("SimpleVehicleType");
  });

  it("VehicleType has no extra props at VehicleType_VersionStructure base", () => {
    expect(collectExtraProps(lib, "VehicleType", "VehicleType_VersionStructure")).toEqual([]);
  });

  it("Train has TrainSize and components as extras beyond VehicleType_VersionStructure", () => {
    const extras = collectExtraProps(lib, "Train", "VehicleType_VersionStructure");
    expect(extras).toContain("TrainSize");
    expect(extras).toContain("components");
  });

  it("CompoundTrain has components as extra beyond VehicleType_VersionStructure", () => {
    const extras = collectExtraProps(lib, "CompoundTrain", "VehicleType_VersionStructure");
    expect(extras).toContain("components");
  });

  it("Train extras do not include VehicleType_VersionStructure props", () => {
    const extras = collectExtraProps(lib, "Train", "VehicleType_VersionStructure");
    expect(extras).not.toContain("LowFloor");
    expect(extras).not.toContain("Length");
    expect(extras).not.toContain("PropulsionTypes");
  });
});

describe("collectDependencyTree — real schema", () => {
  it("enum returns empty", () => {
    expect(collectDependencyTree(lib, "ModificationEnumeration")).toHaveLength(0);
  });

  it("simple structure has expected deps", () => {
    const tree = collectDependencyTree(lib, "ContactStructure");
    const unique = tree.filter((n) => !n.duplicate);
    expect(unique.length).toBeGreaterThanOrEqual(3);
    const names = unique.map((n) => n.name);
    expect(names).toContain("MultilingualString");
    expect(names).toContain("PhoneType");
    expect(names).toContain("EmailAddressType");
  });

  it("ContactStructure tree has duplicates for reused types", () => {
    const tree = collectDependencyTree(lib, "ContactStructure");
    const duplicates = tree.filter((n) => n.duplicate);
    const dupNames = duplicates.map((n) => n.name);
    expect(dupNames).toContain("PhoneType");
    expect(dupNames).toContain("MultilingualString");
  });

  it("deep entity has many deps — Authority", () => {
    const tree = collectDependencyTree(lib, "Authority");
    const unique = tree.filter((n) => !n.duplicate);
    const total = tree.length;
    expect(unique.length).toBeGreaterThan(10);
    expect(total).toBeGreaterThan(unique.length);
  });

  it("root excluded from output", () => {
    const tree = collectDependencyTree(lib, "Authority");
    expect(tree.every((n) => n.name !== "Authority")).toBe(true);
  });

  it("via paths reference known property names", () => {
    const tree = collectDependencyTree(lib, "ContactStructure");
    const first = tree[0];
    expect(first.via).toBeTruthy();
    expect(typeof first.via).toBe("string");
  });

  it("BFS depth ordering — all depth-0 before depth-1", () => {
    const tree = collectDependencyTree(lib, "Authority");
    if (tree.length === 0) return;
    let lastDepth0Idx = -1;
    let firstDepth1Idx = Infinity;
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].depth === 0) lastDepth0Idx = i;
      if (tree[i].depth === 1 && i < firstDepth1Idx) firstDepth1Idx = i;
    }
    if (firstDepth1Idx < Infinity) {
      expect(lastDepth0Idx).toBeLessThan(firstDepth1Idx);
    }
  });
});
