/**
 * ProjectFaviconResolver - Effect service contract for project icon discovery.
 *
 * Resolves a representative favicon or app icon file for a workspace by
 * checking common file locations and project source metadata.
 *
 * @module ProjectFaviconResolver
 */
import { isProjectFaviconPath } from "@t3tools/shared/projectFavicon";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as T3ProjectFileLoader from "./T3ProjectFileLoader.ts";

// Resolution probes 23 well-known paths plus 7 source files, then asks git for
// icon-like files anywhere in the checkout. AssetAccess resolves on every
// project-favicon asset URL, and a project's icon rarely moves, so the answer
// is kept for an hour either way. Choosing "detect automatically" refreshes it.
const FAVICON_CACHE_CAPACITY = 512;
const FAVICON_CACHE_TTL = Duration.hours(1);
const GIT_SCAN_TIMEOUT = Duration.seconds(5);
const GIT_SCAN_MAX_OUTPUT_BYTES = 1024 * 1024;

function faviconCacheKey(cwd: string, faviconPath?: string): string {
  return `${faviconPath ?? ""}\0${cwd}`;
}

function parseFaviconCacheKey(key: string): {
  readonly cwd: string;
  readonly faviconPath?: string;
} {
  const separatorIndex = key.indexOf("\0");
  if (separatorIndex === -1) {
    return { cwd: key };
  }
  const faviconPath = key.slice(0, separatorIndex);
  const cwd = key.slice(separatorIndex + 1);
  return faviconPath.length === 0 ? { cwd } : { cwd, faviconPath };
}

// Well-known favicon paths checked in order.
const FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
  ".idea/icon.svg",
  "Resources/AppIcon.icns",
  "AppIcon.icns",
] as const;

// Files that may contain a <link rel="icon"> or icon metadata declaration.
const ICON_SOURCE_FILES = [
  "index.html",
  "public/index.html",
  "app/routes/__root.tsx",
  "src/routes/__root.tsx",
  "app/root.tsx",
  "src/root.tsx",
  "src/index.html",
] as const;

// Icon-like file names git is asked for, at any depth. The extension is
// checked afterwards, since pathspecs cannot express alternatives.
const ICON_SCAN_PATHSPECS = [
  "favicon*",
  "icon.*",
  "app-icon.*",
  "apple-icon.*",
  "apple-touch-icon*",
  "AppIcon.icns",
  "logo.*",
].map((name) => `:(glob,icase)**/${name}`);

// Folders whose icons belong to something other than the project itself.
const IGNORED_ICON_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
  "third_party",
  "third-party",
  "test",
  "tests",
  "__tests__",
  "e2e",
  "fixtures",
  "__fixtures__",
  "mocks",
  "__mocks__",
  "example",
  "examples",
  "docs",
  "storybook",
  ".storybook",
  "coverage",
  "dist",
  "out",
  ".next",
  "pods",
]);

// Folders that conventionally hold an app's icon, so they cost no depth.
const ICON_HOME_DIRECTORIES = new Set([
  "public",
  "static",
  "assets",
  "app",
  "src",
  "build",
  "resources",
  "res",
  "images",
  "img",
  "icons",
]);

// A web app's favicon is drawn to be read small, which is how projects show it.
const ICON_APP_DIRECTORIES: Record<string, number> = {
  web: 5,
  www: 5,
  site: 5,
  frontend: 5,
  client: 5,
  desktop: 4,
  mobile: 2,
};

function iconNameScore(baseName: string): number {
  if (baseName.startsWith("favicon")) return 40;
  if (baseName.startsWith("apple-touch-icon")) return 25;
  if (baseName.startsWith("logo")) return 15;
  return 30;
}

const ICON_FORMAT_SCORES: Record<string, number> = { svg: 6, png: 4, icns: 3, ico: 2 };

/**
 * Ranks a repository-relative path as the project's icon, or null when it is
 * not one. Shallow beats deep, a favicon beats a logo, and a web app's icon
 * beats a mobile app's, so a monorepo's apps/web favicon wins over its
 * apps/mobile launcher icon.
 */
export function scoreIconPath(relativePath: string): number | null {
  if (!isProjectFaviconPath(relativePath)) return null;
  const segments = relativePath.toLowerCase().split("/");
  const baseName = segments.pop() ?? "";
  if (segments.some((segment) => IGNORED_ICON_DIRECTORIES.has(segment))) return null;
  const extension = baseName.slice(baseName.lastIndexOf(".") + 1);
  let score = iconNameScore(baseName) + (ICON_FORMAT_SCORES[extension] ?? 0);
  for (const segment of segments) {
    if (ICON_HOME_DIRECTORIES.has(segment)) continue;
    score += (ICON_APP_DIRECTORIES[segment] ?? 0) - 10;
  }
  return score;
}

/** The scanned paths that could be the project's icon, best first. */
export function rankIconPaths(relativePaths: ReadonlyArray<string>): ReadonlyArray<string> {
  return relativePaths
    .flatMap((relativePath) => {
      const score = scoreIconPath(relativePath);
      return score === null ? [] : [{ relativePath, score }];
    })
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        a.relativePath.length - b.relativePath.length ||
        a.relativePath.localeCompare(b.relativePath),
    )
    .map((candidate) => candidate.relativePath);
}

// Matches <link ...> tags or object-like icon metadata where rel/href can appear in any order.
// The tag pattern is anchored on `<link`, so it only starts at real candidates. Object metadata
// is matched by scanning brace-free runs instead of by one combined pattern: an unanchored
// pattern restarts at every offset and rescans forward, which is quadratic on large sources.
const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;
const ICON_REL_RE = /\brel\s*:\s*["'](?:icon|shortcut icon)["']/i;
const ICON_HREF_RE = /\bhref\s*:\s*["']([^"'?]+)/i;

export class ProjectFaviconResolutionError extends Schema.TaggedError<ProjectFaviconResolutionError>()(
  "ProjectFaviconResolutionError",
  {
    operation: Schema.Literals([
      "normalize-workspace",
      "resolve-path",
      "stat-candidate",
      "read-source",
    ]),
    workspaceRoot: Schema.String,
    relativePath: Schema.optional(Schema.String),
    absolutePath: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to resolve project favicon during ${this.operation} for workspace ${this.workspaceRoot}.`;
  }
}

const isWorkspaceRootNotExistsError = Schema.is(WorkspacePaths.WorkspaceRootNotExistsError);

/** True when the workspace root itself is gone, e.g. a moved or deleted checkout. */
export const isMissingWorkspaceRoot = (error: ProjectFaviconResolutionError): boolean =>
  error.operation === "normalize-workspace" && isWorkspaceRootNotExistsError(error.cause);

/** Service tag for project favicon resolution. */
export class ProjectFaviconResolver extends Context.Service<
  ProjectFaviconResolver,
  {
    /**
     * Resolve a favicon or icon file path for the provided workspace root.
     *
     * Returns `null` when no candidate icon file can be found.
     */
    readonly resolvePath: (
      cwd: string,
      faviconPath?: string,
      options?: { readonly refresh?: boolean },
    ) => Effect.Effect<string | null, ProjectFaviconResolutionError>;
  }
>()("t3/project/ProjectFaviconResolver") {}

function extractIconHref(source: string): string | null {
  const htmlMatch = source.match(LINK_ICON_HTML_RE);
  if (htmlMatch?.[1]) return htmlMatch[1];
  // Icon metadata counts when `rel` and `href` share a brace-free run, so a run holding `rel`
  // but no href falls through to the next one rather than ending the search.
  for (const run of source.split("}")) {
    if (!ICON_REL_RE.test(run)) continue;
    const hrefMatch = run.match(ICON_HREF_RE);
    if (hrefMatch?.[1]) return hrefMatch[1];
  }
  return null;
}

const optionOnNotFound = <A, R>(
  effect: Effect.Effect<A, PlatformError.PlatformError, R>,
): Effect.Effect<Option.Option<A>, PlatformError.PlatformError, R> =>
  effect.pipe(
    Effect.asSome,
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed(Option.none<A>()) : Effect.fail(error),
    }),
  );

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const projectFileLoader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const resolveIconHref = (href: string): ReadonlyArray<string> => {
    const clean = href.replace(/^\//, "");
    return [path.join("public", clean), clean];
  };

  const findExistingFile = Effect.fn("ProjectFaviconResolver.findExistingFile")(function* (
    projectCwd: string,
    relativeCandidates: ReadonlyArray<string>,
    candidateScope: "workspace" | "filesystem",
  ): Effect.fn.Return<string | null, ProjectFaviconResolutionError> {
    for (const relativePath of relativeCandidates) {
      const candidate = yield* (
        candidateScope === "filesystem" && path.isAbsolute(relativePath)
          ? Effect.succeed({ absolutePath: relativePath, relativePath })
          : workspacePaths.resolveRelativePathWithinRoot({
              workspaceRoot: projectCwd,
              relativePath,
            })
      ).pipe(
        Effect.asSome,
        Effect.catchTags({
          WorkspacePathOutsideRootError: () =>
            Effect.succeed(
              Option.none<{ readonly absolutePath: string; readonly relativePath: string }>(),
            ),
        }),
      );
      if (Option.isNone(candidate)) {
        continue;
      }
      const stats = yield* optionOnNotFound(fileSystem.stat(candidate.value.absolutePath)).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectFaviconResolutionError({
              operation: "stat-candidate",
              workspaceRoot: projectCwd,
              relativePath,
              absolutePath: candidate.value.absolutePath,
              cause,
            }),
        ),
      );
      if (Option.isSome(stats) && stats.value.type === "File") {
        return candidate.value.absolutePath;
      }
    }
    return null;
  });

  // Reads one source file and resolves the icon it declares, if any.
  const findIconFromSource = Effect.fn("ProjectFaviconResolver.findIconFromSource")(function* (
    projectCwd: string,
    sourceFile: string,
  ): Effect.fn.Return<string | null, ProjectFaviconResolutionError> {
    const sourcePath = yield* workspacePaths
      .resolveRelativePathWithinRoot({
        workspaceRoot: projectCwd,
        relativePath: sourceFile,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectFaviconResolutionError({
              operation: "resolve-path",
              workspaceRoot: projectCwd,
              relativePath: sourceFile,
              cause,
            }),
        ),
      );
    const source = yield* optionOnNotFound(fileSystem.readFileString(sourcePath.absolutePath)).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectFaviconResolutionError({
            operation: "read-source",
            workspaceRoot: projectCwd,
            relativePath: sourceFile,
            absolutePath: sourcePath.absolutePath,
            cause,
          }),
      ),
    );
    if (Option.isNone(source)) {
      return null;
    }
    const href = extractIconHref(source.value);
    if (!href) {
      return null;
    }
    return yield* findExistingFile(projectCwd, resolveIconHref(href), "workspace");
  });

  // Starts every probe at once and returns the first hit in list order. A miss
  // costs one round of filesystem latency instead of one per probe, which
  // matters when the disk is slow. Fibers are joined in order, so a hit returns
  // without waiting for lower-ranked probes (the scope interrupts them), and a
  // failure surfaces only when no earlier probe found a file.
  const firstInOrder = <A>(
    items: ReadonlyArray<A>,
    probe: (item: A) => Effect.Effect<string | null, ProjectFaviconResolutionError>,
  ) =>
    Effect.gen(function* () {
      const fibers = yield* Effect.forEach(items, (item) => Effect.forkScoped(probe(item)));
      for (const fiber of fibers) {
        const found = yield* Fiber.join(fiber);
        if (found) {
          return found;
        }
      }
      return null;
    }).pipe(Effect.scoped);

  // Icons outside the well-known spots, e.g. a monorepo's apps/web/public/favicon.svg.
  // git lists tracked and untracked files but skips ignored ones such as
  // node_modules, so one call covers the checkout without walking it. A folder
  // that is not a repository, or a git that fails, simply has no such icon.
  const findIconWithGit = Effect.fn("ProjectFaviconResolver.findIconWithGit")(function* (
    projectCwd: string,
  ): Effect.fn.Return<string | null, ProjectFaviconResolutionError> {
    const result = yield* processRunner
      .run({
        command: "git",
        args: [
          "-C",
          projectCwd,
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
          "--",
          ...ICON_SCAN_PATHSPECS,
        ],
        timeout: GIT_SCAN_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: GIT_SCAN_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(Effect.option);
    if (Option.isNone(result) || result.value.code !== 0) return null;
    const paths = result.value.stdout.split("\0").filter((entry) => entry.length > 0);
    // A truncated listing can end mid-path.
    if (result.value.stdoutTruncated) paths.pop();
    // A listed file can be gone from disk, e.g. deleted but not yet committed.
    return yield* findExistingFile(projectCwd, rankIconPaths(paths), "workspace");
  });

  const resolvePathUncached = Effect.fn("ProjectFaviconResolver.resolvePathUncached")(function* (
    cwd: string,
    faviconPath?: string,
  ): Effect.fn.Return<string | null, ProjectFaviconResolutionError> {
    const projectCwd = yield* workspacePaths.normalizeWorkspaceRoot(cwd).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectFaviconResolutionError({
            operation: "normalize-workspace",
            workspaceRoot: cwd,
            cause,
          }),
      ),
    );
    // A grouped project's saved path can be absent from one checkout. Use it
    // where it exists and retain automatic discovery for the other checkouts.
    if (faviconPath !== undefined) {
      const existing = yield* findExistingFile(projectCwd, [faviconPath], "filesystem");
      if (existing) {
        return existing;
      }
    }

    // A t3.json iconPath takes precedence over the well-known locations.
    const projectFile = yield* projectFileLoader.load(projectCwd);
    if (Option.isSome(projectFile) && projectFile.value.iconPath !== undefined) {
      const existing = yield* findExistingFile(
        projectCwd,
        [projectFile.value.iconPath],
        "workspace",
      );
      if (existing) {
        return existing;
      }
    }

    const wellKnown = yield* firstInOrder(FAVICON_CANDIDATES, (candidate) =>
      findExistingFile(projectCwd, [candidate], "workspace"),
    );
    if (wellKnown) {
      return wellKnown;
    }

    const declared = yield* firstInOrder(ICON_SOURCE_FILES, (sourceFile) =>
      findIconFromSource(projectCwd, sourceFile),
    );
    if (declared) {
      return declared;
    }

    return yield* findIconWithGit(projectCwd);
  });

  const faviconCache = yield* Cache.makeWith<string, string | null, ProjectFaviconResolutionError>(
    (key) => {
      const { cwd, faviconPath } = parseFaviconCacheKey(key);
      return resolvePathUncached(cwd, faviconPath);
    },
    {
      capacity: FAVICON_CACHE_CAPACITY,
      timeToLive: Exit.match({
        onSuccess: () => FAVICON_CACHE_TTL,
        onFailure: () => Duration.zero,
      }),
    },
  );

  const resolvePath: ProjectFaviconResolver["Service"]["resolvePath"] = Effect.fn(
    "ProjectFaviconResolver.resolvePath",
  )(function* (cwd, faviconPath, options) {
    const key = faviconCacheKey(cwd, faviconPath);
    if (options?.refresh) {
      yield* Cache.invalidate(faviconCache, key);
    }
    const cached = yield* Cache.get(faviconCache, key);
    if (cached === null) {
      return null;
    }

    // A hit still confirms the file with one stat rather than the ~20 probes a
    // full walk costs, so a deleted icon falls back at once instead of after
    // the TTL.
    const stats = yield* optionOnNotFound(fileSystem.stat(cached)).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectFaviconResolutionError({
            operation: "stat-candidate",
            workspaceRoot: cwd,
            absolutePath: cached,
            cause,
          }),
      ),
    );
    if (Option.isSome(stats) && stats.value.type === "File") {
      return cached;
    }

    yield* Cache.invalidate(faviconCache, key);
    return yield* Cache.get(faviconCache, key);
  });

  return ProjectFaviconResolver.of({ resolvePath });
});

export const layer = Layer.effect(ProjectFaviconResolver, make).pipe(
  Layer.provide(ProcessRunner.layer),
);
