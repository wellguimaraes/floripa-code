/**
 * Seam between scheduled tasks and fresh provider sessions. A `fresh_session` task starts each run
 * in a new session of its one thread; the send carries the thread service's fresh-session flag
 * (`freshContext`).
 */
export const freshSessionSupported = true;

/** Marks the send that starts a scheduled run as one that begins a fresh session. */
export const withFreshSession = <Input extends object>(
  input: Input,
): Input & { freshContext: true } => ({
  ...input,
  freshContext: true,
});
