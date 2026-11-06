import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as LanguageServers from "./LanguageServers.ts";

const spec = (language: "typescript" | "go") =>
  LanguageServers.languageServers.find((entry) => entry.language === language)!;

it.layer(NodeServices.layer)("LanguageServers", (it) => {
  it.effect("maps extensions to a server and its LSP language id", () =>
    Effect.sync(() => {
      const servers = LanguageServers.languageServers;
      assert.strictEqual(
        LanguageServers.languageServerFor(servers, "/w/App.TSX")?.languageId,
        "typescriptreact",
      );
      assert.strictEqual(
        LanguageServers.languageServerFor(servers, "/w/a.mjs")?.languageId,
        "javascript",
      );
      assert.strictEqual(
        LanguageServers.languageServerFor(servers, "/w/main.go")?.spec.language,
        "go",
      );
      assert.strictEqual(LanguageServers.languageServerFor(servers, "/w/README.md"), undefined);
    }),
  );

  it.effect("roots a server at the outermost marker between the workspace and the file", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-root-" });
      const pkg = path.join(workspace, "services", "api", "internal");
      yield* fileSystem.makeDirectory(pkg, { recursive: true });
      yield* fileSystem.writeFileString(path.join(workspace, "services", "api", "go.mod"), "");
      yield* fileSystem.writeFileString(path.join(pkg, "go.mod"), "");
      const rootFor = (filePath: string, language: "typescript" | "go") =>
        LanguageServers.resolveServerRoot({
          workspaceRoot: workspace,
          filePath,
          rootMarkers: spec(language).rootMarkers,
        });

      // A module nested below the top gets its own root; the outer module wins over the inner one.
      assert.strictEqual(
        yield* rootFor(path.join(pkg, "handler.go"), "go"),
        path.join(workspace, "services", "api"),
      );
      // No marker on the way: the workspace itself.
      assert.strictEqual(yield* rootFor(path.join(pkg, "index.ts"), "typescript"), workspace);

      yield* fileSystem.writeFileString(path.join(workspace, "go.work"), "");
      assert.strictEqual(yield* rootFor(path.join(pkg, "handler.go"), "go"), workspace);
    }),
  );

  it.effect("runs the project's TypeScript 7 and falls back to the bundled one", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // The host's own platform, so the bundled fallback below can resolve too.
      const platform = yield* HostProcess.Platform;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-ts-" });
      const typescriptDir = path.join(workspace, "node_modules", "typescript");
      yield* fileSystem.makeDirectory(typescriptDir, { recursive: true });
      const writeTypescriptVersion = (version: string) =>
        fileSystem.writeFileString(
          path.join(typescriptDir, "package.json"),
          JSON.stringify({ name: "typescript", version }),
        );

      // TypeScript 5 has no language server mode, so the bundled 7 answers.
      yield* writeTypescriptVersion("5.9.3");
      const bundled = yield* spec("typescript").resolveLaunch(workspace);
      assert.isTrue(Option.isSome(bundled));
      assert.isFalse(Option.getOrThrow(bundled).command.startsWith(workspace));
      assert.deepStrictEqual(Option.getOrThrow(bundled).args, ["--lsp", "--stdio"]);

      // TypeScript 7 in the project: its own native binary, untouched copy first.
      yield* writeTypescriptVersion("7.1.0");
      const platformDir = path.join(
        workspace,
        "node_modules",
        "@typescript",
        `typescript-${platform}-${yield* HostProcess.Architecture}`,
      );
      yield* fileSystem.makeDirectory(path.join(platformDir, "lib"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(platformDir, "package.json"), "{}");
      const exe = platform === "win32" ? ".exe" : "";
      yield* fileSystem.writeFileString(path.join(platformDir, "lib", `tsc${exe}`), "");
      assert.strictEqual(
        Option.getOrThrow(yield* spec("typescript").resolveLaunch(workspace)).command,
        path.join(yield* fileSystem.realPath(platformDir), "lib", `tsc${exe}`),
      );
      yield* fileSystem.writeFileString(path.join(platformDir, "lib", `tsc.original${exe}`), "");
      assert.strictEqual(
        Option.getOrThrow(yield* spec("typescript").resolveLaunch(workspace)).command,
        path.join(yield* fileSystem.realPath(platformDir), "lib", `tsc.original${exe}`),
      );
    }),
  );
});
