/**
 * Custom XSD → JSON Schema converter for NeTEx.
 *
 * Uses fast-xml-parser to parse XSD files and converts them to JSON Schema Draft 07.
 * Handles xs:include/xs:import by recursively loading referenced files.
 *
 * Why custom? xsd2jsonschema (the npm package) has xs:include as a no-op and crashes
 * on xsd:simpleContent — both are fundamental NeTEx patterns.
 */

import type { JSONSchema7 } from "json-schema";
import { XMLParser } from "fast-xml-parser";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

export type JsonSchema = JSONSchema7 & {
  xml?: { attribute?: boolean };
  "x-netex-leaf"?: string;
};

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
  "xsd:NMTOKENS": { type: "string" },
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

    // Pass 3: annotate simpleContent-derived types with their leaf primitive.
    this.annotateValueLeaves();
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

  /**
   * Extract xsd:documentation text from an xsd:annotation child node.
   * Handles both plain string and { "#text": "..." } forms (when xml:lang present).
   */
  private extractDescription(node: any): string | undefined {
    const ann = node?.["xsd:annotation"];
    if (!ann) return undefined;
    const doc = ann["xsd:documentation"];
    if (doc === undefined || doc === null) return undefined;
    const text = typeof doc === "string" ? doc : typeof doc === "object" ? doc["#text"] : undefined;
    return typeof text === "string" ? text.trim() || undefined : undefined;
  }

  /**
   * Attach a description to a schema, wrapping $ref in allOf when needed.
   * json-schema-to-typescript chokes on $ref + sibling description (infinite recursion
   * on circular refs), so we use allOf to keep them separate.
   */
  private withDescription(schema: JsonSchema, desc: string | undefined): JsonSchema {
    if (!desc) return schema;
    if (schema.$ref) {
      return { allOf: [schema], description: desc };
    }
    schema.description = desc;
    return schema;
  }

  private convertTopLevelElement(el: any): JsonSchema {
    const desc = this.extractDescription(el);
    const typeName = el["@_type"];
    if (typeName) {
      return this.withDescription(this.resolveTypeRef(typeName), desc);
    }

    const ct = el["xsd:complexType"];
    if (ct) {
      const node = Array.isArray(ct) ? ct[0] : ct;
      const result = this.convertComplexType(node);
      if (desc && !result.description) result.description = desc;
      return result;
    }

    const st = el["xsd:simpleType"];
    if (st) {
      const node = Array.isArray(st) ? st[0] : st;
      const result = this.convertSimpleType(node);
      if (desc && !result.description) result.description = desc;
      return result;
    }

    return desc ? { description: desc } : {};
  }

  private convertComplexType(ct: any): JsonSchema {
    const desc = this.extractDescription(ct);

    // complexContent: extension or restriction of another complex type
    if (ct["xsd:complexContent"]) {
      const result = this.convertComplexContent(ct["xsd:complexContent"]);
      if (desc && !result.description) result.description = desc;
      return result;
    }

    // simpleContent: extend a simple type with attributes
    if (ct["xsd:simpleContent"]) {
      const result = this.convertSimpleContent(ct["xsd:simpleContent"]);
      if (desc && !result.description) result.description = desc;
      return result;
    }

    // Direct sequence/choice/all + attributes
    const result: JsonSchema = { type: "object" };
    if (desc) result.description = desc;
    const { properties, required } = this.extractProperties(ct);

    // Direct attributes
    for (const attr of this.asArray(ct["xsd:attribute"])) {
      const name = attr["@_name"];
      if (name) {
        const schema = this.withDescription(
          this.resolveTypeRef(attr["@_type"] || "xsd:string"),
          this.extractDescription(attr),
        );
        schema.xml = { attribute: true };
        properties[name] = schema;
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
          const schema = this.withDescription(
            this.resolveTypeRef(attr["@_type"] || "xsd:string"),
            this.extractDescription(attr),
          );
          schema.xml = { attribute: true };
          properties[name] = schema;
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
          const schema = this.withDescription(
            this.resolveTypeRef(attr["@_type"] || "xsd:string"),
            this.extractDescription(attr),
          );
          schema.xml = { attribute: true };
          properties[name] = schema;
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
    const desc = this.extractDescription(st);

    if (st["xsd:restriction"]) {
      const rest = st["xsd:restriction"];
      const base = rest["@_base"];
      const result: JsonSchema = base ? { ...this.resolveTypeRef(base) } : { type: "string" };
      if (desc) result.description = desc;

      const enums = this.asArray(rest["xsd:enumeration"]);
      if (enums.length > 0) {
        result.enum = [...new Set(enums.map((e: any) => e["@_value"]))];
      }

      const patterns = this.asArray(rest["xsd:pattern"]);
      if (patterns.length > 0) {
        result.pattern = patterns[0]["@_value"];
      }

      if (rest["xsd:minLength"]) result.minLength = parseInt(rest["xsd:minLength"]["@_value"]);
      if (rest["xsd:maxLength"]) result.maxLength = parseInt(rest["xsd:maxLength"]["@_value"]);
      if (rest["xsd:minInclusive"]) result.minimum = parseFloat(rest["xsd:minInclusive"]["@_value"]);
      if (rest["xsd:maxInclusive"]) result.maximum = parseFloat(rest["xsd:maxInclusive"]["@_value"]);

      return result;
    }

    if (st["xsd:union"]) {
      const memberTypes = st["xsd:union"]["@_memberTypes"];
      if (memberTypes) {
        const result: JsonSchema = {
          anyOf: memberTypes.split(/\s+/).map((t: string) => this.resolveTypeRef(t)),
        };
        if (desc) result.description = desc;
        return result;
      }
      // Inline member types
      const memberSimpleTypes = this.asArray(st["xsd:union"]["xsd:simpleType"]);
      if (memberSimpleTypes.length > 0) {
        const result: JsonSchema = {
          anyOf: memberSimpleTypes.map((s: any) => this.convertSimpleType(s)),
        };
        if (desc) result.description = desc;
        return result;
      }
    }

    if (st["xsd:list"]) {
      const itemType = st["xsd:list"]["@_itemType"];
      const result: JsonSchema = {
        type: "array",
        items: itemType ? this.resolveTypeRef(itemType) : { type: "string" },
      };
      if (desc) result.description = desc;
      return result;
    }

    return desc ? { type: "string", description: desc } : { type: "string" };
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
    const desc = this.extractDescription(el);

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

      typeSchema = this.withDescription(typeSchema, desc);
      properties[name] = isArray ? { type: "array", items: typeSchema } : typeSchema;
      if (isRequired) required.push(name);
    } else if (ref) {
      const refName = this.stripNs(ref);
      const refSchema: JsonSchema = { $ref: `#/definitions/${refName}` };
      properties[refName] = isArray
        ? this.withDescription({ type: "array", items: refSchema }, desc)
        : this.withDescription(refSchema, desc);
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
          const schema = this.withDescription(
            this.resolveTypeRef(attr["@_type"] || "xsd:string"),
            this.extractDescription(attr),
          );
          schema.xml = { attribute: true };
          properties[name] = schema;
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

  // ── Leaf annotation ───────────────────────────────────────────────────────

  /**
   * Annotate simpleContent-derived types with `x-netex-leaf`.
   *
   * XSD simpleContent types wrap a primitive `value` property with XML attribute
   * metadata. The converter flattens these into `{ type: "object", properties:
   * { value: baseRef, ...attrs } }`, which is structurally correct but hides
   * the underlying primitive from consumers.
   *
   * This pass walks every definition that has a `value` property, follows the
   * chain through $ref aliases and intermediate value-wrapping types, and stamps
   * the result on the definition as `x-netex-leaf: "string"` (or number, etc.).
   *
   * Design choice (Option B — propagate through the full chain):
   *   Every type whose `value` property ultimately resolves to a primitive gets
   *   annotated, even through intermediaries. For example:
   *     GroupOfEntitiesRefStructure_Dummy → value → VersionOfObjectRefStructure
   *     VersionOfObjectRefStructure → value → ObjectIdType → string
   *   Both get `x-netex-leaf: "string"`.
   *
   * Alternative (Option A — annotate only the direct simpleContent type):
   *   Only the type that directly wraps a primitive `value` gets annotated.
   *   Consumers must still chase intermediate refs. Simpler in the converter
   *   but pushes complexity to every viewer/consumer.
   */
  private annotateValueLeaves(): void {
    const allDefs = new Map<string, JsonSchema>();
    for (const [n, e] of this.types) allDefs.set(n, e.schema);
    for (const [n, e] of this.elements) {
      if (!allDefs.has(n)) allDefs.set(n, e.schema);
    }

    for (const [name, schema] of allDefs) {
      if (this.getValueProperties(schema)?.value) {
        const leaf = this.resolveValueLeaf(name, allDefs, new Set());
        if (leaf) schema["x-netex-leaf"] = leaf;
      }
    }
  }

  /**
   * Follow the `value` property chain to find the underlying primitive type.
   *
   * Handles three link types in the chain:
   *   1. $ref aliases — definition is just `{ $ref: "..." }`
   *   2. allOf inheritance — parent may carry the `value` property
   *   3. value → $ref — `value` property points to another type that may itself
   *      be a value-wrapper (Option B recursion)
   *
   * Returns the primitive type name ("string", "number", etc.) or null if the
   * chain doesn't bottom out at a primitive.
   */
  private resolveValueLeaf(
    name: string,
    allDefs: Map<string, JsonSchema>,
    visited: Set<string>,
  ): string | null {
    if (visited.has(name)) return null;
    visited.add(name);

    const def = allDefs.get(name);
    if (!def) return null;

    // $ref alias (e.g. VehicleType → VehicleType_VersionStructure)
    if (def.$ref) {
      return this.resolveValueLeaf(
        def.$ref.replace("#/definitions/", ""),
        allDefs,
        visited,
      );
    }

    // allOf: check parent for value property
    if (def.allOf) {
      for (const entry of def.allOf as JsonSchema[]) {
        if (entry.$ref) {
          const result = this.resolveValueLeaf(
            entry.$ref.replace("#/definitions/", ""),
            allDefs,
            visited,
          );
          if (result) return result;
        }
      }
    }

    // Terminal: definition IS a simple type (reached via $ref alias chain)
    if (def.type && typeof def.type === "string" && def.type !== "object") {
      return def.type;
    }

    // Look for a `value` property (may be on def.properties or inside allOf)
    const props = this.getValueProperties(def);
    if (!props?.value) return null;
    const vp = props.value as JsonSchema;

    // value points to another type — recurse (Option B: follow the full chain)
    if (vp.$ref) {
      const target = vp.$ref.replace("#/definitions/", "");
      // Target may itself be a value-wrapper → recurse
      const inner = this.resolveValueLeaf(target, allDefs, visited);
      if (inner) return inner;
      // Or target may be a simple type (string, number) → check directly
      const targetDef = allDefs.get(target);
      if (targetDef?.type && typeof targetDef.type === "string" && targetDef.type !== "object") {
        return targetDef.type;
      }
      return null;
    }

    // value is an inline primitive
    if (vp.type && typeof vp.type === "string" && vp.type !== "object") {
      return vp.type;
    }

    return null;
  }

  /** Get properties from a definition, checking both top-level and allOf members. */
  private getValueProperties(def: JsonSchema): Record<string, JsonSchema> | null {
    if (def.properties) return def.properties as Record<string, JsonSchema>;
    if (def.allOf) {
      for (const entry of def.allOf as JsonSchema[]) {
        if (entry.properties) return entry.properties as Record<string, JsonSchema>;
      }
    }
    return null;
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

  /** Return all definition names → source file paths (types + elements). */
  getTypeSourceMap(): Map<string, string> {
    this.convert();
    const map = new Map<string, string>();
    for (const [name, entry] of this.types) map.set(name, entry.sourceFile);
    for (const [name, entry] of this.elements) {
      if (!map.has(name)) map.set(name, entry.sourceFile);
    }
    return map;
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
