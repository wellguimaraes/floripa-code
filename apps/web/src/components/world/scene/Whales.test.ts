import { describe, expect, it } from "vite-plus/test";

import { islandBounds } from "../engine/archipelago";
import { islandWorlds } from "../definitions/island";
import { mainlandOffshore } from "./coast";
import { pickSighting } from "./Whales";

/** A small seeded generator, so every run tries the same spots. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describe("pickSighting", () => {
  it("never leaps over the mainland's coast", () => {
    const definition = islandWorlds[0]!;
    const bounds = islandBounds(definition);
    const coast = mainlandOffshore(definition);
    const mainland = {
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
      shoreRadius: Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2,
      offshore: coast,
    };
    const random = seeded(7);
    let leaps = 0;
    for (let round = 0; round < 500; round += 1) {
      const sighting = pickSighting([mainland], [2.5, 5], random);
      if (sighting === null) continue;
      leaps += 1;
      // Nose and tail at both ends of the leap stay out over the water.
      for (const step of [-1, 0, 1]) {
        const px = sighting.x + Math.sin(sighting.heading) * 4.4 * step;
        const pz = sighting.z + Math.cos(sighting.heading) * 4.4 * step;
        expect(coast(px, pz)).toBeGreaterThan(0);
      }
    }
    // The sea side still gets its whales.
    expect(leaps).toBeGreaterThan(100);
  });
});
