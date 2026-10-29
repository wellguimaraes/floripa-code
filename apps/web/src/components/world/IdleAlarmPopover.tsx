import { BellRingIcon, ChevronDownIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

/**
 * Sits on an island whose idle alarm went off, while it ripples. Dismiss quiets it until the
 * island works again; snooze quiets it for a while.
 */
export function IdleAlarmPopover(props: {
  readonly minutes: number;
  readonly snoozeOptions: ReadonlyArray<{ readonly minutes: number; readonly label: string }>;
  readonly onDismiss: () => void;
  readonly onSnooze: (minutes: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-lg">
      <span className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
        <BellRingIcon className="size-3.5 text-muted-foreground" />
        Idle for more than {formatMinutes(props.minutes)}
      </span>
      <div className="flex gap-1.5">
        <Button variant="outline" size="xs" onClick={props.onDismiss}>
          Dismiss
        </Button>
        <Menu>
          <MenuTrigger render={<Button variant="outline" size="xs" />}>
            Snooze
            <ChevronDownIcon className="size-3" />
          </MenuTrigger>
          <MenuPopup align="start">
            {props.snoozeOptions.map((option) => (
              <MenuItem key={option.minutes} onClick={() => props.onSnooze(option.minutes)}>
                {option.label}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "an hour" : `${hours} hours`;
  }
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
}
