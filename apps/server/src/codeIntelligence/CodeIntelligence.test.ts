// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as CodeIntelligence from "./CodeIntelligence.ts";
import * as LspConnection from "./LspConnection.ts";

type Message = Record<string, unknown> & { readonly method?: string; readonly params?: any };

interface FakeServer {
  readonly command: string;
  readonly cwd: string | undefined;
  readonly received: Array<Message>;
  readonly killed: Deferred.Deferred<void>;
  /** Ends the server's output, as a crash would. */
  readonly crash: Effect.Effect<void>;
}

/**
 * A spawner whose processes are in-memory language servers. `answer` returns
 * the result for each request the client sends.
 */
const makeFakeServers = (answer: (method: string, params: any) => unknown) =>
  Effect.sync(() => {
    const servers: Array<FakeServer> = [];
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
        const killed = yield* Deferred.make<void>();
        const server: FakeServer = {
          command: ChildProcess.isStandardCommand(command) ? command.command : "",
          cwd: ChildProcess.isStandardCommand(command) ? command.options.cwd : undefined,
          received: [],
          killed,
          crash: Queue.end(stdout).pipe(Effect.asVoid),
        };
        servers.push(server);
        const kill = Queue.end(stdout).pipe(Effect.andThen(Deferred.succeed(killed, undefined)));
        yield* Effect.addFinalizer(() => kill);
        const decode = LspConnection.makeLspFrameDecoder();
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(4000 + servers.length),
          exitCode: Effect.never,
          isRunning: Effect.succeed(true),
          kill: () => kill.pipe(Effect.asVoid),
          unref: Effect.succeed(Effect.void),
          stdin: Sink.forEach((chunk: Uint8Array) =>
            decode(chunk).pipe(
              Effect.orDie,
              Effect.flatMap((messages) =>
                Effect.forEach(messages as ReadonlyArray<Message>, (message) => {
                  server.received.push(message);
                  if (message.id === undefined || message.method === undefined) return Effect.void;
                  return Queue.offer(
                    stdout,
                    LspConnection.encodeLspMessage({
                      jsonrpc: "2.0",
                      id: message.id,
                      result: answer(message.method, message.params) ?? null,
                    }),
                  );
                }),
              ),
            ),
          ),
          stdout: Stream.fromQueue(stdout),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        });
      }),
    );
    return { servers, spawner };
  });

/** A built service on the fake spawner, with a home and PATH that hold no gopls. */
const makeService = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  host: { readonly home: string; readonly env?: NodeJS.ProcessEnv },
) =>
  Layer.build(
    CodeIntelligence.layer.pipe(
      Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(Layer.succeed(HostProcess.HomeDirectory, host.home)),
      Layer.provide(Layer.succeed(HostProcess.Environment, host.env ?? { PATH: host.home })),
    ),
  ).pipe(Effect.map((context) => Context.get(context, CodeIntelligence.CodeIntelligence)));

/** A workspace with a TypeScript project: `src/b.ts` imports `greet` from `src/a.ts`. */
const makeWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-code-intel-" });
  yield* fileSystem.makeDirectory(path.join(root, "src"));
  yield* fileSystem.writeFileString(path.join(root, "package.json"), "{}");
  yield* fileSystem.writeFileString(
    path.join(root, "src", "a.ts"),
    "export function greet(name: string) {\n  return name;\n}\n",
  );
  yield* fileSystem.writeFileString(
    path.join(root, "src", "b.ts"),
    'import { greet } from "./a";\nexport const x = greet("bob");\n',
  );
  return { root, file: (relative: string) => path.join(root, relative) };
});

const uri = (filePath: string) => NodeURL.pathToFileURL(filePath).href;
const methods = (server: FakeServer | undefined) =>
  (server?.received ?? []).map((message) => message.method);

it.layer(NodeServices.layer)("CodeIntelligence", (it) => {
  it.effect("starts one server per root on first use and answers in workspace paths", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const { servers, spawner } = yield* makeFakeServers((method) => {
        if (method === "textDocument/definition") {
          return [
            {
              targetUri: uri(workspace.file("src/a.ts")),
              targetRange: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
              targetSelectionRange: {
                start: { line: 0, character: 16 },
                end: { line: 0, character: 21 },
              },
            },
            {
              uri: "file:///opt/typings/greet.d.ts",
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 7 } },
            },
            {
              uri: uri(workspace.file("node_modules/greet/index.d.ts")),
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            },
          ];
        }
        if (method === "textDocument/hover") {
          return { contents: { kind: "markdown", value: "```ts\nfunction greet(): string\n```" } };
        }
        return method === "initialize" ? { capabilities: {} } : null;
      });
      const service = yield* makeService(spawner, { home: workspace.root });
      assert.strictEqual(servers.length, 0, "nothing starts before the first request");

      const position = { cwd: workspace.root, relativePath: "src/b.ts", line: 2, character: 18 };
      const definition = yield* service.definition(position);
      const hover = yield* service.hover(position);

      assert.deepStrictEqual(definition, {
        status: "ok",
        language: "typescript",
        locations: [
          { path: "src/a.ts", line: 1, character: 16, endLine: 1, endCharacter: 21 },
          { path: "/opt/typings/greet.d.ts", line: 5, character: 2, endLine: 5, endCharacter: 7 },
          // Dependencies inside the workspace open read-only, like files outside it.
          {
            path: workspace.file("node_modules/greet/index.d.ts"),
            line: 1,
            character: 0,
            endLine: 1,
            endCharacter: 5,
          },
        ],
      });
      assert.deepStrictEqual(hover, {
        status: "ok",
        language: "typescript",
        contents: { kind: "markdown", value: "```ts\nfunction greet(): string\n```" },
      });
      assert.strictEqual(servers.length, 1);
      assert.strictEqual(servers[0]!.cwd, workspace.root);
      assert.deepStrictEqual(methods(servers[0]), [
        "initialize",
        "initialized",
        "textDocument/didOpen",
        "textDocument/definition",
        "textDocument/hover",
      ]);
      const definitionRequest = servers[0]!.received[3]!;
      assert.deepStrictEqual(definitionRequest.params, {
        textDocument: { uri: uri(workspace.file("src/b.ts")) },
        position: { line: 1, character: 18 },
      });
    }),
  );

  it.effect("sends files changed on disk since the last request", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* makeWorkspace;
      const { servers, spawner } = yield* makeFakeServers((method) =>
        method === "textDocument/definition"
          ? [
              {
                uri: uri(workspace.file("src/a.ts")),
                range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } },
              },
            ]
          : null,
      );
      const service = yield* makeService(spawner, { home: workspace.root });
      const position = { cwd: workspace.root, relativePath: "src/b.ts", line: 2, character: 18 };
      yield* service.definition(position);

      // An agent edits both the open file and the definition target.
      yield* fileSystem.writeFileString(
        workspace.file("src/a.ts"),
        "\n\nexport function greet(name: string) {\n  return name;\n}\n",
      );
      yield* fileSystem.writeFileString(
        workspace.file("src/b.ts"),
        'import { greet } from "./a";\n\nexport const x = greet("bob");\n',
      );
      yield* service.hover({ ...position, line: 3 });

      const received = servers[0]!.received;
      const watched = received.find(
        (message) => message.method === "workspace/didChangeWatchedFiles",
      );
      assert.deepStrictEqual(watched?.params, {
        changes: [{ uri: uri(workspace.file("src/a.ts")), type: 2 }],
      });
      const change = received.find((message) => message.method === "textDocument/didChange");
      assert.deepStrictEqual(change?.params, {
        textDocument: { uri: uri(workspace.file("src/b.ts")), version: 2 },
        contentChanges: [
          { text: 'import { greet } from "./a";\n\nexport const x = greet("bob");\n' },
        ],
      });
    }),
  );

  it.effect("shuts an idle server down", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const { servers, spawner } = yield* makeFakeServers(() => null);
      const service = yield* makeService(spawner, { home: workspace.root });
      yield* service.hover({
        cwd: workspace.root,
        relativePath: "src/a.ts",
        line: 1,
        character: 17,
      });

      yield* TestClock.adjust("10 minutes");
      yield* Deferred.await(servers[0]!.killed);

      assert.deepStrictEqual(methods(servers[0]).slice(-2), ["shutdown", "exit"]);
    }),
  );

  it.effect("stops the servers of a released root", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const { servers, spawner } = yield* makeFakeServers(() => null);
      const service = yield* makeService(spawner, { home: workspace.root });
      yield* service.hover({
        cwd: workspace.root,
        relativePath: "src/a.ts",
        line: 1,
        character: 17,
      });

      yield* service.releaseRoot(workspace.root);
      yield* Deferred.await(servers[0]!.killed);

      assert.deepStrictEqual(methods(servers[0]).slice(-2), ["shutdown", "exit"]);
    }),
  );

  it.effect("starts a fresh server after one dies", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const { servers, spawner } = yield* makeFakeServers((method) =>
        method === "textDocument/hover" ? { contents: "plain answer" } : null,
      );
      const service = yield* makeService(spawner, { home: workspace.root });
      const position = { cwd: workspace.root, relativePath: "src/a.ts", line: 1, character: 17 };
      yield* service.hover(position);

      yield* servers[0]!.crash;
      const hover = yield* service.hover(position);

      assert.strictEqual(servers.length, 2);
      assert.deepStrictEqual(hover, {
        status: "ok",
        language: "typescript",
        contents: { kind: "markdown", value: "plain answer" },
      });
    }),
  );

  it.effect("tries again after a server fails to start", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const { servers, spawner } = yield* makeFakeServers(() => null);
      let attempts = 0;
      const flaky = ChildProcessSpawner.make((command) =>
        attempts++ === 0
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "ChildProcess",
                method: "spawn",
              }),
            )
          : spawner.spawn(command),
      );
      const service = yield* makeService(flaky, { home: workspace.root });
      const position = { cwd: workspace.root, relativePath: "src/a.ts", line: 1, character: 17 };

      const error = yield* service.hover(position).pipe(Effect.flip);
      assert.strictEqual(error.failure, "server-start-failed");
      const hover = yield* service.hover(position);

      assert.strictEqual(hover.status, "ok");
      assert.strictEqual(servers.length, 1);
    }),
  );

  it.effect("reports files it has no server for, and a missing gopls with a hint", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* makeWorkspace;
      yield* fileSystem.writeFileString(workspace.file("go.mod"), "module example.com/app\n");
      yield* fileSystem.writeFileString(workspace.file("main.go"), "package main\n");
      const { servers, spawner } = yield* makeFakeServers(() => null);
      const service = yield* makeService(spawner, { home: workspace.root });

      const markdown = yield* service.hover({
        cwd: workspace.root,
        relativePath: "README.md",
        line: 1,
        character: 0,
      });
      assert.deepStrictEqual(markdown, { status: "unavailable", reason: "unsupported-file" });

      const go = { cwd: workspace.root, relativePath: "main.go", line: 1, character: 0 };
      assert.deepStrictEqual(yield* service.definition(go), {
        status: "unavailable",
        reason: "server-not-installed",
        language: "go",
        installHint: "go install golang.org/x/tools/gopls@latest",
      });
      assert.strictEqual(servers.length, 0);

      // Installed later, where `go install` puts it: found without a restart.
      const gopls = path.join(workspace.root, "go", "bin", "gopls");
      yield* fileSystem.makeDirectory(path.dirname(gopls), { recursive: true });
      yield* fileSystem.writeFileString(gopls, "");
      assert.deepStrictEqual(yield* service.definition(go), {
        status: "ok",
        language: "go",
        locations: [],
      });
      assert.strictEqual(servers[0]!.command, gopls);
    }),
  );

  it.effect("rejects a relative path that leaves the workspace", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const { spawner } = yield* makeFakeServers(() => null);
      const service = yield* makeService(spawner, { home: workspace.root });
      const error = yield* service
        .hover({ cwd: workspace.root, relativePath: "../outside.ts", line: 1, character: 0 })
        .pipe(Effect.flip);
      assert.strictEqual(error.failure, "path-outside-root");
    }),
  );
});

it.effect("reads hover contents in every LSP shape", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(
      CodeIntelligence.hoverContents({ contents: { kind: "plaintext", value: " text " } }),
      { kind: "plaintext", value: "text" },
    );
    assert.deepStrictEqual(
      CodeIntelligence.hoverContents({
        contents: ["Docs", { language: "go", value: "func Greet() string" }],
      }),
      { kind: "markdown", value: "Docs\n\n```go\nfunc Greet() string\n```" },
    );
    assert.strictEqual(CodeIntelligence.hoverContents({ contents: [] }), null);
    assert.strictEqual(CodeIntelligence.hoverContents(null), null);
  }),
);
