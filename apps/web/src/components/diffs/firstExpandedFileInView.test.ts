import { describe, expect, it } from "vite-plus/test";

import { firstExpandedFileInView } from "./firstExpandedFileInView";

// Three files stacked at 0, 400 and 440 in a 1000px-tall diff; `b` is folded to its header.
const tops = new Map([
  ["a", 0],
  ["b", 400],
  ["c", 440],
]);
const files = [
  { fileKey: "a", collapsed: false },
  { fileKey: "b", collapsed: true },
  { fileKey: "c", collapsed: false },
];
const viewportAt = (scrollTop: number, height = 200) => ({
  getScrollTop: () => scrollTop,
  getHeight: () => height,
  getScrollHeight: () => 1000,
  getTopForItem: (id: string) => tops.get(id),
});

describe("firstExpandedFileInView", () => {
  it("picks the unfolded file at the top of the viewport", () => {
    expect(firstExpandedFileInView(viewportAt(100), files)).toBe("a");
  });

  it("skips a folded file on screen for the next unfolded one", () => {
    expect(firstExpandedFileInView(viewportAt(410), files)).toBe("c");
  });

  it("reaches the last file through the end of the diff", () => {
    expect(firstExpandedFileInView(viewportAt(800), files)).toBe("c");
  });

  it("finds nothing when every file on screen is folded", () => {
    expect(
      firstExpandedFileInView(viewportAt(0, 1000), [
        { fileKey: "a", collapsed: true },
        { fileKey: "b", collapsed: true },
      ]),
    ).toBeNull();
  });

  it("finds nothing before the viewer mounts", () => {
    expect(firstExpandedFileInView(undefined, files)).toBeNull();
  });
});
