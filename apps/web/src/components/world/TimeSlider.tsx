import { MoonIcon, SunIcon, SunriseIcon, SunsetIcon } from "lucide-react";

import { Toggle } from "../ui/toggle";
import { SUNRISE, SUNSET } from "./scene/daylight";
import { useWorldHour, useWorldTimeStore } from "./worldTimeStore";

/**
 * Top bar slider: the time of day the world shows. Auto follows this
 * browser's clock; dragging picks an hour and turns auto off.
 */
export function TimeSlider() {
  const hour = useWorldHour();
  const auto = useWorldTimeStore((state) => state.auto);
  const setHour = useWorldTimeStore((state) => state.setHour);
  const setAuto = useWorldTimeStore((state) => state.setAuto);

  return (
    <div className="surface-glass flex h-8 items-center gap-2 rounded-full border border-border/60 pr-1 pl-3 text-foreground shadow-sm">
      <TimeIcon hour={hour} />
      <input
        type="range"
        min={0}
        max={24}
        step={0.5}
        value={hour}
        onChange={(event) => setHour(event.currentTarget.valueAsNumber)}
        aria-label="Time of day"
        className="w-28 accent-primary"
      />
      <span className="w-10 text-xs text-muted-foreground tabular-nums">{formatHour(hour)}</span>
      <Toggle
        variant="pill"
        size="xs"
        pressed={auto}
        onPressedChange={setAuto}
        aria-label="Follow this computer's clock"
      >
        Auto
      </Toggle>
    </div>
  );
}

function TimeIcon({ hour }: { readonly hour: number }) {
  const className = "size-4 text-muted-foreground";
  if (hour < SUNRISE - 0.5 || hour >= SUNSET + 0.5) return <MoonIcon className={className} />;
  if (hour < SUNRISE + 2) return <SunriseIcon className={className} />;
  if (hour >= SUNSET - 2) return <SunsetIcon className={className} />;
  return <SunIcon className={className} />;
}

/** "18:45", on the 24-hour clock. */
function formatHour(hour: number): string {
  const minutes = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
