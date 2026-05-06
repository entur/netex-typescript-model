import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

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
