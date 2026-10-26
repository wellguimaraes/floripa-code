import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

export const OrchestrationThreadSearchSource = Schema.Literals(["user", "assistant"]);
export type OrchestrationThreadSearchSource = typeof OrchestrationThreadSearchSource.Type;

// The server's SQLite client is synchronous and single-connection. Bound both
// scan input and response size so a search cannot monopolize that connection.
export const OrchestrationSearchThreadsInput = Schema.Struct({
  query: TrimmedString.check(Schema.isMinLength(2), Schema.isMaxLength(200)),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});
export type OrchestrationSearchThreadsInput = typeof OrchestrationSearchThreadsInput.Type;

export const OrchestrationThreadSearchMatch = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  snippet: Schema.String.check(Schema.isMaxLength(240)),
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationThreadSearchMatch = typeof OrchestrationThreadSearchMatch.Type;

export const OrchestrationSearchThreadsResult = Schema.Struct({
  matches: Schema.Array(OrchestrationThreadSearchMatch),
});
export type OrchestrationSearchThreadsResult = typeof OrchestrationSearchThreadsResult.Type;

export class OrchestrationSearchThreadsError extends Schema.TaggedError<OrchestrationSearchThreadsError>()(
  "OrchestrationSearchThreadsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Search scoped to archived threads, ranking by keyword and by meaning. */
export const OrchestrationSearchArchivedThreadsInput = Schema.Struct({
  query: OrchestrationSearchThreadsInput.fields.query,
  /** Omitted searches every project. */
  projectIds: Schema.optionalKey(Schema.Array(ProjectId).check(Schema.isMaxLength(100))),
  limit: OrchestrationSearchThreadsInput.fields.limit,
});
export type OrchestrationSearchArchivedThreadsInput =
  typeof OrchestrationSearchArchivedThreadsInput.Type;

/**
 * How far semantic ranking has got. `preparing` covers the first-use model
 * download; `indexing` embeds threads that changed since they were last seen;
 * `unavailable` means only keyword matches are ranked.
 */
export const OrchestrationArchivedThreadSearchIndex = Schema.Struct({
  status: Schema.Literals(["preparing", "indexing", "ready", "unavailable"]),
  indexed: Schema.Int,
  total: Schema.Int,
});
export type OrchestrationArchivedThreadSearchIndex =
  typeof OrchestrationArchivedThreadSearchIndex.Type;

/** Streamed: each value replaces the last, and the stream ends once `index` settles. */
export const OrchestrationSearchArchivedThreadsResult = Schema.Struct({
  matches: Schema.Array(OrchestrationThreadSearchMatch),
  index: OrchestrationArchivedThreadSearchIndex,
});
export type OrchestrationSearchArchivedThreadsResult =
  typeof OrchestrationSearchArchivedThreadsResult.Type;
