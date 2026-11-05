import { lazy, Suspense, useState } from "react";

import { cn } from "../../lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HuePicker } from "./HuePicker";

const CharacterPortrait = lazy(() => import("./scene/CharacterPortrait"));

/**
 * A character's portrait in its colour; clicking it opens the picker to repaint it.
 * Size it with `className`. Subagents share the family colour, so `kid` says so.
 */
export function CharacterHueButton(props: {
  readonly hue: number;
  readonly hat: number | null;
  readonly kid?: boolean;
  readonly onHueChange: (hue: number) => void;
  readonly side?: "top" | "bottom";
  readonly className?: string;
}) {
  const { hue, onHueChange } = props;
  const [picking, setPicking] = useState(false);
  return (
    <Popover open={picking} onOpenChange={setPicking}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label="Change color"
                  className={cn(
                    "shrink-0 cursor-pointer rounded-md outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    props.className,
                  )}
                />
              }
            />
          }
        >
          <Suspense fallback={<div className="size-full" />}>
            <CharacterPortrait hue={hue} hat={props.hat} className="size-full" />
          </Suspense>
        </TooltipTrigger>
        <TooltipPopup side="top">Change color</TooltipPopup>
      </Tooltip>
      <PopoverPopup side={props.side ?? "top"} align="start" padding="compact">
        <HuePicker
          hue={hue}
          onChange={(picked) => {
            onHueChange(picked);
            setPicking(false);
          }}
          {...(props.kid ? { label: "Color of this agent's family" } : {})}
        />
      </PopoverPopup>
    </Popover>
  );
}
