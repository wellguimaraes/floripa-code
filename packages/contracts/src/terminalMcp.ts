import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { TerminalSessionStatus } from "./terminal.ts";

const TerminalMcpTerminalId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).annotate({
  description: "The terminal id t3_terminal_run returned.",
});

/** Input for the `t3_terminal_run` MCP tool. */
export const TerminalMcpRunInput = Schema.Struct({
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(8_192)).annotate({
    description: "Shell command to type into a new terminal, such as 'bun run dev'.",
  }),
  cwd: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Directory to run in: absolute, or relative to the thread's checkout. Defaults to the checkout root.",
    }),
  ),
  restartOnRestore: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Run the command again in a fresh terminal when the app restarts. Only for long-running processes that are safe to start twice: dev servers, watchers, tunnels. Never for installs, migrations, deploys, or tests. Defaults to false.",
    }),
  ),
});
export type TerminalMcpRunInput = typeof TerminalMcpRunInput.Type;

export const TerminalMcpRunResult = Schema.Struct({
  terminalId: Schema.String,
  cwd: Schema.String,
});
export type TerminalMcpRunResult = typeof TerminalMcpRunResult.Type;

/** Input for the `t3_terminal_read` MCP tool. */
export const TerminalMcpReadInput = Schema.Struct({
  terminalId: TerminalMcpTerminalId,
  lines: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
      .check(Schema.isLessThanOrEqualTo(2_000))
      .annotate({ description: "How many of the last output lines to return. Defaults to 200." }),
  ),
});
export type TerminalMcpReadInput = typeof TerminalMcpReadInput.Type;

export const TerminalMcpReadResult = Schema.Struct({
  terminalId: Schema.String,
  status: TerminalSessionStatus,
  /** Whether a command is running in the shell, rather than the shell waiting at its prompt. */
  commandRunning: Schema.Boolean,
  command: Schema.optional(Schema.String),
  restartOnRestore: Schema.Boolean,
  exitCode: Schema.NullOr(Schema.Int),
  /** The last output lines as plain text, without colors or cursor controls. */
  output: Schema.String,
});
export type TerminalMcpReadResult = typeof TerminalMcpReadResult.Type;

/** Input for the `t3_terminal_stop` MCP tool. */
export const TerminalMcpStopInput = Schema.Struct({ terminalId: TerminalMcpTerminalId });
export type TerminalMcpStopInput = typeof TerminalMcpStopInput.Type;

export const TerminalMcpStopResult = Schema.Struct({ stopped: Schema.Boolean });
export type TerminalMcpStopResult = typeof TerminalMcpStopResult.Type;
