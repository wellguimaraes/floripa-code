import { PipetteIcon } from "lucide-react";
import { useId } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { signTextColor } from "./scene/Sign";
import { islandPlate, islandStaleDays, useWorldIslandPrefsStore } from "./worldIslandPrefsStore";

/** The sign colours on offer, by hue; every island's own pick from `palette.plates` is among them. */
const SIGN_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#78716c",
  "#475569",
] as const;

const STALE_DAYS = [7, 14, 30, 60, 90] as const;
const IDLE_ALARM_MINUTES = [5, 10, 15, 30, 60] as const;

/** The chosen swatch: a white border, then an outline. */
const CHOSEN = "ring-2 ring-foreground ring-offset-2 ring-offset-white";

/**
 * An island's preferences, opened from its sign's gear: the sign's colour, when
 * branches count as stale, and how long the island may sit idle before it
 * ripples for you. The project's icon is set in Settings, not here.
 */
export function IslandPrefsDialog(props: {
  readonly islandKey: string;
  readonly title: string;
  readonly onClose: () => void;
}) {
  const { islandKey, title, onClose } = props;
  const id = useId();
  const prefs = useWorldIslandPrefsStore((state) => state.prefs[islandKey]);
  const update = useWorldIslandPrefsStore((state) => state.update);
  const color = islandPlate(islandKey, prefs);
  const custom = !SIGN_COLORS.some((preset) => preset === color);
  const staleDays = islandStaleDays(prefs);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Island preferences</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Sign color</Label>
              {prefs?.color !== undefined ? (
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="xs"
                  className="-my-1"
                  onClick={() => update(islandKey, { color: null })}
                >
                  Reset
                </Button>
              ) : null}
            </div>
            <div role="radiogroup" aria-label="Sign color" className="flex flex-wrap gap-2">
              {SIGN_COLORS.map((preset, index) => (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={preset === color}
                  aria-label={`Color ${index + 1}`}
                  className={cn(
                    "size-6 cursor-pointer rounded-full outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    preset === color && CHOSEN,
                  )}
                  style={{ backgroundColor: preset }}
                  onClick={() => update(islandKey, { color: preset })}
                />
              ))}
              {/* Any other colour, from the system's picker. */}
              <label
                aria-label="Custom color"
                className={cn(
                  "relative flex size-6 cursor-pointer items-center justify-center rounded-full",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  "has-[:focus-visible]:ring-inset",
                  custom ? CHOSEN : "border border-dashed border-muted-foreground/48",
                )}
                style={custom ? { backgroundColor: color } : undefined}
              >
                <PipetteIcon
                  className={cn("size-3.5", !custom && "text-muted-foreground")}
                  style={custom ? { color: signTextColor(color) } : undefined}
                />
                <input
                  type="color"
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                  value={color}
                  onChange={(event) => update(islandKey, { color: event.target.value })}
                />
              </label>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${id}-stale`}>Stale branches after</Label>
            <Select
              value={staleDays === null ? "off" : String(staleDays)}
              items={{
                off: "Never",
                ...Object.fromEntries(STALE_DAYS.map((days) => [String(days), `${days} days`])),
              }}
              onValueChange={(value) =>
                update(islandKey, { staleDays: value === "off" ? "never" : Number(value) })
              }
            >
              <SelectTrigger id={`${id}-stale`} size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="off">Never</SelectItem>
                {STALE_DAYS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} days
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${id}-idle`}>Idle alarm</Label>
            <Select
              value={prefs?.idleAlarmMinutes === undefined ? "off" : String(prefs.idleAlarmMinutes)}
              items={{
                off: "Off",
                ...Object.fromEntries(
                  IDLE_ALARM_MINUTES.map((minutes) => [String(minutes), `After ${minutes} min`]),
                ),
              }}
              onValueChange={(value) =>
                update(islandKey, { idleAlarmMinutes: value === "off" ? null : Number(value) })
              }
            >
              <SelectTrigger id={`${id}-idle`} size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="off">Off</SelectItem>
                {IDLE_ALARM_MINUTES.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    After {minutes} min
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            The branch list hides stale branches unless you switch that off. The idle alarm ripples
            the island once none of its agents has worked for that long.
          </p>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
