import * as Scheduler from "../scheduling/Scheduler.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const decodeUpsertInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);

it.effect("rejects a stale form save after deletion while preserving explicit-id creates", () =>
  Effect.gen(function* () {
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        id: "scheduled-task:edit-after-delete",
        title: "Review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: "project-stale-schedule",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const created = yield* service.upsert(input);
      const edit = yield* decodeUpsertInput({ ...input, requireExisting: true, title: "Edited" });
      expect((yield* service.upsert(edit)).task.title).toBe("Edited");
      yield* service.delete({ id: created.task.id });

      const failure = yield* service.upsert(edit).pipe(Effect.flip);
      expect(failure.message).toBe("Schedule task not found.");
      expect((yield* service.list()).tasks).toEqual([]);

      expect((yield* service.upsert(input)).task.id).toBe(created.task.id);
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("preserves a due run when a save only pads the scheduled hour", () =>
  Effect.gen(function* () {
    const dueAt = DateTime.makeZonedUnsafe(
      { year: 2026, month: 7, day: 1, hour: 9, minute: 0, second: 0, millisecond: 0 },
      { timeZone: DateTime.zoneMakeLocal(), adjustForTimeZone: true },
    );
    yield* TestClock.setTime(DateTime.toEpochMillis(dueAt) - 1_000);

    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        commandId: "schedule-time-format",
        title: "Morning review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "fixed_time", timeOfDay: "9:00" },
        projectId: "project-schedule-time-format",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        creationSource: "mcp",
      });
      const created = yield* service.upsert(input);
      const expectedDueAt = DateTime.formatIso(DateTime.toUtc(dueAt));
      expect(created.task.nextRunAt).toBe(expectedDueAt);

      // Cross the due time before the scheduler's first five-second tick.
      yield* TestClock.setTime(DateTime.toEpochMillis(dueAt) + 1_000);
      const update = yield* decodeUpsertInput({
        ...input,
        id: created.task.id,
        schedule: { type: "fixed_time", timeOfDay: "09:00" },
      });
      const updated = yield* service.upsert(update);
      expect(updated.task.nextRunAt).toBe(expectedDueAt);
      expect((yield* service.list()).tasks[0]?.nextRunAt).toBe(expectedDueAt);

      const rescheduled = yield* service.upsert({
        ...update,
        schedule: { type: "fixed_time", timeOfDay: "09:30" },
      });
      expect(rescheduled.task.nextRunAt).toBe(
        DateTime.formatIso(DateTime.toUtc(DateTime.add(dueAt, { minutes: 30 }))),
      );
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("runs a one-time schedule once and rejects past times", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-01T07:59:00.000Z"));
    // Each launch takes two minutes, so a manual run can start before the run time and end after it.
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({
        launch: () => TestClock.adjust("2 minutes").pipe(Effect.andThen(Effect.die("synthetic"))),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const decoded = yield* decodeUpsertInput({
        commandId: "once-schedule",
        title: "One time",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "once", runAt: "2026-11-01T03:00:00-05:00" },
        projectId: "project-once",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const created = yield* service.upsert(decoded);
      expect(created.task.schedule).toEqual({ type: "once", runAt: "2026-11-01T08:00:00.000Z" });
      expect(created.task.nextRunAt).toBe("2026-11-01T08:00:00.000Z");

      // A manual run that starts before the time keeps the scheduled run, even if it ends after.
      const early = yield* service.runNow({ id: created.task.id });
      expect(early.task.nextRunAt).toBe("2026-11-01T08:00:00.000Z");

      const due = yield* service.runNow({ id: created.task.id });
      expect(due.task.nextRunAt).toBeNull();
      expect((yield* service.list()).tasks[0]?.nextRunAt).toBeNull();

      yield* service.setEnabled({ id: created.task.id, enabled: false });
      const resumed = yield* service
        .setEnabled({ id: created.task.id, enabled: true })
        .pipe(Effect.flip);
      expect(resumed.message).toBe("The run time has passed. Pick a time in the future.");

      const past = yield* service
        .upsert({ ...decoded, commandId: undefined, title: "Late" })
        .pipe(Effect.flip);
      expect(past.message).toBe("The run time has passed. Pick a time in the future.");
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

const threadModeInput = {
  title: "One thread",
  prompt: "Review the open pull requests.",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId: "project-thread-mode",
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: "codex", model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
} as const;

const threadModeHarness = Effect.gen(function* () {
  const launched: string[] = [];
  const sent: string[] = [];
  const freshFlags: Array<boolean | undefined> = [];
  let deleted = false;
  const layerDependencies = Layer.mergeAll(
    NodeCrypto.layer,
    Scheduler.layer,
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      launch: (input) =>
        Effect.sync(() => {
          launched.push(input.commandId);
          return { threadId: "thread-first" } as never;
        }),
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      sendToThread: (input) =>
        Effect.sync(() => {
          sent.push(input.threadId);
          freshFlags.push(input.freshContext);
          return {} as never;
        }),
      getThreadShell: () => Effect.succeed(deleted ? null : ({ deletedAt: null } as never)),
    }),
    Layer.mock(SecretRequests.SecretRequests)({}),
  );
  return {
    launched,
    sent,
    freshFlags,
    deleteThread: () => {
      deleted = true;
    },
    layer: ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies)),
  };
});

it.effect("a one-thread task starts its thread on the first run and posts later runs there", () =>
  Effect.gen(function* () {
    const harness = yield* threadModeHarness;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert(
        yield* decodeUpsertInput({ ...threadModeInput, threadMode: "continue" }),
      );
      expect(task.threadId).toBeNull();
      yield* service.runNow({ id: task.id });
      expect((yield* service.list()).tasks[0]?.threadId).toBe("thread-first");
      yield* service.runNow({ id: task.id });
      expect(harness.launched).toHaveLength(1);
      expect(harness.sent).toEqual(["thread-first"]);

      // Moving the task to another project leaves the old thread behind.
      const moved = yield* service.upsert(
        yield* decodeUpsertInput({
          ...threadModeInput,
          id: task.id,
          projectId: "project-elsewhere",
          threadId: "thread-first",
          requireExisting: true,
        }),
      );
      expect(moved.task.threadId).toBeNull();
      expect(moved.task.threadMode).toBe("continue");
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a new-thread task never binds, and a thread deleted mid-run is unbound again", () =>
  Effect.gen(function* () {
    const harness = yield* threadModeHarness;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const fresh = yield* service.upsert(
        yield* decodeUpsertInput({ ...threadModeInput, commandId: "new-thread-task" }),
      );
      yield* service.runNow({ id: fresh.task.id });
      expect((yield* service.list()).tasks[0]?.threadId).toBeNull();
      expect(fresh.task.threadMode).toBe("new_thread");

      const bound = yield* service.upsert(
        yield* decodeUpsertInput({
          ...threadModeInput,
          commandId: "continue-task",
          threadMode: "continue",
        }),
      );
      harness.deleteThread();
      yield* service.runNow({ id: bound.task.id });
      const stored = (yield* service.list()).tasks.find((task) => task.id === bound.task.id);
      expect(stored?.threadId).toBeNull();
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a fresh-session task asks the thread service for a fresh context on later runs", () =>
  Effect.gen(function* () {
    const harness = yield* threadModeHarness;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert(
        yield* decodeUpsertInput({ ...threadModeInput, threadMode: "fresh_session" }),
      );
      yield* service.runNow({ id: task.id });
      yield* service.runNow({ id: task.id });
      expect(harness.freshFlags).toEqual([true]);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
