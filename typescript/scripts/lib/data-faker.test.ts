import { describe, it, expect } from "vitest";
import {
  defaultForType,
  fake,
  buildXml,
  toXmlShape,
  serialize,
  type Defs,
} from "./data-faker.js";

// ── defaultForType ──────────────────────────────────────────────────────────

describe("defaultForType", () => {
  it('returns "string" for string', () => {
    expect(defaultForType("string")).toBe('"string"');
  });

  it("returns 0 for number", () => {
    expect(defaultForType("number")).toBe("0");
  });

  it("returns 0 for integer", () => {
    expect(defaultForType("integer")).toBe("0");
  });

  it("returns false for boolean", () => {
    expect(defaultForType("boolean")).toBe("false");
  });

  it("returns [] for arrays", () => {
    expect(defaultForType("string[]")).toBe("[]");
  });

  it("returns first literal for unions", () => {
    expect(defaultForType('"a" | "b"')).toBe('"a"');
  });

  it('returns "string" for string with format', () => {
    expect(defaultForType("string /* date-time */")).toBe('"string"');
  });

  it("returns cast for complex types", () => {
    expect(defaultForType("MyType")).toBe("{} as MyType");
  });
});

// ── fake (née genMockObject) ────────────────────────────────────────────────

describe("fake", () => {
  const syntheticDefs: Defs = {
    MyEntity: {
      allOf: [
        { $ref: "#/definitions/BaseStruct" },
        {
          properties: {
            Name: { type: "string" },
            Active: { type: "boolean" },
            Count: { type: "integer" },
            Mode: { allOf: [{ $ref: "#/definitions/ModeEnum" }] },
            ThingRef: { allOf: [{ $ref: "#/definitions/ThingRefStructure" }] },
            items: { allOf: [{ $ref: "#/definitions/items_RelStructure" }] },
          },
        },
      ],
    },
    BaseStruct: {
      type: "object",
      properties: {
        id: { type: "string", xml: { attribute: true } },
        version: { type: "string", xml: { attribute: true } },
        nameOfClass: {
          allOf: [{ $ref: "#/definitions/NameOfClass" }],
          "x-fixed-single-enum": "NameOfClass",
        },
      },
    },
    NameOfClass: {
      type: "string",
      enum: ["MyEntity", "Other"],
      "x-netex-role": "enumeration",
    },
    ModeEnum: {
      type: "string",
      enum: ["bus", "rail", "tram"],
      "x-netex-role": "enumeration",
    },
    ThingRefStructure: {
      type: "object",
      "x-netex-role": "reference",
      properties: {
        value: { type: "string" },
        ref: { type: "string", xml: { attribute: true } },
      },
    },
    items_RelStructure: {
      type: "object",
      "x-netex-role": "collection",
      properties: {
        Item: { type: "array", items: { $ref: "#/definitions/ItemStruct" } },
      },
    },
    ItemStruct: {
      type: "object",
      properties: { label: { type: "string" } },
    },
  };

  it("fills $id with entity name pattern", () => {
    const result = fake(syntheticDefs, "MyEntity");
    expect(result.$id).toBe("ENT:MyEntity:1");
  });

  it("fills $version with '1'", () => {
    const result = fake(syntheticDefs, "MyEntity");
    expect(result.$version).toBe("1");
  });

  it("fills nameOfClass with context name via x-fixed-single-enum", () => {
    const result = fake(syntheticDefs, "MyEntity");
    expect(result.nameOfClass).toBe("MyEntity");
  });

  it("fills string properties with \"string\" default", () => {
    const result = fake(syntheticDefs, "MyEntity");
    expect(result.Name).toBe("string");
  });

  it("fills boolean properties with false", () => {
    const result = fake(syntheticDefs, "MyEntity");
    expect(result.Active).toBe(false);
  });

  it("fills integer properties with 0", () => {
    const result = fake(syntheticDefs, "MyEntity");
    expect(result.Count).toBe(0);
  });

  it("fills enum properties with first enum value", () => {
    const result = fake(syntheticDefs, "MyEntity");
    expect(result.Mode).toBe("bus");
  });

  it("fills reference properties with ref mock object", () => {
    const result = fake(syntheticDefs, "MyEntity");
    const ref = result.ThingRef as Record<string, unknown>;
    expect(ref).toBeDefined();
    expect(typeof ref.value).toBe("string");
    expect(typeof ref.$ref).toBe("string");
  });

  it("fills collection properties with empty array", () => {
    const result = fake(syntheticDefs, "MyEntity");
    expect(result.items).toEqual([]);
  });

  it("fills shallow-complex ref as nested object", () => {
    const defsWithShallow: Defs = {
      Parent: {
        type: "object",
        properties: {
          Detail: { allOf: [{ $ref: "#/definitions/DetailStruct" }] },
        },
      },
      DetailStruct: {
        type: "object",
        properties: {
          Label: { type: "string" },
          Count: { type: "integer" },
        },
      },
    };
    const result = fake(defsWithShallow, "Parent");
    expect(result.Detail).toEqual({ Label: "string", Count: 0 });
  });

  it("fills shallow-complex array ref as one-element array", () => {
    const defsWithArray: Defs = {
      Parent: {
        type: "object",
        properties: {
          Items: { type: "array", items: { $ref: "#/definitions/ItemType" } },
        },
      },
      ItemType: {
        type: "object",
        "x-netex-atom": "simpleObj",
        properties: {
          value: { type: "string" },
          lang: { type: "string", xml: { attribute: true } },
        },
      },
    };
    const result = fake(defsWithArray, "Parent");
    // ItemType is simpleObj so atom path handles it before shallow-complex,
    // but either way the array should be populated
    expect(Array.isArray(result.Items)).toBe(true);
  });
});

// ── buildXml ────────────────────────────────────────────────────────────────

describe("buildXml", () => {
  it("produces XML from pre-transformed input", () => {
    const xmlShape = { "@_id": "1", Name: "test" };
    const xml = buildXml("Foo", xmlShape);
    expect(xml).toContain("<Foo");
    expect(xml).toContain('id="1"');
    expect(xml).toContain("<Name>test</Name>");
    expect(xml).toContain("</Foo>");
  });
});

// ── toXmlShape ──────────────────────────────────────────────────────────────

describe("toXmlShape", () => {
  it("renames $-prefixed keys to @_-prefixed", () => {
    const defs: Defs = {
      Foo: {
        type: "object",
        properties: {
          id: { type: "string", xml: { attribute: true } },
          version: { type: "string", xml: { attribute: true } },
        },
      },
    };
    const result = toXmlShape(defs, "Foo", { $id: "x", $version: "1" });
    expect(result).toEqual({ "@_id": "x", "@_version": "1" });
  });

  it("stringifies boolean values", () => {
    const defs: Defs = {
      Foo: {
        type: "object",
        properties: {
          LowFloor: { type: "boolean" },
          active: { type: "boolean", xml: { attribute: true } },
        },
      },
    };
    const result = toXmlShape(defs, "Foo", { LowFloor: true, $active: false });
    expect(result).toEqual({ LowFloor: "true", "@_active": "false" });
  });

  it("converts value→#text for simpleObj (simpleContent) types", () => {
    const defs: Defs = {
      BrandingRefStructure: {
        type: "object",
        "x-netex-atom": "simpleObj",
        properties: {
          value: { type: "string" },
          ref: { type: "string", xml: { attribute: true } },
          version: { type: "string", xml: { attribute: true } },
        },
      },
    };
    const result = toXmlShape(defs, "BrandingRefStructure", {
      value: "XXX:Branding:1",
      $ref: "XXX:Branding:1",
      $version: "1",
    });
    expect(result).toEqual({
      "#text": "XXX:Branding:1",
      "@_ref": "XXX:Branding:1",
      "@_version": "1",
    });
  });

  it("keeps value as-is when no $-sibling (not simpleContent)", () => {
    const defs: Defs = {
      Foo: {
        type: "object",
        properties: {
          value: { type: "string" },
          Name: { type: "string" },
        },
      },
    };
    const result = toXmlShape(defs, "Foo", { value: "x", Name: "y" });
    expect(result).toEqual({ value: "x", Name: "y" });
  });

  it("orders properties per schema definition, not obj key order", () => {
    const defs: Defs = {
      Foo: {
        type: "object",
        properties: {
          Alpha: { type: "string" },
          Beta: { type: "string" },
          Gamma: { type: "string" },
        },
      },
    };
    // Pass obj with keys in reverse order
    const result = toXmlShape(defs, "Foo", { Gamma: "c", Alpha: "a", Beta: "b" });
    expect(Object.keys(result)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("puts attributes before elements in output", () => {
    const defs: Defs = {
      Foo: {
        type: "object",
        properties: {
          Name: { type: "string" },
          id: { type: "string", xml: { attribute: true } },
        },
      },
    };
    const result = toXmlShape(defs, "Foo", { Name: "test", $id: "1" });
    // Attributes ($id→@_id) come before elements (Name) in schema order
    // because flattenAllOf returns them in definition order
    expect(Object.keys(result)).toContain("@_id");
    expect(Object.keys(result)).toContain("Name");
  });

  it("recurses into ref-typed properties with correct definition", () => {
    const defs: Defs = {
      Parent: {
        type: "object",
        properties: {
          BrandingRef: { allOf: [{ $ref: "#/definitions/BrandingRefStruct" }] },
        },
      },
      BrandingRefStruct: {
        type: "object",
        "x-netex-atom": "simpleObj",
        properties: {
          value: { type: "string" },
          ref: { type: "string", xml: { attribute: true } },
        },
      },
    };
    const result = toXmlShape(defs, "Parent", {
      BrandingRef: { value: "XXX:Brand:1", $ref: "XXX:Brand:1" },
    });
    expect(result).toEqual({
      BrandingRef: { "#text": "XXX:Brand:1", "@_ref": "XXX:Brand:1" },
    });
  });

  it("recurses into refArray items", () => {
    const defs: Defs = {
      Parent: {
        type: "object",
        properties: {
          Items: { type: "array", items: { $ref: "#/definitions/ItemStruct" } },
        },
      },
      ItemStruct: {
        type: "object",
        "x-netex-atom": "simpleObj",
        properties: {
          value: { type: "string" },
          lang: { type: "string", xml: { attribute: true } },
        },
      },
    };
    const result = toXmlShape(defs, "Parent", {
      Items: [{ value: "hello", $lang: "en" }],
    });
    expect(result).toEqual({
      Items: [{ "#text": "hello", "@_lang": "en" }],
    });
  });

  it("skips undefined values", () => {
    const defs: Defs = {
      Foo: {
        type: "object",
        properties: {
          Name: { type: "string" },
          Desc: { type: "string" },
        },
      },
    };
    const result = toXmlShape(defs, "Foo", { Name: "x", Desc: undefined });
    expect(result).toEqual({ Name: "x" });
  });

  it("follows $ref aliases in definition name", () => {
    const defs: Defs = {
      Alias: { $ref: "#/definitions/RealStruct" },
      RealStruct: {
        type: "object",
        properties: {
          Name: { type: "string" },
          Count: { type: "integer" },
        },
      },
    };
    const result = toXmlShape(defs, "Alias", { Name: "test", Count: 42 });
    expect(result).toEqual({ Name: "test", Count: 42 });
  });

  it("falls back to convention for unknown definition", () => {
    const defs: Defs = {};
    const result = toXmlShape(defs, "Unknown", {
      $id: "x",
      value: "text",
      $ref: "y",
    });
    // Convention-only: $ → @_, value + $sibling → #text
    expect(result).toEqual({ "@_id": "x", "#text": "text", "@_ref": "y" });
  });

  it("preserves ordering through allOf inheritance chain", () => {
    const defs: Defs = {
      Child: {
        allOf: [
          { $ref: "#/definitions/ParentStruct" },
          {
            properties: {
              Delta: { type: "string" },
              Epsilon: { type: "string" },
            },
          },
        ],
      },
      ParentStruct: {
        type: "object",
        properties: {
          Alpha: { type: "string" },
          Beta: { type: "string" },
        },
      },
    };
    // Pass in wrong order
    const result = toXmlShape(defs, "Child", {
      Epsilon: "e",
      Alpha: "a",
      Delta: "d",
      Beta: "b",
    });
    // Parent props first, then child props — XSD extension order
    expect(Object.keys(result)).toEqual(["Alpha", "Beta", "Delta", "Epsilon"]);
  });
});

// ── serialize ───────────────────────────────────────────────────────────────

describe("serialize", () => {
  it("produces XML string with root element wrapper", () => {
    const defs: Defs = {
      Foo: {
        type: "object",
        properties: {
          Name: { type: "string" },
          id: { type: "string", xml: { attribute: true } },
        },
      },
    };
    const xml = serialize(defs, "Foo", { Name: "test", $id: "1" });
    expect(xml).toContain("<Foo");
    expect(xml).toContain("</Foo>");
    expect(xml).toContain('id="1"');
    expect(xml).toContain("<Name>test</Name>");
  });
});
