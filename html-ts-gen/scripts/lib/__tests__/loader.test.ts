import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadNetexLibrary } from "../loader.js";

describe("loadNetexLibrary", () => {
  it("uses default base dir when no arg given", () => {
    const lib = loadNetexLibrary();
    expect(lib).toBeTypeOf("object");
    expect(Object.keys(lib).length).toBeGreaterThan(0);
  });

  it("loads from explicit dir argument", () => {
    const baseDir = resolve(__dirname, "../../../../generated-src/base");
    const lib = loadNetexLibrary(baseDir);
    expect(lib).toBeTypeOf("object");
    expect(Object.keys(lib).length).toBeGreaterThan(0);
  });

  it("loads from explicit *.schema.json file path", () => {
    const baseDir = resolve(__dirname, "../../../../generated-src/base");
    const lib = loadNetexLibrary(`${baseDir}/base.schema.json`);
    expect(lib).toBeTypeOf("object");
  });

  it("throws clear error when dir has no *.schema.json", () => {
    expect(() => loadNetexLibrary("/tmp/definitely-does-not-exist-xyz")).toThrow(/not found/i);
  });
});
