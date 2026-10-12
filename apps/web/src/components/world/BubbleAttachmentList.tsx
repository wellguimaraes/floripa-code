import { FileIcon, XIcon } from "lucide-react";

import { Button } from "../ui/button";
import type { BubbleAttachment } from "./useBubbleAttachments";

/** Files staged in a world bubble: image thumbnails and file chips, each removable. */
export function BubbleAttachmentList(props: {
  readonly attachments: ReadonlyArray<BubbleAttachment>;
  readonly disabled: boolean;
  readonly onRemove: (id: string) => void;
}) {
  const { attachments, disabled, onRemove } = props;
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((attachment) =>
        attachment.type === "image" ? (
          <div key={attachment.id} className="relative size-12">
            <img
              src={attachment.previewUrl}
              alt={attachment.name}
              className="size-full rounded-md border border-border object-cover"
            />
            <div className="absolute top-0.5 right-0.5">
              <Button
                variant="media-close"
                size="icon-micro"
                aria-label={`Remove ${attachment.name}`}
                disabled={disabled}
                onClick={() => onRemove(attachment.id)}
              >
                <XIcon />
              </Button>
            </div>
          </div>
        ) : (
          <div
            key={attachment.id}
            className="flex h-12 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border pr-1 pl-2"
          >
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs">{attachment.name}</span>
            <Button
              variant="ghost"
              size="icon-micro"
              aria-label={`Remove ${attachment.name}`}
              disabled={disabled}
              onClick={() => onRemove(attachment.id)}
            >
              <XIcon />
            </Button>
          </div>
        ),
      )}
    </div>
  );
}
