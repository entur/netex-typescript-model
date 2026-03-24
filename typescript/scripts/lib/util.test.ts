import { describe, it, expect } from "vitest";
import { lcFirst, canonicalPropName } from "./util.js";


describe("lcFirst", () => {
  it("lowercases PascalCase property name", () => {
    expect(lcFirst("BrandingRef")).toBe("brandingRef");
  });

  it("keeps already-lowercase name unchanged", () => {
    expect(lcFirst("version")).toBe("version");
  });

  it("handles single character", () => {
    expect(lcFirst("X")).toBe("x");
  });

  it("handles empty string", () => {
    expect(lcFirst("")).toBe("");
  });
});


describe("canonicalPropName", () => {
  it("returns PascalCase for XML elements", () => {
    expect(canonicalPropName("TransportMode", {})).toBe("TransportMode");
  });

  it("returns $-prefixed for XML attributes", () => {
    expect(canonicalPropName("id", { xml: { attribute: true } })).toBe("$id");
  });

  it("returns name unchanged when schema is undefined", () => {
    expect(canonicalPropName("Foo", undefined)).toBe("Foo");
  });

  it("returns name unchanged when schema has no xml property", () => {
    expect(canonicalPropName("Bar", { type: "string" })).toBe("Bar");
  });
});
