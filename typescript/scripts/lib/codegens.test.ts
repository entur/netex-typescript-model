import { describe, it, expect } from "vitest";
import {
  generateInterface,
  generateTypeAlias,
  generateTypeGuard,
  generateFactory,
  toConstName,
} from "./codegens.js";
import type { Defs } from "./fns.js";

// ── toConstName ─────────────────────────────────────────────────────────────

describe("toConstName", () => {
  it("converts PascalCase to UPPER_SNAKE", () => {
    expect(toConstName("AllModesEnumeration")).toBe("ALL_MODES");
  });

  it("handles consecutive uppercase", () => {
    expect(toConstName("HTTPMethod")).toBe("HTTP_METHOD");
  });

  it("strips Enumeration suffix", () => {
    expect(toConstName("VehicleTypeEnumeration")).toBe("VEHICLE_TYPE");
  });

  it("handles name without Enumeration", () => {
    expect(toConstName("TransportMode")).toBe("TRANSPORT_MODE");
  });
});

// ── Shared test defs ────────────────────────────────────────────────────────

const defs: Defs = {
  Authority: {
    allOf: [
      { $ref: "#/definitions/OrganisationStructure" },
      {
        properties: {
          AuthorityCode: { type: "string", description: "Code for authority" },
        },
      },
    ],
    "x-netex-role": "entity",
  },
  OrganisationStructure: {
    properties: {
      Name: { type: "string", description: "Name of organisation" },
      Description: { type: "string", description: "Description" },
    },
    "x-netex-role": "structure",
  },
  AllModesEnumeration: {
    enum: ["bus", "rail", "tram"],
    "x-netex-role": "enumeration",
  },
  PrivateCode: {
    $ref: "#/definitions/PrivateCodeStructure",
  },
  PrivateCodeStructure: {
    properties: {
      value: { type: "string", xml: { attribute: false } },
    },
    "x-netex-atom": "string",
  },
  VehicleRef: {
    allOf: [{ $ref: "#/definitions/VersionOfObjectRefStructure" }],
    "x-netex-role": "reference",
  },
  VersionOfObjectRefStructure: {
    properties: {
      ref: { type: "string", xml: { attribute: true } },
      version: { type: "string", xml: { attribute: true } },
    },
    "x-netex-role": "structure",
  },
  RequiredEntity: {
    properties: {
      Id: { type: "string" },
      Name: { type: "string" },
    },
    required: ["Id"],
    "x-netex-role": "entity",
  },
  EmptyWrapper: {
    allOf: [{ $ref: "#/definitions/AllModesEnumeration" }],
  },
  ComplexChild: {
    allOf: [
      { $ref: "#/definitions/OrganisationStructure" },
      {
        properties: {
          Extra: { type: "integer", description: "Extra field" },
        },
      },
    ],
    "x-netex-role": "structure",
  },
  WithArrayProp: {
    properties: {
      Items: {
        type: "array",
        items: { $ref: "#/definitions/Authority" },
      },
    },
    "x-netex-role": "entity",
  },
};

// ── generateInterface (plain text) ──────────────────────────────────────────

describe("generateInterface", () => {
  it("generates a basic interface", () => {
    const { text, isAlias } = generateInterface(defs, "Authority", { html: false });
    expect(isAlias).toBe(false);
    expect(text).toContain("interface Authority {");
    expect(text).toContain("  Name?: string;");
    expect(text).toContain("  Description?: string;");
    expect(text).toContain("  AuthorityCode?: string;");
    expect(text).toContain("}");
  });

  it("includes origin comments when not compact", () => {
    const { text } = generateInterface(defs, "Authority", { html: false });
    expect(text).toContain("// ── OrganisationStructure ──");
    expect(text).toContain("// ── Authority ──");
  });

  it("omits origin comments when compact", () => {
    const { text } = generateInterface(defs, "Authority", { html: false, compact: true });
    expect(text).not.toContain("// ──");
    expect(text).not.toContain("/**");
  });

  it("delegates to type alias for empty-prop definitions", () => {
    const { text, isAlias } = generateInterface(defs, "EmptyWrapper", { html: false });
    expect(isAlias).toBe(true);
    expect(text).toContain("type EmptyWrapper");
  });

  it("generates HTML output with spans", () => {
    const { text } = generateInterface(defs, "Authority", { html: true });
    expect(text).toContain('<span class="if-kw">interface</span>');
    expect(text).toContain('<span class="if-prop"');
  });

  it("renders complex property types as linkable names", () => {
    const { text } = generateInterface(defs, "WithArrayProp", { html: false });
    expect(text).toContain("Items?: Authority[];");
  });

  it("compact mode skips JSDoc header", () => {
    const { text } = generateInterface(defs, "Authority", { html: false, compact: true });
    expect(text).toMatch(/^interface Authority \{/);
  });
});

// ── generateTypeAlias (plain text) ──────────────────────────────────────────

describe("generateTypeAlias", () => {
  it("generates enum alias with const array pattern", () => {
    const resolved = { ts: "AllModesEnumeration", complex: false, via: [{ name: "AllModesEnumeration", rule: "enum" }] };
    const { text, isAlias } = generateTypeAlias(defs, "AllModesEnumeration", resolved, { html: false });
    expect(isAlias).toBe(true);
    expect(text).toContain("const ALL_MODES = [");
    expect(text).toContain('"bus"');
    expect(text).toContain('"rail"');
    expect(text).toContain('"tram"');
    expect(text).toContain("] as const;");
    expect(text).toContain("type AllModesEnumeration = (typeof ALL_MODES)[number];");
  });

  it("generates non-enum type alias", () => {
    const resolved = { ts: "string", complex: false, via: [{ name: "PrivateCode", rule: "atom-collapse" }] };
    const { text, isAlias } = generateTypeAlias(defs, "PrivateCode", resolved, { html: false });
    expect(isAlias).toBe(true);
    expect(text).toContain("type PrivateCode = string;");
  });

  it("includes via chain in JSDoc when not compact", () => {
    const resolved = { ts: "string", complex: false, via: [{ name: "PrivateCode", rule: "ref" }, { name: "PrivateCodeStructure", rule: "atom-collapse" }] };
    const { text } = generateTypeAlias(defs, "PrivateCode", resolved, { html: false });
    expect(text).toContain("Resolved via:");
  });

  it("omits JSDoc when compact", () => {
    const resolved = { ts: "string", complex: false };
    const { text } = generateTypeAlias(defs, "PrivateCode", resolved, { html: false, compact: true });
    expect(text).not.toContain("/**");
    expect(text).toMatch(/^type PrivateCode = string;$/);
  });

  it("generates HTML output for enum", () => {
    const resolved = { ts: "AllModesEnumeration", complex: false, via: [{ name: "AllModesEnumeration", rule: "enum" }] };
    const { text } = generateTypeAlias(defs, "AllModesEnumeration", resolved, { html: true });
    expect(text).toContain('<span class="if-kw">const</span>');
    expect(text).toContain('<span class="if-lit">');
  });
});

// ── generateTypeGuard (plain text) ──────────────────────────────────────────

describe("generateTypeGuard", () => {
  it("generates a type guard function", () => {
    const text = generateTypeGuard(defs, "Authority", { html: false });
    expect(text).toContain("function isAuthority(o: unknown): o is Authority {");
    expect(text).toContain('if (!o || typeof o !== "object") return false;');
    expect(text).toContain("const obj = o as Record<string, unknown>;");
    expect(text).toContain('if ("Name" in obj && typeof obj.Name !== "string") return false;');
    expect(text).toContain('if ("AuthorityCode" in obj && typeof obj.AuthorityCode !== "string") return false;');
    expect(text).toContain("return true;");
    expect(text).toContain("}");
  });

  it("uses Array.isArray for array properties", () => {
    const text = generateTypeGuard(defs, "WithArrayProp", { html: false });
    expect(text).toContain("!Array.isArray(obj.Items)");
  });

  it("uses typeof object for complex properties", () => {
    const text = generateTypeGuard(defs, "ComplexChild", { html: false });
    // ComplexChild inherits Name, Description (strings) and adds Extra (integer → number)
    expect(text).toContain('typeof obj.Extra !== "number"');
  });

  it("generates HTML output with spans", () => {
    const text = generateTypeGuard(defs, "Authority", { html: true });
    expect(text).toContain('<span class="if-kw">function</span>');
    expect(text).toContain('<span class="if-kw">return true</span>');
  });
});

// ── generateFactory (plain text) ─────────────────────────────────────────────

describe("generateFactory", () => {
  it("generates factory with no required fields", () => {
    const text = generateFactory(defs, "Authority", { html: false });
    expect(text).toContain("function createAuthority(");
    expect(text).toContain("  init?: Partial<Authority>");
    expect(text).toContain("): Authority {");
    expect(text).toContain("return { ...init } as Authority;");
    expect(text).toContain("}");
  });

  it("generates factory with required fields", () => {
    const text = generateFactory(defs, "RequiredEntity", { html: false });
    expect(text).toContain("function createRequiredEntity(");
    expect(text).toContain("return {");
    expect(text).toContain('Id: "string",  // required');
    expect(text).toContain("...init,");
  });

  it("generates HTML output with spans", () => {
    const text = generateFactory(defs, "Authority", { html: true });
    expect(text).toContain('<span class="if-kw">function</span>');
    expect(text).toContain('<span class="if-ref">Authority</span>');
  });

  it("accepts pre-computed props and required", () => {
    const text = generateFactory(defs, "RequiredEntity", {
      html: false,
      preRequired: new Set(["Id"]),
    });
    expect(text).toContain('Id: "string",  // required');
    expect(text).not.toContain("Name:");
  });
});
