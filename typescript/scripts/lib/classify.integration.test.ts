import { describe, it, expect, beforeAll } from "vitest";
import { defRole } from "./classify.js";
import { loadNetexLibrary } from "./test-helpers.js";
import type { NetexLibrary } from "./types.js";

let lib: NetexLibrary;
beforeAll(() => { lib = loadNetexLibrary(); });

describe("defRole — edge cases (real schema)", () => {
  it("GroupOfEntitiesRefStructure_Dummy is unclassified (no role annotation, no suffix match)", () => {
    expect(defRole(lib["GroupOfEntitiesRefStructure_Dummy"])).toBe("unclassified");
  });
});
