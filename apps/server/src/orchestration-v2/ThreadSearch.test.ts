import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as TextEmbedder from "../embeddings/TextEmbedder.ts";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadSearch from "./ThreadSearch.ts";

// Stands in for the model: words about one concept share an axis, so text in
// different words or languages lands together, as e5 places it.
const CONCEPTS = [
  ["signing", "assinatura", "certificate", "notarize"],
  ["terminal", "split"],
];
const embedder = {
  passages: 0,
  failing: false,
};
const fakeEmbedderLayer = Layer.succeed(
  TextEmbedder.TextEmbedder,
  TextEmbedder.TextEmbedder.of({
    embed: (role, texts) =>
      Effect.suspend(() => {
        if (embedder.failing) {
          return Effect.fail(
            new TextEmbedder.TextEmbedderError({ stage: "download", cause: new Error("offline") }),
          );
        }
        if (role === "passage") embedder.passages += texts.length;
        return Effect.succeed(
          texts.map((text) => {
            const lower = text.toLowerCase();
            const axes = CONCEPTS.map((words) => (words.some((w) => lower.includes(w)) ? 1 : 0));
            // Text about none of them is unrelated to everything else.
            const none = axes.includes(1) ? 0 : 1;
            const vector = Float32Array.from([
              ...axes,
              role === "query" ? none : 0,
              role === "passage" ? none : 0,
            ]);
            const norm = Math.hypot(...vector);
            return vector.map((value) => value / norm);
          }),
        );
      }),
  }),
);

const layerTest = Layer.mergeAll(
  ThreadSearch.layer.pipe(Layer.provide(fakeEmbedderLayer)),
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 27, 0, minute));

const createProject = (projectId: ProjectId) =>
  Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
    projects.apply({
      sequence: 0,
      eventId: EventId.make(`created:${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: DateTime.formatIso(at(0)),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: projectId,
        workspaceRoot: `/work/${projectId}`,
        defaultModelSelection: null,
        scripts: [],
        createdAt: DateTime.formatIso(at(0)),
        updatedAt: DateTime.formatIso(at(0)),
      },
    }),
  );

const thread = (
  threadId: ThreadId,
  projectId: ProjectId,
  overrides: {
    readonly archivedAt?: DateTime.Utc;
    readonly deletedAt?: DateTime.Utc;
    readonly title?: string;
  } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId,
  occurredAt: at(0),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: overrides.title ?? threadId,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: overrides.deletedAt ?? null,
  },
});

const message = (
  threadId: ThreadId,
  id: string,
  role: "user" | "assistant" | "system",
  text: string,
  options: { readonly minute?: number; readonly streaming?: boolean } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`message:${id}`),
  type: "message.updated",
  threadId,
  providerInstanceId,
  occurredAt: at(options.minute ?? 1),
  payload: {
    createdBy: role === "user" ? "user" : "agent",
    creationSource: role === "user" ? "web" : "provider",
    id: MessageId.make(id),
    threadId,
    runId: null,
    nodeId: null,
    role,
    text,
    attachments: [],
    streaming: options.streaming ?? false,
    createdAt: at(options.minute ?? 1),
    updatedAt: at(options.minute ?? 1),
  },
});

it.layer(layerTest)("ThreadSearch", (it) => {
  it.effect("returns one finished user or assistant match per active thread", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = ProjectId.make("project:search");
      const deletedProject = ProjectId.make("project:search-deleted");
      yield* createProject(project);
      yield* createProject(deletedProject);
      yield* Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
        projects.apply({
          sequence: 0,
          eventId: EventId.make("deleted:project"),
          aggregateKind: "project",
          aggregateId: deletedProject,
          occurredAt: DateTime.formatIso(at(2)),
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.deleted",
          payload: { projectId: deletedProject, deletedAt: DateTime.formatIso(at(2)) },
        }),
      );

      const both = ThreadId.make("thread:both");
      const assistantOnly = ThreadId.make("thread:assistant");
      const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
        thread(both, project),
        message(both, "both-assistant", "assistant", "needle from the answer", { minute: 3 }),
        message(both, "both-user-old", "user", "older needle question", { minute: 1 }),
        message(both, "both-user-new", "user", "newer needle question", { minute: 2 }),
        thread(assistantOnly, project),
        message(assistantOnly, "assistant-only", "assistant", "needle in an answer"),
        message(assistantOnly, "assistant-streaming", "user", "needle still typing", {
          streaming: true,
        }),
        message(assistantOnly, "assistant-system", "system", "needle system prompt"),
        thread(ThreadId.make("thread:archived"), project, { archivedAt: at(1) }),
        message(ThreadId.make("thread:archived"), "archived", "user", "needle archived"),
        thread(ThreadId.make("thread:deleted"), project, { deletedAt: at(1) }),
        message(ThreadId.make("thread:deleted"), "deleted", "user", "needle deleted"),
        thread(ThreadId.make("thread:orphaned"), deletedProject),
        message(ThreadId.make("thread:orphaned"), "orphaned", "user", "needle orphaned"),
      ];
      yield* Effect.forEach(events, projections.apply, { discard: true });

      const result = yield* search.search({ query: "NEEDLE", limit: 20 });
      assert.deepEqual(
        result.matches.map((match) => [match.threadId, match.source, match.snippet]),
        [
          [both, "user", "newer needle question"],
          [assistantOnly, "assistant", "needle in an answer"],
        ],
      );
      assert.lengthOf((yield* search.search({ query: "needle", limit: 1 })).matches, 1);
      // LIKE wildcards in the query match literally.
      assert.deepEqual((yield* search.search({ query: "ne%le" })).matches, []);
    }),
  );

  it.effect("reports an unreadable match as a decode failure", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const sql = yield* SqlClient.SqlClient;
      const project = ProjectId.make("project:search-corrupt");
      const threadId = ThreadId.make("thread:corrupt");
      yield* createProject(project);
      yield* Effect.forEach(
        [thread(threadId, project), message(threadId, "corrupt", "user", "20260927")],
        projections.apply,
        { discard: true },
      );
      yield* sql`
        UPDATE orchestration_v2_projection_messages
        SET payload_json = json_set(payload_json, '$.text', 20260927)
        WHERE message_id = 'corrupt'
      `;

      const error = yield* Effect.flip(search.search({ query: "0260927" }));
      assert.equal(error.operation, "decode");
    }),
  );

  it.effect("ranks archived threads by keyword and by meaning, indexing them once", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = ProjectId.make("project:archived");
      yield* createProject(project);
      const signing = ThreadId.make("thread:archived-signing");
      const terminal = ThreadId.make("thread:archived-terminal");
      const titled = ThreadId.make("thread:archived-titled");
      const active = ThreadId.make("thread:active-signing");
      yield* Effect.forEach(
        [
          thread(signing, project, { archivedAt: at(5), title: "Release build" }),
          message(signing, "signing-user", "user", "Corrigir a assinatura do app no mac"),
          thread(terminal, project, { archivedAt: at(4), title: "Tab bar" }),
          message(terminal, "terminal-user", "user", "The split terminal button looks wrong"),
          message(terminal, "terminal-answer", "assistant", "Fixed the button color"),
          thread(titled, project, { archivedAt: at(3), title: "Button polish" }),
          message(titled, "titled-user", "user", "Make it rounder"),
          thread(active, project, { title: "Signing" }),
          message(active, "active-user", "user", "notarize the certificate"),
        ],
        projections.apply,
        { discard: true },
      );
      embedder.passages = 0;

      const run = (query: string) =>
        Stream.runCollect(search.searchArchived({ query, projectIds: [project] }));

      const updates = yield* run("notarize certificate");
      const final = updates.at(-1)!;
      // Keyword ranking arrives before the model has seen anything.
      assert.deepEqual(updates[0]!.index, { status: "preparing", indexed: 0, total: 3 });
      assert.deepEqual(final.index, { status: "ready", indexed: 3, total: 3 });
      // Portuguese wording matches by meaning; the active thread stays out.
      assert.deepEqual(
        final.matches.map((match) => [match.threadId, match.snippet]),
        [[signing, "Corrigir a assinatura do app no mac"]],
      );
      assert.equal(embedder.passages, 3);

      // Every word, in any order, within the title or one message.
      const matchesOf = (query: string) =>
        run(query).pipe(
          Effect.map((updates) =>
            updates.at(-1)!.matches.map((match) => [match.threadId, match.snippet]),
          ),
        );
      assert.deepEqual(yield* matchesOf("polish button"), [[titled, "Make it rounder"]]);
      assert.deepEqual(yield* matchesOf("wrong button"), [
        [terminal, "The split terminal button looks wrong"],
      ]);
      assert.deepEqual(yield* matchesOf("rounder polish"), []);
      // Vectors are reused until the thread changes.
      assert.equal(embedder.passages, 3);
      yield* projections.apply(
        message(terminal, "terminal-late", "user", "one more thing", { minute: 9 }),
      );
      yield* run("anything");
      assert.equal(embedder.passages, 4);
    }),
  );

  it.effect("falls back to keyword matches when the model is unavailable", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = ProjectId.make("project:archived-offline");
      const threadId = ThreadId.make("thread:archived-offline");
      yield* createProject(project);
      yield* Effect.forEach(
        [
          thread(threadId, project, { archivedAt: at(1) }),
          message(threadId, "offline-user", "user", "needle in the archive"),
        ],
        projections.apply,
        { discard: true },
      );
      embedder.failing = true;
      const final = (yield* Stream.runCollect(
        search.searchArchived({ query: "needle", projectIds: [project] }),
      )).at(-1)!;
      embedder.failing = false;
      assert.deepEqual(final.index, { status: "unavailable", indexed: 0, total: 1 });
      assert.deepEqual(
        final.matches.map((match) => match.threadId),
        [threadId],
      );
    }),
  );
});
