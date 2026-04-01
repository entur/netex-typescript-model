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

const REF_PREFIX = "#/definitions/";

function deref(ref) {
  return ref.startsWith(REF_PREFIX) ? ref.substring(REF_PREFIX.length) : ref;
}

// When true, frame-registry entries get a distinct "frameMember" role instead of
// falling through to "entity".  Currently false — all DMO-based concrete elements
// are classified as entity, and x-netex-frames is stamped independently of role.
const DIVERSE_FRAME_MEMBERS = false;

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
    if (
      c.getNodeType() === NodeConst.ELEMENT_NODE &&
      c.getLocalName() === localName &&
      (ns === null || c.getNamespaceURI() === ns)
    ) {
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
    if (
      c.getNodeType() === NodeConst.ELEMENT_NODE &&
      c.getLocalName() === localName &&
      (ns === null || c.getNamespaceURI() === ns)
    ) {
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
  return a !== null && a !== "" ? "" + a : null;
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
  string: { type: "string" },
  normalizedString: { type: "string" },
  token: { type: "string" },
  NCName: { type: "string" },
  NMTOKEN: { type: "string" },
  NMTOKENS: { type: "string" },
  Name: { type: "string" },
  ID: { type: "string" },
  IDREF: { type: "string" },
  language: { type: "string" },
  anyURI: { type: "string", format: "uri" },
  boolean: { type: "boolean" },
  integer: { type: "integer" },
  int: { type: "integer" },
  long: { type: "integer" },
  short: { type: "integer" },
  byte: { type: "integer" },
  positiveInteger: { type: "integer", minimum: 1 },
  nonNegativeInteger: { type: "integer", minimum: 0 },
  decimal: { type: "number" },
  float: { type: "number" },
  double: { type: "number" },
  date: { type: "string", format: "date" },
  dateTime: { type: "string", format: "date-time" },
  time: { type: "string", format: "time" },
  duration: { type: "string" },
  gYear: { type: "string" },
  gYearMonth: { type: "string" },
  gMonth: { type: "string" },
  gMonthDay: { type: "string" },
  gDay: { type: "string" },
  hexBinary: { type: "string" },
  base64Binary: { type: "string" },
  anySimpleType: {},
  anyType: {},
};

// ── XsdToJsonSchema ──────────────────────────────────────────────────────────

class XsdToJsonSchema {
  constructor(xsdRoot) {
    this.xsdRoot = xsdRoot;

    // Registries
    this.types = {}; // name → { name, schema, sourceFile }
    this.groups = {}; // name → { schema (DOM node), sourceFile }
    this.attrGroups = {}; // name → { schema (DOM node), sourceFile }
    this.elements = {}; // name → { name, schema, sourceFile }
    this.parsedFiles = {};

    // Raw definitions collected in pass 1
    this.rawComplexTypes = [];
    this.rawSimpleTypes = [];
    this.rawElements = [];

    this.elementMeta = {}; // name → { abstract, substitutionGroup }
    this.sgMembers = {}; // head name → [member names]

    this.allDefs = null;
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

    // Pass 3: build substitution group reverse map
    this.buildSubstitutionGroupRegistry();

    // Build combined definition map (types + elements, schema only)
    this.allDefs = this.buildAllDefs();

    // Pass 4: classify definitions by role
    this.classifyDefinitions();

    // Pass 5: annotate atoms (needs roles to gate inherited types)
    this.annotateAtoms();

    // Pass 6: mark "Fixed for" enum properties
    this.annotateFixedEnumProperties();

    // Pass 7: propagate stamp through $ref alias chains
    this.propagateFixedEnumStamp();

    // Pass 8: mark deprecated definitions (append /deprecated to role)
    this.annotateDeprecated();
  }

  annotateDeprecated() {
    const re = /\bDEPRECATED\b/;
    let defCount = 0, propCount = 0;
    for (const [name, schema] of Object.entries(this.allDefs)) {
      const desc = schema.description || "";
      if (re.test(desc)) {
        const base = schema["x-netex-role"] || "unclassified";
        schema["x-netex-role"] = base + "/deprecated";
        defCount++;
      }
      for (const ps of this.allPropSchemas(schema)) {
        if (re.test(ps.description || "")) { ps["x-netex-deprecated"] = true; propCount++; }
      }
    }
    if (defCount) print("  deprecated defs: " + defCount);
    if (propCount) print("  deprecated props: " + propCount);
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
    if (attr(ct, "mixed") === "true") result["x-netex-mixed"] = true;
    const { properties, required } = this.extractProperties(ct);

    this.processAttributes(ct, properties);
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

      this.processAttributes(ext, properties);
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
      this.processAttributes(ext, properties);
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
        const anyOf = memberTypes.split(/\s+/).map((t) => this.resolveTypeRef(t));
        const result = { anyOf };
        if (desc) result.description = desc;
        return result;
      }
      // Inline member types
      const memberSimpleTypes = getChildren(union, XSD_NS, "simpleType");
      if (memberSimpleTypes.length > 0) {
        const anyOf = memberSimpleTypes.map((m) => this.convertSimpleType(m));
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
        items: itemType ? this.resolveTypeRef(itemType) : { type: "string" },
        "x-netex-atom": "array",
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
    const children = container.getChildNodes();
    for (let i = 0; i < children.getLength(); i++) {
      const c = children.item(i);
      if (c.getNodeType() !== NodeConst.ELEMENT_NODE) continue;
      if (c.getNamespaceURI() !== XSD_NS) continue;
      const tag = c.getLocalName();
      if (tag === "element") {
        this.processElement(c, properties, required);
      } else if (tag === "group") {
        const ref = attr(c, "ref");
        if (ref) this.inlineGroup(ref, properties, required);
      } else if (tag === "choice") {
        const before = new Set(Object.keys(properties));
        this.processContainer(c, properties, []);
        const choiceProps = Object.keys(properties).filter(k => !before.has(k));
        if (choiceProps.length > 1) {
          for (const k of choiceProps) {
            properties[k]["x-netex-choice"] = choiceProps;
          }
        }
      } else if (tag === "sequence") {
        this.processContainer(c, properties, required);
      }
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
      const refSchema = { $ref: `${REF_PREFIX}${refName}` };
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

      this.processAttributes(groupDef.schema, properties);
    }
  }

  processAttributes(node, properties) {
    for (const a of getChildren(node, XSD_NS, "attribute")) {
      const name = attr(a, "name");
      if (name) {
        const schema = this.withDescription(
          this.resolveTypeRef(attr(a, "type") || "xsd:string"),
          this.extractDescription(a),
        );
        schema.xml = { attribute: true };
        properties[name] = schema;
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
    return { $ref: `${REF_PREFIX}${localName}` };
  }

  // ── Atom annotation ────────────────────────────────────────────────────────

  annotateAtoms() {
    const allDefs = this.allDefs;

    // Pass 1: simpleContent wrappers (types with a lowercase "value" property)
    for (const [name, schema] of Object.entries(allDefs)) {
      const vprops = this.getValueProperties(schema);
      if (vprops?.value) {
        const atom = this.resolveValueAtom(name, allDefs, {});
        if (atom) {
          const propCount = Object.keys(vprops).length;
          schema["x-netex-atom"] = propCount === 1 ? atom : "simpleObj";
        }
      }
    }

    // Pass 2: all-primitive structs not caught by pass 1.
    // If every own property is an inline primitive (string/number/integer/boolean/enum),
    // the type is a simple flat object: 1 prop → collapse to that primitive, 2+ → simpleObj.
    for (const [name, schema] of Object.entries(allDefs)) {
      if (schema["x-netex-atom"]) continue;
      if (schema["x-netex-role"]) continue;
      if (schema.allOf && schema.allOf.some((e) => e.$ref)) continue;
      const props = this.getValueProperties(schema);
      if (!props) continue;
      const entries = Object.entries(props);
      if (entries.length === 0) continue;
      const allPrimitive = entries.every(
        ([, p]) => (p.type && p.type !== "object" && p.type !== "array") || p.enum,
      );
      if (!allPrimitive) continue;
      if (entries.length === 1) {
        schema["x-netex-atom"] = entries[0][1].type || "string";
      } else {
        schema["x-netex-atom"] = "simpleObj";
      }
    }
  }

  /**
   * Stamp `x-fixed-single-enum` on properties whose description says "Fixed for"
   * and that reference an enumeration definition. The stamp value is the enum
   * definition name (e.g. "NameOfClass"). The viewer combines this with the
   * display context to produce a string literal.
   */
  /** Yield all property schemas from a def (top-level and inside allOf entries). */
  *allPropSchemas(schema) {
    if (schema.properties) yield* Object.values(schema.properties);
    if (schema.allOf) {
      for (const entry of schema.allOf) {
        if (entry.properties) yield* Object.values(entry.properties);
      }
    }
  }

  annotateFixedEnumProperties() {
    const allDefs = this.allDefs;

    for (const schema of Object.values(allDefs)) {
      for (const propSchema of this.allPropSchemas(schema)) {
        if (!propSchema.description || !/[Ff]ixed for/.test(propSchema.description)) continue;
        const refTarget = this.extractRefTarget(propSchema);
        if (!refTarget) continue;
        const targetDef = allDefs[refTarget];
        if (targetDef && targetDef["x-netex-role"] === "enumeration") {
          propSchema["x-fixed-single-enum"] = refTarget;
        }
      }
    }
  }

  /** Follow $ref alias chains to resolve the underlying def name. */
  resolveRefAlias(name) {
    const visited = new Set();
    let cur = name;
    while (!visited.has(cur)) {
      visited.add(cur);
      const d = this.allDefs[cur];
      if (!d || !d.$ref) break;
      cur = deref(d.$ref);
    }
    return cur;
  }

  /**
   * Propagate x-fixed-single-enum through $ref alias chains.
   * Only stamps properties whose immediate $ref target is a $ref alias def
   * (not a direct enum reference), preventing over-stamping.
   */
  propagateFixedEnumStamp() {
    const allDefs = this.allDefs;
    const fixedTargets = new Set();
    for (const schema of Object.values(allDefs)) {
      for (const ps of this.allPropSchemas(schema)) {
        if (ps["x-fixed-single-enum"]) fixedTargets.add(ps["x-fixed-single-enum"]);
      }
    }
    if (fixedTargets.size === 0) return;

    let count = 0;
    for (const schema of Object.values(allDefs)) {
      for (const ps of this.allPropSchemas(schema)) {
        if (ps["x-fixed-single-enum"]) continue;
        const ref = this.extractRefTarget(ps);
        if (!ref) continue;
        const refDef = allDefs[ref];
        if (!refDef || !refDef.$ref) continue;
        const resolved = this.resolveRefAlias(ref);
        if (fixedTargets.has(resolved)) {
          ps["x-fixed-single-enum"] = resolved;
          count++;
        }
      }
    }
    if (count > 0) print("    stamped " + count + " alias properties as x-fixed-single-enum");
  }

  /** Extract the $ref target name from a property schema (direct $ref or allOf[{$ref}]). */
  extractRefTarget(propSchema) {
    if (propSchema.$ref) {
      return deref(propSchema.$ref);
    }
    if (propSchema.allOf) {
      for (const entry of propSchema.allOf) {
        if (entry.$ref) return deref(entry.$ref);
      }
    }
    return null;
  }

  resolveValueAtom(name, allDefs, visited) {
    if (visited[name]) return null;
    visited[name] = true;

    const def = allDefs[name];
    if (!def) return null;

    // $ref alias
    if (def.$ref) {
      return this.resolveValueAtom(deref(def.$ref), allDefs, visited);
    }

    // allOf: check parent
    if (def.allOf) {
      for (const entry of def.allOf) {
        if (entry.$ref) {
          const result = this.resolveValueAtom(
            deref(entry.$ref),
            allDefs,
            visited,
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
      const target = deref(vp.$ref);
      const inner = this.resolveValueAtom(target, allDefs, visited);
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

  // ── Substitution group registry ─────────────────────────────────────────

  buildSubstitutionGroupRegistry() {
    this.sgMembers = {};
    for (const [name, meta] of Object.entries(this.elementMeta)) {
      if (!meta.substitutionGroup) continue;
      const head = meta.substitutionGroup;
      if (!this.sgMembers[head]) this.sgMembers[head] = [];
      this.sgMembers[head].push(name);
    }
    for (const members of Object.values(this.sgMembers)) {
      members.sort();
    }
  }

  buildAllDefs() {
    const allDefs = {};
    for (const [name, entry] of Object.entries(this.types)) {
      allDefs[name] = entry.schema;
    }
    for (const [name, entry] of Object.entries(this.elements)) {
      if (!allDefs[name]) allDefs[name] = entry.schema;
    }
    return allDefs;
  }

  // ── Role classification ──────────────────────────────────────────────────

  loadFrameRegistry(jsonPath) {
    const content = new java.lang.String(
      Files.readAllBytes(Paths.get(jsonPath)),
      StandardCharsets.UTF_8,
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
    const visited = {};
    const walk = (cur) => {
      if (visited[cur]) return false;
      visited[cur] = true;
      if (cur === "DataManagedObjectStructure") return true;
      const def = this.allDefs[cur];
      if (!def) return false;
      if (def.$ref) return walk(deref(def.$ref));
      if (def.allOf) {
        for (const entry of def.allOf) {
          if (entry.$ref && walk(deref(entry.$ref))) return true;
        }
      }
      return false;
    };
    return walk(name);
  }

  /** Priority cascade: first matching rule wins. Returns role string or null. */
  determineRole(name, schema) {
    if (name.endsWith("_VersionStructure") || name.endsWith("_BaseStructure")) return "structure";
    if (name.endsWith("_RelStructure")) return "collection";
    if (name.endsWith("_RefStructure") || name.endsWith("RefStructure")) return "reference";
    if (name.endsWith("_DerivedViewStructure")) return "view";
    if (schema["enum"]) return "enumeration";
    if (this.elementMeta[name]?.abstract) return "abstract";
    if (DIVERSE_FRAME_MEMBERS && this.frameRegistry[name]) return "frameMember";
    const meta = this.elementMeta[name];
    if (meta && !meta.abstract && meta.substitutionGroup && this.extendsDataManagedObject(name)) return "entity";
    if (name.endsWith("Ref") && this.elements[name]) return "reference";
    if (name.startsWith("Abstract")) return "abstract";
    return null;
  }

  /** Strip Ref/RefStructure suffix and verify the target exists. */
  deriveRefTarget(name) {
    const target = name.endsWith("Ref") ? name.slice(0, -3)
      : name.endsWith("_RefStructure") ? name.slice(0, -13)
      : name.endsWith("RefStructure") ? name.slice(0, -12)
      : null;
    return target && (this.elements[target] || this.types[target]) ? target : null;
  }

  classifyDefinitions() {
    for (const [name, schema] of Object.entries(this.allDefs)) {
      const role = this.determineRole(name, schema);
      if (role) schema["x-netex-role"] = role;

      if (this.frameRegistry[name]) {
        schema["x-netex-frames"] = this.frameRegistry[name].slice().sort();
      }

      if (role === "reference") {
        const refTarget = this.deriveRefTarget(name);
        if (refTarget) schema["x-netex-refTarget"] = refTarget;
      }

      const meta = this.elementMeta[name];
      if (meta?.substitutionGroup) schema["x-netex-substitutionGroup"] = meta.substitutionGroup;
      const members = this.sgMembers[name];
      if (members?.length) schema["x-netex-sg-members"] = members;
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
      definitions,
    };
  }

  addPlaceholders(definitions) {
    const visited = new Set();
    const queue = Object.values(definitions);

    while (queue.length > 0) {
      const obj = queue.pop();
      if (typeof obj !== "object" || obj === null) continue;

      for (const [key, val] of Object.entries(obj)) {
        if (key === "$ref" && typeof val === "string" && val.startsWith(REF_PREFIX)) {
          const refName = deref(val);
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
      attrGroups: Object.keys(this.attrGroups).length,
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

// ── Sub-graph extraction ──────────────────────────────────────────────────────

/**
 * Prune a schema to only the definitions transitively reachable from `rootName`.
 * Walks every $ref in the object tree starting from the root definition,
 * collecting the transitive closure. Returns a new schema with only those
 * definitions (originals are shared, not cloned).
 */
function pruneToSubGraph(schema, rootName) {
  const defs = schema.definitions;
  if (!defs[rootName]) {
    throw new Error(`--sub-graph root '${rootName}' not found in definitions`);
  }

  const reachable = new Set();
  const queue = [rootName];

  while (queue.length > 0) {
    const name = queue.pop();
    if (reachable.has(name)) continue;
    if (!defs[name]) continue;
    reachable.add(name);

    // Walk the definition's object tree for $ref strings
    const objQueue = [defs[name]];
    const visited = new Set();
    while (objQueue.length > 0) {
      const obj = objQueue.pop();
      if (typeof obj !== "object" || obj === null) continue;
      if (visited.has(obj)) continue;
      visited.add(obj);
      for (const [key, val] of Object.entries(obj)) {
        if (key === "$ref" && typeof val === "string" && val.startsWith(REF_PREFIX)) {
          const target = deref(val);
          if (!reachable.has(target)) queue.push(target);
        }
        if (typeof val === "object" && val !== null) objQueue.push(val);
      }
    }

    // Follow substitution group edges
    const sgMembers = defs[name]?.["x-netex-sg-members"];
    if (Array.isArray(sgMembers)) {
      for (const member of sgMembers) {
        if (!reachable.has(member)) queue.push(member);
      }
    }
  }

  const pruned = {};
  for (const name of reachable) {
    pruned[name] = defs[name];
  }

  return {
    $schema: schema.$schema,
    "x-netex-assembly": schema["x-netex-assembly"],
    "x-netex-sub-graph-root": rootName,
    definitions: pruned,
  };
}

// ── Transparent wrapper collapsing ────────────────────────────────────────────

/**
 * Detect if a definition is a transparent wrapper — a lone $ref with no own
 * structural content. Returns the target name or null.
 *
 * Pattern 1: { $ref: "#/definitions/X", description?, x-netex-*? }
 * Pattern 2: { allOf: [{ $ref: "#/definitions/X" }], description?, x-netex-*? }
 */
function isTransparent(def) {
  if (typeof def !== "object" || def === null) return null;

  const STRUCTURAL_KEYS = ["properties", "type", "enum", "items", "required", "anyOf", "oneOf"];
  for (const key of STRUCTURAL_KEYS) {
    if (def[key] !== undefined) return null;
  }

  // Pattern 1: direct $ref
  if (def.$ref && typeof def.$ref === "string" && def.$ref.startsWith(REF_PREFIX)) {
    return deref(def.$ref);
  }

  // Pattern 2: allOf with a single $ref entry and no structural entries
  if (Array.isArray(def.allOf)) {
    const refs = [];
    for (const entry of def.allOf) {
      if (entry.$ref && typeof entry.$ref === "string" && entry.$ref.startsWith(REF_PREFIX)) {
        refs.push(deref(entry.$ref));
      } else {
        // Non-$ref entry — check for structural content
        for (const key of STRUCTURAL_KEYS) {
          if (entry[key] !== undefined) return null;
        }
      }
    }
    if (refs.length === 1) return refs[0];
  }

  return null;
}

/**
 * Walk all definitions and count how many times each definition name is
 * referenced via $ref. Returns a Map<targetName, count>.
 */
function buildRefCounts(defs) {
  const counts = {};
  for (const [, def] of Object.entries(defs)) {
    const queue = [def];
    const visited = new Set();
    while (queue.length > 0) {
      const obj = queue.pop();
      if (typeof obj !== "object" || obj === null) continue;
      if (visited.has(obj)) continue;
      visited.add(obj);
      for (const [key, val] of Object.entries(obj)) {
        if (key === "$ref" && typeof val === "string" && val.startsWith(REF_PREFIX)) {
          const target = deref(val);
          counts[target] = (counts[target] || 0) + 1;
        }
        if (typeof val === "object" && val !== null) queue.push(val);
      }
    }
  }
  return counts;
}

/**
 * Collapse transparent wrappers in the schema. A transparent wrapper is a
 * definition that is just a $ref alias to another type. When the target has
 * exactly 1 referrer (the wrapper), the target's content is absorbed into
 * the wrapper and the target is removed.
 *
 * Iterates until stable to handle chains (A → B → C).
 * Returns the modified schema.
 */
function collapseTransparent(schema) {
  const defs = schema.definitions;
  let totalCollapsed = 0;

  for (let iteration = 0; ; iteration++) {
    // 1. Find all transparent defs
    const transparent = {}; // wrapperName → targetName
    for (const [name, def] of Object.entries(defs)) {
      const target = isTransparent(def);
      if (target && defs[target]) {
        transparent[name] = target;
      }
    }

    if (Object.keys(transparent).length === 0) break;

    // 2. Build ref counts
    const refCounts = buildRefCounts(defs);

    // 3. Collapse where target has exactly 1 referrer
    let collapsedThisIteration = 0;
    for (const [wrapperName, targetName] of Object.entries(transparent)) {
      const count = refCounts[targetName] || 0;
      if (count > 1) {
        print(`WARN: DE_NORM_GIVES_DUPLICATIONS: ${wrapperName} -> ${targetName} (referenced by ${count} defs, skipping)`);
        continue;
      }

      const wrapper = defs[wrapperName];
      const target = defs[targetName];

      // Guard: wrapper or target may have been deleted earlier in this iteration
      if (!wrapper || !target) continue;

      // Keep wrapper's metadata
      const wrapperDesc = wrapper.description;
      const wrapperSource = wrapper["x-netex-source"];

      // Structural keys to copy from target
      const COPY_KEYS = [
        "allOf", "properties", "type", "enum", "items", "required",
        "anyOf", "oneOf", "pattern", "minimum", "maximum",
        "minLength", "maxLength", "format",
      ];

      // Remove wrapper's $ref or allOf (unwrap pattern 1 or 2)
      delete wrapper.$ref;
      delete wrapper.allOf;

      // Copy structural keys from target
      for (const key of COPY_KEYS) {
        if (target[key] !== undefined) {
          wrapper[key] = target[key];
        }
      }

      // Description: prefer wrapper's, fall back to target's
      if (wrapperDesc) {
        wrapper.description = wrapperDesc;
      } else if (target.description) {
        wrapper.description = target.description;
      }

      // Keep wrapper's x-netex-source
      if (wrapperSource) {
        wrapper["x-netex-source"] = wrapperSource;
      }

      // Inherit annotations from target if not on wrapper
      const ANNOTATIONS = ["x-netex-role", "x-netex-atom", "x-netex-mixed", "x-netex-frames", "x-netex-substitutionGroup", "x-netex-sg-members"];
      for (const ann of ANNOTATIONS) {
        if (wrapper[ann] === undefined && target[ann] !== undefined) {
          wrapper[ann] = target[ann];
        }
      }

      // Stamp reduction annotation
      wrapper["x-netex-reduced"] = [targetName];

      // Delete target
      delete defs[targetName];
      collapsedThisIteration++;
    }

    totalCollapsed += collapsedThisIteration;
    if (collapsedThisIteration === 0) break;

    print(`  collapse iteration ${iteration + 1}: ${collapsedThisIteration} collapsed`);
  }

  if (totalCollapsed > 0) {
    schema["x-netex-collapsed"] = totalCollapsed;
    print(`Collapsed ${totalCollapsed} transparent wrappers`);
  }

  return schema;
}

// ── Config ───────────────────────────────────────────────────────────────────

const REQUIRED_PARTS = ["framework", "gml", "siri", "service"];
const REQUIRED_ROOT_XSDS = ["publication"];

const NATURAL_NAMES = {
  part1_network: "network",
  part2_timetable: "timetable",
  part3_fares: "fares",
  part5_new_modes: "new-modes",
};

function resolveAssembly(parts) {
  const enabled = Object.entries(parts)
    .filter(([k, p]) => !k.startsWith("_") && !p.required && p.enabled)
    .map(([k]) => NATURAL_NAMES[k] || k.replace(/^part\d+_/, "").replace(/_/g, "-"))
    .sort();
  return enabled.length === 0 ? "base" : enabled.join("+");
}

function loadConfig(configPath) {
  const content = new java.lang.String(
    Files.readAllBytes(Paths.get(configPath)),
    StandardCharsets.UTF_8,
  );
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
  return (
    enabledDirList.some(
      (dir) => sourceFile.startsWith(`${dir}/`) || sourceFile.startsWith(`${dir}\\`),
    ) || enabledRootXsdList.includes(sourceFile)
  );
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

  // Separate positional args from flags
  const positional = [];
  let cliParts = [];
  let subGraphRoot = null;
  let collapseEnabled = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--parts" && args[i + 1]) {
      cliParts = args[++i].split(",");
    } else if (args[i] === "--sub-graph" && args[i + 1]) {
      subGraphRoot = args[++i];
    } else if (args[i] === "--collapse") {
      collapseEnabled = true;
    } else {
      positional.push(args[i]);
    }
  }

  if (positional.length < 2) {
    print(
      "Usage: js --jvm xsd-to-jsonschema.js <xsdRoot> <outDir> [configPath] [--parts <key,...>] [--sub-graph <TypeName>] [--collapse]",
    );
    print("  xsdRoot      - path to the versioned XSD directory (e.g. ../xsd/2.0)");
    print("  outDir       - output directory for ASSEMBLY.schema.json");
    print("  configPath   - optional path to config.json (for part filtering)");
    print("  --parts      - optional comma-separated list of parts to enable");
    print("  --sub-graph  - prune output to definitions reachable from TypeName");
    print("  --collapse   - collapse transparent wrappers (only with --sub-graph)");
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
        const optional = Object.keys(config.parts).filter(
          (k) => !k.startsWith("_") && !config.parts[k].required,
        );
        const naturalAliases = optional.map((k) => NATURAL_NAMES[k] || k);
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

  let schema = converter.toJsonSchema(filter);
  schema["x-netex-assembly"] = assembly;
  const fullCount = Object.keys(schema.definitions || {}).length;
  print(`${fullCount} definitions in filtered schema`);

  if (subGraphRoot) {
    schema = pruneToSubGraph(schema, subGraphRoot);
    const prunedCount = Object.keys(schema.definitions).length;
    print(`Sub-graph '${subGraphRoot}': ${prunedCount} reachable definitions (pruned ${fullCount - prunedCount})`);
    if (collapseEnabled) {
      schema = collapseTransparent(schema);
    }
  }

  const outPath = Paths.get(outDir);
  if (!Files.exists(outPath)) {
    Files.createDirectories(outPath);
  }
  const tinyTag = collapseEnabled ? "@tiny" : "";
  const fileName = subGraphRoot ? `${assembly}@${subGraphRoot}${tinyTag}.schema.json` : `${assembly}.schema.json`;
  const outFile = outPath.resolve(fileName);
  const json = JSON.stringify(schema, null, 2);
  Files.writeString(outFile, json, StandardCharsets.UTF_8);
  print(`\nWritten to ${outFile.toString()}`);
}

main();
