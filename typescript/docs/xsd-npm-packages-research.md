# XSD-Aware npm Packages: Research Report

**Date:** 2026-02-19
**Context:** Evaluating alternatives/supplements to our custom 612-line `xsd-to-jsonschema.ts` which treats XSD files as "just XML" via fast-xml-parser.

---

## Executive Summary

There is **no npm package that provides a proper XSD component model** (typed objects representing XSD types, elements, groups, substitution groups, etc.) comparable to what exists in Java (Xerces, XSOM) or Python (xmlschema). The JavaScript/TypeScript ecosystem has a gap here. Every package either:

1. Treats XSD as XML and manually interprets it (same approach as our converter)
2. Wraps native libxml2 but only exposes validation, not schema introspection
3. Is abandoned/unmaintained
4. Is a Go/Java tool with thin JS bindings

The most promising finding is **`@kie-tools/xml-parser-ts-codegen`** (Apache KIE/jBPM project) which handles substitution groups, `xsd:any`/`xsd:anyAttribute`, and multiple namespaces — and is actively maintained. However, it was built specifically for BPMN/DMN schemas and may have gaps with NeTEx.

---

## Package-by-Package Analysis

### Tier 1: Seriously Worth Evaluating

#### `@kie-tools/xml-parser-ts-codegen` (Apache KIE)

| Attribute | Value |
|-----------|-------|
| Version | 10.1.0 |
| Last published | July 2025 |
| Monthly downloads | Not tracked individually (part of monorepo) |
| Dependencies | `lodash`, `@kie-tools/xml-parser-ts` |
| Native deps | None |
| License | Apache-2.0 |

**What it does:** Generates TypeScript types + runtime metadata from XSD files. The companion `@kie-tools/xml-parser-ts` then uses those types/metadata to parse/build XML to/from JSON.

**XSD features handled:**
- Substitution groups (as union types)
- Recursive types
- `xsd:import` and `xsd:include`
- Multiple namespaces with bidirectional mapping
- `xsd:any` and `xsd:anyAttribute` (extension points)
- Anonymous element types (max nesting depth 2)

**XSD features NOT handled:**
- Unknown — documentation says "It doesn't implement the entire XSD specification"
- Tested only against BPMN, DMN, PMML, and Test Scenario XSDs
- No explicit mention of: `xsd:redefine`, facets, `use="required"`, mixed content

**Architecture:** Uses `@kie-tools/xml-parser-ts` (its own DOMParser-based XML parser) to parse the XSD files themselves. Outputs two files: `types.ts` (flattened type hierarchy) and `meta.ts` (runtime metadata for marshalling).

**Relevance to us:** This is the only actively maintained package that handles substitution groups in TypeScript. However, it generates types for XML-to-JSON round-tripping (marshalling), not standalone TypeScript interfaces. The output format may not match what `json-schema-to-typescript` produces. Would need evaluation against NeTEx XSDs specifically.

---

#### `libxml2-wasm`

| Attribute | Value |
|-----------|-------|
| Version | 0.6.0 |
| Last published | August 2025 |
| Monthly downloads | ~77k |
| Dependencies | None (self-contained WASM) |
| Native deps | None (WebAssembly) |
| License | MIT |

**What it does:** WebAssembly port of libxml2. Provides parsing, validation, XPath, modification, serialization. XSD include/import marked as "experimental".

**XSD features handled:**
- Full XSD 1.0 validation (it's libxml2 under the hood)
- XInclude, XSD include/import (experimental)

**What it does NOT provide:**
- **No programmatic access to XSD schema components.** You can validate XML against an XSD, but you cannot traverse the schema to enumerate types, elements, or their properties. libxml2's C API does have `xmlSchemaGetType()` etc., but these are NOT exposed through the WASM wrapper.
- It is a validation tool, not a schema introspection tool.

**Relevance to us:** Could be used as a validation step (validate our XSDs before processing, or validate generated XML). Cannot replace our custom converter because it doesn't expose the schema object model.

---

#### `libxmljs2` + `libxmljs2-xsd`

| Attribute | Value |
|-----------|-------|
| Version | libxmljs2: 0.37.0 / libxmljs2-xsd: 0.30.1 |
| Last published | libxmljs2: ~2021 / libxmljs2-xsd: Sep 2022 |
| Monthly downloads | libxmljs2: ~1.1M / libxmljs2-xsd: ~2.7k |
| Dependencies | nan, bindings, node-pre-gyp (native build) |
| Native deps | **Yes** — requires node-gyp, compiles libxml2 from source |
| License | MIT |

**What it does:** Native Node.js bindings to libxml2 via nan/node-gyp. `libxmljs2-xsd` adds XSD validation on top.

**XSD features handled:**
- Full XSD 1.0 validation
- XSD include/import (resolved at parse time)
- Full DOM API for traversing parsed XML documents

**What it does NOT provide:**
- **No schema component model.** Like the WASM version, you get validation (pass/fail + error messages), not access to `xmlSchemaType`, `xmlSchemaElement`, etc. The libxml2 C API has these structs, but the Node.js bindings don't expose them.
- The original CLAUDE.md mention of "full libxml2 bindings with proper XSD schema loading" was optimistic — the bindings expose DOM + XPath + validation, not schema introspection.

**Relevance to us:** Same as libxml2-wasm but with a native dependency (harder to install, especially in CI). Higher download count only because it's older and widely used for XML parsing (not XSD). The WASM version is strictly better for our needs.

---

### Tier 2: Potentially Useful but Significant Limitations

#### `cxsd` (charto)

| Attribute | Value |
|-----------|-------|
| Version | 0.1.1 |
| Last published | June 2022 (code from 2016) |
| Monthly downloads | ~1.4k |
| Dependencies | bluebird, cget, commander, cxml, **node-expat** |
| Native deps | **Yes** — node-expat requires libexpat-dev |
| License | MIT |

**What it does:** Parses XSD files and generates `.d.ts` TypeScript definitions + `.js` state machine tables for the `cxml` streaming XML parser.

**XSD features handled (claimed):**
- Namespaces (full support)
- Derived types (inheritance)
- Substitution groups (claimed "soon" in 2016, partial fixes in releases)
- Enumerations as string literal unions
- List types as arrays
- Annotations as JSDoc comments

**Limitations:**
- Last meaningful code activity: 2016. Package republished in 2022 but code unchanged.
- 13 open issues, no active maintainer.
- Requires **node-expat** (native C dependency).
- Generates output for `cxml` parser, not standalone TypeScript interfaces.
- The internal XSD model exists but is not documented or exported for reuse.

**Relevance to us:** The internal XSD parser (`src/xsd/`) is the most complete XSD-to-typed-model implementation in the JS ecosystem. It has actual TypeScript classes for XSD components (types, elements, groups, etc.). However, the code is 8+ years old, has native dependencies, and would need significant modernization to extract and reuse. The fork `@wikipathways/cxsd` and `xsd-to-xast` are based on the same codebase.

---

#### `xsd2jsonschema`

| Attribute | Value |
|-----------|-------|
| Version | 0.3.7 |
| Last published | June 2020 |
| Monthly downloads | ~5.7k |
| Dependencies | clone, debug, deep-eql, fs-extra, xmldom, xpath, etc. |
| Native deps | None |
| License | MIT |

**What it does:** Pure JavaScript XSD to JSON Schema converter. Supports Draft-04/06/07.

**Why we already rejected it:** Our `xsd-to-jsonschema.ts` header says:
> "xsd2jsonschema (the npm package) has xs:include as a no-op and crashes on xsd:simpleContent — both are fundamental NeTEx patterns."

**Current state of those bugs:**
- `xs:include` is still documented as partial/no-op in the codebase.
- Repository has 12 open issues, 14 open PRs, last commit unclear.
- Marked as "Inactive" by npm health analysis.
- Uses xmldom + xpath internally (DOM-based, not streaming).

**XSD features it claims:**
- Circular imports
- Forward references
- Multiple namespaces
- JSON Schema Draft-04/06/07

**XSD features missing:**
- `xs:include` (our blocker)
- `xsd:simpleContent` (our blocker)
- Substitution groups (no mention)
- `use="required"` on attributes (unclear)

**Relevance to us:** Dead project. The bugs that made us write our own converter are still present.

---

#### `xsd2json` (fnogatz)

| Attribute | Value |
|-----------|-------|
| Version | 1.12.22 |
| Last published | ~2022 |
| Monthly downloads | ~940 |
| Dependencies | char-spinner, commander, concat-stream |
| Native deps | **Yes — requires SWI-Prolog** installed on the system |
| License | MIT |

**What it does:** XSD to JSON Schema converter built on SWI-Prolog and Constraint Handling Rules (CHR). The actual logic is 92% Prolog code.

**Why it's interesting:** The Prolog-based approach is academically rigorous (based on a thesis). It models XSD semantics as constraint rules rather than imperative tree-walking.

**Why it's impractical:** Requires SWI-Prolog (`swipl`) binary in PATH. 20 open issues. Not a library you can `import` in TypeScript — it shells out to Prolog.

**Relevance to us:** Impractical due to the Prolog dependency. Not usable in our npm-based pipeline.

---

#### `jsonix` + `jsonix-schema-compiler`

| Attribute | Value |
|-----------|-------|
| Version | jsonix: 3.0.0 |
| Last published | March 2019 |
| Monthly downloads | ~53k |
| Dependencies | amdefine, xmldom, xmlhttprequest |
| Native deps | **Yes — schema compiler requires Java** |
| License | BSD-2-Clause |

**What it does:** JavaScript library for XML-JSON bidirectional marshalling. The `jsonix-schema-compiler` is a **Java JAR** that reads XSD files and generates JavaScript mapping descriptors.

**XSD features handled:**
- Comprehensive — the schema compiler is built on JAXB/XJC (Java XML Binding), so it handles essentially all XSD 1.0 features.
- This is the same technology stack as `netex-java-model` (JAXB).

**Why it's impractical:**
- Schema compiler is Java (`java -jar jsonix-schema-compiler-full.jar`).
- Runtime library (jsonix) last updated 2019, uses AMD module format.
- No TypeScript types.
- Effectively a "run Java to generate JS" approach — if we wanted that, we'd use JAXB directly.

**Relevance to us:** The schema compiler has the best XSD coverage of anything in the npm ecosystem, but only because it's Java. If we're willing to use Java in the build pipeline, we should use JAXB/XJC directly (which is what `netex-java-model` does). This defeats the purpose of a pure TypeScript solution.

---

### Tier 3: Not Useful for Our Problem

#### `xmllint-wasm`

| Attribute | Value |
|-----------|-------|
| Version | 5.1.0 |
| Last published | October 2025 |
| Monthly downloads | ~481k |
| Native deps | None (WASM) |

**What it does:** libxml2's xmllint compiled to WASM. Validates XML against XSD. Returns pass/fail + error messages.

**Relevance:** Validation only. No schema introspection. Could be useful as a build-step validator but doesn't help with code generation.

---

#### `xsd-schema-validator`

| Attribute | Value |
|-----------|-------|
| Version | 0.11.0 |
| Last published | January 2025 |
| Monthly downloads | ~99k |
| Dependencies | which |
| Native deps | **Requires Java runtime** |

**What it does:** XSD validation for Node.js that shells out to Java's `javax.xml.validation` API.

**Relevance:** Validation only, requires Java. Not useful for code generation.

---

#### `sax` / `saxes` / `sax-wasm`

**What they do:** SAX-style streaming XML parsers. Zero XSD awareness. They parse XML syntax but have no concept of schemas, types, or validation.

**Relevance:** None. These are lower-level than fast-xml-parser (which at least gives us a tree structure).

---

#### `xmldom` + `xpath`

**What they do:** W3C DOM Level 2 implementation for Node.js. `xpath` adds XPath 1.0 queries.

**Relevance:** Gives us a DOM tree instead of fast-xml-parser's JSON tree. No XSD awareness. Would let us use XPath to query XSD files, but we'd still need to manually interpret XSD semantics. No advantage over our current approach.

---

#### `xsd-ts`

| Attribute | Value |
|-----------|-------|
| Version | 0.0.36 |
| Last published | April 2024 |
| Monthly downloads | ~111 |

**What it does:** Generates TypeScript parser + types from XSD. Author explicitly says it can't handle every XSD and won't fix issues.

**Relevance:** Too limited and unmaintained for NeTEx's complexity.

---

#### `xsd2ts`

| Attribute | Value |
|-----------|-------|
| Version | 0.9.17 |
| Last published | unknown (old) |
| Monthly downloads | ~5.9k |
| Dependencies | xmldom-reborn, ts-code-generator |

**What it does:** Converts XSD to TypeScript template classes using xmldom-based parsing.

**Relevance:** Limited XSD coverage, old dependencies (TypeScript 3.x, xmldom-reborn).

---

#### `xsd-to-xast` (tefkah)

| Attribute | Value |
|-----------|-------|
| Version | 0.5.0 |
| Last published | August 2022 |
| Monthly downloads | ~67 |
| Dependencies | Same as cxsd (it's a fork) |

**What it does:** Fork of cxsd that outputs xast (XML AST) types instead of cxml state machines.

**Relevance:** Same native dependency issues as cxsd. Barely used. Fork of abandoned project.

---

#### `@xsd-tools/typescript`

| Attribute | Value |
|-----------|-------|
| Version | 0.2.0 |
| Last published | February 2023 |
| Monthly downloads | negligible |

**What it does:** Schema-driven XML parser generator for TypeScript. Very limited documentation.

**Relevance:** Too obscure, no community, no evidence it handles complex XSD features.

---

#### `xsdlibrary`

| Attribute | Value |
|-----------|-------|
| Version | 1.3.6 |
| Last published | September 2020 |
| Monthly downloads | ~1.5k |

**What it does:** XML to XSD conversion (reverse direction). Uses fast-xml-parser 3.x.

**Relevance:** Wrong direction — generates XSD from XML, not types from XSD.

---

#### `@asyncapi/modelina`

| Attribute | Value |
|-----------|-------|
| Version | 5.10.1 |
| Last published | ~February 2026 |
| Monthly downloads | high (popular) |

**What it does:** Generates data models (TypeScript, Java, etc.) from AsyncAPI, OpenAPI, JSON Schema, and XSD inputs.

**XSD handling:** Detects `xs:schema`/`xsd:schema` and converts to internal CommonModel representation. The XSD input processing documentation is sparse. No visible XSD-specific dependencies — appears to be a lightweight XSD parser built into the library.

**Relevance:** Worth investigating further, but the XSD support appears to be a thin layer on top of their JSON Schema processing. Unlikely to handle NeTEx's complexity (458+ files, substitution groups, deep type hierarchies).

---

### Non-npm Tools Worth Noting

#### `xgen` (Go binary)

- **Repository:** github.com/xuri/xgen
- **What it does:** XSD parser written in Go. Generates Go/C/Java/Rust/TypeScript code.
- **XSD coverage:** Moderate. Known bugs with `xsd:group` handling, array generation, stack corruption.
- **Relevance:** Could be run as a build-step binary (no npm dependency). TypeScript output quality is questionable based on open issues. Written in Go, so fixing bugs requires Go expertise.

---

## Feature Gap Analysis

What our converter is missing vs. what packages handle:

| Feature | Our converter | @kie-tools | cxsd | xsd2jsonschema | libxml2 (any) |
|---------|:---:|:---:|:---:|:---:|:---:|
| Substitution groups | NO | YES | Partial | NO | N/A (validation only) |
| `xsd:any`/`xsd:anyAttribute` | NO | YES | Unknown | Unknown | N/A |
| `use="required"` on attributes | NO | Unknown | Unknown | Unknown | N/A |
| Mixed content | NO | Unknown | Unknown | NO | N/A |
| `xsd:include` resolution | YES | YES | YES | NO (broken) | N/A |
| `xsd:import` resolution | YES | YES | YES | YES | N/A |
| `xsd:simpleContent` | YES | Unknown | YES | NO (crashes) | N/A |
| `xsd:extension`/`xsd:restriction` | YES | YES | YES | Partial | N/A |
| Multiple namespaces | Stripped | YES | YES | YES | N/A |
| Enum extraction | YES | YES | YES | YES | N/A |
| Facets (beyond basic) | Partial | Unknown | Unknown | Unknown | N/A |
| Default/fixed values | NO | Unknown | Unknown | Unknown | N/A |
| `xsd:redefine` | NO | Unknown | NO | Unknown | N/A |
| `xsd:key`/`xsd:keyref`/`xsd:unique` | NO | NO | NO | NO | N/A |
| Circular type refs | Delegated to json-schema-to-typescript | YES | YES | YES | N/A |

---

## Conclusions

### No Drop-in Replacement Exists

There is no npm package that can replace our custom converter and produce correct JSON Schema or TypeScript from NeTEx XSDs. The ecosystem gap is real.

### Best Candidates for Further Evaluation

1. **`@kie-tools/xml-parser-ts-codegen`** — Most feature-complete, actively maintained, handles substitution groups. But it generates a specific output format (types + metadata for its own XML parser), not generic JSON Schema. Would need investigation to see if (a) it can parse NeTEx XSDs at all, and (b) whether its output format is usable or adaptable.

2. **Enhancing our custom converter** — Given that every package in the ecosystem either treats XSD as XML (like we do) or uses native/Java dependencies, our approach is not unreasonable. The gaps to address in priority order:
   - Substitution groups (most impactful for NeTEx correctness)
   - `use="required"` on attributes (easy to add)
   - `xsd:any`/`xsd:anyAttribute` (emit `additionalProperties: true` or `Record<string, unknown>`)
   - Default/fixed values (useful for documentation)

3. **`libxml2-wasm` as a validation step** — Even though it doesn't help with code generation, using it to validate our XSD processing against libxml2's parser could catch bugs in our include/import resolution.

### What Doesn't Exist (and Why)

No one has built a proper XSD Schema Component Model in JavaScript/TypeScript because:

- XSD 1.0 is a ~200-page specification with extensive edge cases
- The XSD type system (derivation by restriction, extension, list, union) is complex
- Substitution groups require global graph analysis
- The Node.js ecosystem generally avoids XML where possible
- Anyone who needs full XSD compliance uses Java (Xerces, JAXB) or Python (xmlschema, lxml)
- The only full XSD implementations in any language are in C (libxml2), Java (Xerces), and Python (xmlschema)

### Recommendation

Continue with the custom converter approach. The priority enhancements that would close the most impactful gaps are:

1. **Substitution group support** — Build a registry from `substitutionGroup` attributes, emit `oneOf`/`anyOf` at element reference sites
2. **Attribute `use="required"`** — Track and emit in the `required` array
3. **`xsd:any` handling** — Emit `additionalProperties: true` for types containing wildcards

Before investing in substitution groups, run `@kie-tools/xml-parser-ts-codegen` against the NeTEx XSDs to see if it produces anything usable. If it does, we might extract patterns from its approach rather than building from scratch.
