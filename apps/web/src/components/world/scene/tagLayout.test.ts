import { describe, expect, it } from "vite-plus/test";

import { layoutTags } from "./tagLayout";

const size = { width: 40, height: 10 };

describe("layoutTags", () => {
  it("leaves tags that do not touch where they are", () => {
    const lifted = layoutTags(
      [
        { key: "a", x: 0, y: 100 },
        { key: "b", x: 200, y: 100 },
      ],
      new Map([
        ["a", size],
        ["b", size],
      ]),
    );
    expect(Object.fromEntries(lifted)).toEqual({ a: 100, b: 100 });
  });

  it("stacks overlapping tags upward, the lowest one staying put", () => {
    const lifted = layoutTags(
      [
        { key: "high", x: 5, y: 96 },
        { key: "low", x: 0, y: 100 },
        { key: "mid", x: 10, y: 98 },
      ],
      new Map([
        ["high", size],
        ["low", size],
        ["mid", size],
      ]),
    );
    // Each sits fully above the one below it, two pixels apart.
    expect(Object.fromEntries(lifted)).toEqual({ low: 100, mid: 88, high: 76 });
  });
});
