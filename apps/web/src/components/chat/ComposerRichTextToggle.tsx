import { PilcrowIcon } from "lucide-react";

import { persistClientSettingsUpdate } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Flips `composerRichTextEnabled`, the same setting as Settings → Chat → Rich text composer. */
export function flipComposerRichText() {
  return persistClientSettingsUpdate((current) => ({
    ...current,
    composerRichTextEnabled: !current.composerRichTextEnabled,
  })).catch(console.error);
}

// Flipping the setting remounts the editor; pointer-down is swallowed so a focused
// editor keeps its caret across that.
export function ComposerRichTextToggle({
  richTextEnabled,
  shortcutLabel,
}: {
  readonly richTextEnabled: boolean;
  readonly shortcutLabel: string | null;
}) {
  const showingSource = !richTextEnabled;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Markdown source"
            aria-pressed={showingSource}
            data-pressed={showingSource ? "" : undefined}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void flipComposerRichText()}
          />
        }
      >
        <PilcrowIcon />
      </TooltipTrigger>
      <TooltipPopup>
        {showingSource ? "Show formatting" : "Show Markdown source"}
        {shortcutLabel ? ` · ${shortcutLabel}` : null}
      </TooltipPopup>
    </Tooltip>
  );
}
