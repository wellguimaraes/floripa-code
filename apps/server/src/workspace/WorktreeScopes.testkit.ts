import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as WorktreeScopes from "./WorktreeScopes.ts";

export interface TestThreadCheckout {
  readonly scopeKey: string;
  readonly projectCheckout?: boolean;
  /** Archived or deleted threads still resolve but no longer share their scope. */
  readonly live?: boolean;
  readonly settled?: boolean;
}

/**
 * Resolves threads from a fixed map. Threads missing from it are unknown, so
 * their surfaces stay thread-owned.
 */
export const layer = (threads: Readonly<Record<string, TestThreadCheckout>> = {}) =>
  Layer.succeed(
    WorktreeScopes.WorktreeScopes,
    WorktreeScopes.WorktreeScopes.of({
      forThread: (threadId) => {
        const thread = threads[threadId];
        return Effect.succeed(
          thread === undefined
            ? Option.none()
            : Option.some({
                scopeKey: thread.scopeKey,
                projectCheckout: thread.projectCheckout ?? false,
              }),
        );
      },
      sharedWithOtherLiveThread: (input) =>
        Effect.succeed(
          Object.entries(threads).some(
            ([threadId, thread]) =>
              threadId !== input.threadId &&
              thread.scopeKey === input.scopeKey &&
              thread.live !== false &&
              !(input.ignoreSettled === true && thread.settled === true),
          ),
        ),
    }),
  );
