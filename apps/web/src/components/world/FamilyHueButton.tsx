import { useState } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { HuePicker } from "./HuePicker";
import { palette } from "./scene/palette";

/**
 * A character's colour, as its family's three shades, opening the picker to repaint it.
 * Subagents share the family colour, so a kid repaints its parent and siblings too.
 */
export function FamilyHueButton(props: {
  readonly hue: number;
  readonly kid: boolean;
  readonly onHueChange: (hue: number) => void;
  /** Matches the row it sits in: `sm` beside header icon buttons. */
  readonly size?: "xs" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const shades = palette.families[props.hue];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size={props.size ?? "xs"}
            aria-label="Change color"
            title="Change color"
          />
        }
      >
        {shades === undefined ? null : (
          <span className="flex h-3 w-6 overflow-hidden rounded-full">
            {[shades.light, shades.base, shades.dark].map((shade) => (
              <span key={shade} className="flex-1" style={{ backgroundColor: shade }} />
            ))}
          </span>
        )}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" padding="compact">
        <HuePicker
          hue={props.hue}
          onChange={(picked) => {
            props.onHueChange(picked);
            setOpen(false);
          }}
          label={props.kid ? "Color of this agent's family" : "Agent color"}
        />
      </PopoverPopup>
    </Popover>
  );
}
