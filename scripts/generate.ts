/**
 * Generates TypeScript interfaces and Zod schemas from downloaded NeTEx XSDs.
 * Only processes the parts enabled in inputs/config.json.
 *
 * Usage: npx tsx scripts/generate.ts [--part <key>]
 *
 * Options:
 *   --part <key>  Enable one additional non-required part for this run
 *                 (e.g. --part part1_network). Does not modify config.json.
 *
 * Pipeline:
 *   1. Collect XSD files from enabled parts + root XSDs
 *   2. Run cxsd to produce TypeScript interfaces
 *   3. Run ts-to-zod to produce Zod schemas from those interfaces
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

interface PartConfig {
  enabled: boolean;
  required?: boolean;
  dirs: string[];
  description: string;
}

interface RootXsdConfig {
  enabled: boolean;
  required?: boolean;
  file: string;
  description: string;
}

// Hardwired required parts/rootXsds — NeTEx 2.0 structural assumptions.
// These are always enabled regardless of what config.json says.
const REQUIRED_PARTS = ["framework", "gml"] as const;
const REQUIRED_ROOT_XSDS = ["publication"] as const;

class Config {
  readonly netexVersion: string;
  readonly xsdRoot: string;
  readonly generatedInterfaces: string;
  readonly generatedZod: string;
  readonly parts: Record<string, PartConfig>;
  readonly rootXsds: Record<string, RootXsdConfig>;

  constructor(configPath: string) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const root = resolve(configPath, "../..");

    this.netexVersion = raw.netex.version;
    this.xsdRoot = resolve(root, raw.paths.xsdRoot, this.netexVersion);
    this.generatedInterfaces = raw.paths.generatedInterfaces;
    this.generatedZod = raw.paths.generatedZod;
    this.parts = raw.parts;
    this.rootXsds = raw.rootXsds;

    this.enforceRequiredParts();
  }

  private enforceRequiredParts(): void {
    for (const key of REQUIRED_PARTS) {
      const part = this.parts[key];
      if (!part) {
        console.warn(
          `WARNING: required part '${key}' missing from config.json — generation may fail`,
        );
        continue;
      }
      if (!part.enabled || !part.required) {
        console.warn(
          `WARNING: required part '${key}' was disabled or unmarked in config.json — forcing enabled`,
        );
        part.enabled = true;
        part.required = true;
      }
    }
    for (const key of REQUIRED_ROOT_XSDS) {
      const xsd = this.rootXsds[key];
      if (!xsd) {
        console.warn(
          `WARNING: required root XSD '${key}' missing from config.json — generation may fail`,
        );
        continue;
      }
      if (!xsd.enabled || !xsd.required) {
        console.warn(
          `WARNING: required root XSD '${key}' was disabled or unmarked in config.json — forcing enabled`,
        );
        xsd.enabled = true;
        xsd.required = true;
      }
    }
  }

  applyCliPart(cliPart: string): void {
    const part = this.parts[cliPart];
    if (!part || cliPart.startsWith("_")) {
      const optional = Object.keys(this.parts).filter(
        (k) => !k.startsWith("_") && !this.parts[k].required,
      );
      console.error(`Unknown part: ${cliPart}`);
      console.error(`Available optional parts: ${optional.join(", ")}`);
      process.exit(1);
    }
    if (part.required) {
      console.error(`Part '${cliPart}' is already required and always enabled.`);
      process.exit(1);
    }
    part.enabled = true;
  }

  enabledDirs(): string[] {
    return Object.entries(this.parts)
      .filter(([k, p]) => !k.startsWith("_") && p.enabled)
      .flatMap(([, p]) => p.dirs);
  }

  enabledRootXsdFiles(): string[] {
    return Object.entries(this.rootXsds)
      .filter(([k, x]) => !k.startsWith("_") && x.enabled)
      .map(([, x]) => x.file);
  }

  printParts(): void {
    console.log("Parts:");
    for (const [key, part] of Object.entries(this.parts)) {
      if (key.startsWith("_")) continue;
      const status = part.enabled ? "enabled" : "disabled";
      const tag = part.required ? " (required)" : "";
      console.log(`  ${key}: ${status}${tag}`);
    }
  }

  printRootXsds(): void {
    console.log("\nRoot XSDs:");
    for (const [key, xsd] of Object.entries(this.rootXsds)) {
      if (key.startsWith("_")) continue;
      const status = xsd.enabled ? "enabled" : "disabled";
      const tag = xsd.required ? " (required)" : "";
      console.log(`  ${xsd.file}: ${status}${tag}`);
    }
  }

  printSubsetSummary(): void {
    const enabledDirs = this.enabledDirs();
    const enabledRootXsds = this.enabledRootXsdFiles();

    console.log("\nIncluded XSD directories:");

    let totalFiles = 0;
    for (const dir of enabledDirs) {
      const fullPath = resolve(this.xsdRoot, dir);
      try {
        const n = countXsdFiles(fullPath);
        totalFiles += n;
        console.log(`  ${dir}/  (${n} XSD files)`);
      } catch {
        console.log(`  ${dir}/  (not found — run 'npm run download' first)`);
      }
    }

    for (const xsd of enabledRootXsds) {
      const file = resolve(this.xsdRoot, xsd);
      try {
        statSync(file);
        totalFiles++;
        console.log(`  ${xsd}`);
      } catch {
        console.log(`  ${xsd}  (not found)`);
      }
    }

    console.log(`\nTotal XSD files in subset: ${totalFiles}`);
  }
}

function parseCliPart(): string | undefined {
  const i = process.argv.indexOf("--part");
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function countXsdFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countXsdFiles(full);
    } else if (entry.name.endsWith(".xsd")) {
      count++;
    }
  }
  return count;
}

// ###################################
//
//            --- main ---
//
// ###################################

const ROOT = resolve(import.meta.dirname, "..");
const config = new Config(resolve(ROOT, "inputs/config.json"));

const cliPart = parseCliPart();
if (cliPart) config.applyCliPart(cliPart);

console.log("=== NeTEx TypeScript Model Generator ===\n");
console.log(`XSD root: ${config.xsdRoot}`);
console.log(`NeTEx version: ${config.netexVersion}\n`);

config.printParts();
config.printRootXsds();
config.printSubsetSummary();

// TODO: Step 2 — invoke cxsd on the subset
console.log("\n[stub] cxsd generation not yet wired up");
console.log(`  Would output to: ${config.generatedInterfaces}/`);

// TODO: Step 3 — invoke ts-to-zod on generated interfaces
console.log("\n[stub] ts-to-zod generation not yet wired up");
console.log(`  Would output to: ${config.generatedZod}/`);
