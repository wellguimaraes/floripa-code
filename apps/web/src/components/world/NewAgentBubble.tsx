import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { FolderGit2Icon, FolderGitIcon, FolderIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { BubbleComposer } from "./BubbleComposer";
import { HuePicker } from "./HuePicker";
import { useBubbleAttachments } from "./useBubbleAttachments";
import {
  useStartWorldAgent,
  useWorldAgentWorkspaces,
  type WorldAgentWorkspace,
} from "./useStartWorldAgent";

const workspaceValue = (workspace: WorldAgentWorkspace) =>
  workspace.kind === "worktree" ? `worktree:${workspace.path}` : workspace.kind;

/**
 * Starts an agent from an empty spot on an island. Enter sends the text as the
 * first message of a new thread in that project, with any attached, dropped,
 * or pasted files, using the defaults a fresh draft would; the chat stays closed.
 * In a repo it can work in the checkout, a new worktree, or an existing one.
 * The text box, files, voice and send live in BubbleComposer, shared by both bubbles.
 */
export function NewAgentBubble(props: {
  readonly islandName: string;
  readonly project: ScopedProjectRef;
  /** The family colour picked at first: one nobody on the island wears yet. */
  readonly suggestedHue: number;
  readonly onClose: () => void;
  readonly onTextChange: (text: string) => void;
  /** The thread exists and its first turn is starting. */
  readonly onStarted: (thread: {
    readonly key: string;
    readonly ref: ScopedThreadRef;
    readonly hue: number;
  }) => void;
}) {
  const { islandName, project, suggestedHue, onClose, onTextChange, onStarted } = props;
  const [hue, setHue] = useState(suggestedHue);
  const startAgent = useStartWorldAgent();
  const [text, setText] = useState("");
  const workspaces = useWorldAgentWorkspaces(project);
  // Null until picked: the project's default applies.
  const [workspace, setWorkspace] = useState<WorldAgentWorkspace | null>(null);
  const workspaceItems: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly workspace: WorldAgentWorkspace;
  }> = [
    { value: "local", label: "Current checkout", workspace: { kind: "local" } },
    { value: "new-worktree", label: "New worktree", workspace: { kind: "new-worktree" } },
    ...workspaces.worktrees.map((worktree) => {
      const item: WorldAgentWorkspace = { kind: "worktree", ...worktree };
      return { value: workspaceValue(item), label: worktree.branch, workspace: item };
    }),
  ];
  const selectedWorkspace = workspace ?? workspaces.defaultWorkspace;
  const attachments = useBubbleAttachments(project.environmentId);
  const [state, setState] = useState<
    { readonly phase: "idle" | "starting" } | { readonly phase: "error"; message: string }
  >({ phase: "idle" });
  const empty = text.trim() === "" && attachments.attachments.length === 0;

  // Errors from the composer (files, voice) share the status line with the bubble's own.
  const showError = (message: string | null) =>
    setState((current) =>
      message !== null
        ? { phase: "error", message }
        : current.phase === "error"
          ? { phase: "idle" }
          : current,
    );
  const changeText = (next: string) => {
    setText(next);
    onTextChange(next);
  };

  const start = async () => {
    if (state.phase === "starting" || attachments.preparing || empty) return;
    setState({ phase: "starting" });
    try {
      const outgoing = await attachments.prepareForSend();
      const threadId = await startAgent(
        project,
        text.trim(),
        outgoing,
        workspace,
        workspaces.worktreeBaseBranch,
      );
      attachments.sent();
      const ref = { environmentId: project.environmentId, threadId };
      onStarted({ key: scopedThreadKey(ref), ref, hue });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not start an agent here.",
      });
    }
  };

  return (
    <BubbleComposer
      environmentId={project.environmentId}
      attachments={attachments}
      text={text}
      onTextChange={changeText}
      onSubmit={() => void start()}
      onClose={onClose}
      placeholder="What should it work on?"
      inputLabel={`Task for a new agent on ${islandName}`}
      submitLabel="Start"
      speakLabel="Speak the task"
      hint="Enter to start"
      error={state.phase === "error" ? state.message : null}
      onError={showError}
      busy={state.phase === "starting"}
      busyStatus="Starting…"
      header={
        <>
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">New agent</span>
              <span className="truncate text-xs text-muted-foreground">on {islandName}</span>
            </div>
            <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
              <XIcon />
            </Button>
          </div>
          {workspaces.isRepo ? (
            <Select
              modal={false}
              value={workspaceValue(selectedWorkspace)}
              items={workspaceItems}
              disabled={state.phase === "starting"}
              onValueChange={(value: string | null) => {
                const item = workspaceItems.find((candidate) => candidate.value === value);
                if (item !== undefined) setWorkspace(item.workspace);
              }}
            >
              <SelectTrigger size="xs" aria-label="Workspace">
                {selectedWorkspace.kind === "new-worktree" ? (
                  <FolderGit2Icon />
                ) : selectedWorkspace.kind === "worktree" ? (
                  <FolderGitIcon />
                ) : (
                  <FolderIcon />
                )}
                <SelectValue />
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {workspaceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      {item.workspace.kind === "new-worktree" ? (
                        <FolderGit2Icon className="size-3" />
                      ) : item.workspace.kind === "worktree" ? (
                        <FolderGitIcon className="size-3" />
                      ) : (
                        <FolderIcon className="size-3" />
                      )}
                      <span className="truncate">{item.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
        </>
      }
    >
      <HuePicker hue={hue} onChange={setHue} />
    </BubbleComposer>
  );
}
