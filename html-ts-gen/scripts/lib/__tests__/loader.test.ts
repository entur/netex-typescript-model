import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
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

describe("ts-gen --schema CLI flag", () => {
  it("loads schema from --schema dir arg", () => {
    const baseDir = resolve(__dirname, "../../../../generated-src/base");
    const out = execFileSync("npx", [
      "tsx", "scripts/ts-gen.ts",
      "--schema", baseDir,
      "--dest-dir", "/tmp/ts-gen-test-schema-flag",
      "--overwrite",
      "Vehicle",
    ], { cwd: resolve(__dirname, "../../.."), encoding: "utf-8" });
    expect(out).toMatch(/PASS .*Vehicle\.ts/);
  });
});
