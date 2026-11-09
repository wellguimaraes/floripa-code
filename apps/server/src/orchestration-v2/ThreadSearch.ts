import {
  IsoDateTime,
  MessageId,
  type OrchestrationArchivedThreadSearchIndex,
  type OrchestrationSearchArchivedThreadsInput,
  type OrchestrationSearchArchivedThreadsResult,
  OrchestrationThreadSearchSource,
  type OrchestrationSearchThreadsInput,
  type OrchestrationSearchThreadsResult,
  type OrchestrationThreadSearchMatch,
  OrchestrationV2ThreadOpens,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  foldSearchQuery,
  messageMatcher,
  messageSearchTokens,
  rankMessageMatches,
} from "@t3tools/shared/paletteSearch";

import * as TextEmbedder from "../embeddings/TextEmbedder.ts";
import { indexedMessageCondition } from "./messageSearchIndex.ts";

// When the user last wrote in the thread aliased `threads`, as the clients
// rank recency; agent notices in the user role do not count.
const latestUserMessageAt = (sql: SqlClient.SqlClient) => sql`(
  SELECT messages.updated_at
  FROM orchestration_v2_projection_messages AS messages
  WHERE messages.thread_id = threads.thread_id
    AND messages.role = 'user'
    AND COALESCE(json_extract(messages.payload_json, '$.createdBy'), 'user') = 'user'
  ORDER BY messages.updated_at DESC, messages.message_id DESC
  LIMIT 1
)`;

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

function escapeLikePattern(value: string): string {
  return value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");
}

function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/** At most 240 characters, centred near the first match; archived search quotes with it. */
function buildQuerySnippet(text: string, query: string): string {
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

// Token lists bind as JSON arrays, so any number of them is one parameter.
const TokenList = Schema.fromJsonString(Schema.Array(Schema.String));
const MessageSearchRequest = Schema.Struct({
  /** The FTS5 query, or null to scan messages instead. */
  match: Schema.NullOr(Schema.String),
  /** Tokens every hit must contain, checked on the text. */
  substrings: TokenList,
  /** For each short word outside ASCII, the spellings a hit must contain one of. */
  shortSpellings: Schema.fromJsonString(Schema.Array(Schema.Array(Schema.String))),
  projectId: Schema.NullOr(ProjectId),
  /** Threads the caller already lists, left out before the hit limit. */
  excludedThreadIds: TokenList,
});
const MessageSearchRow = Schema.Struct({
  messageRowid: Schema.Number,
  messageId: MessageId,
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  text: Schema.String,
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});

const ThreadOpensRow = Schema.Struct({
  threadId: ThreadId,
  opens: Schema.NullOr(Schema.String),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
});
const decodeThreadOpens = Schema.decodeUnknownOption(
  Schema.fromJsonString(OrchestrationV2ThreadOpens),
);

const SNIPPET_LENGTH = 240;
// The newest hits read per query. A common word stops here instead of reading
// every message, so time stays flat as history grows.
const MESSAGE_HIT_LIMIT = 2000;
// How many of the newest index hits the filters may pass over to fill that
// limit: a rare short word or hidden threads would otherwise read every hit.
const MESSAGE_CANDIDATE_LIMIT = 10_000;
// Without the index, how many of the newest messages a search scans.
const MESSAGE_SCAN_LIMIT = 20_000;
const NON_ASCII = /[\u0080-\uffff]/;

/** SQLite's lower() folds ASCII only, so a short word is checked as each spelling it can match. */
function shortTokenSpellings(token: string): ReadonlyArray<string> {
  const forms = (char: string) => {
    const plain = char.normalize("NFD").replace(/\p{M}/gu, "");
    return [char, char.toUpperCase(), plain, plain.toUpperCase()];
  };
  const spellings = Array.from(token).reduce<ReadonlyArray<string>>(
    (prefixes, char) => prefixes.flatMap((prefix) => forms(char).map((form) => prefix + form)),
    [""],
  );
  return [...new Set(spellings)];
}

/**
 * The SQL inputs for a message search, or null when the query has no token
 * long enough to search. Tokens of three or more characters go to the
 * trigram index as quoted phrases; shorter ones, and every token when the
 * index cannot serve the query, are checked as substrings of the hits.
 */
function buildMessageSearch(
  query: string,
  hasIndex: boolean,
): Omit<typeof MessageSearchRequest.Type, "projectId" | "excludedThreadIds"> | null {
  const { long, short } = messageSearchTokens(query);
  if (long.length === 0) return null;
  // Two-character CJK words are too short for trigrams.
  const indexed = hasIndex && long.every((token) => Array.from(token).length >= 3);
  const narrowing = short.filter((token) => !NON_ASCII.test(token));
  return {
    match: indexed ? long.map((token) => `"${token.replaceAll('"', '""')}"`).join(" ") : null,
    substrings: indexed ? narrowing : [...long, ...narrowing],
    shortSpellings: short.filter((token) => NON_ASCII.test(token)).map(shortTokenSpellings),
  };
}

// A thread shows a link as its text, so in-thread find cannot reach a match
// in the address; messages are matched as they read.
const MARKDOWN_LINK = /!?\[([^\]\n]*)\]\([^)\s]*\)/g;

// Result rows show one line, so the match must sit near the start to be seen.
const SNIPPET_LEAD = 24;

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Up to 240 characters starting a few words before the match at `matchStart`,
 * whitespace collapsed, with ellipses where the text was cut. The client finds
 * the highlights again in the result.
 */
export function buildSearchSnippet(text: string, matchStart: number): string {
  let start = Math.max(0, matchStart - SNIPPET_LEAD);
  const wordStart = text.slice(start, matchStart).search(/\s/);
  if (start > 0 && wordStart !== -1) start += wordStart + 1;
  // Cut between characters, not inside an emoji's surrogate pair.
  if (isLowSurrogate(text.charCodeAt(start))) start++;
  // Collapsing whitespace shortens the text, so read more of it.
  const rawEnd = Math.min(text.length, start + SNIPPET_LENGTH * 2);
  // Emphasis and code marks do not show in a thread either.
  const shown = text
    .slice(start, rawEnd)
    .replace(/\*\*|`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let end = Math.min(shown.length, SNIPPET_LENGTH - 2);
  if (isLowSurrogate(shown.charCodeAt(end))) end--;
  const cut = end < shown.length || rawEnd < text.length;
  return `${start > 0 ? "…" : ""}${shown.slice(0, end)}${cut ? "…" : ""}`;
}

// Filter hidden subagents and side chats before the hit limit so visible matches aren't lost.
// Word starts and ranking follow the title rules in JS.
// Without FTS5 trigrams, or for two-character CJK words, scan the same eligible messages.
// The scan folds ASCII case only, so accent variants and non-ASCII case variants may not match.
export const messageHitsQuery = (
  sql: SqlClient.SqlClient,
  {
    match,
    substrings,
    shortSpellings,
    projectId,
    excludedThreadIds,
  }: typeof MessageSearchRequest.Encoded,
) => sql`
    WITH eligible AS MATERIALIZED (
      SELECT threads.thread_id, threads.project_id
      FROM orchestration_v2_projection_threads AS threads
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE threads.deleted_at IS NULL
        AND threads.archived_at IS NULL
        AND projects.deleted_at IS NULL
        AND (${projectId} IS NULL OR threads.project_id = ${projectId})
        AND threads.thread_id NOT IN (SELECT value FROM json_each(${excludedThreadIds}))
        AND json_extract(threads.payload_json, '$.lineage.relationshipToParent')
          IS NOT 'subagent'
    )
    ${
      match === null
        ? sql`
          SELECT
            messages.rowid AS "messageRowid",
            messages.message_id AS "messageId",
            messages.thread_id AS "threadId",
            eligible.project_id AS "projectId",
            messages.role AS source,
            json_extract(messages.payload_json, '$.text') AS text,
            messages.created_at AS "messageCreatedAt"
          FROM orchestration_v2_projection_messages AS messages
          INNER JOIN eligible ON eligible.thread_id = messages.thread_id
          WHERE ${indexedMessageCondition(sql)}
            -- A scan reads every message it passes, so it stops at the newest ones.
            AND messages.rowid > (
              SELECT coalesce(max(rowid), 0) FROM orchestration_v2_projection_messages
            ) - ${MESSAGE_SCAN_LIMIT}
        `
        : sql`
          SELECT
            orchestration_v2_message_search.rowid AS "messageRowid",
            messages.message_id AS "messageId",
            messages.thread_id AS "threadId",
            eligible.project_id AS "projectId",
            messages.role AS source,
            json_extract(messages.payload_json, '$.text') AS text,
            messages.created_at AS "messageCreatedAt"
          FROM orchestration_v2_message_search
          INNER JOIN orchestration_v2_projection_messages AS messages
            ON messages.rowid = orchestration_v2_message_search.rowid
          INNER JOIN eligible ON eligible.thread_id = messages.thread_id
          WHERE orchestration_v2_message_search MATCH ${match}
            AND orchestration_v2_message_search.rowid >= coalesce((
              SELECT orchestration_v2_message_search.rowid FROM orchestration_v2_message_search
              WHERE orchestration_v2_message_search MATCH ${match}
              ORDER BY orchestration_v2_message_search.rowid DESC
              LIMIT 1 OFFSET ${MESSAGE_CANDIDATE_LIMIT - 1}
            ), 0)
           
        `
    }
      -- Answers to an agent's question show inside its question card, where
      -- neither find nor a jump can reach them.
      AND messages.message_id NOT LIKE 'async-answer:%'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(${substrings}) AS token
        WHERE instr(lower(json_extract(messages.payload_json, '$.text')), token.value) = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM json_each(${shortSpellings}) AS token
        WHERE NOT EXISTS (
          SELECT 1 FROM json_each(token.value) AS spelling
          WHERE instr(json_extract(messages.payload_json, '$.text'), spelling.value) > 0
        )
      )
    -- The index's own rowid, so FTS5 returns hits newest first and stops at
    -- the limit; ordering by the messages table's rowid sorts every hit.
    ORDER BY "messageRowid" DESC
    LIMIT ${MESSAGE_HIT_LIMIT}
  `;

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

  const searchRows = SqlSchema.findAll({
    Request: MessageSearchRequest,
    Result: MessageSearchRow,
    execute: (request) => messageHitsQuery(sql, request),
  });

  const threadOpens = SqlSchema.findAll({
    Request: Schema.Struct({ threadIds: TokenList }),
    Result: ThreadOpensRow,
    execute: ({ threadIds }) => sql`
      SELECT
        threads.thread_id AS "threadId",
        json_extract(threads.payload_json, '$.opens') AS opens,
        ${latestUserMessageAt(sql)} AS "latestUserMessageAt"
      FROM orchestration_v2_projection_threads AS threads
      WHERE threads.thread_id IN (SELECT value FROM json_each(${threadIds}))
    `,
  });

  const read = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new ThreadSearchError({
            operation: Schema.isSchemaError(cause) ? "decode" : "query",
            cause,
          }),
      ),
    );

  // A project scope applies before ranking, so other projects' stronger hits
  // cannot use up the limit.
  const searchMessages = Effect.fn("ThreadSearch.searchMessages")(function* (
    input: OrchestrationSearchThreadsInput & {
      readonly projectId: ProjectId | null;
    },
  ) {
    // One message per thread: the best word match, then what the user wrote,
    // since that is what they remember asking, then the newest by when it was
    // written. Row order is not age: imported histories arrive in one batch.
    // Text relevance (bm25) would cost a pass over every hit in history.
    type Hit = {
      readonly row: typeof MessageSearchRow.Type;
      /** The message as it reads, links as their text. */
      readonly text: string;
      readonly quality: number;
      readonly offset: number;
    };
    const newer = (left: Hit, right: Hit) =>
      (right.row.messageCreatedAt ?? "").localeCompare(left.row.messageCreatedAt ?? "");
    const compareHits = (left: Hit, right: Hit) =>
      right.quality - left.quality ||
      Number(left.row.source !== "user") - Number(right.row.source !== "user") ||
      newer(left, right);
    const rows = yield* read(
      Effect.gen(function* () {
        const index = yield* sql`
          SELECT 1 FROM sqlite_master WHERE name = 'orchestration_v2_message_search'
        `;
        const messageSearch = buildMessageSearch(input.query, index.length > 0);
        return messageSearch === null
          ? []
          : yield* searchRows({
              ...messageSearch,
              projectId: input.projectId,
              excludedThreadIds: [],
            });
      }),
    );
    const best = new Map<ThreadId, Hit>();
    // Matching messages per thread at its best quality: a thread that keeps
    // using the word ranks above a passing mention, and weaker hits ("Trust"
    // for "rust") never add to a whole word's count.
    const hitCounts = new Map<ThreadId, number>();
    const hitCount = (threadId: ThreadId) => hitCounts.get(threadId) ?? 1;
    const matchMessage = messageMatcher(input.query);
    for (const row of rows) {
      const text = row.text.replace(MARKDOWN_LINK, "$1");
      const match = matchMessage(text);
      if (match === null) continue;
      const hit = { row, text, ...match };
      const current = best.get(row.threadId);
      if (current === undefined || hit.quality > current.quality) {
        hitCounts.set(row.threadId, 1);
      } else if (hit.quality === current.quality) {
        hitCounts.set(row.threadId, hitCount(row.threadId) + 1);
      }
      if (current === undefined || compareHits(hit, current) < 0) best.set(row.threadId, hit);
    }
    // Ranked as clients rank them, with picks and use, before the limit cuts:
    // a thread picked for this query must come back even when it only
    // matches in a few old messages.
    const opens = best.size === 0 ? [] : yield* read(threadOpens({ threadIds: [...best.keys()] }));
    const subjectById = new Map(
      opens.map((row) => [
        row.threadId,
        {
          title: "",
          activityAt: row.latestUserMessageAt === null ? null : Date.parse(row.latestUserMessageAt),
          opens: Option.getOrNull(decodeThreadOpens(row.opens)),
        },
      ]),
    );
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const ranked = rankMessageMatches(
      [...best.values()].map((hit) => ({
        ...hit,
        hits: hitCount(hit.row.threadId),
        messageCreatedAt: hit.row.messageCreatedAt,
      })),
      (hit) => subjectById.get(hit.row.threadId),
      foldSearchQuery(input.query),
      now,
      { picks: true },
    );
    return {
      matches: ranked.slice(0, input.limit ?? 50).map(({ row, text, quality, offset }) => ({
        hits: hitCount(row.threadId),
        threadId: row.threadId,
        messageId: row.messageId,
        projectId: row.projectId,
        source: row.source,
        snippet: buildSearchSnippet(text, offset),
        messageCreatedAt: row.messageCreatedAt,
        quality,
      })),
    };
  });

  const search: ThreadSearch["Service"]["search"] = (input) =>
    searchMessages({ ...input, projectId: null });

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
                  snippet: buildQuerySnippet(withoutImages(row.text), input.query),
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
                    snippet: buildQuerySnippet(withoutImages(row.matchText), input.query),
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
