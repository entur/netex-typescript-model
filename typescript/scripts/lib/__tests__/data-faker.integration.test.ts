import { describe, it, expect, beforeAll } from "vitest";
import { fake, serialize } from "../data-faker.js";
import { loadNetexLibrary } from "./test-helpers.js";
import type { NetexLibrary } from "../types.js";

let lib: NetexLibrary;
let vtMock: Record<string, unknown>;
beforeAll(() => {
  lib = loadNetexLibrary();
  vtMock = fake(lib, "VehicleType");
});

describe("fake — VehicleType (real schema)", () => {

  it("has $id containing VehicleType", () => {
    expect(vtMock.$id).toContain("VehicleType");
  });

  it("has $version set to '1'", () => {
    expect(vtMock.$version).toBe("1");
  });

  it("has TransportMode as a valid enum value", () => {
    expect(typeof vtMock.TransportMode).toBe("string");
    expect((vtMock.TransportMode as string).length).toBeGreaterThan(0);
  });

  it("has LowFloor as a boolean", () => {
    expect(typeof vtMock.LowFloor).toBe("boolean");
  });

  it("has BrandingRef as ref-pattern object", () => {

    const ref = vtMock.BrandingRef as Record<string, unknown>;
    expect(ref).toBeDefined();
    expect(typeof ref.value).toBe("string");
    expect(typeof ref.$ref).toBe("string");
  });

  it("has PropulsionTypes as array with enum value", () => {

    const pt = vtMock.PropulsionTypes;
    expect(Array.isArray(pt)).toBe(true);
    expect((pt as unknown[]).length).toBeGreaterThan(0);
    expect(typeof (pt as unknown[])[0]).toBe("string");
  });

  it("has $nameOfClass matching the entity name (XML attribute)", () => {

    expect(vtMock.$nameOfClass).toBe("VehicleType");
  });

  it("includes properties from all 5 inherited origins", () => {


    // EntityStructure
    expect(vtMock.$id).toBeDefined();
    expect(vtMock.$nameOfClass).toBeDefined();

    // EntityInVersionStructure
    expect(vtMock.$version).toBeDefined();
    expect(vtMock.$created).toBeDefined();
    expect(vtMock.$changed).toBeDefined();
    expect(vtMock.$modification).toBeDefined();

    // DataManagedObjectStructure
    expect(vtMock.BrandingRef).toBeDefined();

    // TransportType_VersionStructure
    expect(vtMock.TransportMode).toBeDefined();
    expect(vtMock.PrivateCode).toBeDefined();
    expect(vtMock.Name).toBeDefined();
    expect(Array.isArray(vtMock.Name)).toBe(true);

    // VehicleType_VersionStructure
    expect(vtMock.LowFloor).toBeDefined();
    expect(vtMock.Length).toBeDefined();
    expect(vtMock.PropulsionTypes).toBeDefined();
    expect(vtMock.FuelTypes).toBeDefined();
  });

  it("fills Name as TextType[] array with value and $lang (shallow-complex via mixed-unwrap)", () => {

    expect(Array.isArray(vtMock.Name)).toBe(true);
    const item = (vtMock.Name as Record<string, unknown>[])[0];
    expect(item).toBeDefined();
    expect("value" in item).toBe(true);
    expect("$lang" in item).toBe(true);
  });

  it("fills Description as TextType[] (same shallow-complex path as Name)", () => {

    expect(Array.isArray(vtMock.Description)).toBe(true);
  });

  it("fills keyList as wrapper with KeyValue child array", () => {

    const wrapper = vtMock.keyList as Record<string, unknown>;
    expect(wrapper).toBeDefined();
    expect(typeof wrapper).toBe("object");
    expect(Array.isArray(wrapper.KeyValue)).toBe(true);
    const item = (wrapper.KeyValue as Record<string, unknown>[])[0];
    expect(item).toBeDefined();
    expect("Key" in item).toBe(true);
    expect("Value" in item).toBe(true);
  });

  it("fills privateCodes as wrapper with PrivateCode child array", () => {

    const wrapper = vtMock.privateCodes as Record<string, unknown>;
    expect(wrapper).toBeDefined();
    expect(typeof wrapper).toBe("object");
    expect(Array.isArray(wrapper.PrivateCode)).toBe(true);
    const item = (wrapper.PrivateCode as Record<string, unknown>[])[0];
    expect(item).toBeDefined();
    expect("value" in item).toBe(true);
  });

  it("fills plain string properties with \"string\" default", () => {

    const pc = vtMock.PrivateCode as Record<string, unknown>;
    expect(pc.value).toBe("string");
  });

  it("fills $created as date-time string (inherited from EntityInVersionStructure)", () => {

    expect(vtMock.$created).toBe("2025-01-01T00:00:00");
  });

  it("fills $modification as first enum value (inherited from EntityInVersionStructure)", () => {

    expect(typeof vtMock.$modification).toBe("string");
    expect((vtMock.$modification as string).length).toBeGreaterThan(0);
  });

  it("fills Length as a number (inherited from VehicleType_VersionStructure)", () => {

    expect(typeof vtMock.Length).toBe("number");
  });
});

describe("serialize — VehicleType (real schema)", () => {
  it("produces XML starting with <VehicleType", () => {

    const xml = serialize(lib, "VehicleType", vtMock);
    expect(xml).toContain("<VehicleType");
  });

  it("contains id= attribute", () => {

    const xml = serialize(lib, "VehicleType", vtMock);
    expect(xml).toContain('id=');
  });

  it("contains version= attribute", () => {

    const xml = serialize(lib, "VehicleType", vtMock);
    expect(xml).toContain('version=');
  });
});
