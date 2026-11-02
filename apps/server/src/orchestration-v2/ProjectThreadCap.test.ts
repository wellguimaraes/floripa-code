import { assert, describe, expect, it } from "@effect/vitest";
import {
  EventId,
  PROJECT_ACTIVE_THREAD_CAP,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectThreadCap from "./ProjectThreadCap.ts";

const NOW_MS = Date.parse("2026-06-10T12:00:00.000Z");
const MINUTE_MS = 60_000;
const PROJECT_ID = ProjectId.make("project-1");

const at = (offsetMs: number) => DateTime.makeUnsafe(NOW_MS + offsetMs);

/** A finished, read top-level thread, last active `minutesAgo` minutes ago. */
function thread(
  id: string,
  minutesAgo: number,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell {
  const threadId = ThreadId.make(id);
  return {
    id: threadId,
    projectId: PROJECT_ID,
    title: id,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    status: "completed",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: at(-minutesAgo * MINUTE_MS),
    lastVisitedAt: at(-minutesAgo * MINUTE_MS + 1),
    latestUserMessageAt: null,
    createdAt: at(-1_000 * MINUTE_MS),
    updatedAt: at(-minutesAgo * MINUTE_MS),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function subagent(
  id: string,
  parent: string,
  minutesAgo: number,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
) {
  return thread(id, minutesAgo, {
    lineage: {
      rootThreadId: ThreadId.make(parent),
      parentThreadId: ThreadId.make(parent),
      relationshipToParent: "subagent",
    },
    ...overrides,
  });
}

/** `count` resting threads, `t0` the most recently active. */
const resting = (count: number) =>
  Array.from({ length: count }, (_, index) => thread(`t${index}`, index + 1));

const beyondCap = (threads: ReadonlyArray<OrchestrationV2ThreadShell>, cap = 3) =>
  ProjectThreadCap.threadsBeyondCap(threads, cap, NOW_MS);

describe("threadsBeyondCap", () => {
  it("archives nothing at or under the cap", () => {
    expect(beyondCap(resting(3))).toEqual([]);
  });

  it("archives the longest-resting threads past the cap", () => {
    expect(beyondCap(resting(5))).toEqual(["t4", "t3"]);
  });

  it("skips agents that are busy, waiting on the user, unread, or still working in the background", () => {
    const threads = [
      ...resting(3),
      thread("running", 100, { activityRunStatus: "running" }),
      thread("asking", 90, {
        pendingRuntimeRequest: {} as OrchestrationV2ThreadShell["pendingRuntimeRequest"],
      }),
      thread("unread", 80, { lastVisitedAt: at(-81 * MINUTE_MS) }),
      thread("dev-server", 70, {
        pendingBackgroundTasks: [
          {} as NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]>[number],
        ],
      }),
      thread("snoozed", 60, { snoozedUntil: at(MINUTE_MS), snoozedAt: at(-MINUTE_MS) }),
      thread("never-opened", 50, { lastVisitedAt: null }),
    ];
    // Nine threads over a cap of three, but only four can go: the never-opened
    // one, as the sidebar sees it, and the three resting ones.
    expect(beyondCap(threads)).toEqual(["never-opened", "t2", "t1", "t0"]);
  });

  it("stays over the cap when nothing is resting", () => {
    const busy = Array.from({ length: 5 }, (_, index) =>
      thread(`busy${index}`, index, { activityRunStatus: "running" }),
    );
    expect(beyondCap(busy)).toEqual([]);
  });

  it("counts a family once and archives subagents, then their parent", () => {
    const threads = [...resting(3), thread("parent", 50), subagent("kid", "parent", 60)];
    expect(beyondCap(threads)).toEqual(["kid", "parent"]);
  });

  it("keeps a family while any subagent is still at work, and dates it by its latest member", () => {
    const working = [
      ...resting(3),
      thread("parent", 50),
      subagent("kid", "parent", 60, { activityRunStatus: "running" }),
    ];
    expect(beyondCap(working)).toEqual(["t2"]);

    // The kid answered a minute ago, so the family is the newest, not the oldest.
    const recent = [...resting(3), thread("parent", 50), subagent("kid", "parent", 0.5)];
    expect(beyondCap(recent)).toEqual(["t2"]);
  });
});

describe("ProjectThreadCap worker", () => {
  it.effect("archives the oldest resting agents once a run ends in a full project", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW_MS);
        const threads = resting(PROJECT_ACTIVE_THREAD_CAP + 2);
        const dispatched = yield* Queue.unbounded<OrchestrationV2ServerCommand>();
        const runEnded = {
          type: "run.updated",
          id: EventId.make("event:run-ended"),
          threadId: threads[0]!.id,
          occurredAt: at(0),
          payload: { status: "completed" },
        } as unknown as OrchestrationV2DomainEvent;

        const layer = ProjectThreadCap.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(Orchestrator.OrchestratorV2)({
                streamDomainEvents: Stream.make(runEnded),
                getThreadShell: (threadId) =>
                  Effect.succeed(threads.find((candidate) => candidate.id === threadId) ?? null),
                getShellSnapshot: (options) =>
                  Effect.succeed({
                    schemaVersion: 1,
                    snapshotSequence: 1,
                    threads: options?.projectId === PROJECT_ID ? threads : [],
                    archivedThreads: [],
                  }),
                dispatch: (command) =>
                  Queue.offer(dispatched, command).pipe(
                    Effect.as({ sequence: 1, storedEvents: [] }),
                  ),
              }),
              Layer.succeed(
                Crypto.Crypto,
                Crypto.make({
                  randomBytes: (size) => new Uint8Array(size).fill(1),
                  digest: (_algorithm, data) => Effect.succeed(data),
                }),
              ),
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const cap = yield* ProjectThreadCap.ProjectThreadCap;
          yield* cap.start();
          const first = yield* Queue.take(dispatched);
          const second = yield* Queue.take(dispatched);
          yield* cap.drain;
          assert.deepStrictEqual(
            [first, second].map((command) => [
              command.type,
              "threadId" in command ? command.threadId : null,
            ]),
            [
              ["thread.archive", threads.at(-1)!.id],
              ["thread.archive", threads.at(-2)!.id],
            ],
          );
          assert.strictEqual(yield* Queue.size(dispatched), 0);
        }).pipe(Effect.provide(layer));
      }),
    ),
  );
});
