/**
 * ProjectThreadCap - keeps each project at most `PROJECT_ACTIVE_THREAD_CAP` active
 * agents by archiving the ones that have rested longest.
 *
 * Runs after a thread is created, restored, or a run ends in its project. Only
 * agents that are done and seen are archived: nothing running or queued,
 * nothing waiting on the user, no background work, no unread reply, no snooze
 * still pending. A project with nothing to spare stays over the cap until
 * agents finish. Restore brings an archived agent back.
 *
 * @module ProjectThreadCap
 */
import {
  CommandId,
  PROJECT_ACTIVE_THREAD_CAP,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import { isSnoozed, threadHasQueuedTurnStart } from "./ThreadSettlementService.ts";

const RUN_END_STATUSES = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

function millis(value: DateTime.Utc | null | undefined): number | null {
  return value == null ? null : DateTime.toEpochMillis(value);
}

/** Server twin of the client's `hasUnseenCompletion`: a reply newer than the last visit. */
function hasUnreadReply(thread: OrchestrationV2ThreadShell): boolean {
  const completedAt = millis(thread.latestRunCompletedAt);
  const visitedAt = millis(thread.lastVisitedAt);
  return completedAt !== null && visitedAt !== null && completedAt > visitedAt;
}

function isResting(thread: OrchestrationV2ThreadShell, nowMs: number): boolean {
  return (
    thread.activityRunStatus == null &&
    thread.pendingRuntimeRequest === null &&
    (thread.pendingBackgroundTasks ?? []).length === 0 &&
    !threadHasQueuedTurnStart(thread, nowMs) &&
    !hasUnreadReply(thread) &&
    !isSnoozed(thread, nowMs)
  );
}

/**
 * The threads to archive so at most `cap` top-level threads stay active: the
 * resting ones that went longest without activity, each with its subagents.
 * A family counts as resting only when every member is, and its activity is
 * its latest member's.
 */
export function threadsBeyondCap(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  cap: number,
  nowMs: number,
): ThreadId[] {
  const active = threads.filter(
    (thread) => thread.archivedAt === null && thread.deletedAt === null,
  );
  const topLevel = active.filter((thread) => thread.lineage.relationshipToParent !== "subagent");
  const excess = topLevel.length - cap;
  if (excess <= 0) return [];

  const subagentsOf = Map.groupBy(
    active.filter((thread) => thread.lineage.relationshipToParent === "subagent"),
    (thread) => thread.lineage.parentThreadId,
  );
  const familyOf = (root: OrchestrationV2ThreadShell) => {
    const family = [root];
    for (let index = 0; index < family.length; index += 1) {
      family.push(...(subagentsOf.get(family[index]!.id) ?? []));
    }
    return family;
  };

  return (
    topLevel
      .map((thread) => {
        const family = familyOf(thread);
        return {
          thread,
          family,
          resting: family.every((member) => isResting(member, nowMs)),
          lastActiveMs: Math.max(
            ...family.map((member) => DateTime.toEpochMillis(member.updatedAt)),
          ),
        };
      })
      .filter((entry) => entry.resting)
      .toSorted(
        (left, right) =>
          left.lastActiveMs - right.lastActiveMs || left.thread.id.localeCompare(right.thread.id),
      )
      .slice(0, excess)
      // Subagents before their parent: archiving a parent also archives its idle
      // delegated tasks, and skips the ones already archived.
      .flatMap((entry) => entry.family.toReversed().map((member) => member.id))
  );
}

export class ProjectThreadCap extends Context.Service<
  ProjectThreadCap,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ProjectThreadCap") {}

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const crypto = yield* Crypto.Crypto;

  /** Trims the project that `threadId` belongs to. */
  const trim = Effect.fn("ProjectThreadCap.trim")(
    function* (threadId: ThreadId) {
      const trigger = yield* orchestrator.getThreadShell(threadId);
      if (trigger === null) return;
      const snapshot = yield* orchestrator.getShellSnapshot({
        projectId: trigger.projectId,
        location: "active",
      });
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      const archive = threadsBeyondCap(snapshot.threads, PROJECT_ACTIVE_THREAD_CAP, nowMs);
      yield* Effect.forEach(
        archive,
        (id) =>
          crypto.randomUUIDv4.pipe(
            Effect.flatMap((uuid) =>
              orchestrator.dispatch({
                type: "thread.archive",
                commandId: CommandId.make(`server:thread-cap:${id}:${uuid}`),
                threadId: id,
              }),
            ),
            // One thread that changed under us must not keep the rest active.
            Effect.ignoreCause({ log: true }),
          ),
        { discard: true },
      );
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("project thread cap skipped", {
                threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
  );

  const worker = yield* makeDrainableWorker(trim);

  // Viewing a thread is not a trigger: archiving the agent the user just
  // opened would pull it out from under them.
  const processEvent = (event: OrchestrationV2DomainEvent) => {
    switch (event.type) {
      case "thread.created":
      case "thread.unarchived":
        return worker.enqueue(event.threadId);
      case "run.updated":
        return RUN_END_STATUSES.has(event.payload.status)
          ? worker.enqueue(event.threadId)
          : Effect.void;
      default:
        return Effect.void;
    }
  };

  const start: ProjectThreadCap["Service"]["start"] = Effect.fn("ProjectThreadCap.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(orchestrator.streamDomainEvents, processEvent).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Project thread cap event stream failed", { cause }),
          ),
        ),
      );
    },
  );

  return { start, drain: worker.drain } satisfies ProjectThreadCap["Service"];
});

export const layer = Layer.effect(ProjectThreadCap, make);
