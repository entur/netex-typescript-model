import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  resolveLeafType,
  resolveValueLeaf,
  flattenAllOf,
  type Defs,
} from "./schema-viewer-fns.js";

const jsonschemaDir = resolve(import.meta.dirname, "../../src/generated/base/jsonschema");

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
