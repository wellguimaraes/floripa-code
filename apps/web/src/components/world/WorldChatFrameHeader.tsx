import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { WorktreeSwitcher } from "../chat/WorktreeSwitcher";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useWorldLook } from "./worldLookStore";
import { useWorldModeStore } from "./worldModeStore";

// Four hard 1px shadows, one per side, draw a white outline that follows the icon's shape.
const ICON_RIM = [
  "drop-shadow(1px 0 0 white)",
  "drop-shadow(-1px 0 0 white)",
  "drop-shadow(0 1px 0 white)",
  "drop-shadow(0 -1px 0 white)",
].join(" ");

/**
 * The world chat frame's top row, above both the chat and the worktree's surfaces: the chat
 * toggle, then the project's island sign over the worktree that owns the surfaces. The sign
 * flies the map to the project's island.
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
  const worldLook = useWorldLook(threadKey);
  const focusIslandOf = useWorldModeStore((state) => state.focusIslandOf);
  const toggleLabel = props.chatCollapsed ? "Show chat" : "Hide chat";
  return (
    <header
      ref={props.ref}
      className="relative flex h-14 shrink-0 items-center border-border border-b px-3"
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
      <div className="pointer-events-none absolute inset-y-0 right-24 left-24 flex flex-col items-center justify-center gap-0.5">
        {props.projectName ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Show ${props.projectName} on the map`}
                  onClick={() => focusIslandOf(threadKey)}
                  className="pointer-events-auto flex max-w-full cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-sm leading-5 font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  style={
                    worldLook
                      ? { backgroundColor: worldLook.plate.background, color: worldLook.plate.text }
                      : undefined
                  }
                />
              }
            >
              {props.project ? (
                // The white rim traces the icon's own outline (its alpha), whatever its shape.
                <span className="flex shrink-0" style={{ filter: ICON_RIM }}>
                  <ProjectFavicon project={props.project} className="size-3.5" />
                </span>
              ) : null}
              <span className="truncate">{props.projectName}</span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">Show {props.projectName} on the map</TooltipPopup>
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
