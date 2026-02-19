/**
 * Custom XSD → JSON Schema converter for NeTEx.
 *
 * Uses fast-xml-parser to parse XSD files and converts them to JSON Schema Draft 07.
 * Handles xs:include/xs:import by recursively loading referenced files.
 *
 * Why custom? xsd2jsonschema (the npm package) has xs:include as a no-op and crashes
 * on xsd:simpleContent — both are fundamental NeTEx patterns.
 */

import { XMLParser } from "fast-xml-parser";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  definitions?: Record<string, JsonSchema>;
  enum?: (string | number)[];
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

interface TypeEntry {
  name: string;
  schema: JsonSchema;
  sourceFile: string;
}

/** XSD built-in types → JSON Schema */
const XSD_TYPE_MAP: Record<string, JsonSchema> = {
  "xsd:string": { type: "string" },
  "xsd:normalizedString": { type: "string" },
  "xsd:token": { type: "string" },
  "xsd:NCName": { type: "string" },
  "xsd:NMTOKEN": { type: "string" },
  "xsd:Name": { type: "string" },
  "xsd:ID": { type: "string" },
  "xsd:IDREF": { type: "string" },
  "xsd:language": { type: "string" },
  "xsd:anyURI": { type: "string", format: "uri" },
  "xsd:boolean": { type: "boolean" },
  "xsd:integer": { type: "integer" },
  "xsd:int": { type: "integer" },
  "xsd:long": { type: "integer" },
  "xsd:short": { type: "integer" },
  "xsd:byte": { type: "integer" },
  "xsd:positiveInteger": { type: "integer", minimum: 1 },
  "xsd:nonNegativeInteger": { type: "integer", minimum: 0 },
  "xsd:decimal": { type: "number" },
  "xsd:float": { type: "number" },
  "xsd:double": { type: "number" },
  "xsd:date": { type: "string", format: "date" },
  "xsd:dateTime": { type: "string", format: "date-time" },
  "xsd:time": { type: "string", format: "time" },
  "xsd:duration": { type: "string" },
  "xsd:gYear": { type: "string" },
  "xsd:gYearMonth": { type: "string" },
  "xsd:gMonth": { type: "string" },
  "xsd:gMonthDay": { type: "string" },
  "xsd:gDay": { type: "string" },
  "xsd:hexBinary": { type: "string" },
  "xsd:base64Binary": { type: "string" },
  "xsd:anySimpleType": {},
  "xsd:anyType": {},
};

export class XsdToJsonSchema {
  private types = new Map<string, TypeEntry>();
  private groups = new Map<string, { schema: any; sourceFile: string }>();
  private attrGroups = new Map<string, { schema: any; sourceFile: string }>();
  private elements = new Map<string, TypeEntry>();
  private parsedFiles = new Set<string>();
  /** Raw definitions collected in pass 1 (before conversion). */
  private rawComplexTypes: { raw: any; sourceFile: string }[] = [];
  private rawSimpleTypes: { raw: any; sourceFile: string }[] = [];
  private rawElements: { raw: any; sourceFile: string }[] = [];
  private converted = false;
  private warnings: string[] = [];
  private xsdRoot: string;
  private parser: XMLParser;

  constructor(xsdRoot: string) {
    this.xsdRoot = xsdRoot;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: (name) =>
        [
          "xsd:element",
          "xsd:attribute",
          "xsd:include",
          "xsd:import",
          "xsd:complexType",
          "xsd:simpleType",
          "xsd:group",
          "xsd:attributeGroup",
          "xsd:enumeration",
          "xsd:pattern",
        ].includes(name),
    });
  }

  /** Parse an XSD file and all its includes/imports recursively. */
  loadFile(relativePath: string): void {
    const normalized = relativePath.replace(/\\/g, "/");
    if (this.parsedFiles.has(normalized)) return;
    this.parsedFiles.add(normalized);

    const fullPath = resolve(this.xsdRoot, normalized);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      this.warn(`cannot read ${normalized}, skipping`);
      return;
    }

    const parsed = this.parser.parse(content);
    const schema = parsed["xsd:schema"];
    if (!schema) {
      this.warn(`no xsd:schema root in ${normalized}, skipping`);
      return;
    }

    // Process includes (same namespace)
    for (const inc of this.asArray(schema["xsd:include"])) {
      const loc = inc["@_schemaLocation"];
      if (loc) {
        const resolved = join(dirname(normalized), loc).replace(/\\/g, "/");
        this.loadFile(resolved);
      }
    }

    // Process imports (different namespace)
    for (const imp of this.asArray(schema["xsd:import"])) {
      const loc = imp["@_schemaLocation"];
      if (loc) {
        const resolved = join(dirname(normalized), loc).replace(/\\/g, "/");
        this.loadFile(resolved);
      }
    }

    this.collectRawDefinitions(schema, normalized);
  }

  /**
   * Finalize: convert all collected raw definitions to JSON Schema.
   * Must be called after all files are loaded (loadFile does NOT call this automatically).
   * Groups and attribute groups are available immediately; types/elements are converted here.
   */
  convert(): void {
    if (this.converted) return;
    this.converted = true;

    // Pass 2: convert types and elements (groups/attrGroups are already available)
    const seenTypes = new Set<string>();
    for (const { raw, sourceFile } of this.rawComplexTypes) {
      const name = raw["@_name"];
      if (!name || seenTypes.has(name)) continue;
      seenTypes.add(name);
      try {
        this.types.set(name, { name, schema: this.convertComplexType(raw), sourceFile });
      } catch (e: any) {
        this.warn(`failed to convert complexType '${name}' in ${sourceFile}: ${e.message}`);
      }
    }

    for (const { raw, sourceFile } of this.rawSimpleTypes) {
      const name = raw["@_name"];
      if (!name || seenTypes.has(name)) continue;
      seenTypes.add(name);
      try {
        this.types.set(name, { name, schema: this.convertSimpleType(raw), sourceFile });
      } catch (e: any) {
        this.warn(`failed to convert simpleType '${name}' in ${sourceFile}: ${e.message}`);
      }
    }

    const seenElements = new Set<string>();
    for (const { raw, sourceFile } of this.rawElements) {
      const name = raw["@_name"];
      if (!name || seenElements.has(name)) continue;
      seenElements.add(name);
      try {
        this.elements.set(name, { name, schema: this.convertTopLevelElement(raw), sourceFile });
      } catch (e: any) {
        this.warn(`failed to convert element '${name}' in ${sourceFile}: ${e.message}`);
      }
    }
  }

  /**
   * Pass 1: collect raw XSD nodes and register groups/attrGroups immediately
   * (groups must be available before type conversion in pass 2).
   */
  private collectRawDefinitions(schema: any, sourceFile: string): void {
    // Groups and attribute groups are stored raw (no conversion needed)
    for (const g of this.asArray(schema["xsd:group"])) {
      const name = g["@_name"];
      if (name && !this.groups.has(name)) {
        this.groups.set(name, { schema: g, sourceFile });
      }
    }

    for (const ag of this.asArray(schema["xsd:attributeGroup"])) {
      const name = ag["@_name"];
      if (name && !this.attrGroups.has(name)) {
        this.attrGroups.set(name, { schema: ag, sourceFile });
      }
    }

    // Types and elements: collect raw, convert later
    for (const ct of this.asArray(schema["xsd:complexType"])) {
      if (ct["@_name"]) this.rawComplexTypes.push({ raw: ct, sourceFile });
    }
    for (const st of this.asArray(schema["xsd:simpleType"])) {
      if (st["@_name"]) this.rawSimpleTypes.push({ raw: st, sourceFile });
    }
    for (const el of this.asArray(schema["xsd:element"])) {
      if (el["@_name"]) this.rawElements.push({ raw: el, sourceFile });
    }
  }

  // ── Converters ────────────────────────────────────────────────────────────

  private convertTopLevelElement(el: any): JsonSchema {
    const typeName = el["@_type"];
    if (typeName) return this.resolveTypeRef(typeName);

    const ct = el["xsd:complexType"];
    if (ct) {
      const node = Array.isArray(ct) ? ct[0] : ct;
      return this.convertComplexType(node);
    }

    const st = el["xsd:simpleType"];
    if (st) {
      const node = Array.isArray(st) ? st[0] : st;
      return this.convertSimpleType(node);
    }

    return {};
  }

  private convertComplexType(ct: any): JsonSchema {
    // complexContent: extension or restriction of another complex type
    if (ct["xsd:complexContent"]) {
      return this.convertComplexContent(ct["xsd:complexContent"]);
    }

    // simpleContent: extend a simple type with attributes
    if (ct["xsd:simpleContent"]) {
      return this.convertSimpleContent(ct["xsd:simpleContent"]);
    }

    // Direct sequence/choice/all + attributes
    const result: JsonSchema = { type: "object" };
    const { properties, required } = this.extractProperties(ct);

    // Direct attributes
    for (const attr of this.asArray(ct["xsd:attribute"])) {
      const name = attr["@_name"];
      if (name) {
        properties[name] = this.resolveTypeRef(attr["@_type"] || "xsd:string");
      }
    }

    // Attribute group refs
    this.inlineAttributeGroups(ct, properties);

    if (Object.keys(properties).length > 0) result.properties = properties;
    if (required.length > 0) result.required = required;

    return result;
  }

  private convertComplexContent(cc: any): JsonSchema {
    if (cc["xsd:extension"]) {
      const ext = cc["xsd:extension"];
      const base = ext["@_base"];
      const baseRef = this.resolveTypeRef(base);
      const { properties, required } = this.extractProperties(ext);

      // Collect attributes from the extension
      for (const attr of this.asArray(ext["xsd:attribute"])) {
        const name = attr["@_name"];
        if (name) {
          properties[name] = this.resolveTypeRef(attr["@_type"] || "xsd:string");
        }
      }
      this.inlineAttributeGroups(ext, properties);

      const additional: JsonSchema = {};
      if (Object.keys(properties).length > 0) additional.properties = properties;
      if (required.length > 0) additional.required = required;

      if (Object.keys(additional).length > 0) {
        return { allOf: [baseRef, additional] };
      }
      return baseRef;
    }

    if (cc["xsd:restriction"]) {
      const base = cc["xsd:restriction"]["@_base"];
      return base ? this.resolveTypeRef(base) : {};
    }

    return {};
  }

  private convertSimpleContent(sc: any): JsonSchema {
    if (sc["xsd:extension"]) {
      const ext = sc["xsd:extension"];
      const base = ext["@_base"];
      const baseSchema = this.resolveTypeRef(base);

      const properties: Record<string, JsonSchema> = { value: baseSchema };
      for (const attr of this.asArray(ext["xsd:attribute"])) {
        const name = attr["@_name"];
        if (name) {
          properties[name] = this.resolveTypeRef(attr["@_type"] || "xsd:string");
        }
      }
      this.inlineAttributeGroups(ext, properties);

      return { type: "object", properties };
    }

    if (sc["xsd:restriction"]) {
      const base = sc["xsd:restriction"]["@_base"];
      return base ? this.resolveTypeRef(base) : { type: "string" };
    }

    return { type: "string" };
  }

  private convertSimpleType(st: any): JsonSchema {
    if (st["xsd:restriction"]) {
      const rest = st["xsd:restriction"];
      const base = rest["@_base"];
      const result = base ? { ...this.resolveTypeRef(base) } : { type: "string" as const };

      const enums = this.asArray(rest["xsd:enumeration"]);
      if (enums.length > 0) {
        result.enum = enums.map((e: any) => e["@_value"]);
      }

      const patterns = this.asArray(rest["xsd:pattern"]);
      if (patterns.length > 0) {
        (result as any).pattern = patterns[0]["@_value"];
      }

      if (rest["xsd:minLength"]) (result as any).minLength = parseInt(rest["xsd:minLength"]["@_value"]);
      if (rest["xsd:maxLength"]) (result as any).maxLength = parseInt(rest["xsd:maxLength"]["@_value"]);
      if (rest["xsd:minInclusive"]) (result as any).minimum = parseFloat(rest["xsd:minInclusive"]["@_value"]);
      if (rest["xsd:maxInclusive"]) (result as any).maximum = parseFloat(rest["xsd:maxInclusive"]["@_value"]);

      return result;
    }

    if (st["xsd:union"]) {
      const memberTypes = st["xsd:union"]["@_memberTypes"];
      if (memberTypes) {
        return { anyOf: memberTypes.split(/\s+/).map((t: string) => this.resolveTypeRef(t)) };
      }
      // Inline member types
      const memberSimpleTypes = this.asArray(st["xsd:union"]["xsd:simpleType"]);
      if (memberSimpleTypes.length > 0) {
        return { anyOf: memberSimpleTypes.map((s: any) => this.convertSimpleType(s)) };
      }
    }

    if (st["xsd:list"]) {
      const itemType = st["xsd:list"]["@_itemType"];
      return {
        type: "array",
        items: itemType ? this.resolveTypeRef(itemType) : { type: "string" },
      };
    }

    return { type: "string" };
  }

  // ── Property extraction ───────────────────────────────────────────────────

  private extractProperties(node: any): { properties: Record<string, JsonSchema>; required: string[] } {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    if (node["xsd:sequence"]) {
      this.processContainer(node["xsd:sequence"], properties, required);
    }
    if (node["xsd:choice"]) {
      this.processContainer(node["xsd:choice"], properties, []); // choice → all optional
    }
    if (node["xsd:all"]) {
      this.processContainer(node["xsd:all"], properties, required);
    }

    // Inline group refs
    for (const g of this.asArray(node["xsd:group"])) {
      const ref = g["@_ref"];
      if (ref) this.inlineGroup(ref, properties, required);
    }

    return { properties, required };
  }

  private processContainer(
    container: any,
    properties: Record<string, JsonSchema>,
    required: string[],
  ): void {
    // Elements
    for (const el of this.asArray(container["xsd:element"])) {
      this.processElement(el, properties, required);
    }

    // Nested groups
    for (const g of this.asArray(container["xsd:group"])) {
      const ref = g["@_ref"];
      if (ref) this.inlineGroup(ref, properties, required);
    }

    // Nested choice inside sequence (elements are optional)
    if (container["xsd:choice"]) {
      const choices = this.asArray(container["xsd:choice"]);
      for (const choice of choices) {
        this.processContainer(choice, properties, []);
      }
    }

    // Nested sequence inside choice
    if (container["xsd:sequence"]) {
      const seqs = this.asArray(container["xsd:sequence"]);
      for (const seq of seqs) {
        this.processContainer(seq, properties, required);
      }
    }
  }

  private processElement(
    el: any,
    properties: Record<string, JsonSchema>,
    required: string[],
  ): void {
    const name = el["@_name"];
    const ref = el["@_ref"];
    const minOccurs = el["@_minOccurs"];
    const maxOccurs = el["@_maxOccurs"];
    const isRequired = minOccurs !== "0";
    const isArray = maxOccurs === "unbounded" || (maxOccurs !== undefined && parseInt(maxOccurs) > 1);

    if (name) {
      let typeSchema: JsonSchema;
      if (el["@_type"]) {
        typeSchema = this.resolveTypeRef(el["@_type"]);
      } else if (el["xsd:complexType"]) {
        const ct = Array.isArray(el["xsd:complexType"]) ? el["xsd:complexType"][0] : el["xsd:complexType"];
        typeSchema = this.convertComplexType(ct);
      } else if (el["xsd:simpleType"]) {
        const st = Array.isArray(el["xsd:simpleType"]) ? el["xsd:simpleType"][0] : el["xsd:simpleType"];
        typeSchema = this.convertSimpleType(st);
      } else {
        typeSchema = {};
      }

      properties[name] = isArray ? { type: "array", items: typeSchema } : typeSchema;
      if (isRequired) required.push(name);
    } else if (ref) {
      const refName = this.stripNs(ref);
      const refSchema: JsonSchema = { $ref: `#/definitions/${refName}` };
      properties[refName] = isArray ? { type: "array", items: refSchema } : refSchema;
      if (isRequired) required.push(refName);
    }
  }

  private inlineGroup(refName: string, properties: Record<string, JsonSchema>, required: string[]): void {
    const localName = this.stripNs(refName);
    const groupDef = this.groups.get(localName);
    if (!groupDef) return;

    const { properties: gProps, required: gReq } = this.extractProperties(groupDef.schema);
    Object.assign(properties, gProps);
    required.push(...gReq);
  }

  private inlineAttributeGroups(node: any, properties: Record<string, JsonSchema>): void {
    for (const ag of this.asArray(node["xsd:attributeGroup"])) {
      const ref = ag["@_ref"];
      if (!ref) continue;
      const localName = this.stripNs(ref);
      const groupDef = this.attrGroups.get(localName);
      if (!groupDef) continue;

      for (const attr of this.asArray(groupDef.schema["xsd:attribute"])) {
        const name = attr["@_name"];
        if (name) {
          properties[name] = this.resolveTypeRef(attr["@_type"] || "xsd:string");
        }
      }
    }
  }

  // ── Type resolution ───────────────────────────────────────────────────────

  private resolveTypeRef(typeName: string): JsonSchema {
    if (!typeName) return {};

    // XSD built-in type (with prefix)
    if (XSD_TYPE_MAP[typeName]) return { ...XSD_TYPE_MAP[typeName] };

    // Strip namespace prefix and try again
    const localName = this.stripNs(typeName);
    const prefixed = `xsd:${localName}`;
    if (XSD_TYPE_MAP[prefixed]) return { ...XSD_TYPE_MAP[prefixed] };

    // Reference to a user-defined type
    return { $ref: `#/definitions/${localName}` };
  }

  // ── Output ────────────────────────────────────────────────────────────────

  /**
   * Build a JSON Schema containing definitions from files matching the filter.
   * Adds placeholder `{}` definitions for any $ref targets not in the output.
   * Triggers conversion if not already done.
   */
  toJsonSchema(enabledFilter?: (sourceFile: string) => boolean): JsonSchema {
    this.convert();
    const definitions: Record<string, JsonSchema> = {};

    for (const [name, entry] of this.types) {
      if (!enabledFilter || enabledFilter(entry.sourceFile)) {
        definitions[name] = entry.schema;
      }
    }

    for (const [name, entry] of this.elements) {
      if (!enabledFilter || enabledFilter(entry.sourceFile)) {
        if (!definitions[name]) {
          definitions[name] = entry.schema;
        }
      }
    }

    // Add placeholder definitions for referenced-but-absent types
    this.addPlaceholders(definitions);

    return {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "netex.json",
      type: "object",
      definitions,
    };
  }

  private addPlaceholders(definitions: Record<string, JsonSchema>): void {
    const visited = new Set<string>();
    const queue = [...Object.values(definitions)];

    while (queue.length > 0) {
      const obj = queue.pop()!;
      if (typeof obj !== "object" || obj === null) continue;

      for (const [key, val] of Object.entries(obj)) {
        if (key === "$ref" && typeof val === "string" && val.startsWith("#/definitions/")) {
          const refName = val.substring("#/definitions/".length);
          if (!definitions[refName]) {
            definitions[refName] = {}; // placeholder → compiles as unknown
          }
        }
        if (typeof val === "object" && val !== null && !visited.has(val as any)) {
          visited.add(val as any);
          queue.push(val as any);
        }
      }
    }
  }

  /** Return the source file for a given type or element name. */
  getSourceFile(name: string): string | undefined {
    this.convert();
    return this.types.get(name)?.sourceFile ?? this.elements.get(name)?.sourceFile;
  }

  get stats() {
    this.convert();
    return {
      files: this.parsedFiles.size,
      types: this.types.size,
      elements: this.elements.size,
      groups: this.groups.size,
      attrGroups: this.attrGroups.size,
    };
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private stripNs(name: string): string {
    const colon = name.indexOf(":");
    return colon >= 0 ? name.substring(colon + 1) : name;
  }

  private asArray(val: any): any[] {
    if (val === undefined || val === null) return [];
    return Array.isArray(val) ? val : [val];
  }

  private warn(msg: string): void {
    this.warnings.push(msg);
  }
}
