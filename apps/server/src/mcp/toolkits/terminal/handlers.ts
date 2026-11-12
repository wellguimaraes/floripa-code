import { OrchestratorMcpFailure, type TerminalError } from "@t3tools/contracts";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { stripTerminalControl } from "@t3tools/shared/terminalText";
import { worktreeScopeKey } from "@t3tools/shared/worktreeScope";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as Project from "../../../project/ProjectService.ts";
import * as TerminalManager from "../../../terminal/Manager.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread, unavailable } from "../../threadAccess.ts";
import { TerminalToolkit } from "./tools.ts";

const DEFAULT_READ_LINES = 200;

const terminalFailure = (error: TerminalError) =>
  new OrchestratorMcpFailure({
    code: error._tag === "TerminalSessionLookupError" ? "invalid_request" : "orchestration_error",
    message:
      error._tag === "TerminalSessionLookupError"
        ? "No such terminal in this thread's checkout."
        : error.message,
  });

/** The calling thread's checkout, which owns the terminals these tools reach. */
const callerCheckout = Effect.gen(function* () {
  const {
    projection: { thread },
  } = yield* readThread();
  const projects = yield* Project.ProjectService;
  const project = yield* projects.getById(thread.projectId).pipe(Effect.mapError(unavailable));
  if (Option.isNone(project))
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "The thread's project was not found.",
    });
  const workspaceRoot = project.value.workspaceRoot;
  const worktreePath = thread.worktreePath;
  return {
    threadId: thread.id,
    scopeKey: worktreeScopeKey({ worktreePath, workspaceRoot }),
    workspaceRoot,
    worktreePath,
    root: worktreePath ?? workspaceRoot,
  };
});

/** The last `count` lines as plain text; a carriage return redraws its line, so only the final draw counts. */
function lastLines(history: string, count: number): string {
  return stripTerminalControl(history)
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1))
    .slice(-count)
    .join("\n");
}

export const layer = McpToolAccess.toLayer(
  TerminalToolkit,
  Effect.gen(function* () {
    const terminals = yield* TerminalManager.TerminalManager;
    const crypto = yield* Crypto.Crypto;
    const path = yield* Path.Path;
    return {
      t3_terminal_run: McpToolAccess.runsCommandsAsCaller((input) =>
        Effect.gen(function* () {
          const checkout = yield* callerCheckout;
          const cwd =
            input.cwd === undefined ? checkout.root : path.resolve(checkout.root, input.cwd);
          const terminalId = `agent-${(yield* crypto.randomUUIDv4.pipe(Effect.orDie)).slice(0, 8)}`;
          yield* terminals
            .run({
              threadId: checkout.threadId,
              scopeKey: checkout.scopeKey,
              terminalId,
              cwd,
              worktreePath: checkout.worktreePath,
              env: {
                ...projectScriptRuntimeEnv({
                  project: { cwd: checkout.workspaceRoot },
                  worktreePath: checkout.worktreePath,
                }),
                // Nobody may be attached to answer a truecolor probe, as with setup scripts.
                COLORTERM: "",
              },
              command: input.command,
              restartOnRestore: input.restartOnRestore === true,
              startedByAgent: true,
            })
            .pipe(Effect.mapError(terminalFailure));
          return { terminalId, cwd };
        }),
      ),
      t3_terminal_read: McpToolAccess.readsAsCaller((input) =>
        Effect.gen(function* () {
          const checkout = yield* callerCheckout;
          const { summary, history } = yield* terminals
            .read({
              threadId: checkout.threadId,
              scopeKey: checkout.scopeKey,
              terminalId: input.terminalId,
            })
            .pipe(Effect.mapError(terminalFailure));
          return {
            terminalId: summary.terminalId,
            status: summary.status,
            commandRunning: summary.hasRunningSubprocess,
            ...(summary.command === undefined ? {} : { command: summary.command }),
            restartOnRestore: summary.restartOnRestore === true,
            exitCode: summary.exitCode,
            output: lastLines(history, input.lines ?? DEFAULT_READ_LINES),
          };
        }),
      ),
      t3_terminal_stop: McpToolAccess.runsCommandsAsCaller((input) =>
        Effect.gen(function* () {
          const checkout = yield* callerCheckout;
          const target = {
            threadId: checkout.threadId,
            scopeKey: checkout.scopeKey,
            terminalId: input.terminalId,
          };
          const { summary } = yield* terminals.read(target).pipe(Effect.mapError(terminalFailure));
          if (summary.startedByAgent !== true)
            return yield* new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "The user opened this terminal, so only they can close it.",
            });
          yield* terminals
            .close({ ...target, deleteHistory: true })
            .pipe(Effect.mapError(terminalFailure));
          return { stopped: true };
        }),
      ),
    };
  }),
);
