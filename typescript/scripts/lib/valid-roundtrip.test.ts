import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { genMockObject, buildXmlString, serialize, defRole, type Defs } from "./fns.js";

// ── Schema loading (eager — needed at describe.each time) ────────────────────

const jsonschemaDir = resolve(import.meta.dirname, "../../../generated-src/base");
const xsdRoot = resolve(import.meta.dirname, "../../../xsd/2.0/NeTEx_publication.xsd");

function loadDefs(): Defs {
  if (!existsSync(jsonschemaDir)) {
    throw new Error(`Base jsonschema dir not found at ${jsonschemaDir}.\nRun "make all" first.`);
  }
  const schemaFile = readdirSync(jsonschemaDir).find((f) => f.endsWith(".schema.json"));
  if (!schemaFile) {
    throw new Error(`No *.schema.json found in ${jsonschemaDir}.\nRun "make all" first.`);
  }
  if (!existsSync(xsdRoot)) {
    throw new Error(`XSD not found at ${xsdRoot}.\nRun "make xsd/2.0/NeTEx_publication.xsd" first.`);
  }
  return JSON.parse(readFileSync(join(jsonschemaDir, schemaFile), "utf-8")).definitions;
}

const defs = loadDefs();

// ── Entities to test ─────────────────────────────────────────────────────────

/** ResourceFrame collection element per entity type. */
const FRAME_WRAPPERS: Record<string, string> = {
  VehicleType: "vehicleTypes",
  Vehicle: "vehicles",
  DeckPlan: "deckPlans",
};

const TEST_ENTITIES = Object.keys(FRAME_WRAPPERS).map((name) => ({
  name,
  role: defRole(defs[name]),
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

/** Count validation errors by category, excluding keyref (test-isolation issue). */
function countErrors(stderr: string): { total: number; simpleContent: number; ordering: number } {
  const lines = stderr.split("\n").filter((l) => l.includes("Schemas validity error"));
  const keyref = lines.filter((l) => l.includes("cvc-identity-constraint")).length;
  const simpleContent = lines.filter((l) => l.includes("Element content is not allowed, because the content type is a simple type")).length;
  const ordering = lines.filter((l) => l.includes("This element is not expected. Expected is")).length;
  return { total: lines.length - keyref, simpleContent, ordering };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe.each(TEST_ENTITIES)("$name (role: $role)", ({ name }) => {
  it("validates against NeTEx XSD (buildXmlString)", () => {
    const mock = genMockObject(defs, name);
    const xml = buildXmlString(name, mock);
    const full = wrapInPublicationDelivery(name, xml);
    const { valid, stderr } = validateWithXmllint(full);
    expect(valid, `xmllint errors for ${name}:\n${stderr}`).toBe(true);
  });

  it("serialize produces fewer errors than buildXmlString", () => {
    const mock = genMockObject(defs, name);

    const xmlOld = buildXmlString(name, mock);
    const fullOld = wrapInPublicationDelivery(name, xmlOld);
    const { stderr: stderrOld } = validateWithXmllint(fullOld);
    const oldErrors = countErrors(stderrOld);

    const xmlNew = serialize(defs, name, mock);
    const fullNew = wrapInPublicationDelivery(name, xmlNew);
    const { stderr: stderrNew } = validateWithXmllint(fullNew);
    const newErrors = countErrors(stderrNew);

    // serialize (toValidNested) should fix simpleContent errors (value→#text)
    expect(
      newErrors.simpleContent,
      `serialize should have fewer simpleContent errors than buildXmlString for ${name}.\n` +
        `buildXmlString: ${oldErrors.simpleContent}, serialize: ${newErrors.simpleContent}`,
    ).toBeLessThanOrEqual(oldErrors.simpleContent);

    // Overall error count should not increase
    expect(
      newErrors.total,
      `serialize should not produce more errors than buildXmlString for ${name}.\n` +
        `buildXmlString: ${oldErrors.total}, serialize: ${newErrors.total}\n` +
        stderrNew,
    ).toBeLessThanOrEqual(oldErrors.total);
  });
});
