import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { threadKey } from "./entities.ts";
import { hiddenThreadKeys, NO_HIDDEN_THREADS } from "./threadTagFilter.ts";

const environmentId = EnvironmentId.make("env-1");
const thread = (id: string, tags: string[] = [], parent: string | null = null) => ({
  id: ThreadId.make(id),
  tags,
  lineage: { parentThreadId: parent === null ? null : ThreadId.make(parent) },
});
const key = (id: string) => threadKey({ environmentId, threadId: ThreadId.make(id) });

describe("hiddenThreadKeys", () => {
  it("hides nothing while the filter is off", () => {
    expect(
      hiddenThreadKeys([{ environmentId, hiddenTags: null, threads: [thread("a", ["private"])] }]),
    ).toBe(NO_HIDDEN_THREADS);
  });

  it("hides tagged threads and the children of a hidden parent", () => {
    const hidden = hiddenThreadKeys([
      {
        environmentId,
        hiddenTags: ["private"],
        threads: [
          thread("a", ["private"]),
          thread("child", [], "a"),
          thread("b", ["other"]),
          thread("orphan", [], "missing"),
        ],
      },
    ]);
    expect([...hidden].toSorted()).toEqual([key("a"), key("child")].toSorted());
  });
});
