import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { WorktreeSwitcher } from "../chat/WorktreeSwitcher";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useWorldModeStore } from "./worldModeStore";

/**
 * The world chat frame's top row, above both the chat and the worktree's surfaces: the chat
 * toggle, then the project's icon beside the worktree that owns the surfaces. The icon flies the
 * map to the project's island.
 */
export function WorldChatFrameHeader(props: {
  readonly ref?: Ref<HTMLElement>;
  readonly threadRef: ScopedThreadRef;
  readonly projectName: string | null;
  readonly project: ProjectFaviconProject | null;
  readonly chatCollapsed: boolean;
  readonly onToggleChat: () => void;
  readonly trailing?: ReactNode;
}) {
  const threadKey = scopedThreadKey(props.threadRef);
  const focusIslandOf = useWorldModeStore((state) => state.focusIslandOf);
  const toggleLabel = props.chatCollapsed ? "Show chat" : "Hide chat";
  return (
    <header
      ref={props.ref}
      className="relative flex h-16 shrink-0 items-center border-border border-b px-3"
      data-world-chat-frame-header
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={toggleLabel}
              aria-pressed={!props.chatCollapsed}
              onClick={props.onToggleChat}
            />
          }
        >
          <MessagesSquareIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{toggleLabel}</TooltipPopup>
      </Tooltip>
      <div className="pointer-events-none absolute inset-y-0 right-24 left-24 flex items-center justify-center gap-2">
        {props.project ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Show ${props.projectName ?? "the project"} on the map`}
                  onClick={() => focusIslandOf(threadKey)}
                  className="pointer-events-auto flex shrink-0 cursor-pointer rounded-sm bg-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              {/* A white tile keeps any icon legible on any background. */}
              <ProjectFavicon project={props.project} className="size-6" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              Show {props.projectName ?? "the project"} on the map
            </TooltipPopup>
          </Tooltip>
        ) : null}
        <WorktreeSwitcher
          threadRef={props.threadRef}
          variant="title"
          className="pointer-events-auto max-w-full"
        />
      </div>
      <div className="ml-auto flex items-center">{props.trailing}</div>
    </header>
  );
}
