import { describe, expect, it } from "vite-plus/test";

import type { FixedArea, SceneryKind, WorldDefinition } from "../definition/types";
import { islandWorlds } from "../definitions/island";
import { islandScenery, SCENERY_SIZE } from "./scenery";

const slotsOf = (definition: WorldDefinition) =>
  Object.values(definition.areas)
    .filter((area): area is FixedArea => area.kind === "fixed")
    .flatMap((area) => [...area.slots, ...(area.spillover ?? [])]);

describe("islandScenery", () => {
  it("places the same scenery for an equal definition", () => {
    for (const island of islandWorlds) {
      expect(islandScenery(structuredClone(island))).toEqual(islandScenery(island));
    }
  });

  it("fits every rule's count at every island size", () => {
    for (const island of islandWorlds) {
      const placed = new Map<string, number>();
      for (const prop of islandScenery(island)) {
        placed.set(prop.kind, (placed.get(prop.kind) ?? 0) + 1);
      }
      const wanted = new Map<string, number>();
      for (const rule of island.scenery ?? []) {
        wanted.set(rule.kind, (wanted.get(rule.kind) ?? 0) + rule.count);
      }
      expect(placed).toEqual(wanted);
    }
  });

  it("keeps off every spot and out of the camera's view of it", () => {
    for (const island of islandWorlds) {
      for (const prop of islandScenery(island)) {
        const size = SCENERY_SIZE[prop.kind as SceneryKind];
        const radius = size.radius * (prop.scale ?? 1);
        for (const slot of slotsOf(island)) {
          const dx = prop.position[0] - slot.position[0];
          const dz = prop.position[2] - slot.position[2];
          expect(Math.hypot(dx, dz)).toBeGreaterThan(radius);
          // The camera looks down from (18, 20, 18): whatever stands in front of
          // a spot must not reach up into the view of someone standing there.
          const ahead = (dx + dz) * Math.SQRT1_2;
          const aside = Math.abs(dx - dz) * Math.SQRT1_2;
          if (aside < radius && ahead > 0) {
            const hidden =
              size.height * (prop.scale ?? 1) - ((ahead - radius) * 20) / (18 * Math.SQRT2);
            expect(hidden).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });
});
