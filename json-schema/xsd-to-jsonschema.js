/**
 * XSD → JSON Schema converter for NeTEx — GraalVM JavaScript edition.
 *
 * Feature-parity port of typescript/scripts/xsd-to-jsonschema-1st-try.ts.
 * Uses Java DOM (via GraalVM Java interop) instead of fast-xml-parser.
 * No Node.js APIs — plain JS + Java.type().
 *
 * Usage (via Maven):
 *   mvn generate-resources exec:exec -Dexec.args="<xsdRoot> <outDir> [configPath] [--parts <key,key,...>]"
 *
 * Or directly:
 *   js --jvm --vm.cp="$(cat target/classpath.txt)" xsd-to-jsonschema.js <xsdRoot> <outDir> [configPath] [--parts <key,key,...>]
 */

// ── Java type imports ────────────────────────────────────────────────────────

const Files = Java.type("java.nio.file.Files");
const Paths = Java.type("java.nio.file.Paths");
const StandardCharsets = Java.type("java.nio.charset.StandardCharsets");
const DocumentBuilderFactory = Java.type("javax.xml.parsers.DocumentBuilderFactory");
const NodeConst = Java.type("org.w3c.dom.Node");

// ── DOM helpers ──────────────────────────────────────────────────────────────

const XSD_NS = "http://www.w3.org/2001/XMLSchema";

/**
 * Return direct child elements matching the given namespace URI and local name.
 * Does NOT recurse — only immediate children.
 */
function getChildren(parent, ns, localName) {
  const result = [];
  if (!parent) return result;
  const children = parent.getChildNodes();
  // Indexed loop — for-of doesn't work on Java NodeList
  for (let i = 0; i < children.getLength(); i++) {
    const c = children.item(i);
    if (c.getNodeType() === NodeConst.ELEMENT_NODE &&
        c.getLocalName() === localName &&
        (ns === null || c.getNamespaceURI() === ns)) {
      result.push(c);
    }
  }
  return result;
}

function getFirstChild(parent, ns, localName) {
  if (!parent) return null;
  const children = parent.getChildNodes();
  // Indexed loop — for-of doesn't work on Java NodeList
  for (let i = 0; i < children.getLength(); i++) {
    const c = children.item(i);
    if (c.getNodeType() === NodeConst.ELEMENT_NODE &&
        c.getLocalName() === localName &&
        (ns === null || c.getNamespaceURI() === ns)) {
      return c;
    }
  }
  return null;
}

function getText(el) {
  if (!el) return null;
  const t = el.getTextContent();
  return t ? ("" + t).trim() || null : null;
}

function attr(el, name) {
  if (!el) return null;
  const a = el.getAttribute(name);
  return (a !== null && a !== "") ? "" + a : null;
}

/**
 * Pure-JS path resolution matching Node.js path.join(dirname(base), rel).
 * Avoids Java Path API whose normalization can differ from Node.js.
 */
function resolvePath(basePath, relPath) {
  let dir = basePath.replace(/\\/g, "/");
  const lastSlash = dir.lastIndexOf("/");
  dir = lastSlash >= 0 ? dir.substring(0, lastSlash) : "";

  const segments = (dir ? `${dir}/${relPath}` : relPath).replace(/\\/g, "/").split("/");

  const result = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && result.length > 0 && result[result.length - 1] !== "..") {
      result.pop();
    } else {
      result.push(seg);
    }
  }
  return result.join("/");
}

// ── XSD built-in types → JSON Schema ────────────────────────────────────────

const XSD_TYPE_MAP = {
  "string":            { type: "string" },
  "normalizedString":  { type: "string" },
  "token":             { type: "string" },
  "NCName":            { type: "string" },
  "NMTOKEN":           { type: "string" },
  "NMTOKENS":          { type: "string" },
  "Name":              { type: "string" },
  "ID":                { type: "string" },
  "IDREF":             { type: "string" },
  "language":          { type: "string" },
  "anyURI":            { type: "string", format: "uri" },
  "boolean":           { type: "boolean" },
  "integer":           { type: "integer" },
  "int":               { type: "integer" },
  "long":              { type: "integer" },
  "short":             { type: "integer" },
  "byte":              { type: "integer" },
  "positiveInteger":   { type: "integer", minimum: 1 },
  "nonNegativeInteger":{ type: "integer", minimum: 0 },
  "decimal":           { type: "number" },
  "float":             { type: "number" },
  "double":            { type: "number" },
  "date":              { type: "string", format: "date" },
  "dateTime":          { type: "string", format: "date-time" },
  "time":              { type: "string", format: "time" },
  "duration":          { type: "string" },
  "gYear":             { type: "string" },
  "gYearMonth":        { type: "string" },
  "gMonth":            { type: "string" },
  "gMonthDay":         { type: "string" },
  "gDay":              { type: "string" },
  "hexBinary":         { type: "string" },
  "base64Binary":      { type: "string" },
  "anySimpleType":     {},
  "anyType":           {},
};

// ── XsdToJsonSchema ──────────────────────────────────────────────────────────

class XsdToJsonSchema {
  constructor(xsdRoot) {
    this.xsdRoot = xsdRoot;

    // Registries
    this.types = {};       // name → { name, schema, sourceFile }
    this.groups = {};      // name → { schema (DOM node), sourceFile }
    this.attrGroups = {};  // name → { schema (DOM node), sourceFile }
    this.elements = {};    // name → { name, schema, sourceFile }
    this.parsedFiles = {};

    // Raw definitions collected in pass 1
    this.rawComplexTypes = [];
    this.rawSimpleTypes = [];
    this.rawElements = [];

    this.elementMeta = {}; // name → { abstract, substitutionGroup }

    this.converted = false;
    this.warnings = [];
    this.frameRegistry = {}; // entity name → [frame names], populated externally

    // DocumentBuilder setup
    const factory = DocumentBuilderFactory.newInstance();
    factory.setNamespaceAware(true);
    factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
    factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
    factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
    this.builder = factory.newDocumentBuilder();
  }

  // ── File loading ───────────────────────────────────────────────────────────

  loadFile(relativePath) {
    const normalized = relativePath.replace(/\\/g, "/");
    if (this.parsedFiles[normalized]) return;
    this.parsedFiles[normalized] = true;

    const fullPath = Paths.get(this.xsdRoot, normalized).normalize().toString();
    const file = Paths.get(fullPath).toFile();
    if (!file.exists()) {
      this.warn(`cannot read ${normalized}, skipping`);
      return;
    }

    let doc;
    try {
      doc = this.builder.parse(file);
    } catch (e) {
      this.warn(`parse error in ${normalized}: ${e.getMessage()}`);
      return;
    }

    const schema = doc.getDocumentElement();
    if (!schema || schema.getLocalName() !== "schema") {
      this.warn(`no xsd:schema root in ${normalized}, skipping`);
      return;
    }

    for (const inc of getChildren(schema, XSD_NS, "include")) {
      const loc = attr(inc, "schemaLocation");
      if (loc) this.loadFile(resolvePath(normalized, loc));
    }

    for (const imp of getChildren(schema, XSD_NS, "import")) {
      const loc = attr(imp, "schemaLocation");
      if (loc) this.loadFile(resolvePath(normalized, loc));
    }

    this.collectRawDefinitions(schema, normalized);
  }

  // ── Pass 1: collect raw definitions ────────────────────────────────────────

  collectRawDefinitions(schema, sourceFile) {
    for (const g of getChildren(schema, XSD_NS, "group")) {
      const name = attr(g, "name");
      if (name && !this.groups[name]) {
        this.groups[name] = { schema: g, sourceFile };
      }
    }

    for (const ag of getChildren(schema, XSD_NS, "attributeGroup")) {
      const name = attr(ag, "name");
      if (name && !this.attrGroups[name]) {
        this.attrGroups[name] = { schema: ag, sourceFile };
      }
    }

    for (const ct of getChildren(schema, XSD_NS, "complexType")) {
      if (attr(ct, "name")) {
        this.rawComplexTypes.push({ raw: ct, sourceFile });
      }
    }

    for (const st of getChildren(schema, XSD_NS, "simpleType")) {
      if (attr(st, "name")) {
        this.rawSimpleTypes.push({ raw: st, sourceFile });
      }
    }

    for (const el of getChildren(schema, XSD_NS, "element")) {
      if (attr(el, "name")) {
        this.rawElements.push({ raw: el, sourceFile });
      }
    }
  }

  // ── Pass 2: convert ────────────────────────────────────────────────────────

  convert() {
    if (this.converted) return;
    this.converted = true;

    const seenTypes = new Set();

    for (const { raw, sourceFile } of this.rawComplexTypes) {
      const name = attr(raw, "name");
      if (!name || seenTypes.has(name)) continue;
      seenTypes.add(name);
      try {
        this.types[name] = { name, schema: this.convertComplexType(raw), sourceFile };
      } catch (e) {
        this.warn(`failed to convert complexType '${name}' in ${sourceFile}: ${e}`);
      }
    }

    for (const { raw, sourceFile } of this.rawSimpleTypes) {
      const name = attr(raw, "name");
      if (!name || seenTypes.has(name)) continue;
      seenTypes.add(name);
      try {
        this.types[name] = { name, schema: this.convertSimpleType(raw), sourceFile };
      } catch (e) {
        this.warn(`failed to convert simpleType '${name}' in ${sourceFile}: ${e}`);
      }
    }

    const seenElements = new Set();
    for (const { raw, sourceFile } of this.rawElements) {
      const name = attr(raw, "name");
      if (!name || seenElements.has(name)) continue;
      seenElements.add(name);
      // Capture element metadata before conversion
      this.elementMeta[name] = {
        abstract: attr(raw, "abstract") === "true",
        substitutionGroup: attr(raw, "substitutionGroup")
          ? this.stripNs(attr(raw, "substitutionGroup"))
          : null,
      };
      try {
        this.elements[name] = { name, schema: this.convertTopLevelElement(raw), sourceFile };
      } catch (e) {
        this.warn(`failed to convert element '${name}' in ${sourceFile}: ${e}`);
      }
    }

    // Pass 3: annotate value leaves
    this.annotateValueLeaves();

    // Pass 4: classify definitions by role
    this.classifyDefinitions();
  }

  // ── Description extraction ─────────────────────────────────────────────────

  extractDescription(node) {
    if (!node) return null;
    const ann = getFirstChild(node, XSD_NS, "annotation");
    if (!ann) return null;
    const doc = getFirstChild(ann, XSD_NS, "documentation");
    if (!doc) return null;
    return getText(doc) || null;
  }

  withDescription(schema, desc) {
    if (!desc) return schema;
    if (schema.$ref) {
      return { allOf: [schema], description: desc };
    }
    schema.description = desc;
    return schema;
  }

  // ── Converters ─────────────────────────────────────────────────────────────

  convertTopLevelElement(el) {
    const desc = this.extractDescription(el);
    const typeName = attr(el, "type");
    if (typeName) {
      return this.withDescription(this.resolveTypeRef(typeName), desc);
    }

    const ct = getFirstChild(el, XSD_NS, "complexType");
    if (ct) {
      const result = this.convertComplexType(ct);
      if (desc && !result.description) result.description = desc;
      return result;
    }

    const st = getFirstChild(el, XSD_NS, "simpleType");
    if (st) {
      const result = this.convertSimpleType(st);
      if (desc && !result.description) result.description = desc;
      return result;
    }

    return desc ? { description: desc } : {};
  }

  convertComplexType(ct) {
    const desc = this.extractDescription(ct);

    const cc = getFirstChild(ct, XSD_NS, "complexContent");
    if (cc) {
      const result = this.convertComplexContent(cc);
      if (desc && !result.description) result.description = desc;
      return result;
    }

    const sc = getFirstChild(ct, XSD_NS, "simpleContent");
    if (sc) {
      const result = this.convertSimpleContent(sc);
      if (desc && !result.description) result.description = desc;
      return result;
    }

    const result = { type: "object" };
    if (desc) result.description = desc;
    const { properties, required } = this.extractProperties(ct);

    for (const a of getChildren(ct, XSD_NS, "attribute")) {
      const name = attr(a, "name");
      if (name) {
        const schema = this.withDescription(
          this.resolveTypeRef(attr(a, "type") || "xsd:string"),
          this.extractDescription(a)
        );
        schema.xml = { attribute: true };
        properties[name] = schema;
      }
    }

    this.inlineAttributeGroups(ct, properties);

    if (Object.keys(properties).length > 0) result.properties = properties;
    if (required.length > 0) result.required = required;

    return result;
  }

  convertComplexContent(cc) {
    const ext = getFirstChild(cc, XSD_NS, "extension");
    if (ext) {
      const base = attr(ext, "base");
      const baseRef = this.resolveTypeRef(base);
      const { properties, required } = this.extractProperties(ext);

      for (const a of getChildren(ext, XSD_NS, "attribute")) {
        const name = attr(a, "name");
        if (name) {
          const schema = this.withDescription(
            this.resolveTypeRef(attr(a, "type") || "xsd:string"),
            this.extractDescription(a)
          );
          schema.xml = { attribute: true };
          properties[name] = schema;
        }
      }
      this.inlineAttributeGroups(ext, properties);

      const additional = {};
      if (Object.keys(properties).length > 0) additional.properties = properties;
      if (required.length > 0) additional.required = required;

      if (Object.keys(additional).length > 0) {
        return { allOf: [baseRef, additional] };
      }
      return baseRef;
    }

    const restr = getFirstChild(cc, XSD_NS, "restriction");
    if (restr) {
      const base = attr(restr, "base");
      return base ? this.resolveTypeRef(base) : {};
    }

    return {};
  }

  convertSimpleContent(sc) {
    const ext = getFirstChild(sc, XSD_NS, "extension");
    if (ext) {
      const base = attr(ext, "base");
      const baseSchema = this.resolveTypeRef(base);

      const properties = { value: baseSchema };
      for (const a of getChildren(ext, XSD_NS, "attribute")) {
        const name = attr(a, "name");
        if (name) {
          const schema = this.withDescription(
            this.resolveTypeRef(attr(a, "type") || "xsd:string"),
            this.extractDescription(a)
          );
          schema.xml = { attribute: true };
          properties[name] = schema;
        }
      }
      this.inlineAttributeGroups(ext, properties);

      return { type: "object", properties };
    }

    const restr = getFirstChild(sc, XSD_NS, "restriction");
    if (restr) {
      const base = attr(restr, "base");
      return base ? this.resolveTypeRef(base) : { type: "string" };
    }

    return { type: "string" };
  }

  convertSimpleType(st) {
    const desc = this.extractDescription(st);

    const rest = getFirstChild(st, XSD_NS, "restriction");
    if (rest) {
      const base = attr(rest, "base");
      const result = base ? { ...this.resolveTypeRef(base) } : { type: "string" };
      if (desc) result.description = desc;

      // Enumerations — use getAttribute directly to preserve empty string values
      const enums = getChildren(rest, XSD_NS, "enumeration");
      if (enums.length > 0) {
        const seen = new Set();
        const values = [];
        for (const en of enums) {
          let v = en.getAttribute("value");
          if (v !== null) v = "" + v; // coerce Java String to JS string
          if (v !== null && !seen.has(v)) {
            seen.add(v);
            values.push(v);
          }
        }
        result["enum"] = values;
      }

      // Pattern
      const patterns = getChildren(rest, XSD_NS, "pattern");
      if (patterns.length > 0) {
        result.pattern = attr(patterns[0], "value");
      }

      // Facets
      const minLength = getFirstChild(rest, XSD_NS, "minLength");
      if (minLength) result.minLength = parseInt(attr(minLength, "value"));
      const maxLength = getFirstChild(rest, XSD_NS, "maxLength");
      if (maxLength) result.maxLength = parseInt(attr(maxLength, "value"));
      const minInc = getFirstChild(rest, XSD_NS, "minInclusive");
      if (minInc) result.minimum = parseFloat(attr(minInc, "value"));
      const maxInc = getFirstChild(rest, XSD_NS, "maxInclusive");
      if (maxInc) result.maximum = parseFloat(attr(maxInc, "value"));

      return result;
    }

    // Union
    const union = getFirstChild(st, XSD_NS, "union");
    if (union) {
      const memberTypes = attr(union, "memberTypes");
      if (memberTypes) {
        const anyOf = memberTypes.split(/\s+/).map(t => this.resolveTypeRef(t));
        const result = { anyOf };
        if (desc) result.description = desc;
        return result;
      }
      // Inline member types
      const memberSimpleTypes = getChildren(union, XSD_NS, "simpleType");
      if (memberSimpleTypes.length > 0) {
        const anyOf = memberSimpleTypes.map(m => this.convertSimpleType(m));
        const result = { anyOf };
        if (desc) result.description = desc;
        return result;
      }
    }

    // List
    const list = getFirstChild(st, XSD_NS, "list");
    if (list) {
      const itemType = attr(list, "itemType");
      const result = {
        type: "array",
        items: itemType ? this.resolveTypeRef(itemType) : { type: "string" }
      };
      if (desc) result.description = desc;
      return result;
    }

    return desc ? { type: "string", description: desc } : { type: "string" };
  }

  // ── Property extraction ────────────────────────────────────────────────────

  extractProperties(node) {
    const properties = {};
    const required = [];

    const seq = getFirstChild(node, XSD_NS, "sequence");
    if (seq) this.processContainer(seq, properties, required);

    const choice = getFirstChild(node, XSD_NS, "choice");
    if (choice) this.processContainer(choice, properties, []); // choice → all optional

    const all = getFirstChild(node, XSD_NS, "all");
    if (all) this.processContainer(all, properties, required);

    for (const g of getChildren(node, XSD_NS, "group")) {
      const ref = attr(g, "ref");
      if (ref) this.inlineGroup(ref, properties, required);
    }

    return { properties, required };
  }

  processContainer(container, properties, required) {
    for (const el of getChildren(container, XSD_NS, "element")) {
      this.processElement(el, properties, required);
    }

    for (const g of getChildren(container, XSD_NS, "group")) {
      const ref = attr(g, "ref");
      if (ref) this.inlineGroup(ref, properties, required);
    }

    // Nested choice inside sequence (elements are optional)
    for (const ch of getChildren(container, XSD_NS, "choice")) {
      this.processContainer(ch, properties, []);
    }

    // Nested sequence inside choice
    for (const sq of getChildren(container, XSD_NS, "sequence")) {
      this.processContainer(sq, properties, required);
    }
  }

  processElement(el, properties, required) {
    const name = attr(el, "name");
    const ref = attr(el, "ref");
    const minOccurs = attr(el, "minOccurs");
    const maxOccurs = attr(el, "maxOccurs");
    const isRequired = minOccurs !== "0";
    const isArray = maxOccurs === "unbounded" || (maxOccurs !== null && parseInt(maxOccurs) > 1);
    const desc = this.extractDescription(el);

    if (name) {
      let typeSchema;
      const typeName = attr(el, "type");
      if (typeName) {
        typeSchema = this.resolveTypeRef(typeName);
      } else {
        const ct = getFirstChild(el, XSD_NS, "complexType");
        if (ct) {
          typeSchema = this.convertComplexType(ct);
        } else {
          const st = getFirstChild(el, XSD_NS, "simpleType");
          typeSchema = st ? this.convertSimpleType(st) : {};
        }
      }

      typeSchema = this.withDescription(typeSchema, desc);
      properties[name] = isArray ? { type: "array", items: typeSchema } : typeSchema;
      if (isRequired) required.push(name);
    } else if (ref) {
      const refName = this.stripNs(ref);
      const refSchema = { $ref: `#/definitions/${refName}` };
      properties[refName] = isArray
        ? this.withDescription({ type: "array", items: refSchema }, desc)
        : this.withDescription(refSchema, desc);
      if (isRequired) required.push(refName);
    }
  }

  inlineGroup(refName, properties, required) {
    const localName = this.stripNs(refName);
    const groupDef = this.groups[localName];
    if (!groupDef) return;

    const { properties: gProps, required: gReq } = this.extractProperties(groupDef.schema);
    Object.assign(properties, gProps);
    required.push(...gReq);
  }

  inlineAttributeGroups(node, properties) {
    for (const ag of getChildren(node, XSD_NS, "attributeGroup")) {
      const ref = attr(ag, "ref");
      if (!ref) continue;
      const localName = this.stripNs(ref);
      const groupDef = this.attrGroups[localName];
      if (!groupDef) continue;

      for (const a of getChildren(groupDef.schema, XSD_NS, "attribute")) {
        const name = attr(a, "name");
        if (name) {
          const schema = this.withDescription(
            this.resolveTypeRef(attr(a, "type") || "xsd:string"),
            this.extractDescription(a)
          );
          schema.xml = { attribute: true };
          properties[name] = schema;
        }
      }
    }
  }

  // ── Type resolution ────────────────────────────────────────────────────────

  resolveTypeRef(typeName) {
    if (!typeName) return {};

    const localName = this.stripNs(typeName);

    // XSD built-in type
    if (XSD_TYPE_MAP[localName]) return { ...XSD_TYPE_MAP[localName] };

    // Reference to a user-defined type
    return { $ref: `#/definitions/${localName}` };
  }

  // ── Leaf annotation ────────────────────────────────────────────────────────

  annotateValueLeaves() {
    const allDefs = {};
    for (const [name, entry] of Object.entries(this.types)) {
      allDefs[name] = entry.schema;
    }
    for (const [name, entry] of Object.entries(this.elements)) {
      if (!allDefs[name]) allDefs[name] = entry.schema;
    }

    for (const [name, schema] of Object.entries(allDefs)) {
      const vprops = this.getValueProperties(schema);
      if (vprops?.value) {
        const leaf = this.resolveValueLeaf(name, allDefs, {});
        if (leaf) schema["x-netex-leaf"] = leaf;
      }
    }
  }

  resolveValueLeaf(name, allDefs, visited) {
    if (visited[name]) return null;
    visited[name] = true;

    const def = allDefs[name];
    if (!def) return null;

    // $ref alias
    if (def.$ref) {
      return this.resolveValueLeaf(
        def.$ref.replace("#/definitions/", ""),
        allDefs,
        visited
      );
    }

    // allOf: check parent
    if (def.allOf) {
      for (const entry of def.allOf) {
        if (entry.$ref) {
          const result = this.resolveValueLeaf(
            entry.$ref.replace("#/definitions/", ""),
            allDefs,
            visited
          );
          if (result) return result;
        }
      }
    }

    // Terminal: simple type
    if (def.type && typeof def.type === "string" && def.type !== "object") {
      return def.type;
    }

    // Look for value property
    const props = this.getValueProperties(def);
    if (!props?.value) return null;
    const vp = props.value;

    // value → $ref
    if (vp.$ref) {
      const target = vp.$ref.replace("#/definitions/", "");
      const inner = this.resolveValueLeaf(target, allDefs, visited);
      if (inner) return inner;
      const targetDef = allDefs[target];
      if (targetDef?.type && typeof targetDef.type === "string" && targetDef.type !== "object") {
        return targetDef.type;
      }
      return null;
    }

    // Inline primitive
    if (vp.type && typeof vp.type === "string" && vp.type !== "object") {
      return vp.type;
    }

    return null;
  }

  getValueProperties(def) {
    if (def.properties) return def.properties;
    if (def.allOf) {
      for (const entry of def.allOf) {
        if (entry.properties) return entry.properties;
      }
    }
    return null;
  }

  // ── Role classification ──────────────────────────────────────────────────

  loadFrameRegistry(jsonPath) {
    const content = new java.lang.String(
      Files.readAllBytes(Paths.get(jsonPath)), StandardCharsets.UTF_8
    );
    const raw = JSON.parse("" + content);
    const registry = {}; // entity name → [frame names]
    for (const [frame, entities] of Object.entries(raw)) {
      if (frame.startsWith("_")) continue;
      for (const entity of entities) {
        if (!registry[entity]) registry[entity] = [];
        registry[entity].push(frame);
      }
    }
    return registry;
  }

  extendsDataManagedObject(name) {
    const allDefs = {};
    for (const [n, entry] of Object.entries(this.types)) {
      allDefs[n] = entry.schema;
    }
    for (const [n, entry] of Object.entries(this.elements)) {
      if (!allDefs[n]) allDefs[n] = entry.schema;
    }
    return this._chainHasAncestor(name, allDefs, "DataManagedObjectStructure", {});
  }

  _chainHasAncestor(name, allDefs, target, visited) {
    if (visited[name]) return false;
    visited[name] = true;
    if (name === target) return true;

    const def = allDefs[name];
    if (!def) return false;

    // $ref alias
    if (def.$ref) {
      return this._chainHasAncestor(
        def.$ref.replace("#/definitions/", ""), allDefs, target, visited
      );
    }

    // allOf: follow parent refs
    if (def.allOf) {
      for (const entry of def.allOf) {
        if (entry.$ref) {
          if (this._chainHasAncestor(
            entry.$ref.replace("#/definitions/", ""), allDefs, target, visited
          )) return true;
        }
      }
    }

    return false;
  }

  classifyDefinitions() {
    // Build combined definition map
    const allDefs = {};
    for (const [name, entry] of Object.entries(this.types)) {
      allDefs[name] = entry;
    }
    for (const [name, entry] of Object.entries(this.elements)) {
      if (!allDefs[name]) allDefs[name] = entry;
    }

    for (const [name, entry] of Object.entries(allDefs)) {
      const schema = entry.schema;
      let role = null;

      // 1. Structure suffixes (highest priority — structural classification)
      if (name.endsWith("_VersionStructure") || name.endsWith("_BaseStructure")) {
        role = "structure";
      }
      // 2. Collection
      else if (name.endsWith("_RelStructure")) {
        role = "collection";
      }
      // 3. Reference (suffix patterns)
      else if (name.endsWith("_RefStructure") || name.endsWith("RefStructure")) {
        role = "reference";
      }
      // 4. View
      else if (name.endsWith("_DerivedViewStructure")) {
        role = "view";
      }
      // 5. Enumeration
      else if (schema["enum"]) {
        role = "enumeration";
      }
      // 6. Abstract element
      else if (this.elementMeta[name]?.abstract) {
        role = "abstract";
      }
      // 7. Frame member (from registry)
      else if (this.frameRegistry[name]) {
        role = "frameMember";
        schema["x-netex-frames"] = this.frameRegistry[name].slice().sort();
      }
      // 8. Concrete element with substitutionGroup + DMO ancestry
      else if (
        this.elementMeta[name] &&
        !this.elementMeta[name].abstract &&
        this.elementMeta[name].substitutionGroup &&
        this.extendsDataManagedObject(name)
      ) {
        role = "entity";
      }
      // 9. Name ends in Ref and exists in elements
      else if (name.endsWith("Ref") && this.elements[name]) {
        role = "reference";
      }

      if (role) {
        schema["x-netex-role"] = role;
      }
    }
  }

  // ── Output ─────────────────────────────────────────────────────────────────

  toJsonSchema(enabledFilter) {
    this.convert();
    const definitions = {};

    for (const [name, entry] of Object.entries(this.types)) {
      if (!enabledFilter || enabledFilter(entry.sourceFile)) {
        definitions[name] = entry.schema;
        entry.schema["x-netex-source"] = entry.sourceFile;
      }
    }

    for (const [name, entry] of Object.entries(this.elements)) {
      if (!enabledFilter || enabledFilter(entry.sourceFile)) {
        if (!definitions[name]) {
          definitions[name] = entry.schema;
          entry.schema["x-netex-source"] = entry.sourceFile;
        }
      }
    }

    // Placeholders for missing $ref targets
    this.addPlaceholders(definitions);

    return {
      $schema: "http://json-schema.org/draft-07/schema#",
      definitions
    };
  }

  addPlaceholders(definitions) {
    const visited = new Set();
    const queue = Object.values(definitions);

    while (queue.length > 0) {
      const obj = queue.pop();
      if (typeof obj !== "object" || obj === null) continue;

      for (const [key, val] of Object.entries(obj)) {
        if (key === "$ref" && typeof val === "string" && val.startsWith("#/definitions/")) {
          const refName = val.substring("#/definitions/".length);
          if (!definitions[refName]) {
            definitions[refName] = {};
          }
        }
        if (typeof val === "object" && val !== null && !visited.has(val)) {
          visited.add(val);
          queue.push(val);
        }
      }
    }
  }

  // ── Stats / Warnings ───────────────────────────────────────────────────────

  getStats() {
    this.convert();
    return {
      files: Object.keys(this.parsedFiles).length,
      types: Object.keys(this.types).length,
      elements: Object.keys(this.elements).length,
      groups: Object.keys(this.groups).length,
      attrGroups: Object.keys(this.attrGroups).length
    };
  }

  getWarnings() {
    return this.warnings.slice();
  }

  getSourceFile(name) {
    this.convert();
    const t = this.types[name];
    if (t) return t.sourceFile;
    const e = this.elements[name];
    if (e) return e.sourceFile;
    return null;
  }

  getTypeSourceMap() {
    this.convert();
    const map = {};
    for (const [name, entry] of Object.entries(this.types)) {
      map[name] = entry.sourceFile;
    }
    for (const [name, entry] of Object.entries(this.elements)) {
      if (!map[name]) map[name] = entry.sourceFile;
    }
    return map;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  stripNs(name) {
    const colon = name.indexOf(":");
    return colon >= 0 ? name.substring(colon + 1) : name;
  }

  warn(msg) {
    this.warnings.push(msg);
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

const REQUIRED_PARTS = ["framework", "gml", "siri", "service"];
const REQUIRED_ROOT_XSDS = ["publication"];

const NATURAL_NAMES = {
  part1_network: "network",
  part2_timetable: "timetable",
  part3_fares: "fares",
  part5_new_modes: "new-modes"
};

function resolveAssembly(parts) {
  const enabled = Object.entries(parts)
    .filter(([k, p]) => !k.startsWith("_") && !p.required && p.enabled)
    .map(([k]) => NATURAL_NAMES[k] || k.replace(/^part\d+_/, "").replace(/_/g, "-"))
    .sort();
  return enabled.length === 0 ? "base" : enabled.join("+");
}

function loadConfig(configPath) {
  const content = new java.lang.String(Files.readAllBytes(Paths.get(configPath)), StandardCharsets.UTF_8);
  const raw = JSON.parse("" + content);
  const { parts, rootXsds } = raw;

  for (const key of REQUIRED_PARTS) {
    const part = parts[key];
    if (part) {
      part.required = true;
      part.enabled = true;
    }
  }
  for (const key of REQUIRED_ROOT_XSDS) {
    const xsd = rootXsds[key];
    if (xsd) {
      xsd.required = true;
      xsd.enabled = true;
    }
  }

  return { raw, parts, rootXsds };
}

function enabledDirs(parts) {
  return Object.entries(parts)
    .filter(([k, p]) => !k.startsWith("_") && p.enabled)
    .flatMap(([, p]) => p.dirs);
}

function enabledRootXsdFiles(rootXsds) {
  return Object.entries(rootXsds)
    .filter(([k, v]) => !k.startsWith("_") && v.enabled)
    .map(([, v]) => v.file);
}

function isEnabledPath(sourceFile, enabledDirList, enabledRootXsdList) {
  return enabledDirList.some(dir =>
    sourceFile.startsWith(`${dir}/`) || sourceFile.startsWith(`${dir}\\`)
  ) || enabledRootXsdList.includes(sourceFile);
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
  // Script arguments: try the GraalJS 'arguments' global first,
  // fall back to the 'script.args' system property (set by Maven).
  let args = [];
  if (typeof arguments !== "undefined" && arguments.length > 0) {
    args = Array.prototype.slice.call(arguments);
  } else {
    const System = Java.type("java.lang.System");
    const scriptArgs = System.getProperty("script.args");
    if (scriptArgs) {
      args = ("" + scriptArgs).trim().split(/\s+/);
    }
  }

  // Separate positional args from --parts flag
  const positional = [];
  let cliParts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--parts" && args[i + 1]) {
      cliParts = args[++i].split(",");
    } else {
      positional.push(args[i]);
    }
  }

  if (positional.length < 2) {
    print("Usage: js --jvm xsd-to-jsonschema.js <xsdRoot> <outDir> [configPath] [--parts <key,key,...>]");
    print("  xsdRoot    - path to the versioned XSD directory (e.g. ../xsd/2.0)");
    print("  outDir     - output directory for ASSEMBLY.schema.json");
    print("  configPath - optional path to config.json (for part filtering)");
    print("  --parts    - optional comma-separated list of parts to enable");
    java.lang.System.exit(1);
  }

  const xsdRoot = Paths.get(positional[0]).toAbsolutePath().normalize().toString();
  const outDir = Paths.get(positional[1]).toAbsolutePath().normalize().toString();
  const configPath = positional.length > 2 ? positional[2] : null;

  if (cliParts.length > 0 && !configPath) {
    print("--parts requires a configPath argument");
    java.lang.System.exit(1);
  }

  let enabledDirList = null;
  let enabledRootXsdList = null;
  let assembly = "base";

  if (configPath) {
    const config = loadConfig(configPath);
    // Build reverse lookup: natural name → config key (e.g. "network" → "part1_network")
    const reverseNames = {};
    for (const [k, v] of Object.entries(NATURAL_NAMES)) reverseNames[v] = k;

    // Apply CLI parts (validate each — accept both config keys and natural names)
    for (let part of cliParts) {
      if (reverseNames[part]) part = reverseNames[part]; // resolve natural name
      const p = config.parts[part];
      if (!p || part.startsWith("_")) {
        const optional = Object.keys(config.parts)
          .filter(k => !k.startsWith("_") && !config.parts[k].required);
        const naturalAliases = optional.map(k => NATURAL_NAMES[k] || k);
        print(`ERROR: Unknown part: ${part}`);
        print(`Available optional parts: ${optional.join(", ")}`);
        print(`  (also accepted as: ${naturalAliases.join(", ")})`);
        java.lang.System.exit(1);
      }
      if (p.required) {
        print(`ERROR: Part '${part}' is already required and always enabled.`);
        java.lang.System.exit(1);
      }
      p.enabled = true;
    }
    enabledDirList = enabledDirs(config.parts);
    enabledRootXsdList = enabledRootXsdFiles(config.rootXsds);
    assembly = resolveAssembly(config.parts);
    print(`Config loaded. Assembly: ${assembly}`);
    print(`Enabled dirs: ${enabledDirList.join(", ")}`);
  }

  print(`\nParsing XSD files from: ${xsdRoot}`);
  const converter = new XsdToJsonSchema(xsdRoot);

  // Load frame membership registry (resolve relative to CWD = json-schema/)
  const frameMembersPath = Paths.get("frame-members.json").toAbsolutePath().normalize().toString();
  if (Files.exists(Paths.get(frameMembersPath))) {
    converter.frameRegistry = converter.loadFrameRegistry(frameMembersPath);
    const entityCount = Object.keys(converter.frameRegistry).length;
    print(`Frame registry loaded: ${entityCount} entities`);
  }

  converter.loadFile("NeTEx_publication.xsd");

  const stats = converter.getStats();
  print(`Parsed ${stats.files} files`);
  print(`Found ${stats.types} types, ${stats.elements} elements, ${stats.groups} groups`);

  const warnings = converter.getWarnings();
  if (warnings.length > 0) {
    print(`${warnings.length} warnings:`);
    for (const w of warnings.slice(0, 10)) {
      print(`  - ${w}`);
    }
    if (warnings.length > 10) print(`  ... and ${warnings.length - 10} more`);
  }

  print("\nGenerating JSON Schema...");
  const filter = enabledDirList
    ? (sourceFile) => isEnabledPath(sourceFile, enabledDirList, enabledRootXsdList)
    : null;

  const schema = converter.toJsonSchema(filter);
  schema["x-netex-assembly"] = assembly;
  const defCount = Object.keys(schema.definitions || {}).length;
  print(`${defCount} definitions in filtered schema`);

  const outPath = Paths.get(outDir);
  if (!Files.exists(outPath)) {
    Files.createDirectories(outPath);
  }
  const outFile = outPath.resolve(`${assembly}.schema.json`);
  const json = JSON.stringify(schema, null, 2);
  Files.writeString(outFile, json, StandardCharsets.UTF_8);
  print(`\nWritten to ${outFile.toString()}`);
}

main();
