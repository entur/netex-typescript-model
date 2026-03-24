import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { defRole } from "../classify.js";
import { fake, serialize } from "../data-faker.js";
import { loadNetexLibrary } from "./test-helpers.js";

const xsdRoot = resolve(import.meta.dirname, "../../../../xsd/2.0/NeTEx_publication.xsd");

if (!existsSync(xsdRoot)) {
  throw new Error(`XSD not found at ${xsdRoot}.\nRun "make xsd/2.0/NeTEx_publication.xsd" first.`);
}

const netexLibrary = loadNetexLibrary();

// ── Entities to test ─────────────────────────────────────────────────────────

/** ResourceFrame collection element per entity type.
 *  Subset chosen for structural diversity — deep inheritance, flat, nested,
 *  collection, and multi-domain — while keeping xmllint runtime reasonable. */
const FRAME_WRAPPERS: Record<string, string> = {
  VehicleType: "vehicleTypes",
  Contact: "contacts",
  DeckPlan: "deckPlans",
  ResponsibilitySet: "responsibilitySets",
  GroupOfOperators: "groupsOfOperators",
};

const TEST_ENTITIES = Object.keys(FRAME_WRAPPERS).map((name) => ({
  name,
  role: defRole(netexLibrary[name]),
  wrapper: FRAME_WRAPPERS[name],
}));

// ── PublicationDelivery wrapper ──────────────────────────────────────────────

function wrapInPublicationDelivery(entityName: string, entityXml: string): string {
  const wrapper = FRAME_WRAPPERS[entityName];
  if (!wrapper) throw new Error(`No frame wrapper for entity: ${entityName}`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<PublicationDelivery xmlns="http://www.netex.org.uk/netex"',
    '    xmlns:gml="http://www.opengis.net/gml/3.2"',
    '    xmlns:siri="http://www.siri.org.uk/siri"',
    '    version="1.0">',
    "  <PublicationTimestamp>2025-01-01T00:00:00</PublicationTimestamp>",
    "  <ParticipantRef>ENT</ParticipantRef>",
    "  <dataObjects>",
    '    <ResourceFrame id="RF:1" version="1">',
    `      <${wrapper}>`,
    entityXml,
    `      </${wrapper}>`,
    "    </ResourceFrame>",
    "  </dataObjects>",
    "</PublicationDelivery>",
  ].join("\n");
}

// ── xmllint helper ───────────────────────────────────────────────────────────

function validateWithXmllint(xml: string): { valid: boolean; stderr: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), "netex-xsd-"));
  const tmpFile = join(tmpDir, "test.xml");
  try {
    writeFileSync(tmpFile, xml, "utf-8");
    execSync(`xmllint --schema "${xsdRoot}" --noout "${tmpFile}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { valid: true, stderr: "" };
  } catch (err: unknown) {
    const e = err as { stderr?: string };
    return { valid: false, stderr: e.stderr ?? String(err) };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Error filtering ──────────────────────────────────────────────────────────

/**
 * Filter xmllint stderr to non-keyref errors.
 *
 * Keyref errors (`cvc-identity-constraint`) are test-isolation artifacts —
 * referenced entities (Branding, VehicleModel, etc.) aren't in the single-entity
 * test document. These are not generation bugs.
 */
function nonKeyrefErrors(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter((l) => l.includes("Schemas validity error"))
    .filter((l) => !l.includes("key-sequence"));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe.each(TEST_ENTITIES)("$name (role: $role)", ({ name }) => {
  it("validates against NeTEx XSD (ignoring keyref)", { timeout: 30_000 }, () => {
    const mock = fake(netexLibrary, name);
    const xml = serialize(netexLibrary, name, mock);
    const full = wrapInPublicationDelivery(name, xml);
    const { stderr } = validateWithXmllint(full);
    const errors = nonKeyrefErrors(stderr);
    expect(errors, `xmllint errors for ${name}:\n${errors.join("\n")}`).toEqual([]);
  });
});
