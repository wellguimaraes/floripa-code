import { ImageIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import type { ChatImageAttachment } from "../../types";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  SNAP_SHOT_ATTACHMENT_FRAME_CLASS,
  SnapShotAttachmentDetails,
} from "./SnapShotAttachmentDetails";

/** More images than this would take a second grid row, so they stack instead. */
export const MESSAGE_IMAGE_GRID_MAX = 2;

const STACKED = 3;

/** A sent image in a message's media grid; opens the full picture among `images`. */
export function UserImageThumbnail({
  image,
  images,
  onImageExpand,
}: {
  image: ChatImageAttachment;
  images: ReadonlyArray<ChatImageAttachment>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  return (
    <div
      className={cn(
        "bg-background/70",
        image.source?.kind === "snap-shot" && image.previewUrl
          ? cn(SNAP_SHOT_ATTACHMENT_FRAME_CLASS, "col-span-2")
          : "aspect-[4/3] overflow-hidden rounded-lg border border-border/80",
      )}
    >
      {image.previewUrl ? (
        <button
          type="button"
          className="block h-full w-full cursor-zoom-in"
          aria-label={`Preview ${image.name}`}
          onClick={() => {
            const preview = buildExpandedImagePreview(images, image.id);
            if (preview) onImageExpand(preview);
          }}
        >
          <img src={image.previewUrl} alt={image.name} className="block size-full object-cover" />
        </button>
      ) : (
        <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-2xs text-muted-foreground/70">
          {image.name}
        </div>
      )}
      {image.previewUrl && image.source?.kind === "snap-shot" ? (
        <SnapShotAttachmentDetails source={image.source} />
      ) : null}
    </div>
  );
}

/**
 * A message's images as one row of overlapping thumbnails, so many images do not bury the text.
 * The row opens a grid of all of them, and a grid image opens the full picture.
 */
export function MessageImageStack(props: {
  readonly images: ReadonlyArray<ChatImageAttachment>;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = props.images.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg text-xs text-muted-foreground last:mb-0 hover:text-foreground"
          />
        }
        aria-label={`Show ${count} images`}
      >
        <span className="flex">
          {props.images.slice(0, STACKED).map((image, index) => (
            <span
              key={image.id}
              className="-ms-4 flex size-10 items-center justify-center overflow-hidden rounded-md border border-border/80 bg-background shadow-sm first:ms-0"
              style={{ zIndex: STACKED - index }}
            >
              {image.previewUrl ? (
                <img src={image.previewUrl} alt="" className="size-full object-cover" />
              ) : (
                <ImageIcon className="size-4 text-muted-foreground/70" />
              )}
            </span>
          ))}
        </span>
        <span className="tabular-nums">{`${count} images`}</span>
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" padding="compact" width="lg">
        <div className="grid grid-cols-3 gap-2">
          {props.images.map((image) => (
            <UserImageThumbnail
              key={image.id}
              image={image}
              images={props.images}
              onImageExpand={(preview) => {
                // The full picture replaces the grid rather than opening over it.
                setOpen(false);
                props.onImageExpand(preview);
              }}
            />
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
