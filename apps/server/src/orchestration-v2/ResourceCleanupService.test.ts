import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as WorktreeScopesTestkit from "../workspace/WorktreeScopes.testkit.ts";
import * as ResourceCleanupService from "./ResourceCleanupService.ts";

const makeCleanup = (threads: Readonly<Record<string, WorktreeScopesTestkit.TestThreadCheckout>>) =>
  Effect.gen(function* () {
    const terminalCloses = yield* Ref.make<
      ReadonlyArray<Parameters<TerminalManager.TerminalManager["Service"]["close"]>[0]>
    >([]);
    const previewCloses = yield* Ref.make<
      ReadonlyArray<Parameters<PreviewManager.PreviewManager["Service"]["closeForThread"]>[0]>
    >([]);
    const cleanup = yield* Effect.service(ResourceCleanupService.ResourceCleanupService).pipe(
      Effect.provide(
        ResourceCleanupService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(TerminalManager.TerminalManager)({
                close: (input) => Ref.update(terminalCloses, (calls) => [...calls, input]),
              }),
              Layer.mock(PreviewManager.PreviewManager)({
                closeForThread: (input) => Ref.update(previewCloses, (calls) => [...calls, input]),
              }),
              WorktreeScopesTestkit.layer(threads),
              ServerConfig.layerTest(process.cwd(), { prefix: "resource-cleanup-" }),
              NodeServices.layer,
            ),
          ),
        ),
      ),
    );
    return { cleanup, terminalCloses, previewCloses };
  });

it.layer(NodeServices.layer)("ResourceCleanupService", (it) => {
  it.effect("closes a checkout's terminals and tabs with its last live thread", () =>
    Effect.gen(function* () {
      const { cleanup, terminalCloses, previewCloses } = yield* makeCleanup({
        "thread-1": { scopeKey: "/repo/.worktrees/feature" },
        // Archived and deleted threads no longer hold the checkout.
        "thread-2": { scopeKey: "/repo/.worktrees/feature", live: false },
      });

      yield* cleanup.cleanupTerminals("thread-1");
      yield* cleanup.cleanupPreviews("thread-1");

      assert.deepStrictEqual(yield* Ref.get(terminalCloses), [
        { threadId: "thread-1", deleteHistory: true },
        { threadId: "thread-1", scopeKey: "/repo/.worktrees/feature", deleteHistory: true },
      ]);
      assert.deepStrictEqual(yield* Ref.get(previewCloses), [
        { threadId: "thread-1", scopeKey: "/repo/.worktrees/feature" },
      ]);
    }),
  );

  it.effect("keeps shared terminals and tabs while another thread works in the checkout", () =>
    Effect.gen(function* () {
      const { cleanup, terminalCloses, previewCloses } = yield* makeCleanup({
        "thread-1": { scopeKey: "/repo" },
        // A settled thread can still be reopened, so it keeps the shared shells.
        "thread-2": { scopeKey: "/repo", settled: true },
      });

      yield* cleanup.cleanupTerminals("thread-1");
      yield* cleanup.cleanupPreviews("thread-1");

      // Only what the thread opened before checkouts were shared goes away.
      assert.deepStrictEqual(yield* Ref.get(terminalCloses), [
        { threadId: "thread-1", deleteHistory: true },
      ]);
      assert.deepStrictEqual(yield* Ref.get(previewCloses), [
        { threadId: "thread-1", scopeKey: undefined },
      ]);
    }),
  );

  it.effect("closes only the thread's own surfaces when its checkout is unknown", () =>
    Effect.gen(function* () {
      const { cleanup, terminalCloses, previewCloses } = yield* makeCleanup({});

      yield* cleanup.cleanupTerminals("draft-thread");
      yield* cleanup.cleanupPreviews("draft-thread");

      assert.deepStrictEqual(yield* Ref.get(terminalCloses), [
        { threadId: "draft-thread", deleteHistory: true },
      ]);
      assert.deepStrictEqual(yield* Ref.get(previewCloses), [
        { threadId: "draft-thread", scopeKey: undefined },
      ]);
    }),
  );
});
