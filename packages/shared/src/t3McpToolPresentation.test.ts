import { describe, expect, it } from "vite-plus/test";

import { T3_MCP_TOOL_NAMES, resolveT3McpToolPresentation } from "./t3McpToolPresentation.ts";

describe("resolveT3McpToolPresentation", () => {
  it("recognizes every T3 tool across provider prefixes and completion suffixes", () => {
    for (const tool of T3_MCP_TOOL_NAMES) {
      const presentation = resolveT3McpToolPresentation(tool);
      for (const prefix of [
        "mcp__floripa-code__",
        "mcp__floripa_code__",
        "mcp__floripacode__",
        "Floripa-code.",
        "floripa_code/",
        "floripacode:",
        "mcp_floripa-code_",
        "Floripa Code ",
        "floripa-code · ",
      ]) {
        expect(resolveT3McpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveT3McpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });
  it("pretty prints Claude and Cursor T3 MCP tool names", () => {
    expect(resolveT3McpToolPresentation("mcp__floripa-code__t3_thread_read")).toEqual({
      displayName: "Read a T3 thread",
      logo: "floripa-code",
    });
  });

  it("pretty prints Codex T3 MCP tool names", () => {
    expect(resolveT3McpToolPresentation("floripa-code.create_threads")).toEqual({
      displayName: "Create T3 threads",
      logo: "floripa-code",
    });
  });

  it("pretty prints thread metadata updates", () => {
    expect(resolveT3McpToolPresentation("mcp__floripa-code__t3_thread_update")).toEqual({
      displayName: "Update T3 thread metadata",
      logo: "floripa-code",
    });
  });

  it("pretty prints bare T3 MCP toolkit names", () => {
    expect(resolveT3McpToolPresentation("list_scheduled_tasks")).toEqual({
      displayName: "List scheduled tasks",
      logo: "floripa-code",
    });
  });

  it("pretty prints worktree T3 MCP tool names", () => {
    expect(resolveT3McpToolPresentation("mcp__floripa-code__t3_worktree_handoff")).toEqual({
      displayName: "Hand off thread to a git worktree",
      logo: "floripa-code",
    });
    expect(resolveT3McpToolPresentation("floripa-code.t3_worktree_status")).toEqual({
      displayName: "Get thread worktree status",
      logo: "floripa-code",
    });
  });

  it("pretty prints preview T3 MCP tool names", () => {
    expect(resolveT3McpToolPresentation("Floripa-code.preview_open")).toEqual({
      displayName: "Open a page in the preview browser",
      logo: "floripa-code",
    });
    expect(resolveT3McpToolPresentation("mcp__floripa-code__preview_status")).toEqual({
      displayName: "Get preview browser status",
      logo: "floripa-code",
    });
  });

  it("matches the separator variants ACP registry agents emit", () => {
    for (const name of [
      "mcp_floripa-code_delegate_task",
      "floripa_code:delegate_task",
      "floripacode/delegate_task",
      "floripa-code delegate_task",
      "Floripa Code delegate_task",
      "floripa-code__delegate_task",
    ]) {
      expect(resolveT3McpToolPresentation(name)?.displayName).toBe("Delegate a child task");
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveT3McpToolPresentation("floripa-code-thread_opencode2-adapter_delegate_task")
        ?.displayName,
    ).toBe("Delegate a child task");
    expect(
      resolveT3McpToolPresentation("floripa-code-thread_opencode2-adapter_not_a_tool"),
    ).toBeNull();
  });

  it("keeps unknown MCP tools on the generic renderer path", () => {
    expect(resolveT3McpToolPresentation("mcp__github__search_issues")).toBeNull();
    expect(resolveT3McpToolPresentation("floripa-code.not_a_real_tool")).toBeNull();
  });
});
