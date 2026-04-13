import { describe, it, expect } from "vitest";
import { collapseRef, collapseColl, resolveCollVerStruct, buildTypeOverrides } from "../collapse.js";
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
        expect(cc.simplifiedName).toBeTruthy();
        expect(cc.childKey).toBeTruthy();
        expect(cc.verStructName).toBe(cc.simplifiedName);
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
        expect(r.simplifiedName).toBeTruthy();
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

// ── buildTypeOverrides ─────────────────────────────────────────────────────

describe("buildTypeOverrides", () => {
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
    // Check if any collection was collapsed
    for (const [, v] of overrides) {
      // Collapsed collection types should not contain _RelStructure
      expect(v).not.toContain("_RelStructure");
    }
  });
});
