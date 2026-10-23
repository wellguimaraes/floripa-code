import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  type ChatAttachment,
  type MessageId,
  type ServerSettingsError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ThreadTitleDrift from "../textGeneration/ThreadTitleDrift.ts";
import { isNativeMaintenanceCommand, type OrchestratorV2Error } from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

import { formatThreadTitleContext } from "@t3tools/provider-core/server/threadTitleContext";
export { formatThreadTitleContext } from "@t3tools/provider-core/server/threadTitleContext";

export class ThreadTitleRegenerationService extends Context.Service<
  ThreadTitleRegenerationService,
  {
    readonly execute: (input: {
      readonly threadId: ThreadId;
      readonly requestId: CommandId;
      readonly kind:
        | { readonly type: "initial"; readonly messageId: MessageId }
        | { readonly type: "regenerate" }
        | { readonly type: "drift-check"; readonly messageId: MessageId };
    }) => Effect.Effect<
      void,
      OrchestratorV2Error | ProjectStore.ProjectStoreV2Error | ServerSettingsError
    >;
  }
>()("t3/orchestration-v2/ThreadTitleRegenerationService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const titleDrift = yield* ThreadTitleDrift.ThreadTitleDrift;

  const complete = (input: {
    readonly threadId: ThreadId;
    readonly requestId: CommandId;
    readonly title?: string;
  }) =>
    threads
      .dispatch({
        type: "thread.title.regeneration.complete",
        commandId: CommandId.make(`${input.requestId}:title-complete`),
        threadId: input.threadId,
        requestId: input.requestId,
        ...(input.title === undefined ? {} : { title: input.title }),
      })
      .pipe(Effect.asVoid);

  /** Asks for a regenerated title when a follow-up message moved the thread to a new task. */
  const checkDrift = Effect.fn("ThreadTitleRegenerationService.checkDrift")(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: CommandId;
    readonly messageId: MessageId;
  }) {
    const projection = yield* threads.getThreadRecords(input.threadId, ["messages"], {
      messageRoles: ["user"],
    });
    const thread = projection.thread;
    if (thread.titleManual === true || thread.titleRegeneration != null) return;
    const messages = projection.messages.filter(
      (message) =>
        !message.streaming &&
        message.notification === undefined &&
        !isNativeMaintenanceCommand(message),
    );
    const latestIndex = messages.findIndex((message) => message.id === input.messageId);
    const latest = messages[latestIndex];
    // Approvals and nudges such as "ok" or "continue" never start a new task.
    if (latest === undefined || latest.text.trim().length < 12) return;
    const project = yield* projects.get(thread.projectId);
    if (Option.isNone(project)) return;
    const verdict = yield* titleDrift.check({
      cwd: thread.worktreePath ?? project.value.workspaceRoot,
      title: thread.title,
      earlierMessages: messages.slice(0, latestIndex).map((message) => message.text),
      latestMessage: latest.text,
    });
    if (verdict.type === "keep") return;
    yield* threads.dispatch(
      verdict.type === "retitle"
        ? {
            type: "thread.metadata.update",
            commandId: CommandId.make(`${input.requestId}:title-drift`),
            threadId: input.threadId,
            generatedTitle: verdict.title,
          }
        : {
            // The whole-thread regeneration keeps the original subject, which drift just ruled out.
            type: "thread.metadata.update",
            commandId: CommandId.make(`${input.requestId}:title-drift`),
            threadId: input.threadId,
            regenerateTitle: true,
            regenerateTitleFrom: latest.id,
          },
    );
  });

  const execute: ThreadTitleRegenerationService["Service"]["execute"] = Effect.fn(
    "ThreadTitleRegenerationService.execute",
  )(function* (input) {
    if (input.kind.type === "drift-check") {
      // Best effort: a failed check keeps the current title.
      return yield* checkDrift({ ...input, messageId: input.kind.messageId }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Thread title drift check failed", {
                threadId: input.threadId,
                requestId: input.requestId,
                cause,
              }),
        ),
      );
    }
    const kind = input.kind;
    const outcome:
      | { readonly type: "stale" }
      | { readonly type: "complete"; readonly title?: string } = yield* Effect.gen(function* () {
      const projection = yield* threads.getThreadRecords(
        input.threadId,
        ["messages"],
        kind.type === "initial"
          ? { messageIds: [kind.messageId] }
          : { messageRoles: ["user", "assistant"] },
      );
      if (projection.thread.titleRegeneration?.requestId !== input.requestId) {
        return { type: "stale" as const };
      }

      const project = yield* projects.get(projection.thread.projectId);
      if (Option.isNone(project)) {
        return { type: "complete" as const };
      }

      let context: {
        readonly message: string;
        readonly attachments: ReadonlyArray<ChatAttachment>;
      };
      if (kind.type === "initial") {
        const messageId = kind.messageId;
        const message = projection.messages.find(
          (candidate) => candidate.id === messageId && !candidate.streaming,
        );
        context =
          message === undefined
            ? { message: "", attachments: [] }
            : { message: message.text, attachments: message.attachments };
      } else {
        context = formatThreadTitleContext(
          projection.messages.filter(
            (message) => !message.streaming && message.notification === undefined,
          ),
        );
      }
      if (context.message.length === 0 && context.attachments.length === 0) {
        return { type: "complete" as const };
      }

      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        projection.thread.projectId,
      ).settings;
      const result = yield* textGeneration.generateThreadTitle({
        cwd: projection.thread.worktreePath ?? project.value.workspaceRoot,
        message: context.message,
        attachments: context.attachments,
        ...(kind.type === "regenerate" ? { previousTitle: projection.thread.title } : {}),
        modelSelection: settings.textGenerationModelSelection,
      });
      const generatedTitle = result.title.trim();
      return generatedTitle === "New thread" ||
        (kind.type === "regenerate" && generatedTitle === projection.thread.title.trim())
        ? { type: "complete" as const }
        : { type: "complete" as const, title: result.title };
    }).pipe(
      Effect.retry({
        times: kind.type === "initial" ? 2 : 0,
        schedule: Schedule.exponential("2 seconds"),
      }),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Thread title generation failed", {
              threadId: input.threadId,
              requestId: input.requestId,
              cause,
            }).pipe(Effect.as({ type: "complete" as const })),
      ),
    );

    if (outcome.type === "stale") {
      return;
    }
    yield* complete({
      ...input,
      ...(outcome.title === undefined ? {} : { title: outcome.title }),
    });
  });

  return ThreadTitleRegenerationService.of({ execute });
});

export const layer = Layer.effect(ThreadTitleRegenerationService, make);
