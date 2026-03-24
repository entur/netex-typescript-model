/** Shared type definitions for schema introspection. */

/** A JSON Schema definition (loose typing — mirrors what the viewer receives). */
export type Def = Record<string, any>;
export type NetexLibrary = Record<string, Def>;

export interface ViaHop {
  name: string;
  rule:
    | "ref"
    | "allOf-passthrough"
    | "allOf-speculative"
    | "atom-collapse"
    | "mixed-unwrap"
    | "array-unwrap"
    | "array-of"
    | "empty-object"
    | "enum"
    | "primitive"
    | "complex"
    | "fixed-for"
    | "dyn-class";
}

export interface ResolvedType {
  ts: string;
  complex: boolean;
  /** Resolution chain — each hop records the def name and which resolveDefType branch handled it. */
  via?: ViaHop[];
}

export interface FlatProperty {
  /** `[xsdName, canonicalName]` — original XSD property name and its canonical name (PascalCase for elements, $-prefixed for attributes). */
  prop: [string, string];
  type: string;
  desc: string;
  origin: string;
  schema: Def;
  /** When set, this property was inlined from a 1-to-1 $ref member with this tsName. */
  inlinedFrom?: string;
}

/** Discriminated shape of a JSON Schema property node. */
export type SchemaShape =
  | { kind: "ref"; target: string }
  | { kind: "enum"; values: unknown[] }
  | { kind: "refArray"; target: string }
  | { kind: "array"; itemType: string }
  | { kind: "primitive"; type: string; format?: string }
  | { kind: "object" }
  | { kind: "unknown" };

/** A node in the inheritance chain returned by `buildInheritanceChain`. */
export interface InheritanceNode {
  name: string;
  ownProps: { name: string; schema: Record<string, unknown> }[];
}

/** Entry returned by `collectRefProps`. */
export interface RefPropEntry {
  propName: string;
  refDefName: string;
  targetEntities: string[];
}

/** A node in the BFS dependency tree returned by `collectDependencyTree`. */
export interface DepTreeNode {
  name: string;
  via: string;
  depth: number;
  duplicate: boolean;
}
