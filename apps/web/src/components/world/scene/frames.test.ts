import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { drawSoon } from "./frames";

describe("drawSoon", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws once per interval however many things ask", () => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    for (let walker = 0; walker < 20; walker += 1) drawSoon(invalidate, 30);
    vi.advanceTimersByTime(1000 / 30);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // The next frame's requests start a new interval.
    for (let walker = 0; walker < 20; walker += 1) drawSoon(invalidate, 30);
    vi.advanceTimersByTime(1000 / 30);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("keeps canvases apart", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    drawSoon(first, 30);
    drawSoon(second, 30);
    vi.advanceTimersByTime(1000 / 30);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
