import { ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import { buildManagerRequest, type ManagerAgent, readManagerRoute } from "./ManagerRouter.ts";

const agent = (id: string, worktreePath: string | null, title = id): ManagerAgent => ({
  threadId: ThreadId.make(id),
  title,
  branch: worktreePath === null ? null : `feature/${id}`,
  worktreePath,
  minutesSinceActive: 5,
  recentUserMessages: [`work on ${title}`],
  lastAgentReply: null,
});

describe("buildManagerRequest", () => {
  it("groups agents under their checkout and counts worktrees only agents know about", () => {
    const request = buildManagerRequest(
      [agent("a", null), agent("b", "/wt/listed"), agent("c", "/wt/unlisted")],
      {
        mainBranch: "main",
        worktrees: [{ path: "/wt/listed", branch: "feature/listed" }],
        message: "fix the login page",
      },
    );
    const { checkouts } = request.state;
    assert.deepStrictEqual(Object.keys(checkouts), ["main", "worktree_1", "worktree_2"]);
    assert.deepStrictEqual(
      checkouts.main?.agents.map((a) => a.title),
      ["a"],
    );
    assert.strictEqual(checkouts.worktree_1?.branch, "feature/listed");
    assert.strictEqual(checkouts.worktree_2?.branch, "feature/c");
    assert.deepStrictEqual(Object.keys(request.questions.where.criteria), [
      "main",
      "worktree_1",
      "worktree_2",
      "new_worktree",
    ]);
    assert.deepStrictEqual(Object.keys(request.questions.target.criteria), [
      "agent_1",
      "agent_2",
      "agent_3",
      "new_agent",
    ]);
  });
});

describe("readManagerRoute", () => {
  it("maps labels back, most likely first, ignoring labels it never offered", () => {
    const request = buildManagerRequest([agent("a", null), agent("b", "/wt/b")], {
      mainBranch: "main",
      worktrees: [],
      message: "continue",
    });
    const route = readManagerRoute(
      {
        where: { choice: "worktree_1", probabilities: { worktree_1: 0.9, main: 0.08, bogus: 1 } },
        target: { choice: "agent_2", probabilities: { agent_2: 0.7, new_agent: 0.2 } },
      },
      request,
    );
    assert.deepStrictEqual(route.checkouts, [
      { checkout: { kind: "worktree", path: "/wt/b" }, probability: 0.9 },
      { checkout: { kind: "local" }, probability: 0.08 },
      { checkout: { kind: "new-worktree" }, probability: 0 },
    ]);
    assert.deepStrictEqual(route.agents, [
      { threadId: ThreadId.make("b"), probability: 0.7 },
      { threadId: ThreadId.make("a"), probability: 0 },
    ]);
    assert.strictEqual(route.newAgentProbability, 0.2);
  });
});
