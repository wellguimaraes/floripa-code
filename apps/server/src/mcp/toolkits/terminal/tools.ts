import {
  OrchestratorMcpFailure,
  TerminalMcpReadInput,
  TerminalMcpReadResult,
  TerminalMcpRunInput,
  TerminalMcpRunResult,
  TerminalMcpStopInput,
  TerminalMcpStopResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ProjectService.ProjectService,
];

const TerminalRunTool = Tool.make("t3_terminal_run", {
  description:
    "Needs an agent running inside a T3 thread with full access. Run a long-lived command, such as a dev server, watcher, or tunnel, in a new terminal in this thread's checkout. The user sees it as a terminal tab and can stop it; it keeps running after your turn ends. Prefer this over your own background shell for anything the user should be able to see or keep running. Set restartOnRestore only for processes that are safe to start twice. Returns the terminalId for t3_terminal_read and t3_terminal_stop.",
  parameters: TerminalMcpRunInput,
  success: TerminalMcpRunResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Run a command in a terminal")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const TerminalReadTool = Tool.make("t3_terminal_read", {
  description:
    "Needs an agent running inside a T3 thread. Read a terminal in this thread's checkout: whether its command is still running, and its last output lines as plain text. Use it to check a command started with t3_terminal_run, such as a dev server's errors.",
  parameters: TerminalMcpReadInput,
  success: TerminalMcpReadResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read a terminal")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const TerminalStopTool = Tool.make("t3_terminal_stop", {
  description:
    "Needs an agent running inside a T3 thread with full access. Stop a command started with t3_terminal_run and close its terminal, so it does not restart either. Terminals the user opened are theirs to close.",
  parameters: TerminalMcpStopInput,
  success: TerminalMcpStopResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Stop a terminal command")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const TerminalToolkit = Toolkit.make(TerminalRunTool, TerminalReadTool, TerminalStopTool);
