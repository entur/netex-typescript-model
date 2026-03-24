/** Low-level helpers shared across schema introspection modules. */

import type { Def } from "./types.js";

/** Strip the JSON Schema `#/definitions/` prefix from a `$ref` string. */
export function deref(ref: string): string {
  return ref.replace("#/definitions/", "");
}

/** Find the first `$ref` target in an `allOf` array, or `null`. */
export function allOfRef(allOf: Def[]): string | null {
  for (const e of allOf) {
    if (e.$ref) return deref(e.$ref);
  }
  return null;
}

/** Lowercase the first character of a property name (NeTEx props are PascalCase, TS conventions use camelCase). */
export function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Return the canonical property name: PascalCase for XML elements, $-prefixed for XML attributes. */
export function canonicalPropName(xsdName: string, schema: Def | undefined): string {
  if (schema && schema.xml && (schema.xml as any).attribute) return "$" + xsdName;
  return xsdName;
}
