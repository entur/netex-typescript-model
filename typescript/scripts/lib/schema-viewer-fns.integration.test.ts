import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  resolveLeafType,
  resolveValueLeaf,
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

  it("resolveLeafType returns complex for simpleContent types (use resolveValueLeaf instead)", () => {
    // PrivateCodeStructure has { type: "object", properties: { value, type } }
    // resolveLeafType correctly sees it as complex — the leaf is exposed via x-netex-leaf
    const result = resolveLeafType(defs, "PrivateCodeStructure");
    expect(result.complex).toBe(true);
    expect(resolveValueLeaf(defs, "PrivateCodeStructure")).toBe("string");
  });

  it("flattenAllOf produces properties for a real type", () => {
    const props = flattenAllOf(defs, "VersionOfObjectRefStructure");
    expect(props.length).toBeGreaterThan(0);
    expect(props.some((p) => p.prop === "value")).toBe(true);
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
