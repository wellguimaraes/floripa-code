import { describe, expect, it } from "vite-plus/test";

import type { FixedArea, WorldDefinition } from "../definition/types";
import { islandWorlds } from "../definitions/island";
import { islandVariant } from "./variety";

const slotsOf = (definition: WorldDefinition) =>
  Object.values(definition.areas)
    .filter((area): area is FixedArea => area.kind === "fixed")
    .flatMap((area) => [...area.slots, ...(area.spillover ?? [])]);
const keys = Array.from({ length: 40 }, (_, index) => `project-${index}`);

describe("islandVariant", () => {
  it("gives a project the same island every time", () => {
    const island = islandWorlds[0]!;
    expect(islandVariant(island, "a")).toBe(islandVariant(island, "a"));
    expect(islandVariant(structuredClone(island), "a").props).toEqual(
      islandVariant(island, "a").props,
    );
  });

  it("arranges islands of the same size differently", () => {
    const island = islandWorlds[0]!;
    const palms = new Set(
      keys.map((key) =>
        JSON.stringify(islandVariant(island, key).props.filter((prop) => prop.kind === "palm")),
      ),
    );
    expect(palms.size).toBe(keys.length);
  });

  it("keeps at least one big shore rock and tree, and some islands fewer than all", () => {
    for (const kinds of [["boulder"], ["tree", "sibipiruna"]]) {
      const bigCounts = keys.map(
        (key) =>
          islandVariant(islandWorlds[0]!, key).props.filter(
            (prop) => kinds.includes(prop.kind) && prop.scale === undefined,
          ).length,
      );
      expect(Math.min(...bigCounts)).toBeGreaterThanOrEqual(1);
      expect(new Set(bigCounts).size).toBeGreaterThan(1);
    }
  });

  it("never moves a palm, tree or rock nearer a character's spot than a unit, or than it stood", () => {
    for (const island of islandWorlds) {
      const nearest = (position: readonly number[]) =>
        Math.min(
          ...slotsOf(island).map((slot) =>
            Math.hypot(position[0]! - slot.position[0], position[2]! - slot.position[2]),
          ),
        );
      for (const key of keys) {
        islandVariant(island, key).props.forEach((prop, index) => {
          const before = nearest(island.props[index]!.position);
          expect(nearest(prop.position)).toBeGreaterThanOrEqual(Math.min(1, before));
        });
      }
    }
  });
});
