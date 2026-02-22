/**
 * Shared configuration for the NeTEx TypeScript generation pipeline.
 *
 * Extracted from generate.ts so that xsd-to-jsonschema-1st-try.ts and other scripts
 * can reuse Config, part definitions, and assembly resolution without pulling in
 * the full generation pipeline.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

export interface PartConfig {
  enabled?: boolean;
  required?: boolean;
  dirs: string[];
  description: string;
}

export interface RootXsdConfig {
  enabled?: boolean;
  required?: boolean;
  file: string;
  description: string;
}

// Hardwired required parts/rootXsds — NeTEx 2.0 structural assumptions.
// These are always enabled regardless of what config.json says.
export const REQUIRED_PARTS = ["framework", "gml", "siri", "service"] as const;
export const REQUIRED_ROOT_XSDS = ["publication"] as const;

/** Short filesystem-friendly names for optional parts. */
export const NATURAL_NAMES: Record<string, string> = {
  part1_network: "network",
  part2_timetable: "timetable",
  part3_fares: "fares",
  part5_new_modes: "new-modes",
};

/**
 * Resolve an assembly name from enabled optional parts.
 * Required parts are always present and don't differentiate the output.
 * Falls back to stripping `partN_` prefix if no natural name is defined.
 */
export function resolveAssembly(parts: Record<string, PartConfig>): string {
  const enabled = Object.entries(parts)
    .filter(([k, p]) => !k.startsWith("_") && !p.required && p.enabled)
    .map(([k]) => NATURAL_NAMES[k] ?? k.replace(/^part\d+_/, "").replace(/_/g, "-"))
    .sort();

  return enabled.length === 0 ? "base" : enabled.join("+");
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

export class Config {
  readonly netexVersion: string;
  readonly xsdRoot: string;
  readonly generatedBase: string;
  readonly parts: Record<string, PartConfig>;
  readonly rootXsds: Record<string, RootXsdConfig>;

  constructor(configPath: string) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const configDir = dirname(configPath);

    this.netexVersion = raw.netex.version;
    this.xsdRoot = resolve(configDir, raw.paths.xsdRoot, this.netexVersion);
    this.generatedBase = resolve(configDir, raw.paths.generated);
    this.parts = raw.parts;
    this.rootXsds = raw.rootXsds;

    this.enforceRequiredParts();
  }

  get assembly(): string {
    return resolveAssembly(this.parts);
  }

  private enforceRequiredParts(): void {
    // required implies enabled — set both unconditionally
    for (const key of REQUIRED_PARTS) {
      const part = this.parts[key];
      if (!part) {
        console.warn(
          `WARNING: required part '${key}' missing from config.json — generation may fail`,
        );
        continue;
      }
      if (part.enabled === false) {
        console.warn(
          `WARNING: required part '${key}' was explicitly disabled in config.json — forcing enabled`,
        );
      }
      part.required = true;
      part.enabled = true;
    }
    for (const key of REQUIRED_ROOT_XSDS) {
      const xsd = this.rootXsds[key];
      if (!xsd) {
        console.warn(
          `WARNING: required root XSD '${key}' missing from config.json — generation may fail`,
        );
        continue;
      }
      if (xsd.enabled === false) {
        console.warn(
          `WARNING: required root XSD '${key}' was explicitly disabled in config.json — forcing enabled`,
        );
      }
      xsd.required = true;
      xsd.enabled = true;
    }
  }

  applyCliParts(cliParts: string[]): void {
    for (const cliPart of cliParts) {
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

  /** Returns true if a source file path belongs to an enabled part or root XSD. */
  isEnabledPath(sourceFile: string): boolean {
    const enabledDirs = this.enabledDirs();
    for (const dir of enabledDirs) {
      if (sourceFile.startsWith(dir + "/") || sourceFile.startsWith(dir + "\\")) {
        return true;
      }
    }
    // Root-level XSD files
    for (const xsd of this.enabledRootXsdFiles()) {
      if (sourceFile === xsd) return true;
    }
    return false;
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
        console.log(`  ${dir}/  (not found — run 'cd ../json-schema && mvn initialize' to download XSDs)`);
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
