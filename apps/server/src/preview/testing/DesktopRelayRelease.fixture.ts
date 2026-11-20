// @effect-diagnostics nodeBuiltinImport:off - Entry point for the superseded-release regression test.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as ServerSettings from "../../serverSettings.ts";

import * as ServerConfig from "../../config.ts";
import * as DesktopBrowserChannel from "../DesktopBrowserChannel.ts";

const key = { threadId: "thread-1", tabId: "tab-1" };

Effect.gen(function* () {
  const base = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-relay-release-" })),
  );
  const context = yield* Layer.build(
    DesktopBrowserChannel.layer.pipe(
      Layer.provide(ServerSettings.layerTest()),
      Layer.provide(
        Layer.succeed(ServerConfig.ServerConfig, {
          ...base,
          desktopBrowserFd: 3,
          desktopBrowserControlFd: 4,
        }),
      ),
    ),
  );
  const browser = Context.get(context, DesktopBrowserChannel.DesktopBrowserChannel);
  yield* Console.log("ready");
  if (!(yield* browser.awaitAttached(key, "5 seconds"))) {
    return yield* Effect.die("The browser attach message was not received.");
  }
  // A connection to the tab, then a newer one, then the older one ends late.
  const older = yield* Scope.make();
  yield* browser.endpoint(key).pipe(Scope.provide(older));
  const newer = yield* Scope.make();
  yield* browser.endpoint(key).pipe(Scope.provide(newer));
  yield* Scope.close(older, Exit.void);
  yield* Scope.close(newer, Exit.void);
  yield* Console.log("done");
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
