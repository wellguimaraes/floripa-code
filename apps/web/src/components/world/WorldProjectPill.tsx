import { cn } from "../../lib/utils";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";

/**
 * A project's name on a pill in its island sign's colours, led by its icon when given, wherever
 * the world's UI names a project: the chat frame's header, the new-agent bubble, the island's
 * popovers and dialogs. Without colours the pill takes the surrounding text's.
 */
export function WorldProjectPill(props: {
  readonly name: string;
  readonly plate: { readonly background: string; readonly text: string } | null;
  readonly project?: ProjectFaviconProject | null;
  /** "md" titles a frame, as in the chat header; "sm" sits above a popover's or dialog's title. */
  readonly size?: "sm" | "md";
}) {
  const size = props.size ?? "md";
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 font-semibold",
        size === "sm" && "text-xs leading-5",
        size === "md" && "text-sm leading-5",
      )}
    >
      {props.project ? (
        // A white tile keeps any icon legible on any background.
        <span className="flex shrink-0 rounded-sm bg-white">
          <ProjectFavicon
            project={props.project}
            className={cn(size === "sm" && "size-5", size === "md" && "size-6")}
          />
        </span>
      ) : null}
      <span
        className={cn(
          "truncate rounded-full",
          size === "sm" && "px-2",
          size === "md" && "px-2.5 py-0.5",
        )}
        style={
          props.plate
            ? { backgroundColor: props.plate.background, color: props.plate.text }
            : undefined
        }
      >
        {props.name}
      </span>
    </span>
  );
}
