import { describe, it, expect } from "vitest";
import { buildSidebarItems, buildRoleFilter } from "./build-schema-html.js";

// ── buildSidebarItems ─────────────────────────────────────────────────────────

describe("buildSidebarItems", () => {
  it("stamps data-role from x-netex-role", () => {
    const netexLibrary = { Foo: { "x-netex-role": "entity" } };
    const html = buildSidebarItems(["Foo"], netexLibrary);
    expect(html).toContain('data-role="entity"');
  });

  it('uses "unclassified" when x-netex-role is missing', () => {
    const netexLibrary = { Bar: { type: "object" } };
    const html = buildSidebarItems(["Bar"], netexLibrary);
    expect(html).toContain('data-role="unclassified"');
  });

  it('uses "unclassified" when definition is undefined', () => {
    const netexLibrary = {};
    const html = buildSidebarItems(["Missing"], netexLibrary);
    expect(html).toContain('data-role="unclassified"');
  });

  it("stamps data-name in lowercase", () => {
    const netexLibrary = { MyType: { "x-netex-role": "structure" } };
    const html = buildSidebarItems(["MyType"], netexLibrary);
    expect(html).toContain('data-name="mytype"');
    expect(html).toContain('data-role="structure"');
  });

  it("generates one <li> per definition", () => {
    const netexLibrary = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "reference" },
    };
    const html = buildSidebarItems(["A", "B"], netexLibrary);
    const liCount = (html.match(/<li>/g) ?? []).length;
    expect(liCount).toBe(2);
  });
});

// ── buildRoleFilter ───────────────────────────────────────────────────────────

describe("buildRoleFilter", () => {
  it("returns chips only for roles present in the data", () => {
    const netexLibrary = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "reference" },
    };
    const html = buildRoleFilter(["A", "B"], netexLibrary);
    expect(html).toContain('data-role="entity"');
    expect(html).toContain('data-role="reference"');
    expect(html).not.toContain('data-role="abstract"');
  });

  it("renders count in chip label", () => {
    const netexLibrary = {
      A: { "x-netex-role": "entity" },
      B: { "x-netex-role": "entity" },
      C: { "x-netex-role": "structure" },
    };
    const html = buildRoleFilter(["A", "B", "C"], netexLibrary);
    expect(html).toContain("Entity (2)");
    expect(html).toContain("Structure (1)");
  });

  it("renders role-chip buttons", () => {
    const netexLibrary = { A: { "x-netex-role": "view" } };
    const html = buildRoleFilter(["A"], netexLibrary);
    expect(html).toContain('<button class="role-chip"');
    expect(html).toContain("View (1)");
  });

  it("returns empty string when no definitions", () => {
    expect(buildRoleFilter([], {})).toBe("");
  });
});
