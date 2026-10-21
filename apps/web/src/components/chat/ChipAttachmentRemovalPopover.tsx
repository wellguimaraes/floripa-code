import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Popover, PopoverPopup, PopoverTitle } from "../ui/popover";
import { attachmentsWithRemovedChips, type ChipAttachment } from "./chipAttachmentRemoval";

interface PendingRemoval {
  ids: ReadonlyArray<string>;
  anchor: DOMRect;
}

/**
 * Deleting an attachment's chip from the prompt leaves the attachment staged. This asks, beside
 * the caret, whether it should go too, unless the user told it to remember an answer
 * (Settings → Confirmations). A composer calls `chipsChanged` after each edit and renders
 * `ChipAttachmentRemovalPopover` with the result.
 */
export function useChipAttachmentRemoval(input: {
  attachments: ReadonlyArray<ChipAttachment>;
  onRemove: (ids: ReadonlyArray<string>) => void;
  /** Gives the caret back to the text after a choice. */
  onSettled: () => void;
}) {
  const mode = useClientSettings((settings) => settings.composerChipAttachmentRemoval);
  const updateClientSettings = useUpdateClientSettings();
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const latest = useRef({ mode, attachments: input.attachments, onRemove: input.onRemove });
  useLayoutEffect(() => {
    latest.current = { mode, attachments: input.attachments, onRemove: input.onRemove };
  });

  // Stable, so composers can call it from memoized change handlers.
  const chipsChanged = useCallback(
    (
      previousContextIds: ReadonlySet<string>,
      nextContextIds: ReadonlySet<string>,
      readAnchor: () => DOMRect | null,
    ) => {
      const { mode, attachments, onRemove } = latest.current;
      const removed = attachmentsWithRemovedChips(
        attachments,
        previousContextIds,
        nextContextIds,
      ).map((attachment) => attachment.id);
      // An undo or paste that brings a chip back answers the question for that attachment.
      const rechipped = new Set(
        attachments
          .filter((attachment) => nextContextIds.has(attachment.contextId))
          .map((attachment) => attachment.id),
      );
      const ask = removed.length > 0 && mode === "ask";
      if (removed.length > 0 && mode === "remove") onRemove(removed);
      const anchor = ask ? readAnchor() : null;
      setPending((current) => {
        const kept = (current?.ids ?? []).filter(
          (id) => !rechipped.has(id) && !removed.includes(id),
        );
        if (ask && anchor) return { ids: [...kept, ...removed], anchor };
        if (current === null || kept.length === current.ids.length) return current;
        return kept.length > 0 ? { ...current, ids: kept } : null;
      });
    },
    [],
  );

  // Attachments removed some other way (the tray, a send) drop out of the question.
  const attachments = pending
    ? input.attachments.filter((attachment) => pending.ids.includes(attachment.id))
    : [];

  const settle = (remove: boolean, remember: boolean) => {
    if (remove) input.onRemove(attachments.map((attachment) => attachment.id));
    if (remember) {
      void updateClientSettings({ composerChipAttachmentRemoval: remove ? "remove" : "keep" });
    }
    setPending(null);
    input.onSettled();
  };

  return {
    open: attachments.length > 0,
    attachments,
    anchor: pending?.anchor ?? null,
    chipsChanged,
    /** Closing without an answer keeps the attachments and asks again next time. */
    dismiss: () => setPending(null),
    settle,
  };
}

export function ChipAttachmentRemovalPopover(props: {
  removal: ReturnType<typeof useChipAttachmentRemoval>;
}) {
  const { removal } = props;
  const [remember, setRemember] = useState(false);
  const [first] = removal.attachments;
  return (
    <Popover
      open={removal.open}
      onOpenChange={(open) => {
        if (!open) removal.dismiss();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setRemember(false);
      }}
    >
      {removal.anchor ? (
        <PopoverPopup
          anchor={{ getBoundingClientRect: () => removal.anchor ?? new DOMRect() }}
          side="top"
          align="start"
          sideOffset={8}
          width="sm"
          // The caret stays in the text, so typing carries on while this is open.
          initialFocus={false}
          finalFocus={false}
        >
          <PopoverTitle>
            {removal.attachments.length === 1
              ? "Remove the attachment too?"
              : `Remove ${removal.attachments.length} attachments too?`}
          </PopoverTitle>
          <p className="mt-2 text-muted-foreground text-sm">
            {removal.attachments.length === 1 && first ? (
              <>
                <span className="break-all font-medium text-foreground">{first.name}</span> is still
                attached to the message.
              </>
            ) : (
              "Their chips are gone, but the files are still attached to the message."
            )}
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked)} />
            Remember my choice
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => removal.settle(false, remember)}>
              Keep
            </Button>
            <Button variant="destructive" size="sm" onClick={() => removal.settle(true, remember)}>
              Remove
            </Button>
          </div>
        </PopoverPopup>
      ) : null}
    </Popover>
  );
}
