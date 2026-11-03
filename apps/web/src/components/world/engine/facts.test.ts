import {
  PROJECT_ACTIVE_THREAD_CAP,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../../test-fixtures";
import {
  ageReplies,
  buildCharacterFacts,
  collapseSubagents,
  type CharacterFacts,
  islandIdleSeconds,
} from "./facts";

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

const build = (threads: ReturnType<typeof thread>[]) =>
  buildCharacterFacts({ threads, localLastVisitedAt: () => undefined });

describe("buildCharacterFacts", () => {
  it("draws the most recent agents of each island up to the cap, subagents riding along", () => {
    const at = (minute: number) => `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`;
    const busy = Array.from({ length: PROJECT_ACTIVE_THREAD_CAP + 1 }, (_, index) =>
      thread(`busy${index}`, { updatedAt: at(index + 10) }),
    );
    const other = thread("other", {
      projectId: ProjectId.make("project-2"),
      updatedAt: at(0),
    });
    const kid = thread("kid", { ...subagentOf("busy1"), updatedAt: at(1) });
    const shown = new Set(build([...busy, other, kid]).map((f) => f.ref.threadId as string));

    // The oldest agent on the full island is left off; the other island keeps its own.
    expect(shown.has("busy0")).toBe(false);
    expect(shown.has("busy1")).toBe(true);
    expect(shown.has("kid")).toBe(true);
    expect(shown.has("other")).toBe(true);
    expect(shown.size).toBe(PROJECT_ACTIVE_THREAD_CAP + 2);
  });

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
});

describe("collapseSubagents", () => {
  const base = build([thread("template")])[0]!;
  const fact = (key: string, overrides: Partial<CharacterFacts> = {}): CharacterFacts => ({
    ...base,
    key,
    title: key,
    ref: { ...base.ref, threadId: ThreadId.make(key) },
    ...overrides,
  });

  it("draws one figure for an agent's subagents and counts them", () => {
    const parent = fact("parent");
    const kids = ["a", "b", "c", "d"].map((id, index) =>
      fact(id, {
        kid: true,
        parentKey: parent.key,
        lastReplyAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      }),
    );
    const { facts, subagentsOf } = collapseSubagents([
      kids[0]!,
      parent,
      kids[2]!,
      kids[1]!,
      kids[3]!,
    ]);
    const figure = facts.find((item) => item.kid);
    expect(facts.filter((item) => !item.kid).map((item) => item.key)).toEqual([parent.key]);
    expect(figure).toMatchObject({
      key: "d",
      parentKey: parent.key,
      subagentCount: 4,
    });
    expect(
      subagentsOf
        .get(parent.key)
        ?.map((item) => item.key)
        .toSorted(),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("lets the subagent that needs you stand for the others", () => {
    const parent = fact("parent", { status: "working" });
    const working = fact("working", {
      kid: true,
      parentKey: parent.key,
      status: "working",
      lastReplyAt: "2026-01-03T00:00:00.000Z",
    });
    const asking = fact("asking", {
      kid: true,
      parentKey: parent.key,
      status: "approval",
      lastReplyAt: "2026-01-01T00:00:00.000Z",
    });
    const { facts } = collapseSubagents([parent, working, asking]);
    expect(facts.find((item) => item.kid)).toMatchObject({
      key: "asking",
      status: "approval",
      subagentCount: 2,
    });
  });

  it("counts a nested subagent on the agent and stands the figure next to it", () => {
    const parent = fact("parent");
    const kid = fact("kid", { kid: true, parentKey: parent.key, status: "ready" });
    const grandkid = fact("grandkid", {
      kid: true,
      parentKey: kid.key,
      status: "working",
      lastReplyAt: "2026-01-02T00:00:00.000Z",
    });
    const { facts, subagentsOf } = collapseSubagents([parent, kid, grandkid]);
    expect(facts.find((item) => item.key === parent.key)?.hasWorkingKids).toBe(true);
    expect(facts.find((item) => item.kid)).toMatchObject({
      key: "grandkid",
      parentKey: parent.key,
      subagentCount: 2,
    });
    expect(
      subagentsOf
        .get(parent.key)
        ?.map((item) => item.key)
        .toSorted(),
    ).toEqual(["grandkid", "kid"]);
    expect(subagentsOf.has(kid.key)).toBe(false);
  });

  it("prefers a subagent that is still producing over a quiet one", () => {
    const parent = fact("parent");
    const quiet = fact("quiet", {
      kid: true,
      parentKey: parent.key,
      status: "working",
      quiet: true,
      lastReplyAt: "2026-01-03T00:00:00.000Z",
    });
    const busy = fact("busy", {
      kid: true,
      parentKey: parent.key,
      status: "working",
      lastReplyAt: "2026-01-01T00:00:00.000Z",
    });
    const { facts } = collapseSubagents([parent, quiet, busy]);
    expect(facts.find((item) => item.kid)?.key).toBe("busy");
  });

  it("leaves an agent with one subagent as that subagent", () => {
    const parent = fact("parent");
    const kid = fact("kid", { kid: true, parentKey: parent.key, title: "Review the tests" });
    const { facts } = collapseSubagents([parent, kid]);
    expect(facts.find((item) => item.kid)).toMatchObject({
      key: "kid",
      title: "Review the tests",
      subagentCount: 1,
    });
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
