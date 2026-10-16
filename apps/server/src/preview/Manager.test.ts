import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { type PreviewEvent, ThreadId } from "@t3tools/contracts";
import { PreviewUrlNormalizationError } from "@t3tools/shared/preview";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import { expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as WorktreeScopesTestkit from "../workspace/WorktreeScopes.testkit.ts";
import * as PreviewManager from "./Manager.ts";

const DRAIN_LIMIT = 100;

interface EventCollector {
  /** Drain everything published since the last call (or since subscribe). */
  readonly drain: Effect.Effect<ReadonlyArray<PreviewEvent>>;
}

/**
 * Each `it.effect` shares the live PreviewManager layer across the whole
 * `it.layer` block, so tests that assert per-thread counts must use a unique
 * thread id to avoid bleeding state from earlier tests.
 */
let nextThreadId = 0;
const freshThreadId = () => ThreadId.make(`thread-${++nextThreadId}`);

/**
 * Subscribe to the manager's event stream BEFORE the test publishes. We
 * use `subscribeEvents` (synchronous PubSub.subscribe under the hood) so
 * no event can land between subscribe and the consumer drain.
 */
const collectEvents = Effect.gen(function* () {
  const manager = yield* PreviewManager.PreviewManager;
  const subscription = yield* manager.subscribeEvents;
  const collector: EventCollector = {
    drain: PubSub.takeUpTo(subscription, DRAIN_LIMIT),
  };
  return collector;
}).pipe(Effect.withSpan("preview.test.collectEvents"));

// Threads named here resolve to a checkout; `freshThreadId` threads are
// unknown, so their tabs stay theirs alone as before scopes existed.
const SCOPE_A = "/repo/.t3/worktrees/feature-a";
const SCOPE_B = "/repo/.t3/worktrees/feature-b";
const scopedThread = (name: string) => ThreadId.make(`scoped-${name}`);

const layer = PreviewManager.layer.pipe(
  Layer.provide(
    WorktreeScopesTestkit.layer({
      [scopedThread("a1")]: { scopeKey: SCOPE_A },
      [scopedThread("a2")]: { scopeKey: SCOPE_A },
      [scopedThread("a3")]: { scopeKey: SCOPE_A },
      [scopedThread("a4")]: { scopeKey: SCOPE_A },
      [scopedThread("b1")]: { scopeKey: SCOPE_B },
      [scopedThread("b2")]: { scopeKey: SCOPE_B },
    }),
  ),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-preview-manager-" })),
  Layer.provide(NodeCrypto.layer),
  Layer.provide(NodeServices.layer),
);

it.layer(layer)("PreviewManager", (it) => {
  it.effect("opens a session and emits opened with normalized URL", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;

      const snapshot = yield* manager.open({ threadId, url: "localhost:5173" });
      expect(snapshot.tabId.startsWith("tab_")).toBe(true);
      expect(snapshot.navStatus._tag).toBe("Loading");
      if (snapshot.navStatus._tag === "Loading") {
        expect(snapshot.navStatus.url).toBe("http://localhost:5173/");
      }

      const events = yield* collector.drain;
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("opened");
      if (events[0]?.type === "opened") {
        expect(events[0].tabId).toBe(snapshot.tabId);
      }
    }),
  );

  it.effect("keeps the tab's profile across navigation and status reports", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;

      const opened = yield* manager.open({ threadId, profileId: "work" });
      expect(opened.profileId).toBe("work");

      // `navigate` and `reportStatus` rebuild the snapshot field by field
      // rather than spreading it, so a new field is dropped unless carried
      // explicitly — which would silently move the tab to another profile's
      // partition on its first navigation.
      const navigated = yield* manager.navigate({
        threadId,
        tabId: opened.tabId,
        url: "localhost:5173",
      });
      expect(navigated.profileId).toBe("work");

      yield* manager.reportStatus({
        threadId,
        tabId: opened.tabId,
        navStatus: { _tag: "Success", url: "http://localhost:5173/", title: "Dev" },
        canGoBack: true,
        canGoForward: false,
      });
      const listed = yield* manager.list({ threadId });
      expect(listed.sessions.find((s) => s.tabId === opened.tabId)?.profileId).toBe("work");
    }),
  );

  it.effect("lets any client size, theme, and zoom a server tab", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;
      const opened = yield* manager.open({ threadId, runtime: "server" });
      const viewport = {
        _tag: "preset",
        presetId: "iphone-12-pro",
        width: 390,
        height: 844,
      } as const;
      yield* manager.resize({ threadId, tabId: opened.tabId, viewport });
      const adjusted = yield* manager.adjust({
        threadId,
        tabId: opened.tabId,
        colorScheme: "dark",
        zoomFactor: 1.25,
      });
      expect(adjusted).toMatchObject({ viewport, colorScheme: "dark", zoomFactor: 1.25 });
      // One-off requests go to the server's browser and leave the tab's state alone.
      yield* manager.adjust({ threadId, tabId: opened.tabId, hardReload: true, clear: "cache" });
      const events = (yield* collector.drain).filter((event) => event.type === "resized");
      expect(events.at(-1)).toMatchObject({
        request: { hardReload: true, clear: "cache" },
        snapshot: { colorScheme: "dark", zoomFactor: 1.25 },
      });
      expect(events.at(-2)).not.toHaveProperty("request");
    }),
  );

  it.effect("reissues presentation requests without replaying them on navigation", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;
      const opened = yield* manager.open({ threadId, runtime: "server", reveal: false });
      yield* manager.requestReveal({ threadId, tabId: opened.tabId, force: true });
      const first = (yield* manager.list({ threadId })).sessions[0];
      expect(first?.reveal).toBe(true);
      expect(first?.revealRequest?.force).toBe(true);
      // Server tabs report navigation through their controlling browser.
      const refused = yield* manager
        .navigate({ threadId, tabId: opened.tabId, url: "localhost:5173" })
        .pipe(Effect.flip);
      expect(refused._tag).toBe("PreviewControlRequiredError");
      yield* manager.reportStatus({
        threadId,
        tabId: opened.tabId,
        serverControlled: true,
        navStatus: { _tag: "Success", url: "http://localhost:5173/", title: "Dev" },
        canGoBack: false,
        canGoForward: false,
      });
      expect((yield* manager.list({ threadId })).sessions[0]?.revealRequest).toEqual(
        first?.revealRequest,
      );
      yield* manager.requestReveal({ threadId, tabId: opened.tabId, force: false });
      const second = (yield* manager.list({ threadId })).sessions[0];
      expect(second?.revealRequest?.id).not.toBe(first?.revealRequest?.id);
      expect(second?.revealRequest?.force).toBe(false);
      const events = yield* collector.drain;
      const last = events.at(-1);
      expect(last?.type).toBe("navigated");
      if (last?.type === "navigated")
        expect(last.snapshot.revealRequest).toEqual(second?.revealRequest);
    }),
  );

  it.effect("opens an Idle tab when no URL is supplied", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const snapshot = yield* manager.open({ threadId });
      expect(snapshot.navStatus._tag).toBe("Idle");
    }),
  );

  it.effect("orders list snapshots and events with one monotonic revision", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;
      const before = yield* manager.list({ threadId });

      const opened = yield* manager.open({ threadId, url: "http://localhost:5173" });
      yield* manager.navigate({
        threadId,
        tabId: opened.tabId,
        url: "http://localhost:5173/ready",
      });

      const events = yield* collector.drain;
      const listed = yield* manager.list({ threadId });
      expect(events).toHaveLength(2);
      expect(events[0]!.serverEpoch).toBe(listed.serverEpoch);
      expect(events[1]!.serverEpoch).toBe(listed.serverEpoch);
      expect(events[0]!.revision).toBeGreaterThan(before.revision);
      expect(events[1]!.revision).toBeGreaterThan(events[0]!.revision);
      expect(listed.revision).toBe(events[1]!.revision);
      expect(listed.sessions).toHaveLength(1);
    }),
  );

  it.effect("treats bare hosts as https", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const snapshot = yield* manager.open({ threadId, url: "example.com" });
      if (snapshot.navStatus._tag === "Loading") {
        expect(snapshot.navStatus.url).toBe("https://example.com/");
      }
    }),
  );

  it.effect("rejects empty URL with PreviewInvalidUrlError", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const error = yield* Effect.flip(manager.open({ threadId, url: "   " }));
      expect(error._tag).toBe("PreviewInvalidUrlError");
      expect(error).toMatchObject({ inputLength: 3, reason: "empty" });
      expect(error).not.toHaveProperty("rawUrl");
      expect(error.cause).toBeInstanceOf(PreviewUrlNormalizationError);
      expect((error.cause as PreviewUrlNormalizationError).reason).toBe("empty");
    }),
  );

  it.effect("preserves URL parser failures as the invalid URL cause chain", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const rawUrl = "https://user:password@example.com:bad/path?access_token=secret#fragment";
      const error = yield* Effect.flip(manager.open({ threadId, url: rawUrl }));

      expect(error).toMatchObject({
        inputLength: rawUrl.length,
        reason: "parse",
        protocol: "https:",
      });
      expect(error).not.toHaveProperty("rawUrl");
      expect(error.cause).toBeInstanceOf(PreviewUrlNormalizationError);
      const normalizationError = error.cause as PreviewUrlNormalizationError;
      expect(normalizationError.cause).toBeInstanceOf(Error);
      expect(error.message).not.toContain((normalizationError.cause as Error).message);
      expect(error.message).not.toMatch(/user|password|access_token|secret|fragment/);
    }),
  );

  it.effect("navigate updates snapshot and emits navigated", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;

      const opened = yield* manager.open({ threadId, url: "http://localhost:5173" });
      const snapshot = yield* manager.navigate({
        threadId,
        tabId: opened.tabId,
        url: "http://localhost:5173/about",
        resolvedTitle: "About",
      });

      expect(snapshot.navStatus._tag).toBe("Success");
      if (snapshot.navStatus._tag === "Success") {
        expect(snapshot.navStatus.url).toBe("http://localhost:5173/about");
        expect(snapshot.navStatus.title).toBe("About");
      }
      const events = yield* collector.drain;
      expect(events.map((e) => e.type)).toEqual(["opened", "navigated"]);
    }),
  );

  it.effect("navigate fails for unknown tab", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const error = yield* Effect.flip(
        manager.navigate({
          threadId,
          tabId: "tab_missing",
          url: "http://localhost:5173",
        }),
      );
      expect(error._tag).toBe("PreviewSessionLookupError");
    }),
  );

  it.effect("resizes a tab and preserves its viewport across navigation reports", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;
      const opened = yield* manager.open({ threadId, url: "http://localhost:5173" });

      const resized = yield* manager.resize({
        threadId,
        tabId: opened.tabId,
        viewport: { _tag: "freeform", width: 1024, height: 768 },
      });
      expect(resized.viewport).toEqual({ _tag: "freeform", width: 1024, height: 768 });

      const navigated = yield* manager.navigate({
        threadId,
        tabId: opened.tabId,
        url: "http://localhost:5173/resized",
      });
      expect(navigated.viewport).toEqual(resized.viewport);

      yield* manager.reportStatus({
        threadId,
        tabId: opened.tabId,
        navStatus: { _tag: "Success", url: "http://localhost:5173/resized", title: "Resized" },
        canGoBack: true,
        canGoForward: false,
      });
      const listed = yield* manager.list({ threadId });
      expect(listed.sessions[0]?.viewport).toEqual(resized.viewport);

      const events = yield* collector.drain;
      expect(events.map((event) => event.type)).toEqual([
        "opened",
        "resized",
        "navigated",
        "navigated",
      ]);
    }),
  );

  it.effect("rejects resize for an unknown tab", () =>
    Effect.gen(function* () {
      const manager = yield* PreviewManager.PreviewManager;
      const error = yield* Effect.flip(
        manager.resize({
          threadId: freshThreadId(),
          tabId: "tab_missing",
          viewport: { _tag: "fill" },
        }),
      );
      expect(error._tag).toBe("PreviewSessionLookupError");
    }),
  );

  it.effect(
    "rejects client status reports for server tabs without changing state or emitting events",
    () =>
      Effect.gen(function* () {
        const threadId = freshThreadId();
        const manager = yield* PreviewManager.PreviewManager;
        const opened = yield* manager.open({ threadId, runtime: "server", reveal: false });
        const collector = yield* collectEvents;
        const before = yield* manager.list({ threadId });
        const input = {
          threadId,
          tabId: opened.tabId,
          navStatus: {
            _tag: "Success" as const,
            url: "http://localhost:5173/changed",
            title: "Changed",
          },
          canGoBack: true,
          canGoForward: true,
        };
        const rejected = yield* manager.reportStatus(input).pipe(Effect.flip);
        expect(rejected._tag).toBe("PreviewControlRequiredError");
        expect(yield* manager.list({ threadId })).toEqual(before);
        expect(yield* collector.drain).toEqual([]);

        yield* manager.reportStatus({ ...input, serverControlled: true });
        expect((yield* manager.list({ threadId })).sessions[0]).toMatchObject({
          navStatus: input.navStatus,
          canGoBack: true,
          canGoForward: true,
        });
        const events = yield* collector.drain;
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type: "navigated",
          snapshot: { navStatus: input.navStatus },
        });
      }),
  );

  it.effect("reportStatus emits failed for LoadFailed nav", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;

      const opened = yield* manager.open({ threadId, url: "http://localhost:5173" });
      yield* manager.reportStatus({
        threadId,
        tabId: opened.tabId,
        navStatus: {
          _tag: "LoadFailed",
          url: "http://localhost:5173",
          title: "",
          code: -105,
          description: "ERR_NAME_NOT_RESOLVED",
        },
        canGoBack: false,
        canGoForward: false,
      });

      const events = yield* collector.drain;
      const failed = events.find((e) => e.type === "failed");
      expect(failed?.type).toBe("failed");
      if (failed?.type === "failed") {
        expect(failed.code).toBe(-105);
        expect(failed.description).toBe("ERR_NAME_NOT_RESOLVED");
      }
    }),
  );

  it.effect("close removes the session and emits closed", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;

      yield* manager.open({ threadId, url: "http://localhost:5173" });
      yield* manager.close({ threadId });

      const result = yield* manager.list({ threadId });
      expect(result.sessions).toHaveLength(0);
      const events = yield* collector.drain;
      const closed = events.find((e) => e.type === "closed");
      expect(closed?.type).toBe("closed");
    }),
  );

  it.effect("gives every tab in a batch close its own monotonic revision", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      yield* manager.open({ threadId, url: "http://localhost:5173" });
      yield* manager.open({ threadId, url: "http://localhost:3000" });
      const collector = yield* collectEvents;

      yield* manager.close({ threadId });

      const events = yield* collector.drain;
      const listed = yield* manager.list({ threadId });
      expect(events).toHaveLength(2);
      expect(events.every((event) => event.type === "closed")).toBe(true);
      expect(events[1]!.revision).toBeGreaterThan(events[0]!.revision);
      expect(listed.revision).toBe(events[1]!.revision);
      expect(listed.sessions).toHaveLength(0);
    }),
  );

  it.effect("close is idempotent for unknown threads", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      yield* manager.close({ threadId });
      const result = yield* manager.list({ threadId });
      expect(result.sessions).toHaveLength(0);
    }),
  );

  it.effect("list returns every snapshot for the thread sorted by updatedAt", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const first = yield* manager.open({ threadId, url: "http://localhost:5173" });
      const second = yield* manager.open({ threadId, url: "http://localhost:3000" });
      const result = yield* manager.list({ threadId });
      expect(result.sessions).toHaveLength(2);
      const ids = result.sessions.map((s) => s.tabId);
      expect(ids).toContain(first.tabId);
      expect(ids).toContain(second.tabId);
    }),
  );

  it.effect("open creates an independent tab on every call", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;

      const a = yield* manager.open({ threadId, url: "http://localhost:5173" });
      const b = yield* manager.open({ threadId, url: "http://localhost:3000/path" });

      expect(a.tabId).not.toBe(b.tabId);
      const list = yield* manager.list({ threadId });
      expect(list.sessions).toHaveLength(2);

      const events = yield* collector.drain;
      expect(events.map((e) => e.type)).toEqual(["opened", "opened"]);
    }),
  );

  it.effect("close with mismatching tabId is a no-op", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      yield* manager.open({ threadId, url: "http://localhost:5173" });
      yield* manager.close({ threadId, tabId: "tab_missing" });

      const list = yield* manager.list({ threadId });
      expect(list.sessions).toHaveLength(1);
    }),
  );

  it.effect("close with explicit tabId removes only that tab", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const a = yield* manager.open({ threadId, url: "http://localhost:5173" });
      const b = yield* manager.open({ threadId, url: "http://localhost:3000" });

      yield* manager.close({ threadId, tabId: a.tabId });

      const list = yield* manager.list({ threadId });
      expect(list.sessions.map((s) => s.tabId)).toEqual([b.tabId]);
    }),
  );

  it.effect("multiple subscribers receive every event independently", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const aSub = yield* manager.subscribeEvents;
      const bSub = yield* manager.subscribeEvents;

      yield* manager.open({ threadId, url: "http://localhost:5173" });
      yield* manager.open({ threadId, url: "http://localhost:3000" });

      const aEvents = yield* PubSub.takeUpTo(aSub, DRAIN_LIMIT);
      const bEvents = yield* PubSub.takeUpTo(bSub, DRAIN_LIMIT);
      expect(aEvents.map((e) => e.type)).toEqual(["opened", "opened"]);
      expect(bEvents.map((e) => e.type)).toEqual(["opened", "opened"]);
    }),
  );
  it.effect("shares a worktree's tabs with every thread in it", () =>
    Effect.gen(function* () {
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;
      const opener = scopedThread("a1");
      const sibling = scopedThread("a2");

      const opened = yield* manager.open({ threadId: opener, url: "http://localhost:5173" });
      expect(opened.threadId).toBe(opener);
      expect(opened.scopeKey).toBe(SCOPE_A);

      const listed = yield* manager.list({ threadId: sibling });
      expect(listed.sessions.map((session) => session.tabId)).toContain(opened.tabId);

      const navigated = yield* manager.navigate({
        threadId: sibling,
        tabId: opened.tabId,
        url: "http://localhost:3000",
      });
      // The tab keeps its opener; the sibling only drove it.
      expect(navigated.threadId).toBe(opener);

      yield* manager.close({ threadId: sibling, tabId: opened.tabId });
      const events = yield* collector.drain;
      expect(events.map((event) => [event.type, event.threadId, event.scopeKey])).toEqual([
        ["opened", opener, SCOPE_A],
        ["navigated", opener, SCOPE_A],
        ["closed", opener, SCOPE_A],
      ]);
    }),
  );

  it.effect("hides a worktree's tabs from threads in another checkout", () =>
    Effect.gen(function* () {
      const manager = yield* PreviewManager.PreviewManager;
      const opened = yield* manager.open({ threadId: scopedThread("b1") });
      const outsider = scopedThread("a3");

      const listed = yield* manager.list({ threadId: outsider });
      expect(listed.sessions.map((session) => session.tabId)).not.toContain(opened.tabId);

      const error = yield* manager
        .navigate({ threadId: outsider, tabId: opened.tabId, url: "http://localhost:3000" })
        .pipe(Effect.flip);
      expect(error._tag).toBe("PreviewSessionLookupError");

      // Closing from outside does nothing; the tab is still there for its checkout.
      yield* manager.close({ threadId: outsider, tabId: opened.tabId });
      const owners = yield* manager.list({ threadId: scopedThread("b2") });
      expect(owners.sessions.map((session) => session.tabId)).toContain(opened.tabId);
    }),
  );

  it.effect("keeps an unresolved thread's tabs to itself", () =>
    Effect.gen(function* () {
      const manager = yield* PreviewManager.PreviewManager;
      const draft = freshThreadId();
      const opened = yield* manager.open({ threadId: draft });
      expect(opened.scopeKey).toBeUndefined();

      const other = yield* manager.list({ threadId: freshThreadId() });
      expect(other.sessions.map((session) => session.tabId)).not.toContain(opened.tabId);
      const error = yield* manager
        .resize({ threadId: freshThreadId(), tabId: opened.tabId, viewport: { _tag: "fill" } })
        .pipe(Effect.flip);
      expect(error._tag).toBe("PreviewSessionLookupError");
    }),
  );

  it.effect("places a draft in the worktree its client names", () =>
    Effect.gen(function* () {
      const manager = yield* PreviewManager.PreviewManager;
      const sibling = yield* manager.open({ threadId: scopedThread("a4") });
      const draft = freshThreadId();

      // The trailing separator normalizes away, as the client's key would.
      const listed = yield* manager.list({ threadId: draft, clientScopeKey: `${SCOPE_A}/` });
      expect(listed.sessions.map((session) => session.tabId)).toContain(sibling.tabId);
      // Later requests from the draft carry no hint and still reach the worktree's tabs.
      yield* manager.navigate({
        threadId: draft,
        tabId: sibling.tabId,
        url: "http://localhost:3000",
      });
      const opened = yield* manager.open({ threadId: draft });
      expect(opened.scopeKey).toBe(SCOPE_A);

      // A thread the server knows keeps its own checkout whatever the client says.
      const known = yield* manager.list({ threadId: scopedThread("b2"), clientScopeKey: SCOPE_A });
      expect(known.sessions.map((session) => session.tabId)).not.toContain(sibling.tabId);
    }),
  );

  it.effect("closeForThread closes a checkout's tabs only when asked", () =>
    Effect.gen(function* () {
      const manager = yield* PreviewManager.PreviewManager;
      const deleted = scopedThread("a4");
      const sibling = scopedThread("a2");
      const shared = yield* manager.open({ threadId: deleted });
      const draft = freshThreadId();
      const draftTab = yield* manager.open({ threadId: draft });

      // A sibling still works in the checkout: only the thread's own tabs close.
      yield* manager.closeForThread({ threadId: draft });
      yield* manager.closeForThread({ threadId: deleted });
      const remaining = (yield* manager.list({ threadId: sibling })).sessions.map(
        (session) => session.tabId,
      );
      expect(remaining).toContain(shared.tabId);
      expect((yield* manager.list({ threadId: draft })).sessions).toEqual([]);
      expect(draftTab.scopeKey).toBeUndefined();

      // The last thread leaving the checkout takes its tabs with it.
      yield* manager.closeForThread({ threadId: deleted, scopeKey: SCOPE_A });
      const after = (yield* manager.list({ threadId: sibling })).sessions.map(
        (session) => session.tabId,
      );
      expect(after).not.toContain(shared.tabId);
    }),
  );
});
