import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matchComposerThreadItems, parseThreadMentionQuery } from "./composerThreadItems.ts";

const env = EnvironmentId.make("env-1");
const otherEnv = EnvironmentId.make("env-2");
const project = ProjectId.make("project-1");
const otherProject = ProjectId.make("project-2");
const shell = (
  id: string,
  title: string,
  overrides: Partial<Parameters<typeof matchComposerThreadItems>[0]["shells"][number]> = {},
) => ({
  environmentId: env,
  projectId: project,
  id: ThreadId.make(id),
  title,
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  ...overrides,
});
const match = (shells: ReturnType<typeof shell>[], query: string) =>
  matchComposerThreadItems({
    shells,
    environmentId: env,
    projectId: project,
    excludeThreadId: ThreadId.make("self"),
    query,
  });

describe("matchComposerThreadItems", () => {
  it("offers nothing for a bare @ so the picker stays a file picker", () => {
    expect(match([shell("t1", "Fix login")], "  ")).toEqual([]);
  });

  it("matches titles within the project, newest first, skipping self and archived", () => {
    const items = match(
      [
        shell("old", "Login flow", { updatedAt: "2026-01-01T00:00:00.000Z" }),
        shell("new", "Login redesign", { updatedAt: "2026-02-01T00:00:00.000Z" }),
        shell("self", "Login self"),
        shell("gone", "Login archived", { archivedAt: "2026-01-02T00:00:00.000Z" }),
        shell("foreign", "Login elsewhere", { environmentId: otherEnv }),
        shell("sibling", "Login in another project", { projectId: otherProject }),
        shell("nope", "Unrelated"),
      ],
      "LOGIN",
    );
    expect(items.map((item) => item.thread.threadId)).toEqual(["new", "old"]);
    expect(items[0]).toMatchObject({ type: "thread", label: "Login redesign", fixedIntent: null });
  });

  it("lists recent project threads for an intent prefix, even before a title is typed", () => {
    const shells = [shell("a", "Fix login"), shell("b", "Billing")];
    expect(match(shells, "tell:").map((item) => item.thread.threadId)).toEqual(["a", "b"]);
    expect(match(shells, "Look:bill")).toEqual([
      expect.objectContaining({ label: "Billing", fixedIntent: "look" }),
    ]);
  });

  it("offers nothing without a project", () => {
    expect(
      matchComposerThreadItems({
        shells: [shell("t1", "Fix login")],
        environmentId: env,
        projectId: null,
        excludeThreadId: null,
        query: "fix",
      }),
    ).toEqual([]);
  });
});

describe("parseThreadMentionQuery", () => {
  it("reads the intent prefix and leaves other queries open", () => {
    expect(parseThreadMentionQuery("tell:fix")).toEqual({ intent: "tell", titleQuery: "fix" });
    expect(parseThreadMentionQuery("src/tell:x")).toEqual({
      intent: null,
      titleQuery: "src/tell:x",
    });
  });
});
