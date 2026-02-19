/**
 * Splits a monolithic generated TypeScript file into per-category modules.
 *
 * Categories are derived from XSD source file paths. Each category gets its own
 * .ts file with import statements for cross-referenced types from other categories.
 * A barrel index.ts re-exports everything.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Ordered category rules — first match wins. */
const CATEGORY_RULES: [string, string, (f: string) => boolean][] = [
  ["siri", "SIRI real-time types", (f) => f.startsWith("siri/") || f.startsWith("siri_utility/")],
  [
    "reusable",
    "NeTEx reusable components",
    (f) => f.startsWith("netex_framework/netex_reusableComponents/"),
  ],
  [
    "responsibility",
    "NeTEx responsibility & organisation types",
    (f) => f.startsWith("netex_framework/netex_responsibility/"),
  ],
  [
    "generic",
    "NeTEx generic framework types",
    (f) => f.startsWith("netex_framework/netex_genericFramework/"),
  ],
  ["network", "NeTEx Part 1 — Network topology", (f) => f.startsWith("netex_part_1/")],
  ["timetable", "NeTEx Part 2 — Timetables", (f) => f.startsWith("netex_part_2/")],
  ["fares", "NeTEx Part 3 — Fares", (f) => f.startsWith("netex_part_3/")],
  ["new-modes", "NeTEx Part 5 — New modes", (f) => f.startsWith("netex_part_5/")],
  // Catch-all: framework utility/frames, netex_service, root XSDs, unknown
  ["core", "NeTEx core types", () => true],
];

interface DeclBlock {
  defName: string;
  tsName: string;
  text: string;
  category: string;
}

export interface SplitResult {
  /** Category name → file path written */
  files: Map<string, string>;
  /** Category name → number of declarations */
  counts: Map<string, number>;
}

/**
 * Parse the generated TypeScript into declaration blocks.
 * Each block is identified by the JSDoc `via the \`definition\` "DefName"` marker
 * that json-schema-to-typescript adds for every definition.
 */
function parseDeclarations(ts: string): DeclBlock[] {
  // Find each JSDoc→export boundary: the */ that immediately precedes an export line
  const boundaryRe = /\*\/\nexport (?:type|interface) (\w+)/g;
  const boundaries = [...ts.matchAll(boundaryRe)];
  if (boundaries.length === 0) return [];

  const blocks: DeclBlock[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const closeJsdoc = boundaries[i].index!;
    const tsName = boundaries[i][1];

    // Search backwards from the */ to find this declaration's opening /**
    const jsdocStart = ts.lastIndexOf("/**", closeJsdoc);
    if (jsdocStart < 0) continue;

    // Block extends from this JSDoc to the next declaration's JSDoc (or EOF)
    const nextJsdocStart =
      i + 1 < boundaries.length ? ts.lastIndexOf("/**", boundaries[i + 1].index!) : ts.length;
    const text = ts.slice(jsdocStart, nextJsdocStart).trimEnd();

    // Extract JSON Schema definition name from JSDoc
    const defMatch = text.match(/via the `definition` "([^"]+)"/);
    const defName = defMatch ? defMatch[1] : tsName;

    blocks.push({ defName, tsName, text, category: "" });
  }
  return blocks;
}

/** Determine which category a source file belongs to. */
function categorize(sourceFile: string | undefined): string {
  if (!sourceFile) return "core";
  for (const [name, , test] of CATEGORY_RULES) {
    if (test(sourceFile)) return name;
  }
  return "core";
}

/** Get the human description for a category. */
function categoryDescription(cat: string): string {
  for (const [name, desc] of CATEGORY_RULES) {
    if (name === cat) return desc;
  }
  return cat;
}

/**
 * Extract PascalCase identifiers from TypeScript code (stripping JSDoc comments first).
 * Returns a Set of unique identifiers found in the code portion of a block.
 */
function extractTypeReferences(blockText: string, ownName: string): Set<string> {
  // Strip JSDoc comments to avoid false positives from documentation text
  const stripped = blockText.replace(/\/\*\*[\s\S]*?\*\//g, "");
  // Match PascalCase identifiers (all NeTEx type/interface names start with uppercase)
  const matches = stripped.match(/\b[A-Z]\w+/g) || [];
  const refs = new Set(matches);
  refs.delete(ownName);
  return refs;
}

function makeBanner(category: string): string {
  return [
    "/* eslint-disable */",
    "/**",
    ` * NeTEx TypeScript interfaces — ${categoryDescription(category)}.`,
    " * Auto-generated from NeTEx XSD schemas. Do not edit manually.",
    " *",
    " * @see https://github.com/NeTEx-CEN/NeTEx",
    " */",
    "",
  ].join("\n");
}

export function splitTypeScript(
  ts: string,
  sourceMap: Map<string, string>,
  outDir: string,
): SplitResult {
  const blocks = parseDeclarations(ts);
  if (blocks.length === 0) {
    return { files: new Map(), counts: new Map() };
  }

  // Map each block to a category
  for (const block of blocks) {
    block.category = categorize(sourceMap.get(block.defName));
  }

  // Build tsName → category lookup
  const tsCategoryMap = new Map<string, string>();
  for (const block of blocks) {
    tsCategoryMap.set(block.tsName, block.category);
  }

  // Group blocks by category
  const categories = new Map<string, DeclBlock[]>();
  for (const block of blocks) {
    let list = categories.get(block.category);
    if (!list) {
      list = [];
      categories.set(block.category, list);
    }
    list.push(block);
  }

  const result: SplitResult = { files: new Map(), counts: new Map() };

  for (const [cat, catBlocks] of categories) {
    // Scan each block's code for type references from other categories
    const externalDeps = new Map<string, Set<string>>(); // otherCat → Set<tsName>

    for (const block of catBlocks) {
      const refs = extractTypeReferences(block.text, block.tsName);
      for (const ref of refs) {
        const refCat = tsCategoryMap.get(ref);
        if (!refCat || refCat === cat) continue;
        let set = externalDeps.get(refCat);
        if (!set) {
          set = new Set();
          externalDeps.set(refCat, set);
        }
        set.add(ref);
      }
    }

    // Build file content
    const parts: string[] = [makeBanner(cat)];

    // Import statements (sorted for determinism)
    for (const [depCat, names] of [...externalDeps.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const sorted = [...names].sort();
      parts.push(`import type { ${sorted.join(", ")} } from './${depCat}.js';`);
    }
    if (externalDeps.size > 0) parts.push("");

    // Declarations
    for (const block of catBlocks) {
      parts.push(block.text);
    }
    parts.push(""); // trailing newline

    const filePath = resolve(outDir, `${cat}.ts`);
    writeFileSync(filePath, parts.join("\n"));
    result.files.set(cat, filePath);
    result.counts.set(cat, catBlocks.length);
  }

  // Write barrel index.ts
  const barrelParts = [
    "/* eslint-disable */",
    "/**",
    " * NeTEx TypeScript interfaces — barrel re-export.",
    " * Auto-generated from NeTEx XSD schemas. Do not edit manually.",
    " */",
    "",
  ];
  for (const cat of [...categories.keys()].sort()) {
    barrelParts.push(`export * from './${cat}.js';`);
  }
  barrelParts.push("");
  writeFileSync(resolve(outDir, "index.ts"), barrelParts.join("\n"));

  return result;
}
