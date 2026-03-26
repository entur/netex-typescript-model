import { describe, it, expect } from "vitest";
import {
  generateInterface,
  generateTypeAlias,
  generateTypeGuard,
  generateFactory,
  generateSubTypesBlock,
  collectRenderableDeps,
  toConstName,
} from "../codegens.js";
import type { NetexLibrary } from "../types.js";

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

// ── Shared test definitions ─────────────────────────────────────────────────────────

const netexLibrary: NetexLibrary = {
  NameOfClass: {
    enum: ["Authority", "Vehicle", "StopPlace", "Line", "Route"],
    "x-netex-role": "enumeration",
  },
  Authority: {
    allOf: [
      { $ref: "#/definitions/OrganisationStructure" },
      {
        properties: {
          AuthorityCode: { type: "string", description: "Code for authority" },
          nameOfClass: {
            allOf: [{ $ref: "#/definitions/NameOfClass" }],
            "x-fixed-single-enum": "NameOfClass",
          },
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
  WithModeProp: {
    properties: {
      mode: {
        allOf: [{ $ref: "#/definitions/AllModesEnumeration" }],
      },
    },
    "x-netex-role": "entity",
  },
  WithDynClassRef: {
    allOf: [
      { $ref: "#/definitions/OrganisationStructure" },
      {
        properties: {
          nameOfMemberClass: {
            allOf: [{ $ref: "#/definitions/NameOfClass" }],
          },
        },
      },
    ],
    "x-netex-role": "entity",
  },
  StatusEnum: {
    enum: ["active", "inactive", "pending"],
    "x-netex-role": "enumeration",
  },
  EntityWithFixedStatus: {
    allOf: [{
      properties: {
        status: {
          allOf: [{ $ref: "#/definitions/StatusEnum" }],
          "x-fixed-single-enum": "StatusEnum",
        },
      },
    }],
    "x-netex-role": "entity",
  },
  WithUnstampedStatusRef: {
    allOf: [
      { $ref: "#/definitions/OrganisationStructure" },
      {
        properties: {
          category: {
            allOf: [{ $ref: "#/definitions/StatusEnum" }],
          },
        },
      },
    ],
    "x-netex-role": "entity",
  },
  RelationshipId: { $ref: "#/definitions/NameOfClass" },
  SomeRelStructure: {
    allOf: [
      {
        properties: {
          $id: {
            allOf: [{ $ref: "#/definitions/RelationshipId" }],
            "x-fixed-single-enum": "NameOfClass",
            xml: { attribute: true },
          },
          Item: { type: "array", items: { $ref: "#/definitions/Authority" } },
        },
      },
    ],
    "x-netex-role": "collection",
  },
  WithRelDep: {
    allOf: [
      { $ref: "#/definitions/OrganisationStructure" },
      {
        properties: {
          nameOfClass: {
            allOf: [{ $ref: "#/definitions/NameOfClass" }],
            "x-fixed-single-enum": "NameOfClass",
          },
          conds: {
            type: "array",
            items: { $ref: "#/definitions/SomeRelStructure" },
          },
        },
      },
    ],
    "x-netex-role": "entity",
  },
};

// ── generateInterface (plain text) ──────────────────────────────────────────

describe("generateInterface", () => {
  it("generates a basic interface", () => {
    const { text, isAlias } = generateInterface(netexLibrary, "Authority", { html: false });
    expect(isAlias).toBe(false);
    expect(text).toContain("interface Authority {");
    expect(text).toContain("  Name?: string;");
    expect(text).toContain("  Description?: string;");
    expect(text).toContain("  AuthorityCode?: string;");
    expect(text).toContain("}");
  });

  it("includes origin comments when not compact", () => {
    const { text } = generateInterface(netexLibrary, "Authority", { html: false });
    expect(text).toContain("// ── OrganisationStructure ──");
    expect(text).toContain("// ── Authority ──");
  });

  it("omits origin comments when metaComments: false", () => {
    const { text } = generateInterface(netexLibrary, "Authority", { html: false, metaComments: false });
    expect(text).not.toContain("// ──");
    expect(text).not.toContain("/**");
  });

  it("delegates to type alias for empty-prop definitions", () => {
    const { text, isAlias } = generateInterface(netexLibrary, "EmptyWrapper", { html: false });
    expect(isAlias).toBe(true);
    expect(text).toContain("type EmptyWrapper");
  });

  it("generates HTML output with spans", () => {
    const { text } = generateInterface(netexLibrary, "Authority", { html: true });
    expect(text).toContain('<span class="if-kw">interface</span>');
    expect(text).toContain('<span class="if-prop"');
  });

  it("renders complex property types as linkable names", () => {
    const { text } = generateInterface(netexLibrary, "WithArrayProp", { html: false });
    expect(text).toContain("Items?: Authority[];");
  });

  it("maps JSON Schema integer to TypeScript number", () => {
    const { text } = generateInterface(netexLibrary, "ComplexChild", { html: false });
    expect(text).toContain("Extra?: number;");
    expect(text).not.toContain("integer");
  });

  it("metaComments: false skips JSDoc header", () => {
    const { text } = generateInterface(netexLibrary, "Authority", { html: false, metaComments: false });
    expect(text).toMatch(/^interface Authority \{/);
  });

  it("renders dynamic NameOfClass ref as string", () => {
    const { text } = generateInterface(netexLibrary, "WithDynClassRef", { html: false });
    expect(text).toContain("nameOfMemberClass?: string;");
    expect(text).not.toContain("NameOfClass");
  });

  it("excludeProps omits named properties", () => {
    const { text } = generateInterface(netexLibrary, "Authority", {
      html: false,
      excludeProps: new Set(["Name", "Description"]),
    });
    expect(text).toContain("interface Authority {");
    expect(text).not.toContain("Name?");
    expect(text).not.toContain("Description?");
    expect(text).toContain("AuthorityCode?");
  });
});

// ── generateTypeAlias (plain text) ──────────────────────────────────────────

describe("generateTypeAlias", () => {
  it("generates enum alias with const array pattern", () => {
    const resolved = { ts: "AllModesEnumeration", complex: false, via: [{ name: "AllModesEnumeration", rule: "enum" }] };
    const { text, isAlias } = generateTypeAlias(netexLibrary, "AllModesEnumeration", resolved, { html: false });
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
    const { text, isAlias } = generateTypeAlias(netexLibrary, "PrivateCode", resolved, { html: false });
    expect(isAlias).toBe(true);
    expect(text).toContain("type PrivateCode = string;");
  });

  it("includes via chain in JSDoc when not compact", () => {
    const resolved = { ts: "string", complex: false, via: [{ name: "PrivateCode", rule: "ref" }, { name: "PrivateCodeStructure", rule: "atom-collapse" }] };
    const { text } = generateTypeAlias(netexLibrary, "PrivateCode", resolved, { html: false });
    expect(text).toContain("Resolved via:");
  });

  it("omits JSDoc when metaComments: false", () => {
    const resolved = { ts: "string", complex: false };
    const { text } = generateTypeAlias(netexLibrary, "PrivateCode", resolved, { html: false, metaComments: false });
    expect(text).not.toContain("/**");
    expect(text).toMatch(/^type PrivateCode = string;$/);
  });

  it("generates HTML output for enum", () => {
    const resolved = { ts: "AllModesEnumeration", complex: false, via: [{ name: "AllModesEnumeration", rule: "enum" }] };
    const { text } = generateTypeAlias(netexLibrary, "AllModesEnumeration", resolved, { html: true });
    expect(text).toContain('<span class="if-kw">const</span>');
    expect(text).toContain('<span class="if-lit">');
  });
});

// ── generateTypeGuard (plain text) ──────────────────────────────────────────

describe("generateTypeGuard", () => {
  it("generates a type guard function", () => {
    const text = generateTypeGuard(netexLibrary, "Authority", { html: false });
    expect(text).toContain("function isAuthority(o: unknown): o is Authority {");
    expect(text).toContain('if (!o || typeof o !== "object") return false;');
    expect(text).toContain("const obj = o as Record<string, unknown>;");
    expect(text).toContain('if ("Name" in obj && typeof obj.Name !== "string") return false;');
    expect(text).toContain('if ("AuthorityCode" in obj && typeof obj.AuthorityCode !== "string") return false;');
    expect(text).toContain("return true;");
    expect(text).toContain("}");
  });

  it("uses Array.isArray for array properties", () => {
    const text = generateTypeGuard(netexLibrary, "WithArrayProp", { html: false });
    expect(text).toContain("!Array.isArray(obj.Items)");
  });

  it("uses typeof object for complex properties", () => {
    const text = generateTypeGuard(netexLibrary, "ComplexChild", { html: false });
    // ComplexChild inherits Name, Description (strings) and adds Extra (integer → number)
    expect(text).toContain('typeof obj.Extra !== "number"');
  });

  it("generates HTML output with spans", () => {
    const text = generateTypeGuard(netexLibrary, "Authority", { html: true });
    expect(text).toContain('<span class="if-kw">function</span>');
    expect(text).toContain('<span class="if-kw">return true</span>');
  });
});

// ── generateFactory (plain text) ─────────────────────────────────────────────

describe("generateFactory", () => {
  it("generates factory with no required fields", () => {
    const text = generateFactory(netexLibrary, "Authority", { html: false });
    expect(text).toContain("function createAuthority(");
    expect(text).toContain("  init?: Partial<Authority>");
    expect(text).toContain("): Authority {");
    expect(text).toContain("return { ...init } as Authority;");
    expect(text).toContain("}");
  });

  it("generates factory with required fields", () => {
    const text = generateFactory(netexLibrary, "RequiredEntity", { html: false });
    expect(text).toContain("function createRequiredEntity(");
    expect(text).toContain("return {");
    expect(text).toContain('Id: "string",  // required');
    expect(text).toContain("...init,");
  });

  it("generates HTML output with spans", () => {
    const text = generateFactory(netexLibrary, "Authority", { html: true });
    expect(text).toContain('<span class="if-kw">function</span>');
    expect(text).toContain('<span class="if-ref">Authority</span>');
  });

  it("accepts pre-computed props and required", () => {
    const text = generateFactory(netexLibrary, "RequiredEntity", {
      html: false,
      preRequired: new Set(["Id"]),
    });
    expect(text).toContain('Id: "string",  // required');
    expect(text).not.toContain("Name:");
  });
});

// ── generateInterface (root block) ──────────────────────────────────────────

describe("generateInterface as root block", () => {
  it("generates plain text with metaComments for Authority", () => {
    const { text } = generateInterface(netexLibrary, "Authority", { html: false });
    expect(text).toContain("interface Authority {");
    expect(text).toContain("// ──");
  });

  it("returns alias text for enum definitions", () => {
    const { text } = generateInterface(netexLibrary, "AllModesEnumeration", { html: false });
    expect(text).toContain("const ALL_MODES");
  });
});

// ── generateSubTypesBlock ─────────────────────────────────────────────────

describe("generateSubTypesBlock", () => {
  it("returns empty string for type with no complex deps", () => {
    const text = generateSubTypesBlock(netexLibrary, "Authority", { html: false });
    expect(text).toBe("");
  });

  it("includes complex deps from array properties", () => {
    // WithArrayProp has Items: Authority[] — Authority is a complex dep
    const text = generateSubTypesBlock(netexLibrary, "WithArrayProp", { html: false });
    expect(text).toContain("interface Authority {");
  });

  it("omits metaComments on dep blocks", () => {
    const text = generateSubTypesBlock(netexLibrary, "WithArrayProp", { html: false });
    expect(text).not.toContain("// ──");
  });

  it("excludes x-fixed-single-enum enums unreferenced as types", () => {
    const text = generateSubTypesBlock(netexLibrary, "Authority", { html: false });
    expect(text).not.toContain("NAME_OF_CLASS");
    expect(text).not.toContain("type NameOfClass");
  });

  it("includes enums that ARE referenced as property types", () => {
    const text = generateSubTypesBlock(netexLibrary, "WithModeProp", { html: false });
    expect(text).toContain("ALL_MODES");
  });

  it("fully excludes NameOfClass from alias-chain deps", () => {
    const text = generateSubTypesBlock(netexLibrary, "WithRelDep", { html: false });
    expect(text).not.toContain("NAME_OF_CLASS");
    expect(text).not.toContain("type NameOfClass");
    expect(text).not.toContain("?: NameOfClass");
  });

  it("excludes NameOfClass for dynamic (non-fixed) refs", () => {
    const text = generateSubTypesBlock(netexLibrary, "WithDynClassRef", { html: false });
    expect(text).not.toContain("NAME_OF_CLASS");
    expect(text).not.toContain("type NameOfClass");
  });

  it("excludedMembers removes deps seeded by excluded props", () => {
    const full = generateSubTypesBlock(netexLibrary, "WithArrayProp", { html: false });
    expect(full).toContain("interface Authority {");
    const excluded = generateSubTypesBlock(netexLibrary, "WithArrayProp", {
      html: false,
      excludedMembers: new Set(["Items"]),
    });
    expect(excluded).not.toContain("Authority");
  });

  it("collapses fixed-enum-target deps to string", () => {
    const text = generateSubTypesBlock(netexLibrary, "WithUnstampedStatusRef", { html: false });
    expect(text).toContain("type StatusEnum = string;");
    expect(text).not.toContain("STATUS_ENUM");
  });
});

// ── collectRenderableDeps ────────────────────────────────────────────────────

describe("collectRenderableDeps", () => {
  it("excludes x-fixed-single-enum deps", () => {
    const names = collectRenderableDeps(netexLibrary, "Authority");
    expect(names).not.toContain("NameOfClass");
  });

  it("includes normal enum deps", () => {
    const names = collectRenderableDeps(netexLibrary, "WithModeProp");
    expect(names).toContain("AllModesEnumeration");
  });

  it("excludes NameOfClass for dynamic refs", () => {
    const names = collectRenderableDeps(netexLibrary, "WithDynClassRef");
    expect(names).not.toContain("NameOfClass");
  });

  it("excludedMembers filters deps seeded by excluded props", () => {
    const full = collectRenderableDeps(netexLibrary, "WithArrayProp");
    expect(full).toContain("Authority");
    const excluded = collectRenderableDeps(netexLibrary, "WithArrayProp", new Set(["Items"]));
    expect(excluded).not.toContain("Authority");
  });
});
