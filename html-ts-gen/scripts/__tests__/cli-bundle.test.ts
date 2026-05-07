import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const out = `${repoRoot}/dist/ts-gen.mjs`;

describe("cli-bundle", () => {
  beforeAll(() => {
    execFileSync("npx", ["tsx", "scripts/build-cli-bundle.ts"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  });

  it("produces dist/ts-gen.mjs", () => {
    expect(existsSync(out)).toBe(true);
  });

  it("starts with shebang", () => {
    expect(readFileSync(out, "utf-8").slice(0, 19)).toBe("#!/usr/bin/env node");
  });

  it("is a single-file bundle (>50 KB)", () => {
    expect(statSync(out).size).toBeGreaterThan(50_000);
  });

  it("runs and prints usage when no targets given", () => {
    let stderr = "";
    try {
      execFileSync("node", [out], { cwd: repoRoot, stdio: "pipe", encoding: "utf-8" });
    } catch (e) {
      stderr = (e as { stderr: string }).stderr;
    }
    expect(stderr).toMatch(/Usage: netex-ts-gen/);
  });
});

describe("build-tarball-pkg-json", () => {
  const tmp = mkdtempSync(join(tmpdir(), "pkg-json-"));

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("writes package.json with per-assembly name and bin", () => {
    execFileSync("npx", [
      "tsx", "scripts/build-tarball-pkg-json.ts",
      "--assembly", "network+timetable",
      "--version", "2.0.0",
      "--out-dir", tmp,
    ], { cwd: repoRoot, stdio: "pipe" });
    const pkg = JSON.parse(readFileSync(join(tmp, "package.json"), "utf-8"));
    expect(pkg.name).toBe("@entur/netex-typescript-model-network-timetable");
    expect(pkg.version).toBe("2.0.0");
    expect(pkg.bin).toEqual({ "netex-ts-gen": "./ts-gen.mjs" });
    expect(pkg.dependencies.typescript).toMatch(/^\^?\d/);
    expect(pkg.type).toBe("module");
  });

  it("slugifies '@' and '+' for sub-graph assemblies", () => {
    execFileSync("npx", [
      "tsx", "scripts/build-tarball-pkg-json.ts",
      "--assembly", "network@StopPlace@tiny",
      "--version", "0.0.0-dev",
      "--out-dir", tmp,
    ], { cwd: repoRoot, stdio: "pipe" });
    const pkg = JSON.parse(readFileSync(join(tmp, "package.json"), "utf-8"));
    expect(pkg.name).toBe("@entur/netex-typescript-model-network-stopplace-tiny");
  });
});
