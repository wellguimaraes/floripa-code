/**
 * Seam between scheduled tasks and fresh provider sessions. A `fresh_session` task starts each run
 * in a new session of its one thread; the send that carries that request lives with the thread
 * service ("sends can start a fresh provider session"), not here. Until that service method is
 * wired in, tasks cannot be saved in `fresh_session` mode and the environment does not advertise it.
 * To join the two, set `freshSessionSupported` to true and make `withFreshSession` add the send's
 * fresh-session flag (upstream names it `freshContext`).
 */
export const freshSessionSupported = false;

/** Marks the send that starts a scheduled run as one that begins a fresh session. */
export const withFreshSession = <Input extends object>(input: Input): Input => input;
