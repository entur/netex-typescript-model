import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { makeInlinedToXmlShape } from "./to-xml-shape.js";
import { fake, toXmlShape as dataFakerToXmlShape } from "./data-faker.js";
import { lcFirst, type Defs } from "./fns.js";

// ── Schema loading (eager — needed at describe.each time) ────────────────────

const jsonschemaDir = resolve(import.meta.dirname, "../../../generated-src/base");

function loadDefs(): Defs {
  if (!existsSync(jsonschemaDir)) {
    throw new Error(
      `Base jsonschema dir not found at ${jsonschemaDir}.\nRun "make all" first.`,
    );
  }
  const schemaFile = readdirSync(jsonschemaDir).find((f) => f.endsWith(".schema.json"));
  if (!schemaFile) {
    throw new Error(`No *.schema.json found in ${jsonschemaDir}.\nRun "make all" first.`);
  }
  return JSON.parse(readFileSync(join(jsonschemaDir, schemaFile), "utf-8")).definitions;
}

const defs = loadDefs();

// ── Entity list (ResourceFrame entities from valid-roundtrip.test.ts) ────────

const ENTITIES = [
  "Contact",
  "DataSource",
  "VehicleType",
  "Vehicle",
  "DeckPlan",
  "Blacklist",
  "ControlCentre",
  "VehicleModel",
  "SchematicMap",
  "ResponsibilitySet",
  "ResponsibilityRole",
  "GroupOfOperators",
  "Whitelist",
  "ServiceFacilitySet",
  "SiteFacilitySet",
  "VehicleEquipmentProfile",
  "RollingStockInventory",
  "CarModelProfile",
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("makeInlinedToXmlShape", () => {
  it("Contact: returns valid JavaScript", () => {
    const code = makeInlinedToXmlShape(defs, "Contact");
    expect(typeof code).toBe("string");
    expect(() => new Function("obj", "toXmlShape", code)).not.toThrow();
  });

  it("Contact: generated function matches toXmlShape", () => {
    const code = makeInlinedToXmlShape(defs, "Contact");
    const stem = fake(defs, "Contact");
    const fnName = lcFirst("Contact") + "ToXmlShape";
    const fn = new Function(code + `\nreturn ${fnName};`)();
    const cb = (name: string, obj: Record<string, unknown>) =>
      dataFakerToXmlShape(defs, name, obj);
    const generated = fn(stem, cb);
    const reference = dataFakerToXmlShape(defs, "Contact", stem);
    expect(generated).toEqual(reference);
  });

  describe.each(ENTITIES)("%s", (name) => {
    it("generated matches toXmlShape", () => {
      const code = makeInlinedToXmlShape(defs, name);
      const fnName = lcFirst(name) + "ToXmlShape";
      const fn = new Function(code + `\nreturn ${fnName};`)();
      const stem = fake(defs, name);
      const cb = (n: string, obj: Record<string, unknown>) =>
        dataFakerToXmlShape(defs, n, obj);
      expect(fn(stem, cb)).toEqual(dataFakerToXmlShape(defs, name, stem));
    });
  });
});
