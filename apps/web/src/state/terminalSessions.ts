import {
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  EMPTY_TERMINAL_SESSION_STATE,
  selectRunningSubprocessTerminalIds,
  terminalOwnerKey,
  type KnownTerminalSession,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import {
  ThreadId,
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  type TerminalAttachInput,
  type TerminalSummary,
} from "@t3tools/contracts";
import { useMemo } from "react";

import { useEnvironmentQuery } from "./query";
import { terminalEnvironment } from "./terminal";
import { useEnvironmentScope } from "./session";

const EMPTY_KNOWN_TERMINAL_SESSIONS = Object.freeze<ReadonlyArray<KnownTerminalSession>>([]);

interface TerminalMetadataIndex {
  readonly all: ReadonlyArray<TerminalSummary>;
  readonly views: Map<EnvironmentId, Map<string, ReadonlyArray<KnownTerminalSession>>>;
}

const metadataIndexes = new WeakMap<ReadonlyArray<TerminalSummary>, TerminalMetadataIndex>();
const sessionsBySummary = new WeakMap<TerminalSummary, Map<EnvironmentId, KnownTerminalSession>>();
// Reuse groups a consumer still holds without keeping old group members alive
// merely because their first summary remains in a newer metadata snapshot.
const groupsByAnchor = new WeakMap<
  TerminalSummary,
  Map<EnvironmentId, Map<string, WeakRef<ReadonlyArray<KnownTerminalSession>>>>
>();

function knownSession(
  summary: TerminalSummary,
  environmentId: EnvironmentId,
): KnownTerminalSession {
  let byEnvironment = sessionsBySummary.get(summary);
  const previous = byEnvironment?.get(environmentId);
  if (previous) return previous;
  const session = {
    target: {
      environmentId,
      threadId: ThreadId.make(summary.threadId),
      terminalId: summary.terminalId,
      ...(summary.scopeKey ? { scopeKey: summary.scopeKey } : {}),
    },
    state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
  };
  if (!byEnvironment) {
    byEnvironment = new Map();
    sessionsBySummary.set(summary, byEnvironment);
  }
  byEnvironment.set(environmentId, session);
  return session;
}

function terminalMetadataIndex(metadata: ReadonlyArray<TerminalSummary>): TerminalMetadataIndex {
  let index = metadataIndexes.get(metadata);
  if (!index) {
    const compare = new Intl.Collator(undefined, { numeric: true }).compare;
    const all = metadata.toSorted((left, right) => compare(left.terminalId, right.terminalId));
    index = { all, views: new Map() };
    metadataIndexes.set(metadata, index);
  }
  return index;
}

/**
 * A terminal belongs to the thread that opened it and, when the server shares
 * it, to every thread in its checkout (`scopeKey`).
 */
function summaryMatches(
  summary: TerminalSummary,
  threadId: string,
  scopeKey: string | null,
): boolean {
  return summary.threadId === threadId || (scopeKey !== null && summary.scopeKey === scopeKey);
}

/**
 * Share one ordered index per immutable snapshot without changing metadata subscriptions.
 * `threadId` null selects every terminal; a `scopeKey` adds the terminals other
 * threads opened in the same checkout.
 */
export function selectKnownTerminalSessions(
  metadata: ReadonlyArray<TerminalSummary> | null,
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
  scopeKey: string | null = null,
): ReadonlyArray<KnownTerminalSession> {
  if (environmentId === null || metadata === null || metadata.length === 0) {
    return EMPTY_KNOWN_TERMINAL_SESSIONS;
  }
  const index = terminalMetadataIndex(metadata);
  const viewKey = threadId === null ? "" : `${threadId}\u0000${scopeKey ?? ""}`;
  let views = index.views.get(environmentId);
  const cached = views?.get(viewKey);
  if (cached) return cached;
  const summaries =
    threadId === null
      ? index.all
      : index.all.filter((summary) => summaryMatches(summary, threadId, scopeKey));
  if (summaries.length === 0) return EMPTY_KNOWN_TERMINAL_SESSIONS;

  const anchor = summaries[0]!;
  let groups = groupsByAnchor.get(anchor);
  let environmentGroups = groups?.get(environmentId);
  const previous = environmentGroups?.get(viewKey)?.deref();
  const sessions =
    previous?.length === summaries.length &&
    previous.every((session, index) => session.state.summary === summaries[index])
      ? previous
      : summaries.map((summary) => knownSession(summary, environmentId));
  if (!groups) {
    groups = new Map();
    groupsByAnchor.set(anchor, groups);
  }
  if (!environmentGroups) {
    environmentGroups = new Map();
    groups.set(environmentId, environmentGroups);
  }
  if (sessions !== previous) environmentGroups.set(viewKey, new WeakRef(sessions));
  if (!views) {
    views = new Map();
    index.views.set(environmentId, views);
  }
  views.set(viewKey, sessions);
  return sessions;
}

export function useAttachedTerminalSession(input: {
  readonly environmentId: EnvironmentId | null;
  readonly terminal: TerminalAttachInput | null;
}): TerminalSessionState {
  const canRead = useEnvironmentScope(input.environmentId, AuthTerminalReadScope);
  const canOperate = useEnvironmentScope(input.environmentId, AuthTerminalOperateScope);
  const attach = useEnvironmentQuery(
    input.environmentId !== null && input.terminal !== null
      ? canOperate
        ? terminalEnvironment.attach({
            environmentId: input.environmentId,
            input: input.terminal,
          })
        : canRead
          ? terminalEnvironment.observe({
              environmentId: input.environmentId,
              input: {
                threadId: input.terminal.threadId,
                terminalId: input.terminal.terminalId,
                ...(input.terminal.scopeKey ? { scopeKey: input.terminal.scopeKey } : {}),
              },
            })
          : null
      : null,
  );
  const metadata = useEnvironmentQuery(
    input.environmentId === null || !canRead
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );

  return useMemo(() => {
    if (input.environmentId === null || input.terminal === null) {
      return EMPTY_TERMINAL_SESSION_STATE;
    }
    const { threadId, terminalId } = input.terminal;
    // A server that predates shared terminals ignores the scope and keys the
    // session by the thread alone.
    const owner = terminalOwnerKey(input.terminal);
    const summary =
      metadata.data?.find(
        (terminal) =>
          terminal.terminalId === terminalId &&
          (terminalOwnerKey(terminal) === owner ||
            (terminal.scopeKey === undefined && terminal.threadId === threadId)),
      ) ?? null;
    const state = combineTerminalSessionState(summary, attach.data ?? EMPTY_TERMINAL_BUFFER_STATE);
    return attach.error === null ? state : { ...state, error: attach.error, status: "error" };
  }, [attach.data, attach.error, input.environmentId, input.terminal, metadata.data]);
}

/** Pass the thread's worktree `scopeKey` to include terminals its checkout shares. */
export function useKnownTerminalSessions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly scopeKey?: string | null;
}): ReadonlyArray<KnownTerminalSession> | null {
  const canRead = useEnvironmentScope(input.environmentId, AuthTerminalReadScope);
  const metadata = useEnvironmentQuery(
    input.environmentId === null || !canRead
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );
  return useMemo(
    () =>
      metadata.data === null || metadata.error !== null
        ? null
        : selectKnownTerminalSessions(
            metadata.data,
            input.environmentId,
            input.threadId,
            input.scopeKey ?? null,
          ),
    [input.environmentId, input.scopeKey, input.threadId, metadata.data, metadata.error],
  );
}

export function useThreadRunningTerminalIds(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly scopeKey?: string | null;
}): ReadonlyArray<string> {
  const sessions = useKnownTerminalSessions(input);
  return useMemo(() => selectRunningSubprocessTerminalIds(sessions ?? []), [sessions]);
}
