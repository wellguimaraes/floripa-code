import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { chatAfterArchive } from "./chatAfterArchive";

const local = "local" as EnvironmentId;
const project = "project" as ProjectId;
const ref = (id: string): ScopedThreadRef => ({ environmentId: local, threadId: id as ThreadId });
const shell = (worktreePath: string | null, archived = false) => ({
  environmentId: local,
  projectId: project,
  worktreePath,
  archivedAt: archived ? "2026-11-18T00:00:00.000Z" : null,
});

function pick(
  opened: ReadonlyArray<string>,
  archived: string,
  shells: Record<string, ReturnType<typeof shell>>,
) {
  const next = chatAfterArchive(
    opened.map(ref),
    ref(archived),
    (target) => shells[target.threadId] ?? null,
    () => "/repo",
  );
  return next === null ? null : scopedThreadKey(next);
}

describe("chatAfterArchive", () => {
  it("picks the chat opened most recently before, in the same worktree", () => {
    const shells = { a: shell("/wt"), b: shell("/wt"), c: shell("/wt"), d: shell("/other") };
    expect(pick(["b", "c", "d", "a"], "a", shells)).toBe(scopedThreadKey(ref("c")));
  });

  it("skips archived and unknown threads", () => {
    const shells = { a: shell("/wt"), b: shell("/wt"), c: shell("/wt", true) };
    expect(pick(["b", "c", "gone", "a"], "a", shells)).toBe(scopedThreadKey(ref("b")));
  });

  it("matches the project folder whether or not its path is recorded", () => {
    const shells = { a: shell(null), b: shell("/repo") };
    expect(pick(["b", "a"], "a", shells)).toBe(scopedThreadKey(ref("b")));
  });

  it("closes the chat when no other agent in the worktree was opened", () => {
    const shells = { a: shell("/wt"), b: shell("/other") };
    expect(pick(["b", "a"], "a", shells)).toBeNull();
  });
});
