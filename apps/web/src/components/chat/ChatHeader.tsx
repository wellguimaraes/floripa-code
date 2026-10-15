import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { isTrailingDoubleClick } from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { readLocalApi } from "~/localApi";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { useClientSettings } from "../../hooks/useSettings";
import { useWorldLook } from "../world/worldLookStore";
import {
  WorldChatCharacter,
  WorldChatWorktree,
  WorldRegenerateTitleButton,
} from "../world/WorldChatActions";

// three.js loads only when the world shows this thread's character.

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  /** Drafts have no server thread yet, so the title carries no action menu. */
  isServerThread: boolean;
  activeProject: EnvironmentProject | null;
  /** The sidebar's label for the project's group, such as "owner/repo". */
  activeProjectGroupLabel: string | null;
  parentThreadLink: { threadId: ThreadId; title: string } | null;
  onOpenThread: (threadId: ThreadId) => void;
  rightPanelOpen: boolean;
  onNewThreadInProject: () => void;
  onOpenProjectSettings?: (() => void) | undefined;
}

/**
 * Rename commit rule shared with the sidebar's inline rename: trim, reject
 * empty (the caller toasts), and skip the mutation when nothing changed.
 */
export function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

// How long a click on the thread title waits before opening the action menu,
// so a double-click-to-rename can cancel it first. Only the native desktop
// menu needs this: it swallows input while open, so the wait must cover the
// OS double-click interval. The browser fallback menu keeps seeing DOM
// events (the second click dismisses it and dblclick still fires), so it
// opens immediately.
const TITLE_MENU_OPEN_DELAY_MS = 500;
export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  activeThreadTitle,
  isServerThread,
  activeProject,
  activeProjectGroupLabel,
  parentThreadLink,
  onOpenThread,
  rightPanelOpen,
  onNewThreadInProject,
  onOpenProjectSettings,
}: ChatHeaderProps) {
  const activeProjectName = activeProject?.title;
  // The island sign's name: the sidebar's label for the project, last path segment.
  const worldProjectName =
    activeProjectGroupLabel?.slice(activeProjectGroupLabel.lastIndexOf("/") + 1) ||
    activeProjectName;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const interfaceFont = useClientSettings((settings) => settings.fontFamilySans);
  const breadcrumbContainerRef = useRef<HTMLDivElement>(null);
  const [collapseParentTitle, setCollapseParentTitle] = useState(false);
  const activeThreadRef = useMemo(
    () => scopeThreadRef(activeThreadEnvironmentId, activeThreadId),
    [activeThreadEnvironmentId, activeThreadId],
  );
  // In the world, the chat leads with its character, so you can tell who you're talking to.
  const worldLook = useWorldLook(scopedThreadKey(activeThreadRef));
  const canOperateThread = useEnvironmentScope(
    activeThreadEnvironmentId,
    AuthOrchestrationOperateScope,
  );
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  // Inline rename, keyed by thread: navigating away drops an in-progress
  // rename instead of committing stale text. Cleared on thread change (not
  // just hidden) so returning to the thread doesn't revive the old draft.
  const [renaming, setRenaming] = useState<{
    threadId: ThreadId;
    environmentId: EnvironmentId;
    title: string;
  } | null>(null);
  if (
    renaming !== null &&
    (renaming.threadId !== activeThreadId ||
      renaming.environmentId !== activeThreadEnvironmentId ||
      !canOperateThread)
  ) {
    setRenaming(null);
  }
  const renamingTitle =
    canOperateThread &&
    renaming?.threadId === activeThreadId &&
    renaming.environmentId === activeThreadEnvironmentId
      ? renaming.title
      : null;
  // Leaving rename swaps the input back for the title, which needs a fresh fit.
  const isRenamingTitle = renamingTitle !== null;
  useEffect(() => {
    const list = breadcrumbContainerRef.current?.querySelector("ol");
    if (!list || !parentThreadLink) return;
    // Measure the untruncated labels, including a collapsed parent's hidden
    // text, so expanding and collapsing never change the fit calculation.
    // Width-capped labels (the project) never grow, so their overflow is skipped.
    const measure = () => {
      const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
      const width = Array.from(list.children).reduce(
        (total, item) => {
          const label = item.querySelector('[data-slot="workspace-breadcrumb-text"]');
          const ellipsis = item.querySelector("[data-parent-breadcrumb-ellipsis]");
          return (
            total +
            (item.firstElementChild?.getBoundingClientRect().width ?? 0) +
            (label && getComputedStyle(label).maxWidth === "none"
              ? label.scrollWidth - label.clientWidth
              : 0) -
            (ellipsis?.getBoundingClientRect().width ?? 0)
          );
        },
        gap * (list.children.length - 1),
      );
      setCollapseParentTitle(width > list.clientWidth);
    };
    measure();
    const frame = requestAnimationFrame(measure);
    document.fonts.addEventListener("loadingdone", measure);
    const stopObserving = observeResize(list, measure);
    return () => {
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener("loadingdone", measure);
      stopObserving();
    };
  }, [activeProjectName, activeThreadTitle, parentThreadLink, interfaceFont, isRenamingTitle]);
  const renameCommittedRef = useRef(false);
  const startRename = useCallback(() => {
    if (
      !isServerThread ||
      !readEnvironmentScope(activeThreadEnvironmentId, AuthOrchestrationOperateScope)
    )
      return;
    renameCommittedRef.current = false;
    setRenaming({
      environmentId: activeThreadEnvironmentId,
      threadId: activeThreadId,
      title: activeThreadTitle,
    });
  }, [activeThreadEnvironmentId, activeThreadId, activeThreadTitle, isServerThread]);
  const commitRename = useCallback(
    (title: string) => {
      setRenaming(null);
      if (!readEnvironmentScope(activeThreadEnvironmentId, AuthOrchestrationOperateScope)) return;
      const resolution = resolveRenameCommit({ title, originalTitle: activeThreadTitle });
      if (resolution.action === "reject-empty") {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (resolution.action === "noop") return;
      void updateThreadMetadata({
        environmentId: activeThreadEnvironmentId,
        input: { threadId: activeThreadId, title: resolution.title },
      }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
      });
    },
    [activeThreadEnvironmentId, activeThreadId, activeThreadTitle, updateThreadMetadata],
  );
  const { openMenu, closeMenu } = useThreadActionMenu({
    threadRef: isServerThread ? activeThreadRef : null,
    projectCwd: activeProjectCwd,
    onStartRename: startRename,
    world: worldLook !== null,
  });
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleMenuTimerRef = useRef<number | null>(null);
  const cancelPendingTitleMenu = useCallback(() => {
    if (titleMenuTimerRef.current === null) return;
    clearTimeout(titleMenuTimerRef.current);
    titleMenuTimerRef.current = null;
  }, []);
  // Drop a pending menu-open when the thread changes or the header unmounts,
  // so it can never fire for a thread the user already left.
  useEffect(
    () => () => {
      cancelPendingTitleMenu();
    },
    [activeThreadEnvironmentId, activeThreadId, cancelPendingTitleMenu],
  );
  const openTitleMenuNow = useCallback(() => {
    cancelPendingTitleMenu();
    const rect = titleButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenu({ x: rect.left, y: rect.bottom + 4 });
  }, [cancelPendingTitleMenu, openMenu]);
  const openMenuFromTitle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // The trailing click of a double-click belongs to rename, not the menu.
      if (isTrailingDoubleClick(event.detail)) return;
      // Keyboard activation and the explicit chevron affordance can never be
      // the first half of a double-click, so they open without waiting.
      const clickedChevron =
        (event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null;
      if (event.detail === 0 || clickedChevron || window.desktopBridge === undefined) {
        openTitleMenuNow();
        return;
      }
      // Stay pending long enough for dblclick to cancel the open before the
      // native menu appears and swallows the second click.
      cancelPendingTitleMenu();
      titleMenuTimerRef.current = window.setTimeout(() => {
        titleMenuTimerRef.current = null;
        openTitleMenuNow();
      }, TITLE_MENU_OPEN_DELAY_MS);
    },
    [cancelPendingTitleMenu, openTitleMenuNow],
  );
  const handleTitleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // The chevron is the explicit menu affordance; only the title text renames.
      if ((event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null) return;
      cancelPendingTitleMenu();
      closeMenu();
      startRename();
    },
    [cancelPendingTitleMenu, closeMenu, startRename],
  );
  const handleHeaderContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (renamingTitle !== null) return;
      if (!isServerThread && onOpenProjectSettings === undefined) return;
      cancelPendingTitleMenu();
      event.preventDefault();
      if (!isServerThread) {
        const api = readLocalApi();
        if (!api) return;
        void api.contextMenu
          .show([{ id: "project-settings", label: "Project settings", icon: "settings" }], {
            x: event.clientX,
            y: event.clientY,
          })
          .then((action) => {
            if (action === "project-settings") onOpenProjectSettings?.();
          });
        return;
      }
      openMenu({ x: event.clientX, y: event.clientY });
    },
    [cancelPendingTitleMenu, isServerThread, onOpenProjectSettings, openMenu, renamingTitle],
  );
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        renameCommittedRef.current = true;
        commitRename(event.currentTarget.value);
      } else if (event.key === "Escape") {
        renameCommittedRef.current = true;
        setRenaming(null);
      }
    },
    [commitRename],
  );
  return (
    <div
      ref={breadcrumbContainerRef}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 sm:gap-3",
        rightPanelOpen ? "pr-10" : "pr-24",
      )}
      onContextMenu={handleHeaderContextMenu}
    >
      {worldLook !== null ? (
        <WorldChatCharacter
          threadRef={isServerThread ? activeThreadRef : null}
          hue={worldLook.hue}
          hat={worldLook.hat}
        />
      ) : null}
      {/* In the world the regenerate button makes the title row taller than its text, so
          the stack sits lower to leave even room over the chip and under the title. */}
      <div className={cn("flex min-w-0 flex-1 flex-col", worldLook !== null && "pt-1.5")}>
        {/* The project title is often just a folder name, so the sidebar's
            label for it sits above, matching the sidebar row. */}
        {worldLook === null &&
        activeProjectGroupLabel &&
        activeProjectGroupLabel !== activeProjectName ? (
          <span className="min-w-0 truncate text-xs leading-4 font-medium text-secondary-label">
            {activeProjectGroupLabel}
          </span>
        ) : null}
        {/* In the world, the project shows as its island's sign: a chip in the
            sign's colour above the title, which then stands alone. */}
        {worldLook !== null && activeProject ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`New thread in ${worldProjectName}`}
                  onClick={onNewThreadInProject}
                  className={cn(
                    "mb-0.5 max-w-full cursor-pointer self-start truncate rounded-full px-2",
                    "text-xs leading-5 font-semibold",
                    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  )}
                  style={{
                    backgroundColor: worldLook.plate.background,
                    color: worldLook.plate.text,
                  }}
                />
              }
            >
              {worldProjectName}
            </TooltipTrigger>
            <TooltipPopup side="top">New thread in {worldProjectName}</TooltipPopup>
          </Tooltip>
        ) : null}
        <WorkspaceBreadcrumb
          ariaLabel="Thread breadcrumb"
          className="overflow-clip [overflow-clip-margin:2px]"
        >
          {/* The project always leads the header: knowing which project a
            thread lives in is priority zero, and the thread title alone
            doesn't answer it. */}
          {worldLook === null && activeProject ? (
            <>
              <WorkspaceBreadcrumbItem className="shrink">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`New thread in ${activeProjectName}`}
                        onClick={onNewThreadInProject}
                        className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      />
                    }
                  >
                    <ProjectFavicon project={activeProject} className="size-3.5" />
                    <WorkspaceBreadcrumbText className="max-w-40">
                      {activeProjectName}
                    </WorkspaceBreadcrumbText>
                  </TooltipTrigger>
                  <TooltipPopup side="top">New thread in {activeProjectName}</TooltipPopup>
                </Tooltip>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator>
                <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
              </WorkspaceBreadcrumbSeparator>
            </>
          ) : null}
          {worldLook === null && parentThreadLink ? (
            <>
              <WorkspaceBreadcrumbItem>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Open parent thread: ${parentThreadLink.title}`}
                        onClick={() => onOpenThread(parentThreadLink.threadId)}
                        className="inline-flex min-w-0 max-w-full cursor-pointer items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      />
                    }
                  >
                    <WorkspaceBreadcrumbText
                      aria-hidden
                      className={collapseParentTitle ? "w-0" : undefined}
                    >
                      {parentThreadLink.title}
                    </WorkspaceBreadcrumbText>
                    {collapseParentTitle ? (
                      <span aria-hidden data-parent-breadcrumb-ellipsis>
                        ...
                      </span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipPopup side="top">{parentThreadLink.title}</TooltipPopup>
                </Tooltip>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator>
                <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
              </WorkspaceBreadcrumbSeparator>
            </>
          ) : null}
          <WorkspaceBreadcrumbItem
            current
            // In the world the regenerate button follows the title, a small step apart.
            className={cn("min-w-10 flex-1", worldLook !== null && "gap-1.5")}
          >
            {renamingTitle !== null ? (
              <input
                autoFocus
                aria-label="Thread title"
                className={cn(
                  "min-w-0 flex-1 rounded-sm bg-transparent text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-ring/50 focus:ring-ring",
                  // The world's header leads with the title alone, so it reads larger.
                  worldLook !== null && "text-base",
                )}
                defaultValue={renamingTitle}
                onBlur={(event) => {
                  if (renameCommittedRef.current) return;
                  // Focus landing on a navigation button means the rename was
                  // abandoned — discard it rather than persisting a half-draft.
                  if (
                    event.relatedTarget instanceof HTMLElement &&
                    event.relatedTarget.closest("button")
                  ) {
                    setRenaming(null);
                    return;
                  }
                  commitRename(event.currentTarget.value);
                }}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={handleRenameKeyDown}
              />
            ) : isServerThread && worldLook === null ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      ref={titleButtonRef}
                      type="button"
                      aria-label={`Thread actions for ${activeThreadTitle}`}
                      aria-haspopup="menu"
                      onClick={openMenuFromTitle}
                      onDoubleClick={canOperateThread ? handleTitleDoubleClick : undefined}
                      onBlur={cancelPendingTitleMenu}
                      className="group/thread-title inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    />
                  }
                >
                  <h2 className="min-w-0">
                    <WorkspaceBreadcrumbText className={cn(worldLook !== null && "text-base")}>
                      {activeThreadTitle}
                    </WorkspaceBreadcrumbText>
                  </h2>
                  <ChevronDownIcon
                    aria-hidden
                    data-thread-title-chevron
                    className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread-title:opacity-100 group-focus-visible/thread-title:opacity-100"
                  />
                </TooltipTrigger>
                <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
              </Tooltip>
            ) : (
              // In the world the title opens no menu (right-click still does); double-click renames.
              <Tooltip>
                <TooltipTrigger
                  render={
                    <h2
                      aria-label={activeThreadTitle}
                      // In the world the regenerate button follows the title, not the row's end.
                      className={cn("min-w-0", worldLook === null && "flex-1")}
                      onDoubleClick={
                        isServerThread && canOperateThread ? handleTitleDoubleClick : undefined
                      }
                    />
                  }
                >
                  <WorkspaceBreadcrumbText className={cn(worldLook !== null && "text-base")}>
                    {activeThreadTitle}
                  </WorkspaceBreadcrumbText>
                </TooltipTrigger>
                <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
              </Tooltip>
            )}
            {worldLook !== null && renamingTitle === null && isServerThread ? (
              <WorldRegenerateTitleButton threadRef={activeThreadRef} />
            ) : null}
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        {/* In the world, where the thread works sits under its title, main checkout included. */}
        {worldLook !== null && isServerThread ? (
          <WorldChatWorktree threadRef={activeThreadRef} projectRoot={activeProjectCwd} />
        ) : null}
      </div>
    </div>
  );
});
