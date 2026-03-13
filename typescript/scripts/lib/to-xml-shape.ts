/**
 * Static code generator for stem→XML projection functions.
 *
 * `makeInlinedToXmlShape` emits a per-entity JavaScript function with a
 * generic base loop (attr rename, bool stringify, simpleContent `value→#text`)
 * followed by override lines for complex children that delegate to a
 * `toXmlShape` callback.
 */

import {
  flattenAllOf,
  classifySchema,
  resolveAtom,
  resolvePropertyType,
  lcFirst,
  defRole,
  type Defs,
  type Def,
  type ResolvedType,
} from "./fns.js";

/**
 * Resolve an abstract element head to the first concrete substitution group member.
 * Follows `x-netex-sg-members` chains until a non-abstract definition is found.
 */
function resolveConcreteElement(defs: Defs, name: string): string {
  const visited = new Set<string>();
  let current = name;
  while (!visited.has(current)) {
    visited.add(current);
    const d = defs[current];
    if (!d) break;
    const members = d["x-netex-sg-members"] as string[] | undefined;
    if (!members || members.length === 0) break;
    current = members[0];
  }
  return current;
}

/**
 * Check whether a ref-typed property resolves to a direct-assignable value
 * (primitive or empty array from `fake`) rather than a complex object that
 * needs `toXmlShape` delegation.
 */
function shouldDirectAssign(defs: Defs, refTarget: string, resolved: ResolvedType): boolean {
  const targetDef = defs[refTarget];
  if (!targetDef) return false;

  const role = defRole(targetDef);
  if (role === "collection" || role === "enumeration") return true;

  const atom = resolveAtom(defs, refTarget);
  if (atom && atom !== "simpleObj") return true;

  return !resolved.complex;
}

export interface InlineOptions {
  /** Emit `var out = <name>(obj)` instead of the inline base loop. */
  baseCall?: string;
  /** Emit `var out = <name>(obj)` for simpleContent types. */
  baseSimpleCall?: string;
}

/**
 * Generate a standalone JavaScript function that performs the same
 * stem→XMLBuilder-shape transform as `toXmlShape` for a specific definition.
 *
 * Emits a base loop that handles attribute rename (`$`→`@_`), boolean
 * stringification, and simpleContent `value`→`#text`. Complex ref-typed
 * properties get override lines that delegate to a `toXmlShape` callback.
 *
 * When `opts.baseCall` / `opts.baseSimpleCall` is provided the base loop
 * is replaced with a single function call, allowing the caller to emit
 * shared helpers.
 */
export function makeInlinedToXmlShape(
  defs: Defs,
  name: string,
  opts?: InlineOptions,
): string {
  const props = flattenAllOf(defs, name);
  const isSimpleContent = resolveAtom(defs, name) === "simpleObj";
  const fnName = lcFirst(name) + "ToXmlShape";

  // ── Phase 1: collect overrides (complex delegation + key renames) ───────

  const overrides: Array<{
    canonName: string;
    xmlName: string;
    code: string;
  }> = [];
  const processed = new Set<string>();

  for (const p of props) {
    const canonName = p.prop[1];
    if (processed.has(canonName)) continue;
    processed.add(canonName);
    if (canonName.startsWith("$")) continue;
    if (isSimpleContent && canonName === "value") continue;

    const shape = classifySchema(p.schema);

    let xmlName = canonName;
    let refTarget: string | undefined;
    if (shape.kind === "ref") refTarget = shape.target;
    else if (shape.kind === "refArray") refTarget = shape.target;

    if (refTarget) {
      const targetDef = defs[refTarget];
      if (
        targetDef?.["x-netex-role"] === "abstract" &&
        targetDef?.["x-netex-sg-members"]
      ) {
        const concrete = resolveConcreteElement(defs, refTarget);
        xmlName = concrete;
        refTarget = concrete;
      }
    }

    if (shape.kind === "ref" && refTarget) {
      const resolved = resolvePropertyType(defs, p.schema);
      const isMixed = resolved.via?.some((h) => h.rule === "mixed-unwrap") ?? false;

      if (isMixed && resolved.ts.endsWith("[]")) {
        const innerType = resolved.ts.slice(0, -2);
        overrides.push({
          canonName,
          xmlName,
          code: `out['${xmlName}'] = obj['${canonName}'].map(function(item) { return toXmlShape('${innerType}', item); });`,
        });
      } else if (!shouldDirectAssign(defs, refTarget, resolved)) {
        overrides.push({
          canonName,
          xmlName,
          code: `out['${xmlName}'] = toXmlShape('${refTarget}', obj['${canonName}']);`,
        });
      } else if (xmlName !== canonName) {
        // Direct-assign but key renamed (abstract resolution)
        overrides.push({
          canonName,
          xmlName,
          code: `out['${xmlName}'] = obj['${canonName}'];`,
        });
      }
    } else if (shape.kind === "refArray" && refTarget) {
      overrides.push({
        canonName,
        xmlName,
        code: `out['${xmlName}'] = obj['${canonName}'].map(function(item) { return toXmlShape('${refTarget}', item); });`,
      });
    }
  }

  // ── Phase 2: emit function ──────────────────────────────────────────────

  const lines: string[] = [];
  lines.push(`function ${fnName}(obj, toXmlShape) {`);

  const helperName = isSimpleContent
    ? opts?.baseSimpleCall
    : opts?.baseCall;

  if (helperName) {
    lines.push(`  var out = ${helperName}(obj);`);
  } else {
    lines.push(`  var out = {};`);
    lines.push(`  var keys = Object.keys(obj);`);
    lines.push(`  for (var i = 0; i < keys.length; i++) {`);
    lines.push(`    var k = keys[i], v = obj[k];`);
    lines.push(`    if (v === undefined) continue;`);
    lines.push(
      `    if (k[0] === '$') out['@_' + k.slice(1)] = typeof v === 'boolean' ? String(v) : v;`,
    );
    if (isSimpleContent) {
      lines.push(`    else if (k === 'value') out['#text'] = v;`);
    }
    lines.push(`    else out[k] = typeof v === 'boolean' ? String(v) : v;`);
    lines.push(`  }`);
  }

  for (const ov of overrides) {
    if (ov.xmlName !== ov.canonName) {
      lines.push(`  if (obj['${ov.canonName}'] !== undefined) {`);
      lines.push(`    delete out['${ov.canonName}'];`);
      lines.push(`    ${ov.code}`);
      lines.push(`  }`);
    } else {
      lines.push(`  if (obj['${ov.canonName}'] !== undefined) ${ov.code}`);
    }
  }

  lines.push(`  return out;`);
  lines.push(`}`);

  return lines.join("\n");
}
