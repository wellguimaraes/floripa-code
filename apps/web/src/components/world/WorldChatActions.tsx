import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ArchiveIcon, RefreshCwIcon } from "lucide-react";
import { memo, useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import { readEnvironmentSupportsTitleRegeneration, useThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ARCHIVE_SHORTCUT, confirmArchive, useArchiveShortcut } from "./useArchiveShortcut";
import { CharacterHueButton } from "./CharacterHueButton";
import { useWorldLook, useWorldLookStore } from "./worldLookStore";
import { useWorldModeStore } from "./worldModeStore";

/** The world chat's thread, while the world shows it and the user may act on it. */
function useWorldChatThread(threadRef: ScopedThreadRef | null) {
  const threadKey = threadRef === null ? "" : scopedThreadKey(threadRef);
  const worldLook = useWorldLook(threadKey);
  const thread = useThreadShell(threadRef);
  const canOperate = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  if (threadRef === null || worldLook === null || thread === null || !canOperate) return null;
  return { threadRef, threadKey, worldLook, thread };
}

/**
 * The world chat's archive action, at its header's end.
 * Elsewhere it lives in the title menu, so it renders nothing outside the world.
 */
export const WorldArchiveButton = memo(function WorldArchiveButton({
  threadRef,
}: {
  readonly threadRef: ScopedThreadRef | null;
}) {
  const chat = useWorldChatThread(threadRef);
  const { archiveThread } = useThreadActions();
  const archiveChatAgent = useWorldModeStore((state) => state.archiveChatAgent);
  const [archiving, setArchiving] = useState(false);

  // Archive, not delete: it can be undone from the toast or Settings → Archived. The world's
  // own archive plays the agent's exit and reports its own failures. Either way the chat closes.
  const archive = async (anchor: Element | null) => {
    if (chat === null || archiving) return;
    if (!(await confirmArchive(anchor))) return;
    setArchiving(true);
    if (archiveChatAgent !== null) {
      await archiveChatAgent();
      setArchiving(false);
      return;
    }
    const result = await archiveThread(chat.threadRef);
    setArchiving(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Failed to archive thread",
        description: error instanceof Error && error.message !== "" ? error.message : "Try again.",
      });
    }
  };

  // A chat opened on an archived agent has nothing left to archive.
  const archivable = chat !== null && chat.thread.archivedAt == null;
  useArchiveShortcut(() => archive(null), archivable);
  if (!archivable) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Archive this thread"
            aria-keyshortcuts="Alt+A"
            disabled={archiving}
            onClick={(event) => void archive(event.currentTarget)}
          />
        }
      >
        <ArchiveIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="top">
        <span className="flex items-center gap-2">
          Archive this thread <Kbd>{ARCHIVE_SHORTCUT}</Kbd>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
});

/** Regenerates the world chat's title, beside archive. Renders nothing outside the world. */
export const WorldRegenerateTitleButton = memo(function WorldRegenerateTitleButton({
  threadRef,
}: {
  readonly threadRef: ScopedThreadRef | null;
}) {
  const chat = useWorldChatThread(threadRef);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  if (chat === null || !readEnvironmentSupportsTitleRegeneration(chat.threadRef.environmentId)) {
    return null;
  }
  const regeneratingTitle = chat.thread.titleRegeneration != null;

  // The new title arrives on the thread shell; until then the button spins.
  const regenerateTitle = async () => {
    if (regeneratingTitle) return;
    const result = await updateMetadata({
      environmentId: chat.threadRef.environmentId,
      input: { threadId: chat.threadRef.threadId, regenerateTitle: true },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Failed to regenerate thread title",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={regeneratingTitle ? "Regenerating title" : "Regenerate title"}
            disabled={regeneratingTitle}
            onClick={() => void regenerateTitle()}
          />
        }
      >
        <RefreshCwIcon className={cn("size-4", regeneratingTitle && "animate-spin")} />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {regeneratingTitle ? "Regenerating title…" : "Regenerate title"}
      </TooltipPopup>
    </Tooltip>
  );
});

/**
 * The world chat's character, leading its header; clicking it repaints the character. The
 * colour is this viewer's own, so it needs no permission. Renders nothing outside the world.
 */
export const WorldRecolorButton = memo(function WorldRecolorButton({
  threadRef,
  className,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly className?: string;
}) {
  const threadKey = scopedThreadKey(threadRef);
  const worldLook = useWorldLook(threadKey);
  const recolor = useWorldLookStore((state) => state.recolor);
  if (worldLook === null || recolor === null) return null;
  return (
    <CharacterHueButton
      hue={worldLook.hue}
      hat={worldLook.hat}
      kid={worldLook.kid}
      onHueChange={(hue) => recolor(threadKey, hue)}
      side="bottom"
      {...(className === undefined ? {} : { className })}
    />
  );
});
