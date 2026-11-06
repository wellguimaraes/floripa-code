// @effect-diagnostics nodeBuiltinImport:off
/**
 * LanguageServers - the registry behind code intelligence. Each entry maps file
 * extensions to a language server: how to find its binary, which files mark a
 * project root, and the LSP language id of each extension. Adding a language
 * is adding an entry here.
 *
 * @module LanguageServers
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import type { CodeIntelligenceLanguage } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

export interface LanguageServerLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export interface LanguageServerSpec {
  readonly language: CodeIntelligenceLanguage;
  /** LSP language id by lowercase file extension, dot included. */
  readonly languageIds: Readonly<Record<string, string>>;
  /** A directory holding one of these files roots a server. */
  readonly rootMarkers: ReadonlyArray<string>;
  /** Shown when the server is not installed. */
  readonly installHint?: string;
  /** The binary to run for a root, or none when it is not installed. */
  readonly resolveLaunch: (
    root: string,
  ) => Effect.Effect<Option.Option<LanguageServerLaunch>, never, LaunchRequirements>;
}

type LaunchRequirements = FileSystem.FileSystem | Path.Path;

/**
 * The TypeScript 7 native binary next to a resolved `typescript` package, or
 * undefined for TypeScript 6 and older, which have no `--lsp`. The binary lives
 * in a per-platform package (`@typescript/typescript-darwin-arm64`), resolved
 * from the `typescript` package the way its own launcher does. `effect-tsgo
 * patch` wraps that binary and keeps the untouched one as `tsc.original`.
 */
function typescriptNativeBinary(
  typescriptPackageJson: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | undefined {
  const manifest = JSON.parse(NodeFS.readFileSync(typescriptPackageJson, "utf8")) as {
    readonly version?: unknown;
  };
  const major = typeof manifest.version === "string" ? Number.parseInt(manifest.version, 10) : 0;
  if (!(major >= 7)) return undefined;
  const platformPackageJson = NodeModule.createRequire(typescriptPackageJson).resolve(
    `@typescript/typescript-${platform}-${arch}/package.json`,
  );
  // Inside a packaged desktop app the package sits in app.asar, where nothing
  // can be executed; electron-builder unpacks binaries beside it.
  const binDir = NodePath.join(NodePath.dirname(platformPackageJson), "lib").replace(
    /\.asar(?=[\\/])/,
    ".asar.unpacked",
  );
  const exe = platform === "win32" ? ".exe" : "";
  for (const name of [`tsc.original${exe}`, `tsc${exe}`]) {
    const candidate = NodePath.join(binDir, name);
    if (NodeFS.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The project's own TypeScript when it is 7 or newer, so results match the
 * version it builds with. Older or missing TypeScript falls back to the copy
 * this server ships with.
 */
const resolveTypescriptLaunch = (root: string) =>
  Effect.gen(function* () {
    const platform = yield* HostProcess.Platform;
    const arch = yield* HostProcess.Architecture;
    const fromRequire = (require: NodeJS.Require) => {
      try {
        return typescriptNativeBinary(require.resolve("typescript/package.json"), platform, arch);
      } catch {
        return undefined;
      }
    };
    const binary =
      fromRequire(NodeModule.createRequire(NodePath.join(root, "package.json"))) ??
      fromRequire(NodeModule.createRequire(import.meta.url));
    return binary === undefined
      ? Option.none()
      : Option.some({ command: binary, args: ["--lsp", "--stdio"] });
  });

/** gopls on PATH, else where `go install` puts it: $GOBIN, each $GOPATH/bin, ~/go/bin. */
const resolveGoplsLaunch = () =>
  Effect.gen(function* () {
    const onPath = yield* resolveCommandPath("gopls").pipe(Effect.option);
    if (Option.isSome(onPath)) return Option.some({ command: onPath.value, args: [] });

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const env = yield* HostProcess.Environment;
    const home = yield* HostProcess.HomeDirectory;
    const windows = (yield* HostProcess.Platform) === "win32";
    const exe = windows ? "gopls.exe" : "gopls";
    const directories = [
      ...(env.GOBIN ? [env.GOBIN] : []),
      ...(env.GOPATH ?? "")
        .split(windows ? ";" : ":")
        .filter((entry) => entry.length > 0)
        .map((entry) => path.join(entry, "bin")),
      path.join(home, "go", "bin"),
    ];
    for (const directory of directories) {
      const candidate = path.join(directory, exe);
      if (yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
        return Option.some({ command: candidate, args: [] });
      }
    }
    return Option.none();
  });

export const languageServers: ReadonlyArray<LanguageServerSpec> = [
  {
    language: "typescript",
    languageIds: {
      ".ts": "typescript",
      ".mts": "typescript",
      ".cts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".jsx": "javascriptreact",
    },
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    resolveLaunch: resolveTypescriptLaunch,
  },
  {
    language: "go",
    languageIds: { ".go": "go" },
    rootMarkers: ["go.work", "go.mod"],
    installHint: "go install golang.org/x/tools/gopls@latest",
    resolveLaunch: resolveGoplsLaunch,
  },
];

/** The server for a file and the LSP language id of its extension. */
export function languageServerFor(
  servers: ReadonlyArray<LanguageServerSpec>,
  filePath: string,
): { readonly spec: LanguageServerSpec; readonly languageId: string } | undefined {
  const extension = NodePath.extname(filePath).toLowerCase();
  for (const spec of servers) {
    const languageId = spec.languageIds[extension];
    if (languageId !== undefined) return { spec, languageId };
  }
  return undefined;
}

/**
 * The root a file's server runs in: the outermost directory between the
 * workspace and the file that holds a root marker, so one project or worktree
 * gets one server per language unless it nests separate projects below its
 * top (a repository with a Go module in `backend/`). Without a marker the
 * workspace itself is the root. Callers handle files outside the workspace.
 */
export const resolveServerRoot = (input: {
  readonly workspaceRoot: string;
  readonly filePath: string;
  readonly rootMarkers: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const relativeDir = path.relative(input.workspaceRoot, path.dirname(input.filePath));
    const segments = relativeDir === "" ? [] : relativeDir.split(path.sep);
    let directory = input.workspaceRoot;
    for (let depth = 0; depth <= segments.length; depth += 1) {
      if (depth > 0) directory = path.join(directory, segments[depth - 1]!);
      for (const marker of input.rootMarkers) {
        const markerPath = path.join(directory, marker);
        if (yield* fileSystem.exists(markerPath).pipe(Effect.orElseSucceed(() => false))) {
          return directory;
        }
      }
    }
    return input.workspaceRoot;
  });
