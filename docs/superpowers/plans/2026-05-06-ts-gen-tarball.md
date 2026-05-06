# ts-gen Tarball Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the per-assembly release tarball so a client can `npm install <github-tgz-url>` and get (a) the assembly's `*.schema.json`, (b) the offline `netex-schema.html` viewer, and (c) a self-contained `netex-ts-gen` CLI bundled from `html-ts-gen/scripts/ts-gen.ts`. Drop the legacy/primitive `interfaces/` `.ts` dump from the tarball — `ts-gen` replaces it on demand.

**Architecture:**

1. esbuild bundles `ts-gen.ts` + all `lib/*.ts` deps + `fast-xml-parser` into a single ESM `ts-gen.mjs` with a `#!/usr/bin/env node` shebang.
2. The bundled CLI auto-detects the assembly's `*.schema.json` next to itself; an explicit `--schema <path>` overrides.
3. The tarball is repacked as a valid npm package: top-level `package/` directory, generated `package.json` (per-assembly name, `bin: netex-ts-gen`, `dependencies: { typescript }`), schema JSON, schema HTML viewer, README.

**Tech Stack:** Node.js ≥ 22, esbuild ^0.27, tsx (dev runner), TypeScript (runtime peer for `tsc --noEmit`), fast-xml-parser (bundled), GNU Make.

**Decisions locked from clarification:**

- Per-assembly package name: `@entur/netex-typescript-model-<slug>` where slug = lowercase, `+` and `@` replaced with `-` (e.g. `network-timetable`, `base`, `network-timetable-fares-new-modes`).
- TypeScript: listed as runtime `dependencies` so `npm install <url>.tgz` makes the bundled CLI work out of the box.
- fast-xml-parser: bundled into `ts-gen.mjs`, not a runtime dep.

---

## File Structure

**Modify:**

- `html-ts-gen/scripts/lib/loader.ts` — `loadNetexLibrary()` gains optional `dir?: string` parameter; default keeps current behaviour. (Backward-compatible: all current callers pass no args.)
- `html-ts-gen/scripts/ts-gen.ts` — adds `--schema <path>` CLI flag. Without it, scans `import.meta.dirname` for `*.schema.json`; if found, uses it; else falls back to `loadNetexLibrary()`'s dev default.
- `Makefile` — drops legacy `interfaces/` from the `tarball` recipe; adds new `cli-bundle` and `tarball-pkg-json` targets; rewrites `tarball` to assemble an npm-style `package/` root.
- `.github/workflows/release.yml` — replaces the `npx tsx scripts/ts-gen.ts ...` smoke with a step that extracts the base tarball, runs `npm install` inside, then `npx netex-ts-gen ...`.
- `CLAUDE.md` (the project one) — updates the "Release Pipeline" and tarball-layout description to match the new shape.
- `docs/npm-publishing.md` — adds a new section "Distributing via GitHub Releases (.tgz)" describing the `npm install <url>.tgz` flow alongside the existing npmjs.com flow.

**Create:**

- `html-ts-gen/scripts/build-cli-bundle.ts` — esbuild entry: bundles `ts-gen.ts` to `dist/ts-gen.mjs` with shebang banner; bundles `fast-xml-parser`; externalizes nothing else (Node built-ins are auto-external).
- `html-ts-gen/scripts/build-tarball-pkg-json.ts` — emits `package.json` into the staging dir based on `--assembly`, `--version`, `--out-dir` CLI flags.
- `html-ts-gen/scripts/__tests__/cli-bundle.test.ts` — unit test for the bundle build (output exists, has shebang, `--help`-ish dry run works).
- `html-ts-gen/scripts/__tests__/tarball-install.test.ts` — integration test: extract the .tgz to a tmp dir, `npm install` inside, run `npx netex-ts-gen --schema ./base.schema.json --dest-dir <tmp> Vehicle`, assert files and exit code.
- `html-ts-gen/scripts/lib/__tests__/loader.test.ts` — unit test for the new `dir` argument (existing tests cover the default path).

**Tarball layout (after this plan):**

```
package/                                  # tarball root (npm convention)
├── package.json                          # name: @entur/netex-typescript-model-<slug>
├── README.md                             # usage: npm install <url>.tgz; npx netex-ts-gen
├── ts-gen.mjs                            # bundled, shebang, exec bit set
├── <assembly>.schema.json                # the only schema artifact (kept)
└── netex-schema.html                     # offline viewer (kept)
```

`package.json` shape:

```json
{
  "name": "@entur/netex-typescript-model-<slug>",
  "version": "<VERSION>",
  "description": "NeTEx 2.0 JSON Schema and codegen CLI for assembly '<assembly>'",
  "type": "module",
  "bin": { "netex-ts-gen": "./ts-gen.mjs" },
  "files": ["ts-gen.mjs", "*.schema.json", "netex-schema.html", "README.md"],
  "dependencies": { "typescript": "^5.5" },
  "engines": { "node": ">=22" },
  "repository": { "type": "git", "url": "git+https://github.com/entur/netex-typescript-model.git" },
  "license": "EUPL-1.2"
}
```

---

## Task 1: Add optional `dir` argument to `loadNetexLibrary`

**Files:**

- Modify: `html-ts-gen/scripts/lib/loader.ts`
- Test: `html-ts-gen/scripts/lib/__tests__/loader.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `html-ts-gen/scripts/lib/__tests__/loader.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify the new tests fail**

Run: `cd html-ts-gen && npx vitest run scripts/lib/__tests__/loader.test.ts`
Expected: the "explicit dir" tests FAIL (TypeError — function takes no args).

- [ ] **Step 3: Implement the change**

Replace `html-ts-gen/scripts/lib/loader.ts`:

```ts
/** Load a NetexLibrary from a generated-src dir or schema-json file. */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { NetexLibrary } from "./types.js";

const defaultDir = resolve(import.meta.dirname, "../../../generated-src/base");

/**
 * @param dirOrFile Optional path. If a directory, the first *.schema.json inside is loaded.
 *                  If a file, that file is loaded. Defaults to generated-src/base.
 */
export function loadNetexLibrary(dirOrFile?: string): NetexLibrary {
  const target = dirOrFile ?? defaultDir;
  if (!existsSync(target)) {
    throw new Error(`Schema path not found: ${target}.\nRun "make all" first.`);
  }
  const file = statSync(target).isDirectory()
    ? findSchemaFile(target)
    : target;
  return JSON.parse(readFileSync(file, "utf-8")).definitions;
}

function findSchemaFile(dir: string): string {
  const f = readdirSync(dir).find((n) => n.endsWith(".schema.json"));
  if (!f) throw new Error(`No *.schema.json found in ${dir}.`);
  return join(dir, f);
}
```

- [ ] **Step 4: Run all tests to verify nothing regressed**

Run: `cd html-ts-gen && npx vitest run`
Expected: all tests PASS, including the four new loader tests.

- [ ] **Step 5: Commit**

```bash
git add html-ts-gen/scripts/lib/loader.ts html-ts-gen/scripts/lib/__tests__/loader.test.ts
git commit -m "loader: accept optional schema path arg"
```

---

## Task 2: Add `--schema` flag to ts-gen.ts with auto-detect default

**Files:**

- Modify: `html-ts-gen/scripts/ts-gen.ts`

- [ ] **Step 1: Write the failing test**

Append to `html-ts-gen/scripts/lib/__tests__/loader.test.ts`:

```ts
import { execFileSync } from "node:child_process";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd html-ts-gen && npx vitest run scripts/lib/__tests__/loader.test.ts -t "--schema"`
Expected: FAIL — unknown option `--schema`.

- [ ] **Step 3: Update ts-gen.ts**

Modify `html-ts-gen/scripts/ts-gen.ts`. Replace the imports + CLI parsing block (lines 6–75 currently) with:

```ts
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { generateInterface, generateSubTypesBlock } from "./lib/codegens.js";
import { flattenAllOf, buildExclSet } from "./lib/schema-nav.js";
import { makeInlineCodeBlock } from "./lib/to-xml-shape.js";
import { loadNetexLibrary } from "./lib/loader.js";
import { type CollapseOpts, buildTypeOverrides, REF_PREAMBLE } from "./lib/collapse.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function guardWrite(path: string, content: string): boolean {
  if (!overwrite && existsSync(path)) {
    console.error(`ABORT ${path} already exists (use --overwrite)`);
    return false;
  }
  writeFileSync(path, content);
  return true;
}

function typeCheck(path: string): boolean {
  try {
    execFileSync("npx", ["tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", path], {
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log(`PASS ${path}`);
    return true;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    console.error(`FAIL ${path}`);
    if (e.stdout) console.error(e.stdout);
    if (e.stderr) console.error(e.stderr);
    return false;
  }
}

/** Look for *.schema.json next to the running script (bundled CLI case). */
function adjacentSchema(): string | undefined {
  const dir = import.meta.dirname;
  if (!dir) return undefined;
  try {
    const f = readdirSync(dir).find((n) => n.endsWith(".schema.json"));
    return f ? join(dir, f) : undefined;
  } catch {
    return undefined;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const { values, positionals: TARGETS } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dest-dir": { type: "string", default: "/tmp" },
    schema: { type: "string" },
    overwrite: { type: "boolean", default: false },
    exclude: { type: "string" },
    suffix: { type: "string", default: "" },
    "collapse-refs": { type: "boolean", default: false },
    "collapse-collections": { type: "boolean", default: false },
  },
  allowPositionals: true,
});

if (!TARGETS.length) {
  console.error("Usage: netex-ts-gen [--schema <path>] [--dest-dir <path>] [--overwrite] [--exclude a,b,...]");
  console.error("       [--suffix s] [--collapse-refs] [--collapse-collections] <Target> [...]");
  process.exit(1);
}

const destDir = values["dest-dir"]!;
mkdirSync(destDir, { recursive: true });
const overwrite = values.overwrite!;
const suffix = values.suffix!;
const explicit = values.exclude
  ? new Set(values.exclude.split(",").map((s) => s.trim()).filter((s) => s.length > 0))
  : undefined;
const collapse: CollapseOpts | undefined =
  values["collapse-refs"] || values["collapse-collections"]
    ? { collapseRefs: values["collapse-refs"], collapseCollections: values["collapse-collections"] }
    : undefined;

const schemaArg = values.schema ?? adjacentSchema();
const netexLibrary = loadNetexLibrary(schemaArg);
let allPassed = true;
```

(The rest of the file — the `for (const name of TARGETS)` loop and `process.exit(...)` — stays unchanged.)

- [ ] **Step 4: Run tests to verify pass**

Run: `cd html-ts-gen && npx vitest run scripts/lib/__tests__/loader.test.ts`
Expected: all loader.test.ts tests PASS.

- [ ] **Step 5: Run the full vitest suite to confirm nothing else regressed**

Run: `cd html-ts-gen && npx vitest run`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add html-ts-gen/scripts/ts-gen.ts html-ts-gen/scripts/lib/__tests__/loader.test.ts
git commit -m "ts-gen: add --schema flag with adjacent-file auto-detect"
```

---

## Task 3: Create esbuild bundler script for ts-gen

**Files:**

- Create: `html-ts-gen/scripts/build-cli-bundle.ts`
- Test: `html-ts-gen/scripts/__tests__/cli-bundle.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `html-ts-gen/scripts/__tests__/cli-bundle.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd html-ts-gen && npx vitest run scripts/__tests__/cli-bundle.test.ts`
Expected: FAIL — `build-cli-bundle.ts` not found.

- [ ] **Step 3: Create the bundler**

Create `html-ts-gen/scripts/build-cli-bundle.ts`:

```ts
/** Bundle ts-gen.ts + lib/* + fast-xml-parser into a single .mjs CLI. */

import { build } from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    out: { type: "string", default: "dist/ts-gen.mjs" },
  },
});

const outFile = resolve(process.cwd(), values.out!);
mkdirSync(resolve(outFile, ".."), { recursive: true });

await build({
  entryPoints: [resolve(import.meta.dirname, "ts-gen.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: outFile,
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  minify: false,
  // fast-xml-parser is ESM/CJS hybrid — bundle it. Leave Node built-ins external (esbuild handles automatically).
});

chmodSync(outFile, 0o755);
console.log(`Bundled CLI → ${outFile}`);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd html-ts-gen && npx vitest run scripts/__tests__/cli-bundle.test.ts`
Expected: all four tests PASS.

- [ ] **Step 5: Smoke-test the bundle against a real schema**

Run:

```bash
cd /home/kdm/entur/netex-typescript-model
node html-ts-gen/dist/ts-gen.mjs --schema generated-src/base \
  --dest-dir /tmp/ts-gen-smoke --overwrite Vehicle
```

Expected stdout: `PASS /tmp/ts-gen-smoke/Vehicle.ts` and `PASS /tmp/ts-gen-smoke/Vehicle-mapping.ts`.

- [ ] **Step 6: Commit**

```bash
git add html-ts-gen/scripts/build-cli-bundle.ts html-ts-gen/scripts/__tests__/cli-bundle.test.ts
echo 'dist/' >> html-ts-gen/.gitignore
git add html-ts-gen/.gitignore
git commit -m "build: bundle ts-gen.ts as self-contained ts-gen.mjs"
```

---

## Task 4: Create package.json emitter for the tarball

**Files:**

- Create: `html-ts-gen/scripts/build-tarball-pkg-json.ts`

- [ ] **Step 1: Write the failing test**

Append to `html-ts-gen/scripts/__tests__/cli-bundle.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
```

(Add `afterAll` to the existing vitest import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd html-ts-gen && npx vitest run scripts/__tests__/cli-bundle.test.ts -t "build-tarball-pkg-json"`
Expected: FAIL — script not found.

- [ ] **Step 3: Create the emitter**

Create `html-ts-gen/scripts/build-tarball-pkg-json.ts`:

```ts
/** Emit a per-assembly package.json into a staging dir for tarball assembly. */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    assembly: { type: "string" },
    version: { type: "string" },
    "out-dir": { type: "string" },
  },
});

const assembly = values.assembly!;
const version = values.version!;
const outDir = values["out-dir"]!;

const slug = assembly.toLowerCase().replace(/[+@]/g, "-");

const pkg = {
  name: `@entur/netex-typescript-model-${slug}`,
  version,
  description: `NeTEx 2.0 JSON Schema and codegen CLI for assembly '${assembly}'`,
  type: "module",
  bin: { "netex-ts-gen": "./ts-gen.mjs" },
  files: ["ts-gen.mjs", "*.schema.json", "netex-schema.html", "README.md"],
  dependencies: { typescript: "^5.5" },
  engines: { node: ">=22" },
  repository: {
    type: "git",
    url: "git+https://github.com/entur/netex-typescript-model.git",
  },
  license: "EUPL-1.2",
};

writeFileSync(join(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`Wrote ${outDir}/package.json (${pkg.name}@${version})`);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd html-ts-gen && npx vitest run scripts/__tests__/cli-bundle.test.ts -t "build-tarball-pkg-json"`
Expected: both new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add html-ts-gen/scripts/build-tarball-pkg-json.ts html-ts-gen/scripts/__tests__/cli-bundle.test.ts
git commit -m "build: emit per-assembly package.json for tarball"
```

---

## Task 5: Add `cli-bundle` Makefile target

**Files:**

- Modify: `Makefile`

- [ ] **Step 1: Add the target**

Edit `Makefile`. Below the `# ── TypeScript interfaces ───` block (after the `interfaces/index.ts` rule), insert:

```make
# ── CLI bundle ────────────────────────────────────────────────────────────────

CLI_BUNDLE_SRCS := html-ts-gen/scripts/ts-gen.ts \
	$(wildcard html-ts-gen/scripts/lib/*.ts) \
	html-ts-gen/scripts/build-cli-bundle.ts

html-ts-gen/dist/ts-gen.mjs: $(CLI_BUNDLE_SRCS)
	npx --prefix html-ts-gen tsx html-ts-gen/scripts/build-cli-bundle.ts

cli-bundle: html-ts-gen/dist/ts-gen.mjs
```

Add `cli-bundle` to the `.PHONY` line at line 40:

```make
.PHONY: all schema types docs tarball clean clean_xsd cli-bundle
```

- [ ] **Step 2: Verify the target works**

Run:

```bash
cd /home/kdm/entur/netex-typescript-model
rm -f html-ts-gen/dist/ts-gen.mjs
make cli-bundle
ls -la html-ts-gen/dist/ts-gen.mjs
```

Expected: file exists and is executable.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "make: add cli-bundle target"
```

---

## Task 6: Rewrite `tarball` Makefile target as npm package

**Files:**

- Modify: `Makefile`

- [ ] **Step 1: Replace the tarball recipe**

Edit `Makefile`. Replace the `# ── Release tarball ─────` section (lines 87–100 currently) with:

```make
# ── Release tarball (npm-installable) ────────────────────────────────────────
# Stages files under package/ (npm convention) so `npm install <url>.tgz` works.

tarball: $(GEN)/$(TARBALL_NAME)

# Top-level dir inside the .tgz must be 'package' for npm install support.
TARBALL_STAGE = $(GEN)/$(TARBALL_PREFIX)

$(GEN)/$(TARBALL_NAME): $(GEN)/$(OUT_NAME)/$(OUT_NAME).schema.json \
                       $(GEN)/$(OUT_NAME)/netex-schema.html \
                       html-ts-gen/dist/ts-gen.mjs
	rm -rf $(TARBALL_STAGE)
	mkdir -p $(TARBALL_STAGE)/package
	cp $(GEN)/$(OUT_NAME)/$(OUT_NAME).schema.json $(TARBALL_STAGE)/package/
	cp $(GEN)/$(OUT_NAME)/netex-schema.html $(TARBALL_STAGE)/package/
	cp html-ts-gen/dist/ts-gen.mjs $(TARBALL_STAGE)/package/
	chmod +x $(TARBALL_STAGE)/package/ts-gen.mjs
	cp $(GEN)/$(OUT_NAME)/README.md $(TARBALL_STAGE)/package/ 2>/dev/null || true
	npx --prefix html-ts-gen tsx html-ts-gen/scripts/build-tarball-pkg-json.ts \
	    --assembly "$(OUT_NAME)" --version "$(VERSION)" --out-dir "$(TARBALL_STAGE)/package"
	tar -czf $@ -C $(TARBALL_STAGE) package
	rm -rf $(TARBALL_STAGE)
```

Key changes vs current:

- Drops `cp -r interfaces/` (legacy primitive-ts dump no longer in tarball).
- Adds `cli-bundle` and `package.json` emit as prerequisites.
- Top-level dir is `package/` (npm convention) instead of `$(TARBALL_PREFIX)/`.
- `$(TARBALL_PREFIX)` is repurposed as the staging dir name only — the prefix on the .tgz filename is unchanged.

- [ ] **Step 2: Build a tarball and inspect**

Run:

```bash
cd /home/kdm/entur/netex-typescript-model
make all tarball ASSEMBLY=base VERSION=0.0.0-dev
tar -tzf generated-src/netex-2.0-*-base-v0.0.0-dev.tgz
```

Expected output (order may vary):

```
package/
package/package.json
package/ts-gen.mjs
package/base.schema.json
package/netex-schema.html
package/README.md
```

No `interfaces/` directory.

- [ ] **Step 3: Confirm package.json is valid**

Run: `tar -xOzf generated-src/netex-2.0-*-base-v0.0.0-dev.tgz package/package.json | jq .name`
Expected: `"@entur/netex-typescript-model-base"`.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "tarball: ship as npm package, drop legacy interfaces, include ts-gen CLI"
```

---

## Task 7: End-to-end install test

**Files:**

- Create: `html-ts-gen/scripts/__tests__/tarball-install.test.ts`

- [ ] **Step 1: Write the test**

Create `html-ts-gen/scripts/__tests__/tarball-install.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
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

  it("does not include legacy interfaces/ directory", () => {
    const pkgDir = join(tmp, "node_modules", "@entur", "netex-typescript-model-base");
    expect(existsSync(join(pkgDir, "interfaces"))).toBe(false);
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd html-ts-gen && npx vitest run scripts/__tests__/tarball-install.test.ts`
Expected: all three tests PASS. (First run is slow — `make all` + `npm install` of typescript.)

- [ ] **Step 3: Commit**

```bash
git add html-ts-gen/scripts/__tests__/tarball-install.test.ts
git commit -m "test: tarball installs via npm and exposes netex-ts-gen"
```

---

## Task 8: Update tarball README content

**Files:**

- Modify: the README that gets copied into the tarball. Currently `Makefile` does `cp $(GEN)/$(OUT_NAME)/README.md $(TARBALL_STAGE)/package/ 2>/dev/null || true`. The source README lives at `$(GEN)/$(OUT_NAME)/README.md` — written by `primitive-ts-gen.ts`. Since we are dropping the primitive flow from the tarball, we need a different source for this README.

- [ ] **Step 1: Decide source**

Switch the tarball README source from the per-assembly generated one to a templated one written by `build-tarball-pkg-json.ts`. (Keep the generator script focused: rename to `build-tarball-meta.ts` to reflect that it now emits both `package.json` and `README.md`.)

- [ ] **Step 2: Extend the meta script**

Modify `html-ts-gen/scripts/build-tarball-pkg-json.ts` to also emit `README.md`:

```ts
const readme = `# @entur/netex-typescript-model-${slug}

NeTEx 2.0 JSON Schema (assembly: \`${assembly}\`) plus a self-contained codegen CLI.

## Install

\`\`\`bash
npm install https://github.com/entur/netex-typescript-model/releases/download/v${version}/netex-2.0-next-${assembly}-v${version}.tgz
\`\`\`

## Use the CLI

\`\`\`bash
# Generate Vehicle.ts and Vehicle-mapping.ts from the bundled schema:
npx netex-ts-gen --dest-dir ./gen --overwrite Vehicle

# Collapse refs and one-child collections (recommended for ergonomic types):
npx netex-ts-gen --collapse-refs --collapse-collections \\\\
    --dest-dir ./gen --overwrite VehicleType DeckPlan

# Use a different schema (e.g. another assembly's tarball):
npx netex-ts-gen --schema ./other.schema.json --dest-dir ./gen Vehicle
\`\`\`

## Use the JSON Schema directly

\`${assembly}.schema.json\` is the standard JSON Schema (Draft 07) for this assembly.
Open \`netex-schema.html\` in a browser for the offline schema explorer.

## License

EUPL-1.2.
`;

writeFileSync(join(outDir, "README.md"), readme);
```

(Place after the existing `writeFileSync` for `package.json`.)

- [ ] **Step 3: Drop the old README copy from the Makefile**

In `Makefile`, remove this line from the `tarball` recipe:

```make
	cp $(GEN)/$(OUT_NAME)/README.md $(TARBALL_STAGE)/package/ 2>/dev/null || true
```

(The meta script now writes README.md directly into the staging dir.)

- [ ] **Step 4: Verify**

Run:

```bash
make tarball ASSEMBLY=base VERSION=0.0.0-dev
tar -xOzf generated-src/netex-2.0-*-base-v0.0.0-dev.tgz package/README.md | head -20
```

Expected: README starts with `# @entur/netex-typescript-model-base`.

- [ ] **Step 5: Commit**

```bash
git add html-ts-gen/scripts/build-tarball-pkg-json.ts Makefile
git commit -m "tarball: emit README via meta script, drop legacy README path"
```

---

## Task 9: Update release workflow smoke test

**Files:**

- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Replace the dev smoke test with an install-from-tarball smoke test**

In `.github/workflows/release.yml`, find the `test:` job's last step:

```yaml
      - name: Run ts-gen type-check
        working-directory: html-ts-gen
        run: npx tsx scripts/ts-gen.ts VehicleType Vehicle DeckPlan
```

Replace with:

```yaml
      - uses: actions/download-artifact@v4
        with:
          name: tarball-base
          path: tarballs/

      - name: Install tarball as npm package and run netex-ts-gen
        run: |
          mkdir tarball-test && cd tarball-test
          npm init -y
          npm install ../tarballs/netex-*-base-*.tgz
          mkdir gen
          npx netex-ts-gen --dest-dir ./gen --overwrite VehicleType Vehicle DeckPlan
          ls gen/
          test -f gen/Vehicle.ts
          test -f gen/Vehicle-mapping.ts
```

- [ ] **Step 2: Verify locally with `act` if available, else trust the manual run**

Run (optional, if `act` is installed):

```bash
act push -j test --secret-file /dev/null
```

Otherwise: manually test the equivalent commands locally with the artifact path replaced by `generated-src/netex-*-base-*.tgz`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): smoke-test tarball via npm install + netex-ts-gen"
```

---

## Task 10: Update CLAUDE.md and docs/npm-publishing.md

**Files:**

- Modify: `CLAUDE.md` (project root)
- Modify: `docs/npm-publishing.md`

- [ ] **Step 1: Update the Release Pipeline section in CLAUDE.md**

Find the "Release Pipeline" subsection (search for `### Release Pipeline`). Replace its body with:

```markdown
Triggered by pushing a `v*` tag. Builds each assembly via `make all tarball`, runs the suite, and creates a GitHub Release with `.tgz` tarballs attached. Each tarball is a valid npm package: top-level `package/` dir, per-assembly `name: @entur/netex-typescript-model-<slug>` in `package.json`, with `bin: { "netex-ts-gen": "./ts-gen.mjs" }` exposing the bundled CLI. Clients install with `npm install <github-release-url>.tgz` and run `npx netex-ts-gen ...`. Tarball naming: `netex-<netex_version>-<branch>-<assembly>-v<tag>.tgz`. The `VERSION` variable is extracted from the tag by stripping the `v` prefix.
```

Also update the "Gitignored Artifacts" list — add `html-ts-gen/dist/`.

- [ ] **Step 2: Add a section to docs/npm-publishing.md**

Append to `docs/npm-publishing.md`:

```markdown
## Distributing via GitHub Releases (.tgz)

Independent of npmjs.com publishing, every tagged release attaches per-assembly tarballs as GitHub Release assets. Each tarball is a self-contained npm package — no separate publish step is required.

```bash
# Install the base assembly directly from a release:
npm install https://github.com/entur/netex-typescript-model/releases/download/v2.0.0/netex-2.0-next-base-v2.0.0.tgz

# Generate types from the bundled CLI:
npx netex-ts-gen --collapse-refs --collapse-collections --dest-dir ./gen Vehicle
```

The tarball ships:

- `<assembly>.schema.json` — the JSON Schema artifact
- `ts-gen.mjs` — the bundled CLI (esbuild bundle of `html-ts-gen/scripts/ts-gen.ts` + `fast-xml-parser`)
- `netex-schema.html` — offline schema viewer
- `package.json` — per-assembly name, with `typescript` as a runtime dependency
- `README.md` — usage instructions

Use this distribution channel for one-off integration projects or when private registry access isn't available.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/npm-publishing.md
git commit -m "docs: describe tarball-as-npm-package distribution"
```

---

## Verification

End-to-end checks after all tasks land:

1. **Tarball shape:**
   ```bash
   make all tarball ASSEMBLY=base VERSION=9.9.9
   tar -tzf generated-src/netex-*-base-v9.9.9.tgz
   ```
   Expected: only `package/` + 5 files inside (`package.json`, `ts-gen.mjs`, `base.schema.json`, `netex-schema.html`, `README.md`). No `interfaces/`.

2. **npm install works:**
   ```bash
   mkdir -p /tmp/install-check && cd /tmp/install-check
   npm init -y
   npm install /home/kdm/entur/netex-typescript-model/generated-src/netex-*-base-v9.9.9.tgz
   ls node_modules/@entur/netex-typescript-model-base/
   npx netex-ts-gen --dest-dir . --overwrite Vehicle
   ls Vehicle.ts Vehicle-mapping.ts
   ```
   Expected: install succeeds, CLI runs, both files appear and type-check.

3. **All vitest suites pass:**
   ```bash
   cd html-ts-gen && npx vitest run
   ```

4. **Existing dev workflow unchanged:**
   ```bash
   cd /home/kdm/entur/netex-typescript-model
   npx --prefix html-ts-gen tsx html-ts-gen/scripts/ts-gen.ts Vehicle
   ```
   Expected: still works (loader's default kicks in, no `--schema` needed).

---

## Self-Review

**Spec coverage:**

- "Keep PART.schema.json" → Task 6 keeps `cp $(GEN)/$(OUT_NAME)/$(OUT_NAME).schema.json`. ✅
- "Legacy/primitive .ts dump removed from tarball" → Task 6 drops `cp -r interfaces/`. ✅
- "Package ts-gen.ts as a self-contained runnable" → Tasks 3 (esbuild bundle) + 6 (placed in tarball). ✅
- "New Makefile target" → Tasks 5 (`cli-bundle`) + 6 (`tarball` rewritten). ✅
- "npm install from gh .tgz url" → Task 4 (package.json) + Task 6 (`package/` top-level dir) + Task 7 (verifies it works). ✅
- "OR a curl one-liner" → noted as inferior fallback in README; the npm install path is the documented happy path. The .mjs file is also runnable directly via `node ts-gen.mjs` after `tar xzf`, so a curl one-liner is possible — covered indirectly.

**Placeholder scan:** No "TBD", "TODO", "fill in", or "similar to Task N" — all code is shown inline. Check passed.

**Type/name consistency:**

- `loadNetexLibrary(dir?: string)` — used consistently across loader.ts (Task 1) and ts-gen.ts (Task 2).
- `--schema` flag name — consistent in Task 2 + Task 7 + README (Task 8).
- Slug rule (`+` and `@` → `-`, lowercase) — defined in Task 4, asserted in Task 4 tests, surfaced in Task 8 README and Task 10 docs.
- `bin` name `netex-ts-gen` — consistent across Task 4, Task 7, Task 8, Task 9, Task 10.
- `dist/ts-gen.mjs` path — consistent across Task 3, Task 5, Task 6.

No issues found.
