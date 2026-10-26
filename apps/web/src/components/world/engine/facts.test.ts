import { ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../../test-fixtures";
import { ageReplies, buildCharacterFacts, islandIdleSeconds } from "./facts";

const running = {
  status: "running" as const,
  activeRunId: RunId.make("run-1"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: null,
  lastError: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const thread = (id: string, overrides: ThreadFixtureOverrides = {}) =>
  makeThreadFixture({ id: ThreadId.make(id), runtime: null, ...overrides });

const subagentOf = (parent: string) => ({
  lineage: {
    rootThreadId: ThreadId.make(parent),
    parentThreadId: ThreadId.make(parent),
    relationshipToParent: "subagent" as const,
  },
});

const build = (threads: ReturnType<typeof thread>[], limit?: number) =>
  buildCharacterFacts({
    threads,
    localLastVisitedAt: () => undefined,
    ...(limit ? { limit } : {}),
  });

describe("buildCharacterFacts", () => {
  it("makes a subagent a kid of its parent and gives it the parent's look", () => {
    const facts = build([
      thread("parent"),
      thread("kid", subagentOf("parent")),
      thread("grandkid", subagentOf("kid")),
    ]);
    const byId = new Map(facts.map((f) => [f.ref.threadId as string, f]));

    expect(byId.get("kid")).toMatchObject({ kid: true, lookSeed: "parent" });
    expect(byId.get("kid")!.parentKey).toBe(byId.get("parent")!.key);
    expect(byId.get("grandkid")).toMatchObject({ kid: true, lookSeed: "parent" });
    expect(byId.get("parent")).toMatchObject({ kid: false, lookSeed: "parent" });
  });

  it("keeps the family look but drops the kid role when the parent is not in the world", () => {
    const [orphan] = build([thread("kid", subagentOf("archived-parent"))]);
    expect(orphan).toMatchObject({ kid: false, parentKey: null, lookSeed: "archived-parent" });
  });

  it("gives a fork its own look", () => {
    const [fork] = build([
      thread("fork", {
        lineage: {
          rootThreadId: ThreadId.make("origin"),
          parentThreadId: ThreadId.make("origin"),
          relationshipToParent: "fork",
        },
      }),
    ]);
    expect(fork).toMatchObject({ kid: false, lookSeed: "fork" });
  });

  it("marks a parent whose kid is working", () => {
    const facts = build([
      thread("parent"),
      thread("kid", { ...subagentOf("parent"), runtime: running }),
    ]);
    expect(facts.find((f) => f.ref.threadId === "parent")?.hasWorkingKids).toBe(true);
  });

  it("marks a done kid, and its own kids, as following a busy parent", () => {
    const old = { updatedAt: "2025-12-31T00:00:00.000Z" };
    const family = (parent: ThreadFixtureOverrides) =>
      new Map(
        build([
          thread("parent", parent),
          thread("kid", { ...subagentOf("parent"), ...old }),
          thread("grandkid", { ...subagentOf("kid"), ...old }),
        ]).map((f) => [f.ref.threadId as string, f]),
      );

    const busy = family({ runtime: running });
    expect(busy.get("kid")).toMatchObject({ status: "ready", parentBusy: true });
    expect(busy.get("grandkid")).toMatchObject({ status: "ready", parentBusy: true });
    expect(busy.get("parent")!.parentBusy).toBe(false);
    const resting = family({});
    expect(resting.get("kid")!.parentBusy).toBe(false);
    expect(resting.get("grandkid")!.parentBusy).toBe(false);
  });

  it("keeps a background subagent working while its settled parent waits on it", () => {
    const facts = build([
      thread("parent", {
        runtime: { ...running, status: "idle" },
        pendingBackgroundTasks: [
          { taskId: "task-1", kind: "subagent", childThreadId: ThreadId.make("kid") },
        ],
      }),
      thread("kid", subagentOf("parent")),
      thread("done-kid", subagentOf("parent")),
    ]);
    const byId = new Map(facts.map((f) => [f.ref.threadId as string, f]));
    expect(byId.get("kid")!.status).toBe("working");
    expect(byId.get("done-kid")!.status).toBe("ready");
    expect(byId.get("parent")).toMatchObject({
      status: "waiting",
      hasWorkingKids: true,
      backgroundTask: false,
    });
  });

  it("keeps a subagent working while its parent's current run has touched it", () => {
    const facts = build([
      thread("parent", {
        runtime: running,
        latestRun: {
          runId: RunId.make("run-1"),
          status: "running",
          requestedAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      }),
      thread("kid", { ...subagentOf("parent"), updatedAt: "2026-01-01T00:01:00.000Z" }),
      thread("old-kid", { ...subagentOf("parent"), updatedAt: "2025-12-31T00:00:00.000Z" }),
    ]);
    const byId = new Map(facts.map((f) => [f.ref.threadId as string, f]));
    expect(byId.get("kid")!.status).toBe("working");
    expect(byId.get("old-kid")!.status).toBe("ready");
  });

  it("puts a subagent on its parent's island even when it ran in another project", () => {
    const facts = build([
      thread("parent", { projectId: ProjectId.make("app") }),
      thread("kid", { ...subagentOf("parent"), projectId: ProjectId.make("lib") }),
    ]);
    const kid = facts.find((f) => f.ref.threadId === "kid")!;
    const parent = facts.find((f) => f.ref.threadId === "parent")!;
    expect(kid.projectKey).toBe(parent.projectKey);
    expect(parent.projectKey).toMatch(/:app$/);
  });

  it("keeps the most recently updated threads", () => {
    const facts = build(
      [
        thread("old", { updatedAt: "2026-01-01T00:00:00.000Z" }),
        thread("new", { updatedAt: "2026-03-01T00:00:00.000Z" }),
        thread("mid", { updatedAt: "2026-02-01T00:00:00.000Z" }),
      ],
      2,
    );
    expect(facts.map((f) => f.ref.threadId)).toEqual(["new", "mid"]);
  });
});

describe("islandIdleSeconds", () => {
  const now = Date.parse("2026-01-01T01:00:00.000Z");
  const aged = (threads: ReturnType<typeof thread>[]) => ageReplies(build(threads), now);

  it("counts from the island's latest reply", () => {
    const facts = aged([
      thread("old", { updatedAt: "2026-01-01T00:00:00.000Z" }),
      thread("recent", { updatedAt: "2026-01-01T00:50:00.000Z" }),
    ]);
    expect(islandIdleSeconds(facts)).toBe(600);
  });

  it("is not idle while anyone works, or with nobody there", () => {
    const facts = aged([
      thread("old", { updatedAt: "2026-01-01T00:00:00.000Z" }),
      thread("busy", { runtime: running }),
    ]);
    expect(islandIdleSeconds(facts)).toBeNull();
    expect(islandIdleSeconds([])).toBeNull();
  });
});
