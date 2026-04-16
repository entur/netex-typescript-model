import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

export { loadNetexLibrary } from "../loader.js";

// ── XSD path ─────────────────────────────────────────────────────────────────

export const xsdRoot = resolve(import.meta.dirname, "../../../../xsd/2.0/NeTEx_publication.xsd");

export function requireXsd(): void {
  if (!existsSync(xsdRoot)) {
    throw new Error(`XSD not found at ${xsdRoot}.\nRun "make xsd/2.0/NeTEx_publication.xsd" first.`);
  }
}

// ── Entity definitions ───────────────────────────────────────────────────────

export interface TestEntity {
  name: string;
  wrapper: string;
  frame: string;
  frameId: string;
}

export const CORE: TestEntity[] = [
  { name: "VehicleType", wrapper: "vehicleTypes", frame: "ResourceFrame", frameId: "RF:1" },
  { name: "Vehicle", wrapper: "vehicles", frame: "ResourceFrame", frameId: "RF:1" },
  { name: "Contact", wrapper: "contacts", frame: "ResourceFrame", frameId: "RF:1" },
  { name: "DeckPlan", wrapper: "deckPlans", frame: "ResourceFrame", frameId: "RF:1" },
  { name: "ResponsibilitySet", wrapper: "responsibilitySets", frame: "ResourceFrame", frameId: "RF:1" },
  { name: "GroupOfOperators", wrapper: "groupsOfOperators", frame: "ResourceFrame", frameId: "RF:1" },
];

export const EXTENSIVE: TestEntity[] = [
  ...CORE,
  // Authority/Operator fail: TimeZoneOffset needs number, CountryRef needs 2-char ISO, element ordering
  // DayType fails: DayLength needs xs:duration format
  // DayTypeAssignment fails: order needs positiveInteger, nameOfRefClass wrong enum
  { name: "OperatingPeriod", wrapper: "operatingPeriods", frame: "ServiceCalendarFrame", frameId: "SCF:1" },
];

// ── PublicationDelivery wrapper ──────────────────────────────────────────────

export function wrapInPublicationDelivery(entity: TestEntity, entityXml: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<PublicationDelivery xmlns="http://www.netex.org.uk/netex"',
    '    xmlns:gml="http://www.opengis.net/gml/3.2"',
    '    xmlns:siri="http://www.siri.org.uk/siri"',
    '    version="1.0">',
    "  <PublicationTimestamp>2025-01-01T00:00:00</PublicationTimestamp>",
    "  <ParticipantRef>ENT</ParticipantRef>",
    "  <dataObjects>",
    `    <${entity.frame} id="${entity.frameId}" version="1">`,
    `      <${entity.wrapper}>`,
    entityXml,
    `      </${entity.wrapper}>`,
    `    </${entity.frame}>`,
    "  </dataObjects>",
    "</PublicationDelivery>",
  ].join("\n");
}

// ── xmllint helper ───────────────────────────────────────────────────────────

export function validateWithXmllint(xml: string): { valid: boolean; stderr: string } {
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

/**
 * Filter xmllint stderr to non-keyref errors.
 *
 * Keyref errors are test-isolation artifacts — referenced entities
 * aren't in the single-entity test document.
 */
export function nonKeyrefErrors(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter((l) => l.includes("Schemas validity error"))
    .filter((l) => !l.includes("key-sequence"));
}
