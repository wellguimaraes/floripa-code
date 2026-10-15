import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** More agents or worktrees than an island shows would only dilute the guess. */
const MANAGER_MAX_CANDIDATES = 24;

/** Where a message's work happens: the project checkout, an existing worktree, or a new one. */
export const ManagerCheckout = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("local") }),
  Schema.Struct({ kind: Schema.Literal("worktree"), path: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("new-worktree") }),
]);
export type ManagerCheckout = typeof ManagerCheckout.Type;

export const ManagerRouteInput = Schema.Struct({
  /** The island's top-level agents the message may go to. */
  threadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(MANAGER_MAX_CANDIDATES)),
  /** The branch the project checkout is on, when known. */
  mainBranch: Schema.NullOr(Schema.String),
  /** The repo's other worktrees. Ones the agents work in count even when missing here. */
  worktrees: Schema.Array(
    Schema.Struct({ path: TrimmedNonEmptyString, branch: Schema.String }),
  ).check(Schema.isMaxLength(MANAGER_MAX_CANDIDATES)),
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
});
export type ManagerRouteInput = typeof ManagerRouteInput.Type;

/** The manager's guess, most likely first in each list. */
export const ManagerRoute = Schema.Struct({
  checkouts: Schema.Array(Schema.Struct({ checkout: ManagerCheckout, probability: Schema.Number })),
  agents: Schema.Array(Schema.Struct({ threadId: ThreadId, probability: Schema.Number })),
  /** How likely none of the agents fits and a new one should start. */
  newAgentProbability: Schema.Number,
});
export type ManagerRoute = typeof ManagerRoute.Type;

/**
 * `missingKey` and `rejectedKey` mean the environment needs an OpenRouter API
 * key before the manager can route, so a client can ask for one.
 */
export class ManagerRouteError extends Schema.TaggedError<ManagerRouteError>()(
  "ManagerRouteError",
  {
    reason: Schema.Literals(["missingKey", "rejectedKey", "failed"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
