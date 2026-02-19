/**
 * Downloads NeTEx XSD schemas from GitHub.
 * All configuration read from inputs/config.json.
 *
 * Usage: npx tsx scripts/download.ts
 */

import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(resolve(ROOT, "inputs/config.json"), "utf-8"));

const { version, branch, repoName, githubUrl } = config.netex;
const dest = resolve(ROOT, config.paths.xsdRoot, version);
const zipUrl = `${githubUrl}/archive/refs/heads/${branch}.zip`;
const zipPath = resolve(ROOT, `NeTEx-${branch}.zip`);
const zipPrefix = `${repoName}-${branch}/xsd/`;

// --- Step 1: Download ZIP (cached) ---

async function downloadZip(): Promise<Buffer> {
  if (existsSync(zipPath)) {
    console.log(`Using cached ${zipPath}`);
    return readFileSync(zipPath);
  }
  console.log(`Downloading ${zipUrl}`);
  const res = await fetch(zipUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(zipPath, buf);
  console.log(`Saved ${(buf.length / 1024 / 1024).toFixed(1)}MB to ${zipPath}`);
  return buf;
}

// --- Step 2: Extract xsd/ from ZIP ---

function extractXsd(zipBuf: Buffer): void {
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true });
  }
  mkdirSync(dest, { recursive: true });

  const zip = new AdmZip(zipBuf);
  let extracted = 0;
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith(zipPrefix) || entry.isDirectory) continue;
    const relPath = entry.entryName.slice(zipPrefix.length);
    const outPath = join(dest, relPath);
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, entry.getData());
    extracted++;
  }
  console.log(`Extracted ${extracted} files to ${dest}`);
}

// --- Run ---

const zipBuf = await downloadZip();
extractXsd(zipBuf);
console.log(`\nXSDs ready at ${dest}`);
