import { describe, it, expect, beforeAll } from "vitest";
import { flattenAllOf, inlineSingleRefs } from "../schema-nav.js";
import { loadNetexLibrary } from "./test-helpers.js";
import type { NetexLibrary } from "../types.js";

let lib: NetexLibrary;
beforeAll(() => { lib = loadNetexLibrary(); });

describe("inlineSingleRefs — VehicleType real schema", () => {
  it("replaces 1-to-1 ref candidates with inner props, excluding reference and atom roles", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const result = inlineSingleRefs(lib, props);

    expect(result.some((p) => p.prop[1] === "BrandingRef" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "DeckPlanRef" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "IncludedIn" && !p.inlinedFrom)).toBe(true);
    expect(result.some((p) => p.prop[1] === "ClassifiedAsRef" && !p.inlinedFrom)).toBe(true);

    expect(result.some((p) => p.prop[1] === "PrivateCode" && !p.inlinedFrom)).toBe(true);

    expect(result.some((p) => p.prop[1] === "PassengerCapacity" && !p.inlinedFrom)).toBe(false);
    const capInlined = result.filter((p) => p.inlinedFrom === "PassengerCapacity");
    expect(capInlined.length).toBeGreaterThan(0);

    const capNames = capInlined.map((p) => p.prop[1]);
    const sharedAncestorProps = ["$id", "$version", "$created", "$changed", "keyList", "BrandingRef"];
    for (const name of sharedAncestorProps) {
      expect(capNames).not.toContain(name);
    }

    const expectedCapProps = [
      "FareClass",
      "TotalCapacity",
      "SeatingCapacity",
      "StandingCapacity",
      "SpecialPlaceCapacity",
      "PushchairCapacity",
      "WheelchairPlaceCapacity",
    ];
    for (const name of expectedCapProps) {
      expect(capNames).toContain(name);
    }

    for (const ip of capInlined) {
      expect(ip.inlinedFrom).toBeTruthy();
    }
  });

  it("total prop count increases (inlined target expands)", () => {
    const props = flattenAllOf(lib, "VehicleType");
    const result = inlineSingleRefs(lib, props);
    expect(result.length).toBeGreaterThan(props.length);
  });
});
