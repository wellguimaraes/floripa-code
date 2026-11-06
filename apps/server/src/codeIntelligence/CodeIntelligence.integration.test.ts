import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as CodeIntelligence from "./CodeIntelligence.ts";

// Runs the bundled TypeScript 7 `tsc --lsp` for real: the handshake, document
// sync and both requests against a two-file project.
it.layer(NodeServices.layer)("CodeIntelligence with tsc --lsp", (it) => {
  it.effect("finds a definition and hover text in a TypeScript project", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-tsc-lsp-" });
      yield* fileSystem.makeDirectory(path.join(root, "src"));
      yield* fileSystem.writeFileString(
        path.join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
      );
      yield* fileSystem.writeFileString(
        path.join(root, "src", "a.ts"),
        "/** Says hi. */\nexport function greet(name: string): string {\n  return `hi ${name}`;\n}\n",
      );
      yield* fileSystem.writeFileString(
        path.join(root, "src", "b.ts"),
        'import { greet } from "./a";\nexport const x = greet("bob");\n',
      );
      const service = Context.get(
        yield* Layer.build(CodeIntelligence.layer.pipe(Layer.provide(WorkspacePaths.layer))),
        CodeIntelligence.CodeIntelligence,
      );

      const position = { cwd: root, relativePath: "src/b.ts", line: 2, character: 18 };
      const definition = yield* service.definition(position);
      const hover = yield* service.hover(position);

      assert.deepStrictEqual(definition, {
        status: "ok",
        language: "typescript",
        locations: [{ path: "src/a.ts", line: 2, character: 16, endLine: 2, endCharacter: 21 }],
      });
      assert.strictEqual(hover.status, "ok");
      const contents = hover.status === "ok" ? hover.contents : null;
      assert.strictEqual(contents?.kind, "markdown");
      assert.include(contents?.value, "function greet(name: string): string");
      assert.include(contents?.value, "Says hi.");
    }),
  );
});
