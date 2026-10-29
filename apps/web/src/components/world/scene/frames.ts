const pending = new WeakSet<() => void>();

/**
 * Asks for one more frame in `1000 / fps` ms. Callers on the same canvas share
 * one timer, so twenty walkers together still draw at `fps`, not twenty times
 * that (up to the display's rate).
 */
export function drawSoon(invalidate: () => void, fps: number): void {
  if (pending.has(invalidate)) return;
  pending.add(invalidate);
  setTimeout(() => {
    pending.delete(invalidate);
    invalidate();
  }, 1000 / fps);
}

/** The first frame after the scene sat still carries the whole idle gap; it must not leap. */
const FIRST_FRAME_STEP = 0.1;
/** Within a run, a late frame still owes its time; only a hidden tab's gap is cut short. */
const RUN_FRAME_STEP = 1;

/**
 * How many seconds a moving thing advances this frame. While it keeps moving, that is the real
 * time since its last frame, so a late frame catches up instead of slowing it down. The first
 * frame of a run has no earlier frame of its own, and the delta it is given reaches back over
 * the idle gap, so it is capped. `lastRun` holds the previous frame's time between calls.
 */
export function runStepSeconds(
  lastRun: { current: number | null },
  running: boolean,
  now: number,
  frameDelta: number,
): number {
  const previous = lastRun.current;
  lastRun.current = running ? now : null;
  if (!running || previous === null) return Math.min(frameDelta, FIRST_FRAME_STEP);
  return Math.min(now - previous, RUN_FRAME_STEP);
}

/**
 * Runs `run` once the browser has painted the current frame: the animation
 * frame lands just before the paint, the task queued from it just after.
 * Returns a cancel.
 */
export function afterPaint(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(run);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

/**
 * Runs `run` when the main thread has nothing else to do, or after `timeoutMs`
 * at the latest. Safari has no idle callbacks, so there it runs after the
 * next paint. Returns a cancel.
 */
export function whenIdle(run: () => void, timeoutMs: number): () => void {
  if (typeof requestIdleCallback !== "function") return afterPaint(run);
  const handle = requestIdleCallback(run, { timeout: timeoutMs });
  return () => cancelIdleCallback(handle);
}
