import { describe, it, expect } from "vitest";
import { makeInlinedToXmlShape, makeInlineCodeBlock } from "../to-xml-shape.js";
import { fake, toXmlShape as dataFakerToXmlShape } from "../data-faker.js";
import { lcFirst } from "../util.js";
import { loadNetexLibrary } from "./test-helpers.js";

const netexLibrary = loadNetexLibrary();

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
    const code = makeInlinedToXmlShape(netexLibrary, "Contact");
    expect(typeof code).toBe("string");
    expect(() => new Function("obj", "toXmlShape", code)).not.toThrow();
  });

  it("Contact: generated function matches toXmlShape", () => {
    const code = makeInlinedToXmlShape(netexLibrary, "Contact");
    const stem = fake(netexLibrary, "Contact");
    const fnName = lcFirst("Contact") + "ToXmlShape";
    const fn = new Function(code + `\nreturn ${fnName};`)();
    const cb = (name: string, obj: Record<string, unknown>) =>
      dataFakerToXmlShape(netexLibrary, name, obj);
    const generated = fn(stem, cb);
    const reference = dataFakerToXmlShape(netexLibrary, "Contact", stem);
    expect(generated).toEqual(reference);
  });

  describe.each(ENTITIES)("%s", (name) => {
    it("generated matches toXmlShape", () => {
      const code = makeInlinedToXmlShape(netexLibrary, name);
      const fnName = lcFirst(name) + "ToXmlShape";
      const fn = new Function(code + `\nreturn ${fnName};`)();
      const stem = fake(netexLibrary, name);
      const cb = (n: string, obj: Record<string, unknown>) =>
        dataFakerToXmlShape(netexLibrary, n, obj);
      expect(fn(stem, cb)).toEqual(dataFakerToXmlShape(netexLibrary, name, stem));
    });
  });
});

// ── HTML syntax-highlighting tests ──────────────────────────────────────────

describe("makeInlinedToXmlShape html mode", () => {
  it("Contact: plain mode has no span tags", () => {
    const plain = makeInlinedToXmlShape(netexLibrary, "Contact");
    expect(plain).not.toContain("<span");
    expect(plain).not.toContain("</span>");
  });

  it("Contact: html mode contains span tags with if-* classes", () => {
    const html = makeInlinedToXmlShape(netexLibrary, "Contact", { html: true });
    expect(html).toContain('<span class="if-kw">');
    expect(html).toContain('<span class="if-lit">');
    expect(html).toContain('<span class="if-prop">');
  });

  it("Contact: html mode highlights function and return keywords", () => {
    const html = makeInlinedToXmlShape(netexLibrary, "Contact", { html: true });
    expect(html).toContain('<span class="if-kw">function</span>');
    expect(html).toContain('<span class="if-kw">return</span>');
    expect(html).toContain('<span class="if-kw">const</span>');
  });
});

describe("makeInlineCodeBlock html mode", () => {
  it("Contact: plain mode has no span tags", () => {
    const plain = makeInlineCodeBlock(netexLibrary, "Contact");
    expect(plain).not.toContain("<span");
  });

  it("Contact: html mode contains highlighted comment", () => {
    const html = makeInlineCodeBlock(netexLibrary, "Contact", { html: true });
    expect(html).toContain('<span class="if-cmt">');
    expect(html).toContain("Project Contact");
  });

  it("Contact: html mode includes highlighted keywords", () => {
    const html = makeInlineCodeBlock(netexLibrary, "Contact", { html: true });
    expect(html).toContain('<span class="if-kw">function</span>');
  });

  it("Vehicle: html mode highlights dispatch function keywords", () => {
    const html = makeInlineCodeBlock(netexLibrary, "Vehicle", { html: true });
    expect(html).toContain('<span class="if-kw">switch</span>');
    expect(html).toContain('<span class="if-kw">case</span>');
    expect(html).toContain('<span class="if-kw">default</span>');
  });

  it("plain mode includes comment header", () => {
    const plain = makeInlineCodeBlock(netexLibrary, "Contact");
    expect(plain).toContain("/*");
    expect(plain).toContain("Project Contact");
  });

  it("Vehicle: dedups identical child functions into const alias", () => {
    const code = makeInlineCodeBlock(netexLibrary, "Vehicle");
    // brandingRef is the first ref-structure emitted; all identical ones alias to it
    expect(code).toContain("function brandingRefToXmlShape(");
    expect(code).toContain("const authorityRefToXmlShape = brandingRefToXmlShape;");
    expect(code).toContain("const carModelProfileRefToXmlShape = brandingRefToXmlShape;");
    expect(code).not.toContain("function authorityRefToXmlShape(");
    expect(code).not.toContain("function carModelProfileRefToXmlShape(");
  });
});
