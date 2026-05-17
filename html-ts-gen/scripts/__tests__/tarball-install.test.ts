import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

describe("tarball install + CLI run", () => {
  let tmp: string;
  let tarball: string;

  beforeAll(() => {
    execFileSync("make", ["all", "tarball", "ASSEMBLY=base", "VERSION=0.0.0-test"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    const tgz = readdirSync(join(repoRoot, "generated-src")).find(
      (f) => f.includes("base") && f.endsWith("-v0.0.0-test.tgz"),
    );
    if (!tgz) throw new Error("tarball not found");
    tarball = join(repoRoot, "generated-src", tgz);
    tmp = mkdtempSync(join(tmpdir(), "tarball-install-"));
    execFileSync("npm", ["init", "-y"], { cwd: tmp, stdio: "pipe" });
    execFileSync("npm", ["install", tarball], { cwd: tmp, stdio: "pipe" });
  }, 600_000);

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("exposes netex-ts-gen binary", () => {
    expect(existsSync(join(tmp, "node_modules", ".bin", "netex-ts-gen"))).toBe(true);
  });

  it("generates a valid Vehicle.ts via npx", () => {
    const out = execFileSync("npx", ["netex-ts-gen", "--dest-dir", tmp, "--overwrite", "Vehicle"], {
      cwd: tmp,
      encoding: "utf-8",
    });
    expect(out).toMatch(/PASS .*Vehicle\.ts/);
    expect(existsSync(join(tmp, "Vehicle.ts"))).toBe(true);
  });
});
