import { describe, expect, it } from "vite-plus/test";

import { lookOf, returningLook } from "./archipelago";
import { hashString } from "./hash";

const base = { hueCount: 10, hatCount: 6, chosenHues: {} };

describe("returningLook", () => {
  it("wears its family's colour and its worktree's hat while they are on the island", () => {
    const island = { hues: new Map([["parent", 4]]), hats: new Map([["/wt", 2]]) };
    const look = returningLook({ ...base, island, lookSeed: "parent", worktreePath: "/wt" });
    expect(look).toEqual({ hue: 4, hat: 2 });
    // The restore list previews exactly what the world will draw.
    expect(look).toEqual(lookOf(island, { lookSeed: "parent", worktreePath: "/wt" }));
  });

  it("keeps a colour picked by hand, even one another family wears", () => {
    const island = { hues: new Map([["other", 7]]), hats: new Map() };
    expect(
      returningLook({
        ...base,
        island,
        chosenHues: { seed: 7 },
        lookSeed: "seed",
        worktreePath: null,
      }),
    ).toEqual({ hue: 7, hat: null });
  });

  it("steps past colours and hats already worn, as a newcomer does", () => {
    const hue = hashString("seed") % 10;
    const hat = hashString("/wt") % 6;
    const island = { hues: new Map([["other", hue]]), hats: new Map([["/other", hat]]) };
    expect(returningLook({ ...base, island, lookSeed: "seed", worktreePath: "/wt" })).toEqual({
      hue: (hue + 1) % 10,
      hat: (hat + 1) % 6,
    });
  });
});
