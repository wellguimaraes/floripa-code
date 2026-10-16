import {
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  EMPTY_TERMINAL_SESSION_STATE,
  terminalOutputText,
  terminalOwnerKey,
  type KnownTerminalSession,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import {
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  ThreadId,
  type EnvironmentId,
  type TerminalAttachInput,
} from "@t3tools/contracts";
import { useMemo } from "react";

import { useEnvironmentQuery } from "./query";
import { terminalEnvironment } from "./terminal";
import { useEnvironmentScope } from "./session";

type LegacyTerminalSessionState = TerminalSessionState & { readonly buffer: string };
const EMPTY_LEGACY_TERMINAL_SESSION_STATE: LegacyTerminalSessionState = {
  ...EMPTY_TERMINAL_SESSION_STATE,
  buffer: "",
};

export function useAttachedTerminalSession(input: {
  readonly environmentId: EnvironmentId | null;
  readonly terminal: TerminalAttachInput | null;
}): LegacyTerminalSessionState {
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
                ...(input.terminal.scopeKey === undefined
                  ? {}
                  : { scopeKey: input.terminal.scopeKey }),
                terminalId: input.terminal.terminalId,
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
  const output = attach.data?.output ?? EMPTY_TERMINAL_BUFFER_STATE.output;
  // Installed native binaries still accept initialBuffer. Keep materialization
  // at this mobile boundary until the native streaming API is released.
  const buffer = useMemo(() => terminalOutputText(output), [output]);

  return useMemo(() => {
    if (input.environmentId === null || input.terminal === null) {
      return EMPTY_LEGACY_TERMINAL_SESSION_STATE;
    }
    const owner = terminalOwnerKey(input.terminal);
    const summary =
      metadata.data?.find(
        (terminal) =>
          terminalOwnerKey(terminal) === owner &&
          terminal.terminalId === input.terminal?.terminalId,
      ) ?? null;
    const state = {
      ...combineTerminalSessionState(summary, attach.data ?? EMPTY_TERMINAL_BUFFER_STATE),
      buffer,
    };
    return attach.error === null ? state : { ...state, error: attach.error, status: "error" };
  }, [attach.data, attach.error, buffer, input.environmentId, input.terminal, metadata.data]);
}

/**
 * Terminals a thread can reach: its checkout's shared ones (`scopeKey`) and
 * the ones it opened before checkouts were shared. Without a thread, all.
 */
export function useKnownTerminalSessions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly scopeKey?: string | undefined;
}) {
  const canRead = useEnvironmentScope(input.environmentId, AuthTerminalReadScope);
  const metadata = useEnvironmentQuery(
    input.environmentId === null || !canRead
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );
  const sessions = useMemo((): ReadonlyArray<KnownTerminalSession> | null => {
    if (input.environmentId === null || metadata.data === null || metadata.error !== null) {
      return null;
    }
    return metadata.data
      .filter(
        (summary) =>
          input.threadId === null ||
          (summary.scopeKey === undefined
            ? summary.threadId === input.threadId
            : summary.scopeKey === input.scopeKey),
      )
      .map((summary) => ({
        target: {
          environmentId: input.environmentId!,
          threadId: ThreadId.make(summary.threadId),
          ...(summary.scopeKey === undefined ? {} : { scopeKey: summary.scopeKey }),
          terminalId: summary.terminalId,
        },
        state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
      }))
      .sort((left, right) =>
        left.target.terminalId.localeCompare(right.target.terminalId, undefined, {
          numeric: true,
        }),
      );
  }, [input.environmentId, input.scopeKey, input.threadId, metadata.data, metadata.error]);
  return { sessions, isPending: metadata.isPending, error: metadata.error };
}
