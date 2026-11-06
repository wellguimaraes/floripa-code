import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const CODE_INTELLIGENCE_PATH_MAX_LENGTH = 512;

/** Languages with a registered language server. */
export const CodeIntelligenceLanguage = Schema.Literals(["typescript", "go"]);
export type CodeIntelligenceLanguage = typeof CodeIntelligenceLanguage.Type;

/**
 * A position in a saved file. The path follows `projects.readFile`: relative to
 * `cwd`, or an absolute host path for a read-only file outside the workspace.
 */
export const CodeIntelligencePositionInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(CODE_INTELLIGENCE_PATH_MAX_LENGTH)),
  /** 1-based, like the editor's line numbers. */
  line: PositiveInt,
  /** 0-based UTF-16 offset into the line, like a JavaScript string index. */
  character: NonNegativeInt,
});
export type CodeIntelligencePositionInput = typeof CodeIntelligencePositionInput.Type;

/**
 * A range in a file. `path` is relative to the request's `cwd` when the file is
 * inside it, otherwise an absolute host path (a `node_modules` typing, the Go
 * module cache), which clients open read-only through `projects.readFile`.
 */
export const CodeIntelligenceLocation = Schema.Struct({
  path: TrimmedNonEmptyString,
  line: PositiveInt,
  character: NonNegativeInt,
  endLine: PositiveInt,
  endCharacter: NonNegativeInt,
});
export type CodeIntelligenceLocation = typeof CodeIntelligenceLocation.Type;

/** The file has no language server here; not an error, so clients stay quiet. */
export const CodeIntelligenceUnavailable = Schema.Struct({
  status: Schema.Literal("unavailable"),
  reason: Schema.Literals(["unsupported-file", "server-not-installed"]),
  language: Schema.optional(CodeIntelligenceLanguage),
  /** How to install the missing server, for `server-not-installed`. */
  installHint: Schema.optional(Schema.String),
});
export type CodeIntelligenceUnavailable = typeof CodeIntelligenceUnavailable.Type;

export const CodeIntelligenceDefinitionResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ok"),
    language: CodeIntelligenceLanguage,
    locations: Schema.Array(CodeIntelligenceLocation),
  }),
  CodeIntelligenceUnavailable,
]);
export type CodeIntelligenceDefinitionResult = typeof CodeIntelligenceDefinitionResult.Type;

export const CodeIntelligenceHoverContents = Schema.Struct({
  kind: Schema.Literals(["markdown", "plaintext"]),
  value: Schema.String,
});
export type CodeIntelligenceHoverContents = typeof CodeIntelligenceHoverContents.Type;

export const CodeIntelligenceHoverResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ok"),
    language: CodeIntelligenceLanguage,
    /** Null when the server has nothing to say about the position. */
    contents: Schema.NullOr(CodeIntelligenceHoverContents),
  }),
  CodeIntelligenceUnavailable,
]);
export type CodeIntelligenceHoverResult = typeof CodeIntelligenceHoverResult.Type;

export const CodeIntelligenceFailure = Schema.Literals([
  "path-outside-root",
  "server-start-failed",
  "server-exited",
  "request-failed",
  "request-timed-out",
]);
export type CodeIntelligenceFailure = typeof CodeIntelligenceFailure.Type;

export class CodeIntelligenceError extends Schema.TaggedError<CodeIntelligenceError>()(
  "CodeIntelligenceError",
  {
    failure: CodeIntelligenceFailure,
    language: Schema.optional(CodeIntelligenceLanguage),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const server = this.language === "go" ? "gopls" : "The TypeScript language server";
    switch (this.failure) {
      case "path-outside-root":
        return "The file path is outside the workspace.";
      case "server-start-failed":
        return `${server} could not start.`;
      case "server-exited":
        return `${server} stopped unexpectedly.`;
      case "request-timed-out":
        return `${server} did not answer in time.`;
      case "request-failed":
        return `${server} could not answer the request.`;
    }
  }
}
