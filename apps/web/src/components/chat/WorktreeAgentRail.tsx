import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { worktreeScopeKey } from "@t3tools/shared/worktreeScope";
import { PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon, UserIcon } from "lucide-react";
import { useMemo } from "react";

import { cn } from "~/lib/utils";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import type { WorktreeScope } from "~/worktreeScope";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** A stable colour per thread, so an agent keeps its look across views. */
function agentHue(threadId: string): number {
  let hash = 0;
  for (let index = 0; index < threadId.length; index += 1) {
    hash = (hash * 31 + threadId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

interface RailAgent {
  ref: ScopedThreadRef;
  title: string;
  working: boolean;
}

/**
 * The threads working in the active thread's checkout, beside its chat. They
 * share the panel's surfaces, so switching between them keeps the panel as it
 * is. While the chat is collapsed no agent is selected, and picking one opens
 * the chat on it.
 */
export function WorktreeAgentRail(props: {
  activeThreadRef: ScopedThreadRef;
  activeThreadTitle: string;
  scope: WorktreeScope | null;
  chatCollapsed: boolean;
  onToggleChat: () => void;
  onSelectThread: (ref: ScopedThreadRef) => void;
  onNewThread: (() => void) | null;
  className?: string;
}) {
  const projectRefs = useMemo(
    () => (props.scope ? [scopeProjectRef(props.scope.environmentId, props.scope.projectId)] : []),
    [props.scope],
  );
  const shells = useThreadShellsForProjectRefs(projectRefs);
  const scopeKey = props.scope?.scopeKey ?? null;
  const workspaceRoot = props.scope?.workspaceRoot ?? null;
  const agents = useMemo(() => {
    const active = props.activeThreadRef;
    const list: RailAgent[] = [];
    if (scopeKey !== null && workspaceRoot !== null) {
      for (const shell of shells) {
        if (shell.archivedAt !== null || shell.environmentId !== active.environmentId) continue;
        if (worktreeScopeKey({ worktreePath: shell.worktreePath, workspaceRoot }) !== scopeKey) {
          continue;
        }
        list.push({
          ref: scopeThreadRef(shell.environmentId, shell.id),
          title: shell.title,
          working: threadRuntimeIsActive(shell.runtime),
        });
      }
    }
    // A draft has no shell yet but is still the agent being talked to.
    if (!list.some((agent) => agent.ref.threadId === active.threadId)) {
      list.unshift({ ref: active, title: props.activeThreadTitle, working: false });
    }
    return list;
  }, [props.activeThreadRef, props.activeThreadTitle, scopeKey, shells, workspaceRoot]);

  const CollapseIcon = props.chatCollapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;
  return (
    <nav
      aria-label="Agents in this worktree"
      className={cn("flex w-11 shrink-0 flex-col items-stretch gap-0.5 py-1", props.className)}
      data-worktree-agent-rail
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={props.chatCollapsed ? "Expand chat" : "Collapse chat"}
              onClick={props.onToggleChat}
              className="mx-1 flex h-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <CollapseIcon className="size-4" />
            </button>
          }
        />
        <TooltipPopup side="right">
          {props.chatCollapsed ? "Expand chat" : "Collapse chat"}
        </TooltipPopup>
      </Tooltip>
      <div className="mx-2 my-1 border-border border-t" />
      {agents.map((agent) => {
        const selected =
          !props.chatCollapsed && agent.ref.threadId === props.activeThreadRef.threadId;
        const hue = agentHue(agent.ref.threadId);
        return (
          <Tooltip key={agent.ref.threadId}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={agent.title}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => props.onSelectThread(agent.ref)}
                  className={cn(
                    "relative mx-1 flex h-9 cursor-pointer items-center justify-center rounded-md transition-colors",
                    !selected && "hover:bg-accent/60",
                  )}
                  style={
                    selected
                      ? { backgroundColor: `hsl(${hue} 70% 50%)`, color: "white" }
                      : { color: `hsl(${hue} 60% 55%)` }
                  }
                >
                  <UserIcon className="size-4" />
                  {agent.working && !selected ? (
                    <span
                      aria-hidden
                      className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary"
                    />
                  ) : null}
                </button>
              }
            />
            <TooltipPopup side="right">
              {agent.title}
              {agent.working ? " · working" : ""}
            </TooltipPopup>
          </Tooltip>
        );
      })}
      {props.onNewThread ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="New agent in this worktree"
                onClick={props.onNewThread}
                className="mx-1 mt-auto flex h-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <PlusIcon className="size-4" />
              </button>
            }
          />
          <TooltipPopup side="right">New agent in this worktree</TooltipPopup>
        </Tooltip>
      ) : null}
    </nav>
  );
}
