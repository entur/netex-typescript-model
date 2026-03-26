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

/** Strip TS annotations from makeInlineCodeBlock output for eval. */
function stripTs(code: string): string {
  return code
    .replace(/^type\s+\w+\s*=\s*[^;]+;\s*$/gm, "")
    .replace(/(\w+)(\??\s*:\s*(?:Obj|string|Reshape|unknown)(?:\[\])?)/g, "$1")
    .replace(/\)\s*:\s*Obj\s*\{/g, ") {")
    .replace(/\s+as\s+Obj(?:\[\])?/g, "");
}

type ShapeFn = (obj: Record<string, unknown>) => Record<string, unknown>;

/** Eval generated mapping code and return the root toXmlShape function. */
function evalMapping(name: string, excl?: Set<string>): ShapeFn {
  const allProps = flattenAllOf(netexLibrary, name);
  const code = makeInlineCodeBlock(netexLibrary, name, {
    html: false,
    excludeProps: excl,
    props: allProps,
  });
  const fnName = lcFirst(name) + "ToXmlShape";
  return new Function(stripTs(code) + `\nreturn ${fnName};`)() as ShapeFn;
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
    // Can't use flattenFake here: mapping code expects schema-shape (wrapped
    // collections), but flattenFake unwraps them. Only strip excluded props.
    const filtered = Object.fromEntries(
      Object.entries(vtMock).filter(([k]) => !vtExclSet?.has(k)),
    );
    const xmlShape = shapeFn(filtered);
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

// ── Group C: interface-shape roundtrip — documents mapping code gap ──────────
// flattenFake() unwraps collections to match generateInterface() shape, but
// makeInlinedToXmlShape still generates child() calls expecting the wrapped form.
// This gap must be resolved in issue #30 (makeInlinedToXmlShape becomes
// interface-shape-aware). Until then, this test is .todo.

describe.each(TEST_ENTITIES)("$name generated roundtrip (interface shape)", (entity) => {
  it.todo(
    "flattenFake → mapping code → xmllint (blocked: mapping code expects schema shape, not interface shape)",
  );
});
