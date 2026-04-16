import { describe, it, expect } from "vitest";
import { collapseRef, collapseColl, collapseCollAsRef, resolveCollVerStruct, resolveCollRefVerStruct, buildTypeOverrides } from "../collapse.js";
import { loadNetexLibrary } from "./test-helpers.js";

const lib = loadNetexLibrary();

// ── collapseRef ────────────────────────────────────────────────────────────

describe("collapseRef", () => {
  it("resolves stamped ref via x-netex-refTarget", () => {
    // BrandingRef → VersionOfObjectRefStructure (refTarget stamp on the ref def)
    const schema = { $ref: "#/definitions/VersionOfObjectRefStructure" };
    const r = collapseRef(lib, "BrandingRef", schema);
    // BrandingRef won't resolve via def name (VersionOfObjectRefStructure → VersionOfObject → not entity)
    // but should resolve via property name heuristic (BrandingRef → Branding)
    if (lib.Branding) {
      expect(r).not.toBeNull();
      expect(r!.typeStr).toBe("Ref<'Branding'>");
    }
  });

  it("resolves via property name heuristic", () => {
    const schema = { $ref: "#/definitions/VersionOfObjectRefStructure" };
    const r = collapseRef(lib, "DeckPlanRef", schema);
    if (lib.DeckPlan) {
      expect(r).not.toBeNull();
      expect(r!.entityName).toBe("DeckPlan");
      expect(r!.typeStr).toBe("Ref<'DeckPlan'>");
    }
  });

  it("returns SimpleRef for unresolvable refs", () => {
    const schema = { $ref: "#/definitions/VersionOfObjectRefStructure" };
    const r = collapseRef(lib, "IncludedIn", schema);
    // "IncludedIn" doesn't end with "Ref" — no property name heuristic
    // resolveRefEntity("VersionOfObjectRefStructure") → null
    // Falls through → SimpleRef
    expect(r).not.toBeNull();
    expect(r!.typeStr).toBe("SimpleRef");
  });

  it("returns null for non-ref properties", () => {
    const schema = { type: "string" };
    expect(collapseRef(lib, "Name", schema)).toBeNull();
  });

  it("returns null for non-reference-role refs", () => {
    // classifySchema returns ref, but the target isn't a reference-role def
    const vt = lib.VehicleType;
    if (vt) {
      const schema = { $ref: "#/definitions/VehicleType" };
      expect(collapseRef(lib, "SomeRef", schema)).toBeNull();
    }
  });

  it.each(["TransportOrganisationRef", "VehicleModelProfileRef"])(
    "collapses abstract ref head (%s) to SimpleRef",
    (name) => {
      const r = collapseRef(lib, name, { $ref: `#/definitions/${name}` });
      expect(r).not.toBeNull();
      expect(r!.typeStr).toBe("SimpleRef");
    },
  );
});

// ── collapseColl ───────────────────────────────────────────────────────────

describe("collapseColl", () => {
  it("resolves a single-child RelStructure to its child type", () => {
    // Find a known single-child collection in the schema
    const collNames = Object.keys(lib).filter(
      (k) => k.endsWith("_RelStructure") && lib[k]["x-netex-role"] === "collection",
    );
    expect(collNames.length).toBeGreaterThan(0);

    let found = false;
    for (const cn of collNames) {
      const schema = { $ref: `#/definitions/${cn}` };
      const cc = collapseColl(lib, "test", schema);
      if (cc) {
        expect(cc.target).toBeTruthy();
        expect(cc.childKey).toBeTruthy();
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("returns null for non-collection refs", () => {
    const schema = { $ref: "#/definitions/VersionOfObjectRefStructure" };
    expect(collapseColl(lib, "test", schema)).toBeNull();
  });

  it("returns null for non-ref properties", () => {
    expect(collapseColl(lib, "test", { type: "string" })).toBeNull();
  });
});

// ── resolveCollVerStruct ───────────────────────────────────────────────────

describe("resolveCollVerStruct", () => {
  it("resolves by def name directly", () => {
    const collNames = Object.keys(lib).filter(
      (k) => k.endsWith("_RelStructure") && lib[k]["x-netex-role"] === "collection",
    );
    let found = false;
    for (const cn of collNames) {
      const r = resolveCollVerStruct(lib, cn);
      if (r) {
        expect(r.target).toBeTruthy();
        expect(r.childKey).toBeTruthy();
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("returns null for non-collection", () => {
    expect(resolveCollVerStruct(lib, "VehicleType")).toBeNull();
  });
});

// ── collapseCollAsRef ─────────────────────────────────────────────────────

describe("collapseCollAsRef", () => {
  it("resolves a collection with Ref child to CollapsedCollRef", () => {
    // Find a Ref+Entity collection (has both FooRef and Foo children)
    const collNames = Object.keys(lib).filter(
      (k) => k.endsWith("_RelStructure") && lib[k]["x-netex-role"] === "collection",
    );
    let found = false;
    for (const cn of collNames) {
      const schema = { $ref: `#/definitions/${cn}` };
      const ccRef = collapseCollAsRef(lib, "test", schema);
      if (ccRef) {
        expect(ccRef.typeStr).toMatch(/^(Ref<'.+'>|SimpleRef)$/);
        expect(ccRef.refChildKey).toMatch(/Ref$/);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("returns null for non-ref properties", () => {
    expect(collapseCollAsRef(lib, "test", { type: "string" })).toBeNull();
  });
});

// ── resolveCollRefVerStruct ───────────────────────────────────────────────

describe("resolveCollRefVerStruct", () => {
  it("finds ref child in collection with Ref member", () => {
    const collNames = Object.keys(lib).filter(
      (k) => k.endsWith("_RelStructure") && lib[k]["x-netex-role"] === "collection",
    );
    let found = false;
    for (const cn of collNames) {
      const r = resolveCollRefVerStruct(lib, cn);
      if (r) {
        expect(r.typeStr).toMatch(/^(Ref<'.+'>|SimpleRef)$/);
        expect(r.refChildKey).toMatch(/Ref$/);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("returns null for entity-only collections", () => {
    // Find a collection where resolveCollVerStruct succeeds but resolveCollRefVerStruct doesn't
    const collNames = Object.keys(lib).filter(
      (k) => k.endsWith("_RelStructure") && lib[k]["x-netex-role"] === "collection",
    );
    let found = false;
    for (const cn of collNames) {
      if (resolveCollVerStruct(lib, cn) && !resolveCollRefVerStruct(lib, cn)) {
        found = true;
        break;
      }
    }
    // There should be entity-only collections in the schema
    expect(found).toBe(true);
  });

  it("returns null for non-collection", () => {
    expect(resolveCollRefVerStruct(lib, "VehicleType")).toBeNull();
  });
});

// ── buildTypeOverrides ─────────────────────────────────────────────────────

describe("buildTypeOverrides", () => {
  it("overrides abstract ref heads in Vehicle", () => {
    const overrides = buildTypeOverrides(lib, "Vehicle", { collapseRefs: true });
    expect(overrides.get("TransportOrganisationRef")).toBe("SimpleRef");
    expect(overrides.get("VehicleModelProfileRef")).toBe("SimpleRef");
  });

  it("builds override map for VehicleType with collapseRefs", () => {
    const overrides = buildTypeOverrides(lib, "VehicleType", { collapseRefs: true });
    // VehicleType has BrandingRef which should collapse
    if (overrides.has("BrandingRef")) {
      expect(overrides.get("BrandingRef")).toMatch(/^(Ref<'.+'>|SimpleRef)$/);
    }
    // Non-ref props should NOT be in the map
    expect(overrides.has("Name")).toBeFalsy();
    expect(overrides.has("$id")).toBeFalsy();
  });

  it("builds override map for VehicleType with collapseCollections", () => {
    const overrides = buildTypeOverrides(lib, "VehicleType", { collapseCollections: true });
    for (const [, v] of overrides) {
      // Ref+Entity collections → Ref<'...'> or SimpleRef; entity-only → entity name
      expect(v).not.toContain("_RelStructure");
    }
    // Ref+Entity collections should produce Ref<> types
    const refOverrides = [...overrides.values()].filter((v) => v.startsWith("Ref<") || v === "SimpleRef");
    expect(refOverrides.length).toBeGreaterThan(0);
  });
});
