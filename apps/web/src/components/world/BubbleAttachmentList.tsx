import type { ChatAttachment } from "@t3tools/contracts";
import { FileIcon, XIcon } from "lucide-react";

import { Button } from "../ui/button";
import type { BubbleAttachment } from "./useBubbleAttachments";

/**
 * Files on a world bubble's message, each removable: the stored ones a queued-message edit keeps,
 * then the newly staged ones. Images show as thumbnails, other files as chips.
 */
export function BubbleAttachmentList(props: {
  readonly kept?: ReadonlyArray<{
    readonly attachment: ChatAttachment;
    readonly url: string | null;
  }>;
  readonly attachments: ReadonlyArray<BubbleAttachment>;
  readonly disabled: boolean;
  readonly onRemoveKept?: ((id: string) => void) | undefined;
  readonly onRemove: (id: string) => void;
}) {
  const { kept = [], attachments, disabled, onRemove } = props;
  const items = [
    ...kept.map(({ attachment, url }) => ({
      id: attachment.id,
      name: attachment.name,
      previewUrl: attachment.type === "image" ? url : null,
      remove: () => props.onRemoveKept?.(attachment.id),
    })),
    ...attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      previewUrl: attachment.type === "image" ? attachment.previewUrl : null,
      remove: () => onRemove(attachment.id),
    })),
  ];
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) =>
        item.previewUrl !== null ? (
          <div key={item.id} className="relative size-12">
            <img
              src={item.previewUrl}
              alt={item.name}
              className="size-full rounded-md border border-border object-cover"
            />
            <div className="absolute top-0.5 right-0.5">
              <Button
                variant="media-close"
                size="icon-micro"
                aria-label={`Remove ${item.name}`}
                disabled={disabled}
                onClick={item.remove}
              >
                <XIcon />
              </Button>
            </div>
          </div>
        ) : (
          <div
            key={item.id}
            className="flex h-12 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border pr-1 pl-2"
          >
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs">{item.name}</span>
            <Button
              variant="ghost"
              size="icon-micro"
              aria-label={`Remove ${item.name}`}
              disabled={disabled}
              onClick={item.remove}
            >
              <XIcon />
            </Button>
          </div>
        ),
      )}
    </div>
  );
}
