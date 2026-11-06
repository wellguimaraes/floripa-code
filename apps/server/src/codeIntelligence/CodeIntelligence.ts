// @effect-diagnostics nodeBuiltinImport:off
/**
 * CodeIntelligence - go-to-definition and hover for saved files, answered by
 * language servers over LSP.
 *
 * One server runs per (language, root) and starts on the first request for
 * it. A server stops after sitting idle, when `releaseRoot` covers its root,
 * when it exits on its own (the next request starts a fresh one), and when
 * this service's scope closes with the app server. Processes are stopped
 * through their spawn handle, never by name.
 *
 * Servers read files from disk. Before each request the requested file is
 * synced from disk, and every file the server was shown or pointed us at is
 * re-checked so an agent's edits reach it. Unsaved editor buffers never do.
 *
 * @module CodeIntelligence
 */
import * as NodeURL from "node:url";

import {
  CodeIntelligenceError,
  CodeIntelligenceLanguage,
  type CodeIntelligenceDefinitionResult,
  type CodeIntelligenceHoverContents,
  type CodeIntelligenceHoverResult,
  type CodeIntelligenceLocation,
  type CodeIntelligencePositionInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as RcMap from "effect/RcMap";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as LanguageServers from "./LanguageServers.ts";
import * as LspConnection from "./LspConnection.ts";

/** Big repositories keep a server busy for minutes; a stopped one costs a cold start. */
const IDLE_TIME_TO_LIVE = Duration.minutes(10);
const INITIALIZE_TIMEOUT = Duration.seconds(30);
/** The first request loads the whole project, which takes a while in a big repository. */
const REQUEST_TIMEOUT = Duration.seconds(60);
const SHUTDOWN_TIMEOUT = Duration.seconds(2);
/** Files kept open in a server; older ones close and fall back to its disk view. */
const MAX_OPEN_DOCUMENTS = 16;
/** Files re-checked for changes before each request. */
const MAX_TRACKED_FILES = 256;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_DEFINITION_LOCATIONS = 50;
const MAX_HOVER_CHARACTERS = 32 * 1024;

interface FileStamp {
  readonly mtimeMs: number;
  readonly size: number;
}

interface OpenDocument extends FileStamp {
  readonly version: number;
}

interface Session {
  readonly language: CodeIntelligenceLanguage;
  readonly root: string;
  readonly connection: LspConnection.LspConnection;
  readonly syncLock: Semaphore.Semaphore;
  /** Insertion order is recency: the first entry is the least recently used. */
  readonly openDocuments: Map<string, OpenDocument>;
  readonly trackedFiles: Map<string, FileStamp>;
  exited: boolean;
}

/** RcMap keys compare by value, so a session's identity travels as a JSON string. */
const SessionKey = Schema.Struct({
  language: CodeIntelligenceLanguage,
  root: Schema.String,
  launch: Schema.Struct({ command: Schema.String, args: Schema.Array(Schema.String) }),
});
type SessionKey = typeof SessionKey.Type;
const SessionKeyJson = Schema.fromJsonString(SessionKey);
const encodeKey = Schema.encodeSync(SessionKeyJson);
const decodeKey = Schema.decodeSync(SessionKeyJson);

export class CodeIntelligence extends Context.Service<
  CodeIntelligence,
  {
    /** Where the symbol at a position is defined; several places for overloads and merges. */
    readonly definition: (
      input: CodeIntelligencePositionInput,
    ) => Effect.Effect<CodeIntelligenceDefinitionResult, CodeIntelligenceError>;
    /** The type and documentation of the symbol at a position. */
    readonly hover: (
      input: CodeIntelligencePositionInput,
    ) => Effect.Effect<CodeIntelligenceHoverResult, CodeIntelligenceError>;
    /** Stops every language server rooted at or below `root`, such as a removed checkout. */
    readonly releaseRoot: (root: string) => Effect.Effect<void>;
  }
>()("t3/codeIntelligence/CodeIntelligence") {}

/** Moves a key to the most recent end of a Map and evicts past the cap. */
function touch<V>(map: Map<string, V>, key: string, value: V, cap: number): ReadonlyArray<string> {
  map.delete(key);
  map.set(key, value);
  const evicted: string[] = [];
  for (const oldest of map.keys()) {
    if (map.size <= cap) break;
    map.delete(oldest);
    evicted.push(oldest);
  }
  return evicted;
}

type LspRange = {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRange = (value: unknown): value is LspRange =>
  isRecord(value) &&
  isRecord(value.start) &&
  isRecord(value.end) &&
  typeof value.start.line === "number" &&
  typeof value.start.character === "number" &&
  typeof value.end.line === "number" &&
  typeof value.end.character === "number";

/** `Location`, `Location[]` and `LocationLink[]` as (uri, range) pairs. */
function definitionTargets(
  result: unknown,
): ReadonlyArray<{ readonly uri: string; readonly range: LspRange }> {
  const entries = Array.isArray(result) ? result : result === null ? [] : [result];
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (typeof entry.targetUri === "string") {
      const range = isRange(entry.targetSelectionRange)
        ? entry.targetSelectionRange
        : entry.targetRange;
      return isRange(range) ? [{ uri: entry.targetUri, range }] : [];
    }
    return typeof entry.uri === "string" && isRange(entry.range)
      ? [{ uri: entry.uri, range: entry.range }]
      : [];
  });
}

/** Hover `contents` in any of LSP's three shapes, as one block of text. */
export function hoverContents(result: unknown): CodeIntelligenceHoverContents | null {
  if (!isRecord(result)) return null;
  const { contents } = result;
  let hover: CodeIntelligenceHoverContents | null = null;
  if (isRecord(contents) && typeof contents.kind === "string") {
    hover = {
      kind: contents.kind === "markdown" ? "markdown" : "plaintext",
      value: typeof contents.value === "string" ? contents.value : "",
    };
  } else {
    // Deprecated MarkedString: plain markdown, or a code block in a language.
    const blocks = (Array.isArray(contents) ? contents : [contents]).flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (isRecord(entry) && typeof entry.value === "string") {
        const language = typeof entry.language === "string" ? entry.language : "";
        return [`\`\`\`${language}\n${entry.value}\n\`\`\``];
      }
      return [];
    });
    hover = { kind: "markdown", value: blocks.join("\n\n") };
  }
  const value = hover.value.trim();
  if (value.length === 0) return null;
  return { kind: hover.kind, value: value.slice(0, MAX_HOVER_CHARACTERS) };
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const launchContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const servers = LanguageServers.languageServers;
  /** The last root each (workspace, language) used, for files outside the workspace. */
  const lastRoots = new Map<string, string>();

  const stamp = (filePath: string) =>
    fileSystem.stat(filePath).pipe(
      Effect.map((info): FileStamp => ({
        mtimeMs: Option.getOrUndefined(info.mtime)?.getTime() ?? 0,
        size: Number(info.size),
      })),
      Effect.option,
    );

  const startSession = (encodedKey: string) =>
    Effect.gen(function* () {
      const key = decodeKey(encodedKey);
      const startFailed = (cause: unknown) =>
        new CodeIntelligenceError({
          failure: "server-start-failed",
          language: key.language,
          cause,
        });
      const handle = yield* Effect.acquireRelease(
        spawner
          .spawn(
            ChildProcess.make(key.launch.command, [...key.launch.args], {
              cwd: key.root,
              stdin: { stream: "pipe", endOnDone: false },
              stdout: "pipe",
              stderr: "pipe",
              killSignal: "SIGTERM",
              forceKillAfter: Duration.seconds(2),
            }),
          )
          .pipe(Effect.mapError(startFailed)),
        (child) => child.kill().pipe(Effect.ignore),
      );
      yield* Effect.annotateLogsScoped({
        language: key.language,
        root: key.root,
        pid: Number(handle.pid),
      });
      // gopls logs to stderr; an undrained pipe would stall it.
      yield* handle.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped);
      const connection = yield* LspConnection.make({
        stdin: handle.stdin,
        stdout: handle.stdout,
      });
      const session: Session = {
        language: key.language,
        root: key.root,
        connection,
        syncLock: yield* Semaphore.make(1),
        openDocuments: new Map(),
        trackedFiles: new Map(),
        exited: false,
      };
      yield* connection.closed.pipe(
        Effect.andThen(
          Effect.sync(() => {
            session.exited = true;
          }),
        ),
        Effect.forkScoped,
      );

      const rootUri = NodeURL.pathToFileURL(key.root).href;
      yield* connection
        .request(
          "initialize",
          {
            processId: process.pid,
            clientInfo: { name: "Floripa Code" },
            rootUri,
            rootPath: key.root,
            workspaceFolders: [{ uri: rootUri, name: path.basename(key.root) }],
            capabilities: {
              general: { positionEncodings: ["utf-16"] },
              textDocument: {
                synchronization: { dynamicRegistration: false, didSave: false },
                hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
                definition: { dynamicRegistration: false, linkSupport: true },
              },
              workspace: { workspaceFolders: true },
            },
          },
          { timeout: INITIALIZE_TIMEOUT },
        )
        .pipe(Effect.mapError(startFailed));
      yield* connection.notify("initialized", {}).pipe(Effect.mapError(startFailed));
      yield* Effect.logInfo("language server started");

      // Runs before the spawn handle's kill: ask politely, then the handle ends it.
      yield* Effect.addFinalizer(() =>
        connection
          .request("shutdown", null, { timeout: SHUTDOWN_TIMEOUT })
          .pipe(
            Effect.andThen(connection.notify("exit", null)),
            Effect.ignore,
            Effect.andThen(Effect.logInfo("language server stopped")),
          ),
      );
      return session;
    });

  const sessions = yield* RcMap.make({
    lookup: startSession,
    idleTimeToLive: IDLE_TIME_TO_LIVE,
  });

  /**
   * Brings the server's view of `filePath` up to date with disk, and tells it
   * which other files it has seen changed since the last request.
   */
  const syncDocument = (session: Session, filePath: string, languageId: string) =>
    Effect.gen(function* () {
      const changes: Array<{ uri: string; type: 2 | 3 }> = [];
      const others = [...session.trackedFiles].filter(([tracked]) => tracked !== filePath);
      yield* Effect.forEach(
        others,
        ([tracked, previous]) =>
          stamp(tracked).pipe(
            Effect.flatMap((current) =>
              Effect.gen(function* () {
                if (
                  Option.isSome(current) &&
                  current.value.mtimeMs === previous.mtimeMs &&
                  current.value.size === previous.size
                ) {
                  return;
                }
                const uri = NodeURL.pathToFileURL(tracked).href;
                if (session.openDocuments.delete(tracked)) {
                  // Closing hands the file back to the server's disk view.
                  yield* session.connection.notify("textDocument/didClose", {
                    textDocument: { uri },
                  });
                }
                if (Option.isSome(current)) {
                  session.trackedFiles.set(tracked, current.value);
                  changes.push({ uri, type: 2 });
                } else {
                  session.trackedFiles.delete(tracked);
                  changes.push({ uri, type: 3 });
                }
              }),
            ),
          ),
        { concurrency: 16, discard: true },
      );
      if (changes.length > 0) {
        yield* session.connection.notify("workspace/didChangeWatchedFiles", { changes });
      }

      const current = yield* stamp(filePath);
      if (Option.isNone(current) || current.value.size > MAX_DOCUMENT_BYTES) return;
      const uri = NodeURL.pathToFileURL(filePath).href;
      const open = session.openDocuments.get(filePath);
      if (
        open !== undefined &&
        open.mtimeMs === current.value.mtimeMs &&
        open.size === current.value.size
      ) {
        touch(session.openDocuments, filePath, open, MAX_OPEN_DOCUMENTS);
        return;
      }
      const text = yield* fileSystem.readFileString(filePath).pipe(Effect.option);
      if (Option.isNone(text)) return;
      const version = (open?.version ?? 0) + 1;
      if (open === undefined) {
        yield* session.connection.notify("textDocument/didOpen", {
          textDocument: { uri, languageId, version, text: text.value },
        });
      } else {
        yield* session.connection.notify("textDocument/didChange", {
          textDocument: { uri, version },
          contentChanges: [{ text: text.value }],
        });
      }
      const evicted = touch(
        session.openDocuments,
        filePath,
        { ...current.value, version },
        MAX_OPEN_DOCUMENTS,
      );
      for (const closed of evicted) {
        yield* session.connection.notify("textDocument/didClose", {
          textDocument: { uri: NodeURL.pathToFileURL(closed).href },
        });
      }
      touch(session.trackedFiles, filePath, current.value, MAX_TRACKED_FILES);
    });

  const track = (session: Session, filePaths: ReadonlyArray<string>) =>
    Effect.forEach(
      filePaths,
      (filePath) =>
        session.trackedFiles.has(filePath)
          ? Effect.void
          : stamp(filePath).pipe(
              Effect.map((current) => {
                if (Option.isSome(current)) {
                  touch(session.trackedFiles, filePath, current.value, MAX_TRACKED_FILES);
                }
              }),
            ),
      { discard: true },
    );

  /** Where the request's file lives and which server answers for it. */
  const resolveTarget = (input: CodeIntelligencePositionInput) =>
    Effect.gen(function* () {
      const requested = input.relativePath.trim();
      const filePath = path.isAbsolute(requested)
        ? path.normalize(requested)
        : (yield* workspacePaths
            .resolveRelativePathWithinRoot({ workspaceRoot: input.cwd, relativePath: requested })
            .pipe(
              Effect.mapError(
                (cause) => new CodeIntelligenceError({ failure: "path-outside-root", cause }),
              ),
            )).absolutePath;
      const server = LanguageServers.languageServerFor(servers, filePath);
      if (server === undefined) return { _tag: "Unsupported" as const };
      const { spec, languageId } = server;
      const scopeKey = `${spec.language}\n${input.cwd}`;
      const relative = path.relative(input.cwd, filePath);
      const segments = relative.split(path.sep);
      // A dependency was reached from the project's code, such as a typing in
      // node_modules or a package in the Go module cache: the server that
      // pointed there knows it, and its own markers must not start another.
      const projectFile =
        segments[0] !== ".." && !path.isAbsolute(relative) && !segments.includes("node_modules");
      const root = projectFile
        ? yield* LanguageServers.resolveServerRoot({
            workspaceRoot: input.cwd,
            filePath,
            rootMarkers: spec.rootMarkers,
          }).pipe(Effect.provideContext(launchContext))
        : (lastRoots.get(scopeKey) ?? input.cwd);
      const launch = yield* spec.resolveLaunch(root).pipe(Effect.provideContext(launchContext));
      if (Option.isNone(launch)) return { _tag: "NotInstalled" as const, spec };
      lastRoots.set(scopeKey, root);
      return {
        _tag: "Ready" as const,
        filePath,
        languageId,
        key: { language: spec.language, root, launch: launch.value } satisfies SessionKey,
      };
    });

  /** Runs `use` against a synced session, starting or restarting the server as needed. */
  const withSession = <A>(
    key: SessionKey,
    filePath: string,
    languageId: string,
    use: (session: Session) => Effect.Effect<A, LspConnection.LspRequestError>,
  ) => {
    const encodedKey = encodeKey(key);
    const attempt = Effect.scoped(
      Effect.gen(function* () {
        // A failed start would otherwise stay cached until the idle timeout.
        const session = yield* RcMap.get(sessions, encodedKey).pipe(
          Effect.tapError(() => RcMap.invalidate(sessions, encodedKey)),
        );
        if (session.exited) return yield* new LspConnection.LspConnectionClosedError({});
        yield* session.syncLock.withPermits(1)(syncDocument(session, filePath, languageId));
        return yield* use(session);
      }),
    );
    return attempt.pipe(
      // The server died since it last answered, or while answering: start a fresh one once.
      Effect.catchTags({
        LspConnectionClosedError: () =>
          RcMap.invalidate(sessions, encodedKey).pipe(Effect.andThen(attempt)),
      }),
      Effect.catchTags({
        LspConnectionClosedError: (cause) =>
          Effect.fail(
            new CodeIntelligenceError({ failure: "server-exited", language: key.language, cause }),
          ),
        LspRequestTimeoutError: (cause) =>
          Effect.fail(
            new CodeIntelligenceError({
              failure: "request-timed-out",
              language: key.language,
              cause,
            }),
          ),
        LspResponseError: (cause) =>
          Effect.fail(
            new CodeIntelligenceError({ failure: "request-failed", language: key.language, cause }),
          ),
      }),
    );
  };

  const positionParams = (filePath: string, input: CodeIntelligencePositionInput) => ({
    textDocument: { uri: NodeURL.pathToFileURL(filePath).href },
    position: { line: input.line - 1, character: input.character },
  });

  /**
   * A server's file path as the client should open it: workspace-relative when
   * inside, so it opens in the editor. Dependencies stay absolute, like files
   * outside the workspace, so they open read-only: `node_modules` is installed
   * output, not the project's source.
   */
  const clientPath = (cwd: string, filePath: string) => {
    const relative = path.relative(cwd, filePath);
    const segments = relative.split(path.sep);
    return relative === "" ||
      segments[0] === ".." ||
      path.isAbsolute(relative) ||
      segments.includes("node_modules")
      ? filePath
      : segments.join("/");
  };

  const definition: CodeIntelligence["Service"]["definition"] = Effect.fn(
    "CodeIntelligence.definition",
  )(function* (input) {
    const target = yield* resolveTarget(input);
    if (target._tag === "Unsupported") {
      return { status: "unavailable" as const, reason: "unsupported-file" as const };
    }
    if (target._tag === "NotInstalled") {
      return {
        status: "unavailable" as const,
        reason: "server-not-installed" as const,
        language: target.spec.language,
        ...(target.spec.installHint ? { installHint: target.spec.installHint } : {}),
      };
    }
    const realCwd = yield* fileSystem
      .realPath(input.cwd)
      .pipe(Effect.orElseSucceed(() => input.cwd));
    return yield* withSession(target.key, target.filePath, target.languageId, (session) =>
      Effect.gen(function* () {
        const result = yield* session.connection.request(
          "textDocument/definition",
          positionParams(target.filePath, input),
          { timeout: REQUEST_TIMEOUT },
        );
        const seen = new Set<string>();
        const locations: CodeIntelligenceLocation[] = [];
        const targetPaths: string[] = [];
        for (const { uri, range } of definitionTargets(result)) {
          if (!uri.startsWith("file:")) continue;
          const filePath = NodeURL.fileURLToPath(uri);
          const dedupeKey = `${filePath}:${range.start.line}:${range.start.character}`;
          if (seen.has(dedupeKey) || locations.length >= MAX_DEFINITION_LOCATIONS) continue;
          seen.add(dedupeKey);
          targetPaths.push(filePath);
          const fromCwd = clientPath(input.cwd, filePath);
          locations.push({
            // A server may answer with the real path of a symlinked workspace.
            path: fromCwd === filePath ? clientPath(realCwd, filePath) : fromCwd,
            line: range.start.line + 1,
            character: range.start.character,
            endLine: range.end.line + 1,
            endCharacter: range.end.character,
          });
        }
        // Definitions are where an agent's edits matter next; keep them fresh.
        yield* track(session, targetPaths);
        return { status: "ok" as const, language: target.key.language, locations };
      }),
    );
  });

  const hover: CodeIntelligence["Service"]["hover"] = Effect.fn("CodeIntelligence.hover")(
    function* (input) {
      const target = yield* resolveTarget(input);
      if (target._tag === "Unsupported") {
        return { status: "unavailable" as const, reason: "unsupported-file" as const };
      }
      if (target._tag === "NotInstalled") {
        return {
          status: "unavailable" as const,
          reason: "server-not-installed" as const,
          language: target.spec.language,
          ...(target.spec.installHint ? { installHint: target.spec.installHint } : {}),
        };
      }
      return yield* withSession(target.key, target.filePath, target.languageId, (session) =>
        session.connection
          .request("textDocument/hover", positionParams(target.filePath, input), {
            timeout: REQUEST_TIMEOUT,
          })
          .pipe(
            Effect.map((result) => ({
              status: "ok" as const,
              language: target.key.language,
              contents: hoverContents(result),
            })),
          ),
      );
    },
  );

  const releaseRoot: CodeIntelligence["Service"]["releaseRoot"] = (root) =>
    Effect.gen(function* () {
      const normalized = path.normalize(root);
      for (const encodedKey of yield* RcMap.keys(sessions)) {
        const key = decodeKey(encodedKey);
        if (key.root === normalized || key.root.startsWith(`${normalized}${path.sep}`)) {
          yield* RcMap.invalidate(sessions, encodedKey);
        }
      }
      for (const [scopeKey, lastRoot] of lastRoots) {
        if (lastRoot === normalized || lastRoot.startsWith(`${normalized}${path.sep}`)) {
          lastRoots.delete(scopeKey);
        }
      }
    });

  return CodeIntelligence.of({ definition, hover, releaseRoot });
});

export const layer = Layer.effect(CodeIntelligence, make);
