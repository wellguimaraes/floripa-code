import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { drawSoon, runStepSeconds } from "./frames";

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

describe("runStepSeconds", () => {
  it("caps the first frame of a run, which reaches back over the idle gap", () => {
    const last = { current: null };
    expect(runStepSeconds(last, true, 50, 30)).toBe(0.1);
  });

  it("gives a late frame in a run the time it owes", () => {
    const last = { current: null };
    runStepSeconds(last, true, 10, 0.05);
    expect(runStepSeconds(last, true, 10.25, 0.25)).toBeCloseTo(0.25);
  });

  it("cuts a hidden tab's gap short and starts over after stopping", () => {
    const last = { current: null };
    runStepSeconds(last, true, 10, 0.05);
    expect(runStepSeconds(last, true, 70, 60)).toBe(1);
    runStepSeconds(last, false, 71, 1);
    expect(last.current).toBeNull();
    expect(runStepSeconds(last, true, 200, 129)).toBe(0.1);
  });
});
