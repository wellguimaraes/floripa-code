import {
  IsoDateTime,
  type OrchestrationArchivedThreadSearchIndex,
  type OrchestrationSearchArchivedThreadsInput,
  type OrchestrationSearchArchivedThreadsResult,
  OrchestrationThreadSearchSource,
  type OrchestrationSearchThreadsInput,
  type OrchestrationSearchThreadsResult,
  type OrchestrationThreadSearchMatch,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import * as TextEmbedder from "../embeddings/TextEmbedder.ts";

/** Carries no query text: search input is user content. */
export class ThreadSearchError extends Schema.TaggedError<ThreadSearchError>()(
  "ThreadSearchError",
  {
    operation: Schema.Literals(["query", "decode", "index"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread search ${this.operation} failed.`;
  }
}

const SearchRequest = Schema.Struct({ pattern: Schema.String, limit: Schema.Int });
const SearchRow = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  matchText: Schema.String,
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});

function escapeLikePattern(value: string): string {
  return value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");
}

function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/** At most 240 characters, centred near the first match. */
function buildSearchSnippet(text: string, query: string): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length <= 240) {
    return normalizedText;
  }
  const normalizedQuery = foldAsciiCase(query.replace(/\s+/g, " ").trim());
  const matchIndex = foldAsciiCase(normalizedText).indexOf(normalizedQuery);
  const bodyLength = 236;
  const idealStart = Math.max(0, matchIndex - 72);
  const start = Math.min(idealStart, normalizedText.length - bodyLength);
  const end = Math.min(normalizedText.length, start + bodyLength);
  return `${start > 0 ? "…" : ""}${normalizedText.slice(start, end)}${
    end < normalizedText.length ? "…" : ""
  }`;
}

const ArchivedKeywordRequest = Schema.Struct({
  words: Schema.Array(Schema.String),
  projectIds: Schema.NullOr(Schema.Array(Schema.String)),
  limit: Schema.Int,
});
const ArchivedKeywordRow = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: Schema.NullOr(OrchestrationThreadSearchSource),
  matchText: Schema.NullOr(Schema.String),
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});
const ArchivedScopeRequest = Schema.Struct({
  projectIds: Schema.NullOr(Schema.Array(Schema.String)),
  model: Schema.String,
});
const ArchivedScopeRow = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  updatedAt: Schema.String,
  vector: Schema.NullOr(Schema.Uint8Array),
});
const ThreadIdsRequest = Schema.Struct({ threadIds: Schema.Array(ThreadId) });
const PassageRequest = Schema.Struct({ threadIds: Schema.Array(ThreadId), model: Schema.String });
const PassageRow = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  updatedAt: Schema.String,
  current: Schema.NullOr(Schema.Uint8Array),
  text: Schema.NullOr(Schema.String),
});
const FirstUserMessageRow = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String,
  createdAt: IsoDateTime,
});

// Stored with each vector; bump the suffix when buildPassage changes so old
// vectors are re-embedded.
const INDEX_VERSION = `${TextEmbedder.TEXT_EMBEDDING_MODEL_ID}:passage-1`;
// Threads embedded per round trip to the worker; each round ends with an
// update to the client, so this also sets how often results refresh.
const INDEX_BATCH_SIZE = 8;
// e5 reads 256 tokens per passage (TextEmbedder); this many characters covers
// that in any language without shipping whole transcripts to the worker.
const PASSAGE_MAX_CHARS = 2_000;
// e5 cosine scores sit in a narrow band whose level moves with the query
// (unrelated threads score 0.77-0.80), so a semantic hit must stand this far
// above the typical thread in scope. Measured on real archives: related
// threads cleared it, unrelated ones and cross-language near misses did not.
const SEMANTIC_MARGIN = 0.06;
// Below this many threads the median says little; use the usual level instead.
const SEMANTIC_BASELINE_MIN_THREADS = 20;
const SEMANTIC_DEFAULT_BASELINE = 0.79;
const SEMANTIC_MAX_HITS = 20;
// Reciprocal-rank fusion constant: dampens how much the top ranks of either
// list dominate the merged order.
const FUSION_K = 20;

/** Unique query words, so word order and repeats do not matter. */
function keywordWords(query: string): ReadonlyArray<string> {
  return [...new Set(query.split(/\s+/).filter((word) => word.length > 0))].slice(0, 8);
}

function toVector(bytes: Uint8Array): Float32Array {
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

function dot(left: Float32Array, right: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < left.length; index++) sum += left[index]! * right[index]!;
  return sum;
}

/** Drops inline images, which users paste often and which carry no meaning as text. */
function withoutImages(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
}

/** What a thread is about: its title, then what the user asked, in order. */
function buildPassage(title: string, userTexts: ReadonlyArray<string>): string {
  return withoutImages([title, ...userTexts].join("\n"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PASSAGE_MAX_CHARS);
}

/**
 * Searches the finished user and assistant messages of active V2 threads in
 * active projects. Legacy V1 transcripts that have not been imported yet are
 * not searched.
 */
export class ThreadSearch extends Context.Service<
  ThreadSearch,
  {
    readonly search: (
      input: OrchestrationSearchThreadsInput,
    ) => Effect.Effect<OrchestrationSearchThreadsResult, ThreadSearchError>;
    /**
     * Searches archived threads by keyword (every word, any order, in the
     * title or one message) and by meaning. Threads whose vector is missing or
     * stale are embedded on the way, so the stream emits improving results and
     * ends once `index` settles. Embedding failures degrade to keyword-only.
     */
    readonly searchArchived: (
      input: OrchestrationSearchArchivedThreadsInput,
    ) => Stream.Stream<OrchestrationSearchArchivedThreadsResult, ThreadSearchError>;
  }
>()("t3/orchestration-v2/ThreadSearch") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One best match per thread: user messages outrank assistant ones, then the
  // newest message wins. Threads order by match kind, then recency.
  const searchRows = SqlSchema.findAll({
    Request: SearchRequest,
    Result: SearchRow,
    execute: ({ pattern, limit }) => sql`
      WITH candidate AS (
        SELECT
          threads.thread_id,
          threads.project_id,
          messages.role,
          json_extract(messages.payload_json, '$.text') AS match_text,
          messages.created_at AS message_created_at,
          messages.message_id,
          threads.updated_at AS thread_updated_at
        FROM orchestration_v2_projection_messages AS messages
        INNER JOIN orchestration_v2_projection_threads AS threads
          ON threads.thread_id = messages.thread_id
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.deleted_at IS NULL
          AND threads.archived_at IS NULL
          AND projects.deleted_at IS NULL
          AND messages.streaming = 0
          AND messages.role IN ('user', 'assistant')
          AND json_extract(messages.payload_json, '$.text') LIKE ${pattern} ESCAPE '!'
      ),
      ranked AS (
        SELECT
          thread_id,
          project_id,
          role AS source,
          match_text,
          message_created_at,
          CASE role WHEN 'user' THEN 0 ELSE 1 END AS match_rank,
          thread_updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY thread_id
            ORDER BY
              CASE role WHEN 'user' THEN 0 ELSE 1 END ASC,
              message_created_at DESC,
              message_id ASC
          ) AS thread_match_rank
        FROM candidate
      )
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        source,
        match_text AS "matchText",
        message_created_at AS "messageCreatedAt"
      FROM ranked
      WHERE thread_match_rank = 1
      ORDER BY match_rank ASC, thread_updated_at DESC, thread_id ASC
      LIMIT ${limit}
    `,
  });

  const search: ThreadSearch["Service"]["search"] = Effect.fn("ThreadSearch.search")(
    function* (input) {
      const rows = yield* searchRows({
        pattern: `%${escapeLikePattern(input.query)}%`,
        limit: input.limit ?? 50,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ThreadSearchError({
              operation: Schema.isSchemaError(cause) ? "decode" : "query",
              cause,
            }),
        ),
      );
      return {
        matches: rows.map((row) => ({
          threadId: row.threadId,
          projectId: row.projectId,
          source: row.source,
          snippet: buildSearchSnippet(row.matchText, input.query),
          messageCreatedAt: row.messageCreatedAt,
        })),
      };
    },
  );

  const embedder = yield* TextEmbedder.TextEmbedder;
  // Searches typed in quick succession share the index; one embeds at a time
  // and the next picks up whatever is still stale.
  const indexLock = yield* Semaphore.make(1);

  const archivedScope = (projectIds: ReadonlyArray<string> | null) =>
    projectIds === null
      ? sql``
      : projectIds.length === 0
        ? sql`AND 0`
        : sql`AND threads.project_id IN ${sql.in(projectIds)}`;

  const containsAll = (column: string, words: ReadonlyArray<string>) =>
    sql.and(
      words.map(
        (word) => sql`${sql.literal(column)} LIKE ${`%${escapeLikePattern(word)}%`} ESCAPE '!'`,
      ),
    );

  // One best match per thread, like `search`, plus threads whose title holds
  // every word. Title hits lead, then user messages, then assistant ones.
  const archivedKeywordRows = SqlSchema.findAll({
    Request: ArchivedKeywordRequest,
    Result: ArchivedKeywordRow,
    execute: ({ words, projectIds, limit }) => sql`
      WITH scope AS (
        SELECT threads.thread_id, threads.project_id, threads.title, threads.archived_at
        FROM orchestration_v2_projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.deleted_at IS NULL
          AND threads.archived_at IS NOT NULL
          AND projects.deleted_at IS NULL
          ${archivedScope(projectIds)}
      ),
      hits AS (
        SELECT
          messages.thread_id,
          messages.role,
          json_extract(messages.payload_json, '$.text') AS match_text,
          messages.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY messages.thread_id
            ORDER BY
              CASE messages.role WHEN 'user' THEN 0 ELSE 1 END ASC,
              messages.created_at DESC,
              messages.message_id ASC
          ) AS thread_match_rank
        FROM orchestration_v2_projection_messages AS messages
        INNER JOIN scope ON scope.thread_id = messages.thread_id
        WHERE messages.streaming = 0
          AND messages.role IN ('user', 'assistant')
          AND ${containsAll("json_extract(messages.payload_json, '$.text')", words)}
      ),
      matched AS (
        SELECT
          scope.thread_id,
          scope.project_id,
          scope.archived_at,
          CASE WHEN ${containsAll("scope.title", words)} THEN 1 ELSE 0 END AS title_hit,
          hits.role,
          hits.match_text,
          hits.created_at
        FROM scope
        LEFT JOIN hits ON hits.thread_id = scope.thread_id AND hits.thread_match_rank = 1
      )
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        role AS source,
        match_text AS "matchText",
        created_at AS "messageCreatedAt"
      FROM matched
      WHERE title_hit = 1 OR role IS NOT NULL
      ORDER BY
        title_hit DESC,
        CASE role WHEN 'user' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END ASC,
        archived_at DESC,
        thread_id ASC
      LIMIT ${limit}
    `,
  });

  // Every archived thread in scope, with its vector when that is current.
  const archivedScopeRows = SqlSchema.findAll({
    Request: ArchivedScopeRequest,
    Result: ArchivedScopeRow,
    execute: ({ projectIds, model }) => sql`
      SELECT
        threads.thread_id AS "threadId",
        threads.project_id AS "projectId",
        threads.updated_at AS "updatedAt",
        CASE
          WHEN embeddings.model = ${model}
            AND embeddings.source_updated_at = threads.updated_at
          THEN embeddings.vector
        END AS vector
      FROM orchestration_v2_projection_threads AS threads
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      LEFT JOIN thread_embeddings AS embeddings
        ON embeddings.thread_id = threads.thread_id
      WHERE threads.deleted_at IS NULL
        AND threads.archived_at IS NOT NULL
        AND projects.deleted_at IS NULL
        ${archivedScope(projectIds)}
      ORDER BY threads.archived_at DESC, threads.thread_id ASC
    `,
  });

  // `current` is set when another search embedded the thread meanwhile.
  const passageRows = SqlSchema.findAll({
    Request: PassageRequest,
    Result: PassageRow,
    execute: ({ threadIds, model }) => sql`
      SELECT
        threads.thread_id AS "threadId",
        threads.title,
        threads.updated_at AS "updatedAt",
        CASE
          WHEN embeddings.model = ${model}
            AND embeddings.source_updated_at = threads.updated_at
          THEN embeddings.vector
        END AS current,
        json_extract(messages.payload_json, '$.text') AS text
      FROM orchestration_v2_projection_threads AS threads
      LEFT JOIN thread_embeddings AS embeddings
        ON embeddings.thread_id = threads.thread_id
      LEFT JOIN orchestration_v2_projection_messages AS messages
        ON messages.thread_id = threads.thread_id
        AND messages.role = 'user'
        AND messages.streaming = 0
      WHERE threads.thread_id IN ${sql.in(threadIds)}
      ORDER BY threads.thread_id, messages.created_at, messages.message_id
    `,
  });

  const firstUserMessageRows = SqlSchema.findAll({
    Request: ThreadIdsRequest,
    Result: FirstUserMessageRow,
    execute: ({ threadIds }) => sql`
      SELECT "threadId", text, "createdAt"
      FROM (
        SELECT
          messages.thread_id AS "threadId",
          json_extract(messages.payload_json, '$.text') AS text,
          messages.created_at AS "createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY messages.thread_id
            ORDER BY messages.created_at ASC, messages.message_id ASC
          ) AS position
        FROM orchestration_v2_projection_messages AS messages
        WHERE messages.thread_id IN ${sql.in(threadIds)}
          AND messages.role = 'user'
          AND messages.streaming = 0
      )
      WHERE position = 1 AND text IS NOT NULL
    `,
  });

  const queryError = (cause: unknown) =>
    new ThreadSearchError({
      operation: Schema.isSchemaError(cause) ? "decode" : "query",
      cause,
    });

  /** Embeds `threadIds` and stores their vectors; returns what it stored. */
  const indexThreads = (threadIds: ReadonlyArray<ThreadId>) =>
    Effect.gen(function* () {
      const rows = yield* passageRows({
        threadIds,
        model: INDEX_VERSION,
      }).pipe(Effect.mapError(queryError));
      const stored = new Map<ThreadId, Float32Array>();
      const passages = new Map<ThreadId, { title: string; updatedAt: string; texts: string[] }>();
      for (const row of rows) {
        if (row.current !== null) {
          stored.set(row.threadId, toVector(row.current));
          continue;
        }
        const passage = passages.get(row.threadId) ?? {
          title: row.title,
          updatedAt: row.updatedAt,
          texts: [],
        };
        if (row.text !== null) passage.texts.push(row.text);
        passages.set(row.threadId, passage);
      }
      const entries = [...passages.entries()];
      const vectors = yield* embedder.embed(
        "passage",
        entries.map(([, passage]) => buildPassage(passage.title, passage.texts)),
      );
      yield* Effect.forEach(
        entries,
        ([threadId, passage], index) => {
          const vector = vectors[index]!;
          stored.set(threadId, vector);
          return sql`
            INSERT INTO thread_embeddings (thread_id, model, source_updated_at, vector)
            VALUES (
              ${threadId},
              ${INDEX_VERSION},
              ${passage.updatedAt},
              ${new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)}
            )
            ON CONFLICT (thread_id) DO UPDATE SET
              model = excluded.model,
              source_updated_at = excluded.source_updated_at,
              vector = excluded.vector
          `.pipe(Effect.mapError((cause) => new ThreadSearchError({ operation: "index", cause })));
        },
        { discard: true },
      );
      return stored;
    });

  const searchArchived: ThreadSearch["Service"]["searchArchived"] = (input) =>
    Stream.callback<OrchestrationSearchArchivedThreadsResult, ThreadSearchError>((queue) =>
      Effect.gen(function* () {
        const projectIds = input.projectIds ?? null;
        const limit = input.limit ?? 50;
        const keyword = yield* archivedKeywordRows({
          words: keywordWords(input.query),
          projectIds,
          limit,
        }).pipe(Effect.mapError(queryError));
        const scope = yield* archivedScopeRows({
          projectIds,
          model: INDEX_VERSION,
        }).pipe(Effect.mapError(queryError));
        const projectOf = new Map(scope.map((row) => [row.threadId, row.projectId]));
        const vectors = new Map<ThreadId, Float32Array>();
        for (const row of scope) {
          if (row.vector !== null) vectors.set(row.threadId, toVector(row.vector));
        }
        const firstMessages = new Map<ThreadId, OrchestrationThreadSearchMatch>();
        let queryVector: Float32Array | null = null;

        const publish = (status: OrchestrationArchivedThreadSearchIndex["status"]) =>
          Effect.gen(function* () {
            const keywordRank = new Map(keyword.map((row, rank) => [row.threadId, rank]));
            const semanticRank = new Map<ThreadId, number>();
            if (queryVector !== null) {
              const scored = [...vectors.entries()]
                .map(([threadId, vector]) => ({ threadId, score: dot(queryVector!, vector) }))
                .toSorted((left, right) => right.score - left.score);
              const baseline =
                scored.length >= SEMANTIC_BASELINE_MIN_THREADS
                  ? scored[Math.floor(scored.length / 2)]!.score
                  : SEMANTIC_DEFAULT_BASELINE;
              scored
                .filter(({ score }) => score >= baseline + SEMANTIC_MARGIN)
                .slice(0, SEMANTIC_MAX_HITS)
                .forEach(({ threadId }, rank) => semanticRank.set(threadId, rank));
            }
            const fused = (threadId: ThreadId) =>
              [keywordRank.get(threadId), semanticRank.get(threadId)].reduce<number>(
                (sum, rank) => (rank === undefined ? sum : sum + 1 / (FUSION_K + rank)),
                0,
              );
            const ranked = [...new Set([...keywordRank.keys(), ...semanticRank.keys()])]
              .toSorted((left, right) => fused(right) - fused(left))
              .slice(0, limit);

            // Title and meaning hits have no matching message to quote; they
            // show how the thread started instead.
            const keywordById = new Map(keyword.map((row) => [row.threadId, row]));
            const needsSnippet = ranked.filter(
              (threadId) =>
                keywordById.get(threadId)?.matchText == null && !firstMessages.has(threadId),
            );
            if (needsSnippet.length > 0) {
              const rows = yield* firstUserMessageRows({ threadIds: needsSnippet }).pipe(
                Effect.mapError(queryError),
              );
              for (const row of rows) {
                firstMessages.set(row.threadId, {
                  threadId: row.threadId,
                  projectId: projectOf.get(row.threadId)!,
                  source: "user",
                  snippet: buildSearchSnippet(withoutImages(row.text), input.query),
                  messageCreatedAt: row.createdAt,
                });
              }
            }
            const matches = ranked.flatMap((threadId): OrchestrationThreadSearchMatch[] => {
              const row = keywordById.get(threadId);
              if (row?.matchText != null && row.source !== null) {
                return [
                  {
                    threadId,
                    projectId: row.projectId,
                    source: row.source,
                    snippet: buildSearchSnippet(withoutImages(row.matchText), input.query),
                    messageCreatedAt: row.messageCreatedAt,
                  },
                ];
              }
              const first = firstMessages.get(threadId);
              if (first !== undefined) return [first];
              const projectId = row?.projectId ?? projectOf.get(threadId);
              return projectId === undefined
                ? []
                : [{ threadId, projectId, source: "user", snippet: "", messageCreatedAt: null }];
            });
            yield* Queue.offer(queue, {
              matches,
              index: { status, indexed: vectors.size, total: scope.length },
            });
          });

        const stale = scope.filter((row) => !vectors.has(row.threadId)).map((row) => row.threadId);
        yield* publish("preparing");

        const embedded = yield* embedder.embed("query", [input.query]).pipe(Effect.option);
        if (Option.isNone(embedded)) {
          yield* publish("unavailable");
          return yield* Queue.end(queue);
        }
        queryVector = embedded.value[0]!;

        for (let start = 0; start < stale.length; start += INDEX_BATCH_SIZE) {
          const batch = stale.slice(start, start + INDEX_BATCH_SIZE);
          const stored = yield* indexLock
            .withPermits(1)(indexThreads(batch))
            .pipe(Effect.catchTags({ TextEmbedderError: () => Effect.succeed(null) }));
          if (stored === null) {
            yield* publish("unavailable");
            return yield* Queue.end(queue);
          }
          for (const [threadId, vector] of stored) vectors.set(threadId, vector);
          if (start + INDEX_BATCH_SIZE < stale.length) yield* publish("indexing");
        }
        yield* publish("ready");
        yield* Queue.end(queue);
      }).pipe(Effect.catch((error) => Queue.fail(queue, error))),
    );

  return ThreadSearch.of({ search, searchArchived });
});

export const layer = Layer.effect(ThreadSearch, make);
