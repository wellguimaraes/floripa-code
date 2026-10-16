import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as WorktreeScopes from "../workspace/WorktreeScopes.ts";

export class ResourceCleanupError extends Schema.TaggedError<ResourceCleanupError>()(
  "ResourceCleanupError",
  {
    operation: Schema.Literals(["terminal", "preview", "attachment"]),
    threadId: Schema.optional(Schema.String),
    attachmentId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export class ResourceCleanupService extends Context.Reference<{
  /**
   * Closes the thread's own terminals and, when no other live thread works in
   * its checkout, the checkout's shared terminals, deleting their history.
   */
  readonly cleanupTerminals: (threadId: string) => Effect.Effect<void, ResourceCleanupError>;
  /**
   * Closes the thread's own preview sessions and, when no other live thread
   * works in its checkout, the checkout's; server browser tabs end with them.
   */
  readonly cleanupPreviews: (threadId: string) => Effect.Effect<void, ResourceCleanupError>;
  readonly cleanupAttachments: (
    attachmentIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, ResourceCleanupError>;
}>("t3/orchestration-v2/ResourceCleanupService", {
  defaultValue: () => ({
    cleanupTerminals: () => Effect.void,
    cleanupPreviews: () => Effect.void,
    cleanupAttachments: () => Effect.void,
  }),
}) {}

export const layer = Layer.effect(
  ResourceCleanupService,
  Effect.gen(function* () {
    const terminals = yield* TerminalManager.TerminalManager;
    const previews = yield* PreviewManager.PreviewManager;
    const fileSystem = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const worktreeScopes = yield* WorktreeScopes.WorktreeScopes;
    /** The thread's checkout once no other live thread works there; undefined while one does. */
    const abandonedScope = (threadId: string) =>
      Effect.gen(function* () {
        const scope = yield* worktreeScopes.forThread(threadId);
        if (Option.isNone(scope)) return undefined;
        const { scopeKey } = scope.value;
        const shared = yield* worktreeScopes.sharedWithOtherLiveThread({ scopeKey, threadId });
        return shared ? undefined : scopeKey;
      });
    return {
      cleanupTerminals: (threadId: string) =>
        Effect.gen(function* () {
          // Thread-keyed sessions predate shared checkouts and belong to it alone.
          yield* terminals.close({ threadId, deleteHistory: true });
          const scopeKey = yield* abandonedScope(threadId);
          if (scopeKey !== undefined) {
            yield* terminals.close({ threadId, scopeKey, deleteHistory: true });
          }
        }).pipe(
          Effect.mapError(
            (cause) => new ResourceCleanupError({ operation: "terminal", threadId, cause }),
          ),
        ),
      cleanupPreviews: (threadId: string) =>
        abandonedScope(threadId).pipe(
          Effect.flatMap((scopeKey) => previews.closeForThread({ threadId, scopeKey })),
          Effect.mapError(
            (cause) => new ResourceCleanupError({ operation: "preview", threadId, cause }),
          ),
        ),
      cleanupAttachments: (attachmentIds: ReadonlyArray<string>) =>
        Effect.forEach(
          attachmentIds,
          (attachmentId) => {
            const path = resolveAttachmentPathById({
              attachmentsDir: config.attachmentsDir,
              attachmentId,
            });
            return path === null
              ? Effect.void
              : fileSystem
                  .remove(path, { force: true })
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new ResourceCleanupError({ operation: "attachment", attachmentId, cause }),
                    ),
                  );
          },
          { discard: true, concurrency: 4 },
        ),
    };
  }),
);
