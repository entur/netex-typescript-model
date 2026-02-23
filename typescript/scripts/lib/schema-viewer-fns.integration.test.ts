import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  resolveLeafType,
  resolveValueLeaf,
  resolvePropertyType,
  flattenAllOf,
  buildReverseIndex,
  findTransitiveEntityUsers,
  defRole,
  type Defs,
} from "./schema-viewer-fns.js";

const jsonschemaDir = resolve(import.meta.dirname, "../../../generated-src/base");

let defs: Defs;

beforeAll(() => {
  if (!existsSync(jsonschemaDir)) {
    throw new Error(
      `Base jsonschema dir not found at ${jsonschemaDir}.\nRun "npm run generate" first.`,
    );
  }
  const schemaFile = readdirSync(jsonschemaDir).find((f) => f.endsWith(".schema.json"));
  if (!schemaFile) {
    throw new Error(
      `No *.schema.json found in ${jsonschemaDir}.\nRun "npm run generate" first.`,
    );
  }
  defs = JSON.parse(readFileSync(join(jsonschemaDir, schemaFile), "utf-8")).definitions;
});

describe("integration with real schema", () => {
  it("resolves NaturalLanguageStringStructure leaf to string", () => {
    expect(resolveValueLeaf(defs, "NaturalLanguageStringStructure")).toBe("string");
  });

  it("resolves VersionOfObjectRefStructure leaf to string", () => {
    expect(resolveValueLeaf(defs, "VersionOfObjectRefStructure")).toBe("string");
  });

  it("resolves GroupOfEntitiesRefStructure_Dummy leaf to string (Option B)", () => {
    expect(resolveValueLeaf(defs, "GroupOfEntitiesRefStructure_Dummy")).toBe("string");
  });

  it("MultilingualString has no leaf (no value property)", () => {
    expect(resolveValueLeaf(defs, "MultilingualString")).toBeNull();
  });

  it("resolveLeafType resolves simpleContent types as primitive via x-netex-leaf", () => {
    // PrivateCodeStructure has { type: "object", properties: { value, type }, x-netex-leaf: "string" }
    // resolveLeafType now consults x-netex-leaf and resolves as primitive
    const result = resolveLeafType(defs, "PrivateCodeStructure");
    expect(result).toEqual({ ts: "string", complex: false });
    expect(resolveValueLeaf(defs, "PrivateCodeStructure")).toBe("string");
  });

  it("flattenAllOf produces properties for a real type", () => {
    const props = flattenAllOf(defs, "VersionOfObjectRefStructure");
    expect(props.length).toBeGreaterThan(0);
    expect(props.some((p) => p.prop[0] === "value")).toBe(true);
  });
});

describe("resolvePropertyType — real schema (Interface tab)", () => {
  it("resolves a $ref property to its leaf primitive", () => {
    // VersionOfObjectRefStructure.value → $ref ObjectIdType → string
    const schema = defs["VersionOfObjectRefStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result).toEqual({ ts: "string", complex: false });
  });

  it("resolves an allOf-wrapped $ref to an enum", () => {
    // VersionOfObjectRefStructure.modification → allOf[$ref ModificationEnumeration]
    const schema = defs["VersionOfObjectRefStructure"]?.properties?.["modification"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result.complex).toBe(false);
    expect(result.ts).toContain('"new"');
    expect(result.ts).toContain("|");
  });

  it("resolves an inline primitive with format", () => {
    // VersionOfObjectRefStructure.created → { type: "string", format: "date-time" }
    const schema = defs["VersionOfObjectRefStructure"]?.properties?.["created"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result).toEqual({ ts: "string /* date-time */", complex: false });
  });

  it("resolves an array of $ref items", () => {
    // MultilingualString.Text → { type: "array", items: { $ref: TextType } }
    const schema = defs["MultilingualString"]?.properties?.["Text"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result.ts).toMatch(/\[\]$/);
  });

  it("resolves an inline string property", () => {
    // PrivateCodeStructure.value → { type: "string" }
    const schema = defs["PrivateCodeStructure"]?.properties?.["value"];
    expect(schema).toBeDefined();
    const result = resolvePropertyType(defs, schema);
    expect(result).toEqual({ ts: "string", complex: false });
  });

  it("works end-to-end: flattenAllOf + resolvePropertyType + resolveValueLeaf", () => {
    // Simulates what the Interface tab does for each property
    const props = flattenAllOf(defs, "VersionOfObjectRefStructure");
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      const resolved = resolvePropertyType(defs, p.schema);
      expect(resolved.ts).toBeTruthy();
      // If complex, resolveValueLeaf should be callable without error
      if (resolved.complex) {
        const typeName = resolved.ts.endsWith("[]") ? resolved.ts.slice(0, -2) : resolved.ts;
        resolveValueLeaf(defs, typeName); // should not throw
      }
    }
  });
});

describe("VehicleType — deep entity scenario (Interface tab)", () => {
  it("flattenAllOf collects properties from entire 5-level chain", () => {
    const props = flattenAllOf(defs, "VehicleType");
    expect(props.length).toBeGreaterThan(20);
    // Own properties from VehicleType_VersionStructure
    expect(props.some((p) => p.prop[1] === "lowFloor")).toBe(true);
    expect(props.some((p) => p.prop[1] === "length")).toBe(true);
    // Inherited from TransportType_VersionStructure
    expect(props.some((p) => p.prop[1] === "name" && p.origin === "TransportType_VersionStructure")).toBe(true);
    expect(props.some((p) => p.prop[1] === "transportMode")).toBe(true);
    // Deep inherited from EntityInVersionStructure
    expect(props.some((p) => p.prop[1] === "created")).toBe(true);
    expect(props.some((p) => p.prop[1] === "version")).toBe(true);
  });

  it("resolvePropertyType handles booleans from VehicleType", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const lowFloor = props.find((p) => p.prop[1] === "lowFloor");
    expect(lowFloor).toBeDefined();
    expect(resolvePropertyType(defs, lowFloor!.schema)).toEqual({ ts: "boolean", complex: false });
  });

  it("resolvePropertyType resolves allOf-wrapped measurement types", () => {
    // Length → allOf[$ref LengthType] → should resolve to a leaf
    const props = flattenAllOf(defs, "VehicleType");
    const length = props.find((p) => p.prop[1] === "length");
    expect(length).toBeDefined();
    const result = resolvePropertyType(defs, length!.schema);
    expect(result.ts).toBeTruthy();
    // LengthType is a simpleContent wrapper — resolveValueLeaf exposes the primitive
    const leaf = resolveValueLeaf(defs, "LengthType");
    if (leaf) expect(typeof leaf).toBe("string");
  });

  it("resolvePropertyType resolves enum from inherited TransportMode", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const mode = props.find((p) => p.prop[1] === "transportMode");
    expect(mode).toBeDefined();
    const result = resolvePropertyType(defs, mode!.schema);
    // AllPublicTransportModesEnumeration is an enum — should contain pipe-separated literals
    expect(result.complex).toBe(false);
    expect(result.ts).toContain("|");
  });

  it("resolvePropertyType resolves array from deep-inherited ValidBetween", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const vb = props.find((p) => p.prop[1] === "validBetween");
    expect(vb).toBeDefined();
    const result = resolvePropertyType(defs, vb!.schema);
    expect(result.ts).toMatch(/\[\]$/);
  });

  it("resolvePropertyType resolves BrandingRef as string via x-netex-leaf", () => {
    const props = flattenAllOf(defs, "VehicleType");
    const branding = props.find((p) => p.prop[1] === "brandingRef");
    expect(branding).toBeDefined();
    const result = resolvePropertyType(defs, branding!.schema);
    expect(result).toEqual({ ts: "string", complex: false });
  });

  it("resolvePropertyType resolves complex ref types", () => {
    // capacities → allOf[$ref passengerCapacities_RelStructure] — a complex structure
    const props = flattenAllOf(defs, "VehicleType");
    const cap = props.find((p) => p.prop[1] === "capacities");
    expect(cap).toBeDefined();
    const result = resolvePropertyType(defs, cap!.schema);
    expect(result.complex).toBe(true);
  });
});

describe("findTransitiveEntityUsers — real schema", () => {
  let reverseIdx: Record<string, string[]>;
  const isEntity = (name: string) => defRole(defs[name]) === "entity";

  beforeAll(() => {
    reverseIdx = buildReverseIndex(defs);
  });

  it("PostalAddress reaches entities through AddressablePlace chain", () => {
    // PostalAddress → AddressablePlace_VersionStructure → ... → entity
    const entities = findTransitiveEntityUsers("PostalAddress", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    // Every result must actually be an entity
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("MultilingualString is used by many entities (multi-hop, ubiquitous)", () => {
    // 0 direct entity referrers but 97 total referrers — should find many entities transitively
    const entities = findTransitiveEntityUsers("MultilingualString", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(20);
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("PrivateCodeStructure reaches entities through wrappers", () => {
    // PrivateCodeStructure → PrivateCode/Country_VersionStructure → ... → entities
    const entities = findTransitiveEntityUsers("PrivateCodeStructure", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("GroupOfEntities_VersionStructure reaches entities (deep inheritance)", () => {
    // Sits deep in the inheritance chain, no direct entity refs
    const entities = findTransitiveEntityUsers(
      "GroupOfEntities_VersionStructure",
      reverseIdx,
      isEntity,
    );
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("an entity returns other entities that reference it (not itself)", () => {
    // Pick an entity that other entities likely reference (e.g. via Ref types)
    if (!defs["TopographicPlace"]) return; // skip if not in base
    const entities = findTransitiveEntityUsers("TopographicPlace", reverseIdx, isEntity);
    expect(entities).not.toContain("TopographicPlace");
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("an enumeration finds entities that use it", () => {
    // StopPlaceTypeEnumeration should be used by StopPlace (through _VersionStructure)
    if (!defs["StopPlaceTypeEnumeration"]) return; // skip if not in base
    const entities = findTransitiveEntityUsers("StopPlaceTypeEnumeration", reverseIdx, isEntity);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(defRole(defs[e])).toBe("entity");
    }
  });

  it("completes in reasonable time for a heavily-referenced type", () => {
    const start = performance.now();
    findTransitiveEntityUsers("MultilingualString", reverseIdx, isEntity);
    const elapsed = performance.now() - start;
    // Should complete well under 1 second even for 3000+ defs
    expect(elapsed).toBeLessThan(1000);
  });
});
