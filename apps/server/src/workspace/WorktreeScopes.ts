/**
 * Resolves the checkout ("worktree scope") a thread works in. Terminals and
 * browser tabs belong to the scope, so every thread in one worktree shares
 * them; cleanup asks whether another live thread still works there before it
 * closes anything.
 */
import { ThreadId } from "@t3tools/contracts";
import { worktreeScopeKey } from "@t3tools/shared/worktreeScope";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

export class WorktreeScopeLookupError extends Schema.TaggedError<WorktreeScopeLookupError>()(
  "WorktreeScopeLookupError",
  {
    operation: Schema.Literals(["thread", "siblings"]),
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to resolve the thread's checkout.";
  }
}

export interface ThreadWorktreeScope {
  readonly scopeKey: string;
  /** True when the thread works in the project's own checkout rather than a worktree of its own. */
  readonly projectCheckout: boolean;
}

export class WorktreeScopes extends Context.Service<
  WorktreeScopes,
  {
    /**
     * The thread's scope, archived and deleted threads included. None when the
     * thread or its project is unknown, as for drafts and synthetic callers.
     */
    readonly forThread: (
      threadId: string,
    ) => Effect.Effect<Option.Option<ThreadWorktreeScope>, WorktreeScopeLookupError>;
    /**
     * Whether a live (not archived, not deleted) thread other than `threadId`
     * works in `scopeKey`. `ignoreSettled` skips settled threads, for cleanup
     * that only matters while someone is still working there.
     */
    readonly sharedWithOtherLiveThread: (input: {
      readonly scopeKey: string;
      readonly threadId: string;
      readonly ignoreSettled?: boolean;
    }) => Effect.Effect<boolean, WorktreeScopeLookupError>;
  }
>()("t3/workspace/WorktreeScopes") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;

  const forThread: WorktreeScopes["Service"]["forThread"] = (threadId) =>
    Effect.gen(function* () {
      const thread = yield* projections.getThread(ThreadId.make(threadId)).pipe(
        Effect.asSome,
        Effect.catchTags({
          ProjectionStoreThreadNotFoundError: () => Effect.succeedNone,
        }),
      );
      if (Option.isNone(thread)) return Option.none();
      const project = yield* projects.get(thread.value.projectId, { includeDeleted: true });
      if (Option.isNone(project)) return Option.none();
      const workspaceRoot = project.value.workspaceRoot;
      const scopeKey = worktreeScopeKey({ worktreePath: thread.value.worktreePath, workspaceRoot });
      return Option.some({
        scopeKey,
        projectCheckout: scopeKey === worktreeScopeKey({ workspaceRoot }),
      });
    }).pipe(
      Effect.mapError(
        (cause) => new WorktreeScopeLookupError({ operation: "thread", threadId, cause }),
      ),
    );

  const sharedWithOtherLiveThread: WorktreeScopes["Service"]["sharedWithOtherLiveThread"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const threads = yield* projections.getLiveThreadCheckouts();
      const roots = new Map(
        (yield* projects.list()).map((project) => [project.projectId, project.workspaceRoot]),
      );
      return threads.some((thread) => {
        if (thread.id === input.threadId || (input.ignoreSettled === true && thread.settled)) {
          return false;
        }
        const workspaceRoot = roots.get(thread.projectId);
        return (
          workspaceRoot !== undefined &&
          worktreeScopeKey({ worktreePath: thread.worktreePath, workspaceRoot }) === input.scopeKey
        );
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new WorktreeScopeLookupError({
            operation: "siblings",
            threadId: input.threadId,
            cause,
          }),
      ),
    );

  return WorktreeScopes.of({ forThread, sharedWithOtherLiveThread });
});

export const layer = Layer.effect(WorktreeScopes, make);
