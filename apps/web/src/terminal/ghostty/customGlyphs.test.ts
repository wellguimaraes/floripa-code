import { describe, expect, it } from "vite-plus/test";

import { drawGhosttyCustomGlyph, isGhosttyCustomGlyph } from "./customGlyphs";

function recordingContext() {
  const rects: number[][] = [];
  const context = {
    fillStyle: "#fff",
    globalAlpha: 1,
    fillRect: (...args: number[]) => rects.push(args),
  } as unknown as CanvasRenderingContext2D;
  return { context, rects };
}

describe("drawGhosttyCustomGlyph", () => {
  it("fills half blocks to the full line height so stacked rows leave no gap", () => {
    const { context, rects } = recordingContext();
    drawGhosttyCustomGlyph(context, "▀", 0, 0, 8, 18, 2);
    drawGhosttyCustomGlyph(context, "▄", 0, 0, 8, 18, 2);
    drawGhosttyCustomGlyph(context, "▄", 0, 18, 8, 18, 2);

    expect(rects).toEqual([
      [0, 0, 8, 9],
      [0, 9, 8, 9],
      [0, 27, 8, 9],
    ]);
  });

  it("snaps fractional cells so neighbors share device-pixel edges", () => {
    const { context, rects } = recordingContext();
    const width = 7.23;
    for (let column = 0; column < 3; column += 1) {
      drawGhosttyCustomGlyph(context, "█", 4 + column * width, 4, width, 16, 2);
    }

    for (let index = 1; index < rects.length; index += 1) {
      const previous = rects[index - 1]!;
      expect(rects[index]![0]).toBe(previous[0]! + previous[2]!);
    }
    for (const [x, , w] of rects) {
      expect((x! * 2) % 1).toBe(0);
      expect((w! * 2) % 1).toBe(0);
    }
  });

  it("runs vertical box lines through the full cell height", () => {
    const { context, rects } = recordingContext();
    expect(drawGhosttyCustomGlyph(context, "│", 0, 20, 8, 18, 1)).toBe(true);

    expect(rects).toHaveLength(2);
    const top = Math.min(...rects.map(([, y]) => y!));
    const bottom = Math.max(...rects.map(([, y, , h]) => y! + h!));
    expect([top, bottom]).toEqual([20, 38]);
  });

  it("leaves other text and dashed or double lines to the font", () => {
    const { context, rects } = recordingContext();
    for (const text of ["a", "┄", "═", "▀▀", ""]) {
      expect(isGhosttyCustomGlyph(text)).toBe(false);
      expect(drawGhosttyCustomGlyph(context, text, 0, 0, 8, 18, 1)).toBe(false);
    }
    expect(rects).toEqual([]);
  });
});
