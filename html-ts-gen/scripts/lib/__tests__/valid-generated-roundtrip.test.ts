import { describe, it, expect } from "vitest";
import { defRole } from "../classify.js";
import { fake, flattenFake, buildXml } from "../data-faker.js";
import { makeInlineCodeBlock } from "../to-xml-shape.js";
import { flattenAllOf, buildExclSet } from "../schema-nav.js";
import { lcFirst } from "../util.js";
import {
  loadNetexLibrary,
  requireXsd,
  CORE,
  wrapInPublicationDelivery,
  validateWithXmllint,
  nonKeyrefErrors,
} from "./test-helpers.js";

requireXsd();
const netexLibrary = loadNetexLibrary();

// gen-vehicletype.sh exclude list
const VT_EXPLICIT = new Set([
  "$changed", "$compatibleWithVersionFrameVersionRef", "$created",
  "$dataSourceRef", "$derivedFromObjectRef", "$derivedFromVersionRef",
  "$modification", "$nameOfClass", "$status",
  "alternativeTexts", "ValidBetween", "validityConditions",
  "Extensions", "capacities", "FuelType", "TypeOfFuel",
]);

// Shared VehicleType fixtures (fake is pure/deterministic)
const vtAllProps = flattenAllOf(netexLibrary, "VehicleType");
const vtMock = fake(netexLibrary, "VehicleType");
const vtExclSet = buildExclSet(vtAllProps, { explicit: VT_EXPLICIT });

// ── Helpers ──────────────────────────────────────────────────────────────────

type ShapeFn = (obj: Record<string, unknown>) => Record<string, unknown>;

/** Eval generated mapping code (untyped JS) and return the root toXmlShape function. */
function evalMapping(name: string, excl?: Set<string>): ShapeFn {
  const allProps = flattenAllOf(netexLibrary, name);
  const code = makeInlineCodeBlock(netexLibrary, name, {
    html: false,
    typed: false,
    excludeProps: excl,
    props: allProps,
  });
  const fnName = lcFirst(name) + "ToXmlShape";
  return new Function(code + `\nreturn ${fnName};`)() as ShapeFn;
}

const TEST_ENTITIES = CORE
  .filter((e) => !!netexLibrary[e.name])
  .map((e) => ({ ...e, role: defRole(netexLibrary[e.name]) }));

// ── Group A: schema-shape roundtrip via generated mapping code ───────────────

describe.each(TEST_ENTITIES)("$name generated roundtrip (schema shape)", (entity) => {
  it("mapping code produces XSD-valid XML", { timeout: 30_000 }, () => {
    const shapeFn = evalMapping(entity.name);
    const mock = fake(netexLibrary, entity.name);
    const xmlShape = shapeFn(mock);
    const xml = buildXml(entity.name, xmlShape);
    const full = wrapInPublicationDelivery(entity, xml);
    const { valid, stderr } = validateWithXmllint(full);
    if (valid) return;
    const errors = nonKeyrefErrors(stderr);
    expect(errors, `xmllint errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

// ── Group A+: with exclusions (VehicleType) ──────────────────────────────────

describe("VehicleType generated roundtrip with exclusions", () => {
  const vtEntity = CORE.find((e) => e.name === "VehicleType")!;

  it("mapping code with exclusions produces XSD-valid XML", { timeout: 30_000 }, () => {
    const shapeFn = evalMapping("VehicleType", vtExclSet);
    const flat = flattenFake(netexLibrary, "VehicleType", vtMock, {
      excludeProps: vtExclSet, props: vtAllProps,
    });
    const xmlShape = shapeFn(flat);
    const xml = buildXml("VehicleType", xmlShape);
    const full = wrapInPublicationDelivery(vtEntity, xml);
    const { valid, stderr } = validateWithXmllint(full);
    if (valid) return;
    const errors = nonKeyrefErrors(stderr);
    expect(errors, `xmllint errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

// ── Group B: flattenFake shape assertions ────────────────────────────────────

describe("flattenFake", () => {
  describe("exclusions (VehicleType + gen-vehicletype.sh list)", () => {
    const flat = flattenFake(netexLibrary, "VehicleType", vtMock, {
      excludeProps: vtExclSet, props: vtAllProps,
    });

    it("strips excluded base attrs", () => {
      for (const k of ["$changed", "$modification", "$status", "$nameOfClass"]) {
        expect(flat, `expected ${k} absent`).not.toHaveProperty(k);
      }
    });

    it("strips excluded element props", () => {
      for (const k of ["alternativeTexts", "ValidBetween", "Extensions", "capacities", "FuelType"]) {
        expect(flat, `expected ${k} absent`).not.toHaveProperty(k);
      }
    });

    it("preserves $id and $version", () => {
      expect(flat.$id).toBe(vtMock.$id);
      expect(flat.$version).toBe(vtMock.$version);
    });

    it("preserves non-excluded domain props", () => {
      expect(flat.Name).toEqual(vtMock.Name);
      if ("Length" in vtMock) expect(flat.Length).toBe(vtMock.Length);
    });
  });

  describe("collection unwrapping", () => {
    const flat = flattenFake(netexLibrary, "VehicleType", vtMock, { props: vtAllProps });

    it.each(["keyList", "privateCodes"])("unwraps %s wrapper to flat array", (prop) => {
      if (!vtMock[prop]) return;
      const orig = vtMock[prop];
      if (typeof orig === "object" && !Array.isArray(orig)) {
        expect(Array.isArray(flat[prop]), `${prop} should be flat array`).toBe(true);
      }
    });

    it("preserves non-collection props unchanged", () => {
      expect(flat.$id).toBe(vtMock.$id);
      expect(flat.BrandingRef).toEqual(vtMock.BrandingRef);
    });
  });
});

// ── Group C: interface-shape roundtrip via generated mapping code ─────────────

describe.each(TEST_ENTITIES)("$name generated roundtrip (interface shape)", (entity) => {
  it("flattenFake → mapping code → xmllint", { timeout: 30_000 }, () => {
    const shapeFn = evalMapping(entity.name);
    const raw = fake(netexLibrary, entity.name);
    const flat = flattenFake(netexLibrary, entity.name, raw);
    const xmlShape = shapeFn(flat);
    const xml = buildXml(entity.name, xmlShape);
    const full = wrapInPublicationDelivery(entity, xml);
    const { valid, stderr } = validateWithXmllint(full);
    if (valid) return;
    const errors = nonKeyrefErrors(stderr);
    expect(errors, `xmllint errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
