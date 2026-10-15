import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  ManagerCheckout,
  ManagerRoute,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { BotIcon, XIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn, newMessageId } from "../../lib/utils";
import { formatElapsedDurationLabel } from "../../timestampFormat";
import { readThreadShell, useProject } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { BubbleComposer } from "./BubbleComposer";
import { BubbleMarkdown } from "./BubbleMarkdown";
import { palette } from "./scene/palette";
import { WorkspaceIcon } from "./NewAgentWorkspacePicker";
import { useBubbleAttachments } from "./useBubbleAttachments";
import {
  useStartWorldAgent,
  useWorldAgentSetup,
  useWorldAgentWorkspaces,
  type WorldAgentWorkspace,
} from "./useStartWorldAgent";

/** A checkout guess this strong only asks for a yes. */
const SURE_CHECKOUT = 0.85;
/** Below this, a new agent in the checkout beats guessing which one there. */
const SURE_AGENT = 0.5;

/** An agent on the island the manager can forward to. */
export interface ManagerAgentCandidate {
  readonly key: string;
  readonly ref: ScopedThreadRef;
  readonly title: string;
  readonly worktreePath: string | null;
  /** When it last replied; a working agent is active now. */
  readonly lastReplyAt: string;
  readonly working: boolean;
}

interface Destination {
  readonly workspace: WorldAgentWorkspace;
  /** Null starts a new agent there. */
  readonly agent: ManagerAgentCandidate | null;
}

type State =
  | { readonly phase: "compose" }
  | { readonly phase: "thinking" }
  | { readonly phase: "confirm"; readonly route: ManagerRoute; readonly pick: Destination }
  | { readonly phase: "choose"; readonly route: ManagerRoute }
  | {
      readonly phase: "sending";
      readonly route: ManagerRoute;
      readonly pick: Destination;
      /** The step to go back to if sending fails. */
      readonly from: "confirm" | "choose";
    }
  | { readonly phase: "sent"; readonly pick: Destination; readonly ref: ScopedThreadRef };

/** What the manager shows on the island: thinking, or a question balloon. */
export type ManagerStatus = "idle" | "thinking" | "asking";

/**
 * Talking to an island's manager. He guesses which checkout the message's work
 * belongs in and which agent there should get it (see the server's
 * ManagerRouter), then asks: a strong guess as yes or no, otherwise every
 * checkout and agent to pick from, with a new worktree last. Nothing is sent
 * before you answer.
 */
export function ManagerBubble(props: {
  readonly islandName: string;
  readonly project: ScopedProjectRef;
  readonly agents: ReadonlyArray<ManagerAgentCandidate>;
  /** The colour a new agent wears: one nobody on the island wears yet. */
  readonly suggestedHue: number;
  readonly onStatus: (status: ManagerStatus) => void;
  /** Hides the popover; a question he is waiting on stays (see WorldCanvas). */
  readonly onClose: () => void;
  /** Drops the message and his question, and closes. */
  readonly onCancel: () => void;
  /** He calls the message over: to that agent, or null for a new one. */
  readonly onCall: (agentKey: string | null) => void;
  /** A new agent's thread exists and its first turn is starting. */
  readonly onStarted: (thread: {
    readonly key: string;
    readonly ref: ScopedThreadRef;
    readonly hue: number;
  }) => void;
  readonly onOpenChat: (ref: ScopedThreadRef) => void;
}) {
  const {
    islandName,
    project,
    agents,
    suggestedHue,
    onStatus,
    onClose,
    onCancel,
    onCall,
    onStarted,
    onOpenChat,
  } = props;
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ phase: "compose" });
  const [error, setError] = useState<string | null>(null);
  const attachments = useBubbleAttachments(project.environmentId);
  const workspaces = useWorldAgentWorkspaces(project);
  const setup = useWorldAgentSetup(project);
  const workspaceRoot = useProject(project)?.workspaceRoot ?? null;
  const route = useAtomCommand(serverEnvironment.routeManagerMessage, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const startAgent = useStartWorldAgent();

  const { phase } = state;
  useEffect(() => {
    onStatus(
      phase === "thinking"
        ? "thinking"
        : phase === "confirm" || phase === "choose"
          ? "asking"
          : "idle",
    );
  }, [phase, onStatus]);
  useEffect(() => () => onStatus("idle"), [onStatus]);

  const branchOf = (path: string) =>
    workspaces.worktrees.find((worktree) => worktree.path === path)?.branch ??
    agents.map((agent) => readThreadShell(agent.ref)).find((shell) => shell?.worktreePath === path)
      ?.branch ??
    path.split(/[\\/]/).findLast((part) => part !== "") ??
    path;
  const workspaceOf = (checkout: ManagerCheckout): WorldAgentWorkspace =>
    checkout.kind === "worktree"
      ? { kind: "worktree", path: checkout.path, branch: branchOf(checkout.path) }
      : checkout;
  const agentsIn = (workspace: WorldAgentWorkspace, guess: ManagerRoute) => {
    const odds = new Map(guess.agents.map((agent) => [agent.threadId, agent.probability]));
    return agents
      .filter((agent) =>
        workspace.kind === "local"
          ? agent.worktreePath === null
          : workspace.kind === "worktree" && agent.worktreePath === workspace.path,
      )
      .map((agent) => ({ agent, probability: odds.get(agent.ref.threadId) ?? 0 }))
      .toSorted((a, b) => b.probability - a.probability);
  };
  const bestIn = (workspace: WorldAgentWorkspace, guess: ManagerRoute): Destination => {
    const top = agentsIn(workspace, guess)[0];
    return {
      workspace,
      agent: top !== undefined && top.probability >= SURE_AGENT ? top.agent : null,
    };
  };
  // A new worktree needs a repo to branch from.
  const checkoutsOf = (guess: ManagerRoute) =>
    guess.checkouts.filter(
      (candidate) => candidate.checkout.kind !== "new-worktree" || workspaces.isRepo,
    );

  const ask = async () => {
    const message = text.trim();
    if (message === "" || phase === "thinking") return;
    setError(null);
    setState({ phase: "thinking" });
    const result = await route({
      environmentId: project.environmentId,
      input: {
        threadIds: agents.slice(0, 24).map((agent) => agent.ref.threadId),
        mainBranch: workspaces.mainBranch,
        worktrees: workspaces.worktrees.slice(0, 24),
        message,
      },
    });
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error && failure.message !== ""
          ? failure.message
          : "The manager couldn't decide.",
      );
      setState({ phase: "compose" });
      return;
    }
    const guess = result.value;
    const top = checkoutsOf(guess)[0];
    setState(
      top !== undefined && top.probability >= SURE_CHECKOUT
        ? { phase: "confirm", route: guess, pick: bestIn(workspaceOf(top.checkout), guess) }
        : { phase: "choose", route: guess },
    );
  };

  const send = async (guess: ManagerRoute, pick: Destination, from: "confirm" | "choose") => {
    setError(null);
    setState({ phase: "sending", route: guess, pick, from });
    onCall(pick.agent?.key ?? null);
    try {
      const outgoing = await attachments.prepareForSend();
      let ref: ScopedThreadRef;
      if (pick.agent !== null) {
        const shell = readThreadShell(pick.agent.ref);
        if (shell === null) throw new Error("That agent is no longer here.");
        const result = await startTurn({
          environmentId: pick.agent.ref.environmentId,
          input: {
            threadId: pick.agent.ref.threadId,
            message: {
              messageId: newMessageId(),
              role: "user",
              text: text.trim(),
              attachments: outgoing,
            },
            runtimeMode: shell.runtimeMode,
            interactionMode: shell.interactionMode,
            // Never interrupts a running turn: the message waits for it to end.
            dispatchMode: "queue",
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        ref = pick.agent.ref;
      } else {
        const threadId = await startAgent(
          project,
          text.trim(),
          outgoing,
          pick.workspace,
          workspaces.worktreeBaseBranch,
          setup,
        );
        ref = { environmentId: project.environmentId, threadId };
        onStarted({ key: scopedThreadKey(ref), ref, hue: suggestedHue });
      }
      attachments.sent();
      // A message to an agent already there needs no receipt; a new one gets the way to its chat.
      if (pick.agent !== null) onClose();
      else setState({ phase: "sent", pick, ref });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not send the message.");
      setState(
        from === "confirm"
          ? { phase: "confirm", route: guess, pick }
          : { phase: "choose", route: guess },
      );
    }
  };

  const checkoutLabel = (workspace: WorldAgentWorkspace) =>
    workspace.kind === "local"
      ? "Main worktree"
      : workspace.kind === "worktree"
        ? workspace.branch
        : "a new worktree";
  // Ruled off below, edge to edge, like the character bubble's header.
  const header = (subtitle: string, title = "Manager") => (
    <div className="-mx-2.5 flex items-start gap-2 border-b border-border px-2.5 pb-2">
      <BotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );

  if (state.phase === "compose" || state.phase === "thinking")
    return (
      <BubbleComposer
        environmentId={project.environmentId}
        cwd={workspaceRoot}
        provider={null}
        // Commands belong to an agent's provider, and who gets the message isn't known yet.
        commands={false}
        attachments={attachments}
        text={text}
        onTextChange={setText}
        onSubmit={() => void ask()}
        onClose={onClose}
        narrow
        placeholder="Ask me anything"
        inputLabel={`Message the manager of ${islandName}`}
        submitLabel="Ask"
        speakLabel="Speak to the manager"
        error={error}
        onError={setError}
        busy={phase === "thinking"}
        busyStatus="Thinking…"
        submitBlocked={text.trim() === ""}
        header={header("I'll redirect your request to the right agent", "Ask the Manager")}
      />
    );

  if (state.phase === "sent") {
    const { pick, ref } = state;
    return (
      <ManagerPanel onClose={onClose}>
        {header(`${islandName} · sent`)}
        <p className="text-sm">
          {pick.agent !== null ? (
            <>
              Sent to <strong>{pick.agent.title}</strong>
            </>
          ) : (
            "Started a new agent"
          )}{" "}
          on <strong>{checkoutLabel(pick.workspace)}</strong>.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setText("");
              setState({ phase: "compose" });
            }}
          >
            New message
          </Button>
          <Button size="sm" autoFocus onClick={() => onOpenChat(ref)}>
            Open chat
          </Button>
        </div>
      </ManagerPanel>
    );
  }

  const guess = state.route;
  const sending = state.phase === "sending";
  // Your message, as the character bubble shows the last one you sent.
  const quote = (
    <div
      className="ml-auto max-w-[85%] rounded-lg px-3 py-2 break-words"
      // Light in every app theme, so the text stays dark on them.
      style={{ backgroundColor: palette.bubbleSent, color: palette.bubbleText }}
      aria-label="Your message"
    >
      {/* Clamped on an inner span, so a third line can't peek through the padding. */}
      <span className="line-clamp-2">
        <BubbleMarkdown text={text.trim()} />
      </span>
    </div>
  );
  const status =
    error !== null ? (
      <span className="text-xs text-destructive-foreground">{error}</span>
    ) : sending ? (
      <span className="text-xs text-muted-foreground">Sending…</span>
    ) : null;

  if (state.phase === "confirm" || (state.phase === "sending" && state.from === "confirm")) {
    const pick = state.pick;
    return (
      <ManagerPanel onClose={onClose}>
        {header(`${islandName} · is this right?`)}
        {/* Spaced like the character bubble's thread: yours on the right, his question on the left. */}
        <div className="my-1 flex flex-col gap-2 text-xs">
          {quote}
          <p
            className="mr-auto max-w-[85%] rounded-lg px-3 py-2 break-words"
            style={{ backgroundColor: palette.bubbleReply, color: palette.bubbleText }}
          >
            {pick.agent !== null ? (
              <>
                Send to <strong>{pick.agent.title}</strong>
              </>
            ) : (
              "Start a new agent"
            )}{" "}
            on <strong>{checkoutLabel(pick.workspace)}</strong>?
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          {status}
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={sending}
            onClick={() => setState({ phase: "choose", route: guess })}
          >
            No
          </Button>
          <Button
            size="sm"
            autoFocus
            disabled={sending}
            onClick={() => void send(guess, pick, "confirm")}
          >
            Yes
          </Button>
        </div>
      </ManagerPanel>
    );
  }

  // New ones side by side on top: a new agent in the likeliest existing checkout,
  // and a new worktree. Then every agent, likeliest first: its checkout's odds times its own.
  const checkouts = checkoutsOf(guess);
  const oddsOf = (workspace: WorldAgentWorkspace) =>
    checkouts.find(({ checkout }) => sameCheckout(workspaceOf(checkout), workspace))?.probability ??
    0;
  const topExisting = checkouts.find(({ checkout }) => checkout.kind !== "new-worktree");
  const newWorktree = checkouts.find(({ checkout }) => checkout.kind === "new-worktree");
  const options = [
    ...(topExisting === undefined
      ? []
      : [
          {
            value: "new-agent",
            row: 0,
            workspace: workspaceOf(topExisting.checkout),
            label: "New agent",
            detail: checkoutLabel(workspaceOf(topExisting.checkout)),
            score: topExisting.probability * guess.newAgentProbability,
            destination: { workspace: workspaceOf(topExisting.checkout), agent: null },
          },
        ]),
    ...(newWorktree === undefined
      ? []
      : [
          {
            value: "new-worktree",
            row: 0,
            workspace: { kind: "new-worktree" } as const,
            label: "New worktree",
            detail:
              workspaces.worktreeBaseBranch === null
                ? "From the default branch"
                : `From ${workspaces.worktreeBaseBranch}`,
            score: newWorktree.probability,
            destination: { workspace: { kind: "new-worktree" } as const, agent: null },
          },
        ]),
    ...checkouts
      .flatMap(({ checkout }) => {
        const workspace = workspaceOf(checkout);
        return workspace.kind === "new-worktree"
          ? []
          : agentsIn(workspace, guess).map(({ agent, probability }) => ({
              value: `agent:${agent.key}`,
              workspace,
              label: agent.title,
              detail: checkoutLabel(workspace),
              active: agent.working
                ? "now"
                : formatElapsedDurationLabel(agent.lastReplyAt).replace("just now", "now"),
              score: oddsOf(workspace) * probability,
              destination: { workspace, agent },
            }));
      })
      .toSorted((a, b) => b.score - a.score)
      .map((option, index) => ({ ...option, row: index + 1 })),
  ];
  const likeliest = options.toSorted((a, b) => b.score - a.score)[0];
  return (
    <ManagerPanel onClose={onClose}>
      {header(`${islandName} · where should this go?`)}
      <div className="my-1 flex flex-col text-xs">{quote}</div>
      <DestinationGrid
        options={options.map((option) => ({
          value: option.value,
          row: option.row,
          icon: (
            <WorkspaceIcon workspace={option.workspace} className="size-4 shrink-0 opacity-70" />
          ),
          label: option.label,
          detail: option.detail,
          active: "active" in option ? option.active : undefined,
        }))}
        defaultValue={likeliest?.value}
        disabled={sending}
        onPick={(value) => {
          const option = options.find((candidate) => candidate.value === value);
          if (option !== undefined) void send(guess, option.destination, "choose");
        }}
      />
      <div className="flex items-center justify-end gap-2">
        {status}
        <span className="flex-1" />
        <Button variant="outline" size="sm" disabled={sending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </ManagerPanel>
  );
}

function sameCheckout(a: WorldAgentWorkspace, b: WorldAgentWorkspace) {
  return a.kind === "worktree" && b.kind === "worktree" ? a.path === b.path : a.kind === b.kind;
}

/** The popover's frame for the steps after the composer; Escape closes it. */
function ManagerPanel(props: { readonly onClose: () => void; readonly children: ReactNode }) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    // Handled here, so the world's own Escape (closing the chat panel) leaves it alone.
    event.stopPropagation();
    props.onClose();
  };
  return (
    <div
      tabIndex={-1}
      className="flex w-96 flex-col gap-2.5 rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-lg outline-none"
      onKeyDown={onKeyDown}
    >
      {props.children}
    </div>
  );
}

/**
 * Options in rows, two side by side on the first. The arrow keys move between
 * them (up and down by row, left and right along one), Enter or a click picks.
 */
function DestinationGrid(props: {
  readonly options: ReadonlyArray<{
    readonly value: string;
    readonly row: number;
    readonly icon: ReactNode;
    readonly label: string;
    readonly detail: string;
    /** How long ago it was last active, e.g. "5m". */
    readonly active?: string | undefined;
  }>;
  /** Marked first, e.g. the likeliest option. */
  readonly defaultValue: string | undefined;
  readonly disabled: boolean;
  readonly onPick: (value: string) => void;
}) {
  const { options, defaultValue, disabled, onPick } = props;
  const rows = [
    options.filter((option) => option.row === 0),
    ...options
      .filter((option) => option.row > 0)
      .toSorted((a, b) => a.row - b.row)
      .map((option) => [option]),
  ].filter((row) => row.length > 0);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [active, setActive] = useState(defaultValue ?? options[0]?.value);
  useLayoutEffect(() => {
    if (active !== undefined) buttons.current.get(active)?.focus();
  }, [active]);
  const onKeyDown = (event: KeyboardEvent) => {
    const rowIndex = rows.findIndex((row) => row.some((option) => option.value === active));
    const column = rows[rowIndex]?.findIndex((option) => option.value === active) ?? 0;
    const [down, right] =
      event.key === "ArrowDown"
        ? [1, 0]
        : event.key === "ArrowUp"
          ? [-1, 0]
          : event.key === "ArrowRight"
            ? [0, 1]
            : event.key === "ArrowLeft"
              ? [0, -1]
              : [0, 0];
    if (down === 0 && right === 0) return;
    event.preventDefault();
    const row = rows[rowIndex + down];
    if (row === undefined) return;
    const next = row[Math.min(column + right, row.length - 1)];
    if (next !== undefined && column + right >= 0) setActive(next.value);
  };
  const button = (option: (typeof options)[number], tile: boolean) => (
    <button
      key={option.value}
      ref={(element) => {
        if (element === null) buttons.current.delete(option.value);
        else buttons.current.set(option.value, element);
      }}
      type="button"
      disabled={disabled}
      tabIndex={option.value === active ? 0 : -1}
      onClick={() => onPick(option.value)}
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg border border-border px-3 text-left",
        "bg-muted/40 outline-none transition-colors hover:bg-accent disabled:opacity-60",
        tile ? "h-14" : "h-11",
        option.value === active && "border-primary bg-accent ring-2 ring-primary/40",
      )}
    >
      {option.icon}
      {tile ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{option.label}</span>
          <span className="truncate text-xs text-muted-foreground">{option.detail}</span>
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</span>
          <span className="max-w-1/2 shrink-0 truncate text-xs text-muted-foreground">
            {option.detail}
          </span>
          {option.active !== undefined && option.active !== "" ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums opacity-70">
              {option.active}
            </span>
          ) : null}
        </>
      )}
    </button>
  );
  return (
    <div className="-m-1 flex max-h-80 flex-col gap-1.5 overflow-y-auto p-1" onKeyDown={onKeyDown}>
      {rows.map((row) =>
        row.length > 1 ? (
          <div key={row[0]!.value} className="grid grid-cols-2 gap-1.5">
            {row.map((option) => button(option, true))}
          </div>
        ) : (
          button(row[0]!, row[0]!.row === 0)
        ),
      )}
    </div>
  );
}
