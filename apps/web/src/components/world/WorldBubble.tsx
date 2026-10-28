import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { resolveProviderSkillsForCwd } from "@t3tools/client-runtime/providerSkills";
import { presentPendingBackgroundWork } from "@t3tools/client-runtime/state/thread-execution";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import type { ScopedThreadRef, ServerProvider, TimestampFormat } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  ArchiveIcon,
  ChevronDownIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { formatShortcutLabel } from "../../keybindings";
import { observeResize } from "../../lib/observeResize";
import { cn, newMessageId } from "../../lib/utils";
import {
  readEnvironmentSupportsTitleRegeneration,
  useProject,
  useServerConfigs,
  useThreadProjection,
  useThreadShell,
} from "../../state/entities";
import { derivePendingApprovals, derivePendingUserInputs } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { threadEnvironment } from "../../state/threads";
import { useTheme } from "../../hooks/useTheme";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  PrStatusTooltipContent,
  prStatusIndicator,
  useLinkedThreadPullRequest,
} from "../ThreadStatusIndicators";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "../chat/composerPromptHistory";
import { ComposerBanner } from "../chat/ComposerBanner";
import {
  ClampedUserMessage,
  type UserMessageChipState,
  UserMessageActions,
} from "../chat/MessagesTimeline";
import { ComposerPendingUserInputPanel } from "../chat/ComposerPendingUserInputPanel";
import { QueuedRunsControl } from "../chat/QueuedRunsControl";
import { BubbleApproval } from "./BubbleApproval";
import { BubbleComposer } from "./BubbleComposer";
import type { CharacterFacts } from "./engine/facts";
import { HuePicker } from "./HuePicker";
import { type FamilyShades as Shades, palette } from "./scene/palette";
import { useBubbleAttachments } from "./useBubbleAttachments";
import { useBubbleQuestion } from "./useBubbleQuestion";
import { ARCHIVE_SHORTCUT, confirmArchive, useArchiveShortcut } from "./useArchiveShortcut";
import { LatestTurn } from "./LatestTurn";
import { RollingSwap } from "./RollingSwap";
import { useLastExchange } from "./useLastExchange";
import { worktreeLabel } from "./worktreeLabel";

/**
 * Whether the character's thread has a run to stop: working, waiting on you,
 * or still running something in the background. Subagents stop with their parent.
 */
export function isStoppable(facts: CharacterFacts): boolean {
  if (facts.kid) return false;
  if (facts.status === "waiting") return facts.backgroundTask || facts.hasWorkingKids;
  return ["working", "approval", "input"].includes(facts.status);
}

const EMPTY_SKILLS: UserMessageChipState["skills"] = [];
const EMPTY_PROVIDERS: ReadonlyArray<ServerProvider> = [];
const NOOP = () => {};

const NO_MODIFIERS = {
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: false,
};
// Handled by the composer's Enter key.
const EXPAND_SHORTCUT = formatShortcutLabel({ ...NO_MODIFIERS, key: "enter", modKey: true });

/**
 * A quick reply box beside a character: send a message without leaving the
 * world, or expand into the full chat with whatever was typed so far.
 * The text box, files, voice and send live in BubbleComposer, shared by both bubbles.
 */
export function WorldBubble(props: {
  readonly facts: CharacterFacts;
  readonly onClose: () => void;
  readonly onExpand: () => void;
  /** The thread was archived; the world plays the character's exit. */
  readonly onArchived: () => void;
  /** Start listening at once and send what was said: a voice command. */
  readonly listen?: boolean;
  /** The family colour the character wears now. */
  readonly hue: number;
  /** Repaint the character's family: it and its subagents (or its parent and siblings). */
  readonly onHueChange: (hue: number) => void;
}) {
  const { facts, onClose, onExpand, onArchived, listen = false, hue, onHueChange } = props;
  const { archiveThread } = useThreadActions();
  const thread = useThreadShell(facts.ref);
  const project = useProject(
    thread === null ? null : { environmentId: thread.environmentId, projectId: thread.projectId },
  );
  // Suggestions come from where the thread works and the provider it talks to.
  const providers = useServerConfigs().get(facts.ref.environmentId)?.providers;
  const provider =
    providers?.find((candidate) => candidate.instanceId === thread?.modelSelection.instanceId) ??
    null;
  const { sent: lastSent } = useLastExchange(facts.ref);
  const timestampFormat = useEnvironmentSettings(
    facts.ref.environmentId,
    (settings) => settings.timestampFormat,
  );
  const lastSentForPin = useMemo(
    () =>
      lastSent === null ? null : { ...lastSent, createdAt: DateTime.formatIso(lastSent.createdAt) },
    [lastSent],
  );
  // The exchange opens scrolled to its end, where the latest words are, and follows the agent's
  // work as it grows unless you scrolled up to read.
  const exchange = useRef<HTMLDivElement>(null);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const exchangeContent = useRef<HTMLDivElement>(null);
  const followingEnd = useRef(true);
  // Scrolled up away from the latest words: offers a way back down.
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const { resolvedTheme } = useTheme();
  // Both messages render as the chat does, chips and skills included.
  const cwd = thread?.worktreePath ?? project?.workspaceRoot ?? null;
  const skills = useMemo(
    () => (provider === null ? EMPTY_SKILLS : resolveProviderSkillsForCwd(provider, cwd)),
    [provider, cwd],
  );
  const chips = useMemo<UserMessageChipState>(
    () => ({
      threadRef: facts.ref,
      markdownCwd: cwd ?? undefined,
      resolvedTheme,
      workspaceRoot: project?.workspaceRoot,
      skills,
      activeThreadEnvironmentId: facts.ref.environmentId,
      // The sent message's chips are labels only.
      openPullRequest: NOOP,
      onImageExpand: NOOP,
    }),
    [facts.ref, cwd, resolvedTheme, project?.workspaceRoot, skills],
  );
  useLayoutEffect(() => {
    const element = exchange.current;
    const content = exchangeContent.current;
    if (element === null || content === null) return;
    const toEnd = () => {
      if (followingEnd.current) element.scrollTop = element.scrollHeight;
    };
    toEnd();
    return observeResize(content, toEnd);
  }, []);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  // Work that outlives the turn (dev servers, watch loops, subagents), as the chat shows it once
  // the turn settles.
  const backgroundWork = useMemo(
    () =>
      facts.status === "working" || thread === null
        ? null
        : presentPendingBackgroundWork(thread.pendingBackgroundTasks),
    [facts.status, thread],
  );
  const regeneratingTitle = thread?.titleRegeneration != null;
  const worktree = thread === null ? null : worktreeLabel(thread);
  // The thread's pull request, resolved as the sidebar does.
  const pullRequest = useLinkedThreadPullRequest(
    facts.ref.environmentId,
    thread?.linkedPullRequest,
    thread !== null,
    thread?.pullRequests,
    thread?.branchPullRequest,
  );
  const pr = pullRequest?.pr ?? null;
  const prStatus = prStatusIndicator(pr, pullRequest?.sourceControlProvider);
  const [pickingHue, setPickingHue] = useState(false);
  // The thread's composer draft, shared with the chat panel: what you type in either shows in both.
  const draftTarget = useMemo(
    () => scopeThreadRef(facts.ref.environmentId, facts.ref.threadId),
    [facts.ref.environmentId, facts.ref.threadId],
  );
  const text = useComposerDraftStore((store) => store.getComposerDraft(draftTarget)?.prompt ?? "");
  const setText = (next: string) => useComposerDraftStore.getState().setPrompt(draftTarget, next);
  const attachments = useBubbleAttachments(facts.ref.environmentId, draftTarget);
  const [state, setState] = useState<
    | { readonly phase: "idle" | "sending" | "stopping" | "archiving" }
    | { readonly phase: "error"; message: string }
  >({ phase: "idle" });

  // Errors from the composer (files, voice) share the status line with the bubble's own.
  const showError = (message: string | null) =>
    setState((current) =>
      message !== null
        ? { phase: "error", message }
        : current.phase === "error"
          ? { phase: "idle" }
          : current,
    );

  // What the agent waits on you for, oldest first. An approval comes before a question, as in
  // the chat.
  const projection = useThreadProjection(facts.ref)?.projection ?? null;
  const pending = useMemo(() => {
    if (projection === null) return null;
    const requests = derivePendingThreadRequests(projection);
    return {
      approvals: derivePendingApprovals(requests.approvals),
      question: derivePendingUserInputs(requests.userInputs)[0] ?? null,
    };
  }, [projection]);
  const approval = pending?.approvals[0] ?? null;
  // The agent's open question takes the text box: what you send answers it. One that can no
  // longer be answered stays on show, and the box sends messages again.
  const question = useBubbleQuestion(
    facts.ref,
    approval === null ? (pending?.question ?? null) : null,
    showError,
  );
  const asking = question.request !== null && question.answerable;

  const send = async (said: string) => {
    if (asking) {
      if (question.answer(said)) setText("");
      return;
    }
    const message = said.trim();
    const hasAttachments = attachments.attachments.length > 0;
    if (message === "" && !hasAttachments) return;
    if (thread === null || state.phase === "sending" || attachments.preparing) return;
    setState({ phase: "sending" });
    let outgoing;
    try {
      outgoing = await attachments.prepareForSend(message);
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not attach the files.",
      });
      return;
    }
    const result = await startTurn({
      environmentId: facts.ref.environmentId,
      input: {
        threadId: facts.ref.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: outgoing.text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
          attachments: [...outgoing.attachments],
          ...(outgoing.context !== undefined ? { context: outgoing.context } : {}),
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        // Never interrupts a running turn: the message waits for it to end.
        dispatchMode: "queue",
      },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not send the message.",
      });
      return;
    }
    // Sent: the bubble stays for the next message, and the shared draft is empty again.
    attachments.sent();
    setState({ phase: "idle" });
  };

  const stop = async () => {
    if (state.phase === "stopping") return;
    setState({ phase: "stopping" });
    const result = await interruptTurn({
      environmentId: facts.ref.environmentId,
      input: { threadId: facts.ref.threadId },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not stop the run.",
      });
      return;
    }
    setState({ phase: "idle" });
  };

  // The new title arrives on the thread shell; until then the button spins.
  const regenerateTitle = async () => {
    if (regeneratingTitle) return;
    const result = await updateMetadata({
      environmentId: facts.ref.environmentId,
      input: { threadId: facts.ref.threadId, regenerateTitle: true },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not regenerate the title.",
      });
    }
  };

  // Archive, not delete: it can be undone from the toast or Settings → Archived.
  const archive = async () => {
    if (state.phase === "archiving") return;
    if (!(await confirmArchive(archiveButton.current))) return;
    setState({ phase: "archiving" });
    const result = await archiveThread(facts.ref);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setState({
        phase: "error",
        message:
          error instanceof Error && error.message !== "" ? error.message : "Could not archive.",
      });
      return;
    }
    onArchived();
  };

  useArchiveShortcut(archive);

  // The draft is the chat's own, so the full chat opens with it as it stands.
  const expand = onExpand;

  return (
    <BubbleComposer
      environmentId={facts.ref.environmentId}
      cwd={cwd}
      provider={provider}
      attachments={attachments}
      text={text}
      onTextChange={setText}
      onSubmit={(said) => void send(said)}
      onExpand={expand}
      onClose={onClose}
      placeholder={
        !asking
          ? "Message this agent"
          : question.takesText
            ? "Type your own answer"
            : "Pick an answer above"
      }
      inputLabel={
        asking ? `Answer ${facts.title || "this agent"}` : `Message ${facts.title || "this agent"}`
      }
      submitLabel={
        !asking ? "Send" : question.progress?.isLastQuestion ? "Answer" : "Next question"
      }
      speakLabel={asking ? "Speak an answer" : "Speak a message"}
      hint={
        <>
          <Kbd variant="outline">Enter</Kbd> to {asking ? "answer" : "send"}
          <span className="mx-2">·</span>
          <Kbd variant="outline">{EXPAND_SHORTCUT}</Kbd> to open full chat
        </>
      }
      error={state.phase === "error" ? state.message : null}
      onError={showError}
      busy={state.phase === "sending" || question.responding}
      busyStatus={
        state.phase === "sending" && attachments.attachments.length > 0 ? "Uploading…" : null
      }
      {...(isStoppable(facts) ? { onStop: () => void stop() } : {})}
      notice={state.phase === "stopping" ? "Stopping…" : null}
      submitBlocked={
        thread === null ||
        (asking && !question.progress?.canAdvance && !(question.takesText && text.trim() !== ""))
      }
      submitReady={asking && question.progress?.canAdvance === true}
      listenOnOpen={listen}
      header={
        <>
          <div className="-mx-2.5 flex items-center gap-2 border-b border-border px-2.5 pb-2">
            {/* Subagents share the family colour, so a kid repaints its parent and siblings too. */}
            <Popover open={pickingHue} onOpenChange={setPickingHue}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label="Change color"
                    title="Change color"
                  />
                }
              >
                <FamilyShades shades={palette.families[hue]} />
              </PopoverTrigger>
              <PopoverPopup side="bottom" align="start" padding="compact">
                <HuePicker
                  hue={hue}
                  onChange={(picked) => {
                    onHueChange(picked);
                    setPickingHue(false);
                  }}
                  label={facts.kid ? "Color of this agent's family" : "Agent color"}
                />
              </PopoverPopup>
            </Popover>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-medium", regeneratingTitle && "opacity-55")}>
                {facts.title || "Untitled thread"}
              </p>
              {worktree !== null ? (
                <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                  <span className="truncate">{worktree}</span>
                  {pr !== null && prStatus !== null ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              "flex shrink-0 items-center gap-1 tabular-nums hover:underline",
                              prStatus.colorClass,
                            )}
                          >
                            <prStatus.Icon className="size-3.5" />#{pr.number}
                          </a>
                        }
                      />
                      <TooltipPopup>
                        <PrStatusTooltipContent status={prStatus} />
                      </TooltipPopup>
                    </Tooltip>
                  ) : null}
                </p>
              ) : null}
            </div>
            {readEnvironmentSupportsTitleRegeneration(facts.ref.environmentId) ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={regeneratingTitle ? "Regenerating title" : "Regenerate title"}
                title={regeneratingTitle ? "Regenerating title…" : "Regenerate title"}
                disabled={regeneratingTitle}
                onClick={() => void regenerateTitle()}
              >
                <RefreshCwIcon className={cn(regeneratingTitle && "animate-spin")} />
              </Button>
            ) : null}
            {isStoppable(facts) ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Stop this run"
                title="Stop this run"
                disabled={state.phase === "stopping"}
                onClick={() => void stop()}
              >
                <SquareIcon className="fill-destructive text-destructive" />
              </Button>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    ref={archiveButton}
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Archive this thread"
                    aria-keyshortcuts="Alt+A"
                    disabled={state.phase === "archiving"}
                    onClick={() => void archive()}
                  />
                }
              >
                <ArchiveIcon />
              </TooltipTrigger>
              <TooltipPopup side="top">
                <span className="flex items-center gap-2">
                  Archive this thread <Kbd>{ARCHIVE_SHORTCUT}</Kbd>
                </span>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Open full chat"
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                    onClick={expand}
                  />
                }
              >
                <MessagesSquareIcon />
              </TooltipTrigger>
              <TooltipPopup side="top">
                <span className="flex items-center gap-2">
                  Open full chat <Kbd>{EXPAND_SHORTCUT}</Kbd>
                </span>
              </TooltipPopup>
            </Tooltip>
            <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
              <XIcon />
            </Button>
          </div>
          {/* The last exchange as the chat shows it: yours in a bubble on the right, then everything
              the agent did after it, with a few earlier exchanges above that load further as you
              scroll up. Capped in height: the turn scrolls under your message, which stays pinned on
              top. Ruled off below, edge to edge, like the header; gone while empty. */}
          <div className="relative">
            <div
              ref={exchange}
              onScroll={(event) => {
                const element = event.currentTarget;
                // A pin heads its exchange's box: it sticks once that box starts above the top,
                // and what scrolls under it fades. All reads before any writes, for one layout.
                const top = element.getBoundingClientRect().top;
                const pins = [...element.querySelectorAll<HTMLElement>("[data-exchange-pin]")];
                const stuck = pins.map(
                  (pin) => (pin.parentElement?.getBoundingClientRect().top ?? top) < top,
                );
                pins.forEach((pin, index) => pin.toggleAttribute("data-stuck", stuck[index]));
                followingEnd.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 4;
                setAwayFromEnd(!followingEnd.current);
              }}
              className="-mx-2.5 mt-1 max-h-80 overflow-y-auto border-b border-border px-2.5 pb-2.5 text-bubble has-[>[data-exchange]:empty]:hidden"
            >
              <div ref={exchangeContent} data-exchange className="flex min-w-0 flex-col gap-2">
                <LatestTurn
                  threadRef={facts.ref}
                  sentMessageId={lastSent?.id ?? null}
                  awaitingUser={facts.status === "approval" || facts.status === "input"}
                  cwd={cwd}
                  workspaceRoot={project?.workspaceRoot}
                  resolvedTheme={resolvedTheme}
                  skills={skills}
                  providers={providers ?? EMPTY_PROVIDERS}
                  onOpenFullChat={expand}
                  scrollRef={exchange}
                  pinned={
                    lastSentForPin !== null ? (
                      <ExchangePin
                        message={lastSentForPin}
                        chips={chips}
                        threadRef={facts.ref}
                        timestampFormat={timestampFormat}
                      />
                    ) : null
                  }
                  renderPin={(message) => (
                    <ExchangePin
                      message={message}
                      chips={chips}
                      threadRef={facts.ref}
                      timestampFormat={timestampFormat}
                    />
                  )}
                />
              </div>
            </div>
            {awayFromEnd ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-2.5 z-20 flex justify-center">
                <Button
                  aria-label="Scroll to end"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const element = exchange.current;
                    if (element === null) return;
                    followingEnd.current = true;
                    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
                  }}
                  className="pointer-events-auto"
                  size="xs"
                  variant="inverted"
                >
                  <ChevronDownIcon className="size-3.5" />
                  Scroll to end
                </Button>
              </div>
            ) : null}
          </div>
          {/* Messages waiting behind the agent's current run, above the text box as in the chat. */}
          <div className="mt-2 empty:hidden">
            <QueuedRunsControl
              environmentId={facts.ref.environmentId}
              threadId={facts.ref.threadId}
              placement="floating"
            />
          </div>
          {approval !== null ? (
            <BubbleApproval
              key={approval.requestId}
              threadRef={facts.ref}
              approval={approval}
              pendingCount={pending?.approvals.length ?? 1}
              onError={showError}
            />
          ) : null}
          {question.request !== null ? (
            <ComposerBanner.Root placement="floating" className="mt-2">
              <ComposerPendingUserInputPanel
                pendingUserInputs={[question.request]}
                disabled={!question.answerable}
                respondingRequestIds={question.responding ? [question.request.requestId] : []}
                answers={question.answers}
                questionIndex={question.questionIndex}
                onToggleOption={question.toggleOption}
                onAdvance={question.advance}
                onDismiss={question.dismiss}
              />
            </ComposerBanner.Root>
          ) : null}
          {backgroundWork !== null ? (
            <ComposerBanner.Root
              role="status"
              placement="floating"
              density="comfortable"
              className="mt-2"
            >
              <ComposerBanner.Row>
                <ComposerBanner.Icon>
                  <span className="flex opacity-40" aria-hidden="true">
                    <Spinner size="xs" />
                  </span>
                </ComposerBanner.Icon>
                <ComposerBanner.Content className="whitespace-nowrap">
                  <span className="min-w-0 truncate font-medium">{backgroundWork.title}</span>
                  {/* A single item is already named in the title. */}
                  {backgroundWork.items.length > 1 ? (
                    <span className="min-w-0 truncate text-muted-foreground">
                      {backgroundWork.items.map((item) => item.label).join(", ")}
                    </span>
                  ) : null}
                </ComposerBanner.Content>
                {isStoppable(facts) ? (
                  <ComposerBanner.Actions>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={state.phase === "stopping"}
                      onClick={() => void stop()}
                    >
                      {state.phase === "stopping" ? "Stopping..." : "Stop"}
                    </Button>
                  </ComposerBanner.Actions>
                ) : null}
              </ComposerBanner.Row>
            </ComposerBanner.Root>
          ) : null}
        </>
      }
    />
  );
}

/** A family's three shades side by side in a pill: head, body, legs. */
/**
 * An exchange's message, stuck to the top of its box: the reply scrolls under it and fades out
 * beneath it once the box starts above the top.
 */
function ExchangePin(props: {
  readonly message: Pick<ChatMessage, "id" | "text" | "context" | "attachments" | "createdAt">;
  readonly chips: UserMessageChipState;
  readonly threadRef: ScopedThreadRef;
  readonly timestampFormat: TimestampFormat;
}) {
  const { message } = props;
  // An attachment-only message was sent with a stand-in prompt: there is no text of yours to copy.
  const attachmentOnly = message.text === ATTACHMENT_ONLY_BOOTSTRAP_PROMPT;
  const attachmentCount = message.attachments?.length ?? 0;
  const forActions = useMemo(
    () => (attachmentOnly ? { ...message, text: "" } : message),
    [attachmentOnly, message],
  );
  return (
    <div
      data-exchange-pin
      className="group group/pin sticky top-0 z-10 flex flex-col items-end gap-0.5 bg-popover"
    >
      {/* A fractional scroll offset can leak a row of the turn above the pin; this caps it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-1 bg-popover" />
      <div className="pointer-events-none absolute inset-x-0 top-full hidden h-10 bg-linear-to-b from-popover to-transparent group-data-[stuck]/pin:block" />
      <div
        className="max-w-[85%] rounded-lg bg-message px-3 py-2 break-words text-message-foreground"
        aria-label="Your message"
      >
        <RollingSwap swapKey={message.id}>
          {attachmentOnly ? (
            <span className="line-clamp-2">
              {`${attachmentCount} ${attachmentCount === 1 ? "attachment" : "attachments"}`}
            </span>
          ) : (
            <ClampedUserMessage message={message} chips={props.chips} />
          )}
        </RollingSwap>
      </div>
      <UserMessageActions
        message={forActions}
        environmentId={props.threadRef.environmentId}
        threadId={props.threadRef.threadId}
        timestampFormat={props.timestampFormat}
        // Faint rather than hidden, so the pin shows it has actions.
        className="max-w-[85%] opacity-50"
      />
    </div>
  );
}

function FamilyShades({ shades }: { readonly shades: Shades | undefined }) {
  if (shades === undefined) return null;
  return (
    <span className="flex h-3 w-6 overflow-hidden rounded-full">
      {[shades.light, shades.base, shades.dark].map((shade) => (
        <span key={shade} className="flex-1" style={{ backgroundColor: shade }} />
      ))}
    </span>
  );
}
