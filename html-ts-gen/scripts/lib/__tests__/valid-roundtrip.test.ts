import { describe, it, expect, beforeAll } from "vitest";
import { defRole } from "../classify.js";
import { fake, serialize } from "../data-faker.js";
import {
  loadNetexLibrary,
  requireXsd,
  warmupXmllint,
  CORE,
  EXTENSIVE,
  wrapInPublicationDelivery,
  validateWithXmllint,
  nonKeyrefErrors,
} from "./test-helpers.js";

requireXsd();

const netexLibrary = loadNetexLibrary();

const extensive = process.env.ROUNDTRIP_EXTENSIVE === "1";
const TEST_ENTITIES = (extensive ? EXTENSIVE : CORE)
  .filter((e) => !!netexLibrary[e.name])
  .map((e) => ({ ...e, role: defRole(netexLibrary[e.name]) }));

// Pay xmllint cold-start cost once instead of in the first real test.
beforeAll(() => warmupXmllint(), 60_000);

// ── Tests ────────────────────────────────────────────────────────────────────

describe.each(TEST_ENTITIES)("$name (role: $role)", (entity) => {
  it("validates against NeTEx XSD (ignoring keyref)", { timeout: 60_000 }, () => {
    const mock = fake(netexLibrary, entity.name);
    const xml = serialize(netexLibrary, entity.name, mock);
    const full = wrapInPublicationDelivery(entity, xml);
    const { valid, stderr } = validateWithXmllint(full);
    if (valid) return;
    expect(stderr, `xmllint failed for ${entity.name} with unexpected output`).toContain("validity");
    const errors = nonKeyrefErrors(stderr);
    expect(errors, `xmllint errors for ${entity.name}:\n${errors.join("\n")}`).toEqual([]);
  });
});
