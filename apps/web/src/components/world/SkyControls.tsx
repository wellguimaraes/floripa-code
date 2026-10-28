import {
  CloudLightningIcon,
  CloudRainIcon,
  MoonIcon,
  SunIcon,
  SunriseIcon,
  SunsetIcon,
} from "lucide-react";

import { Slider } from "../ui/slider";
import { Toggle } from "../ui/toggle";
import { SUNRISE, SUNSET } from "./scene/daylight";
import { useWorldHour, useWorldTimeStore } from "./worldTimeStore";
import {
  selectRaining,
  selectStorm,
  useLiveWeather,
  useWorldWeatherStore,
} from "./worldWeatherStore";

/**
 * Top bar pill for the world's sky: the time of day, rain, and a storm with
 * lightning (which brings rain). Dragging the hour or picking the weather
 * leaves that one's auto mode; Auto puts both back on this computer's clock and
 * the real weather here, and is on only while both follow them.
 */
export function SkyControls() {
  useLiveWeather();
  const hour = useWorldHour();
  const timeAuto = useWorldTimeStore((state) => state.auto);
  const setHour = useWorldTimeStore((state) => state.setHour);
  const setTimeAuto = useWorldTimeStore((state) => state.setAuto);
  const raining = useWorldWeatherStore(selectRaining);
  const storm = useWorldWeatherStore(selectStorm);
  const weatherAuto = useWorldWeatherStore((state) => state.auto);
  const setRaining = useWorldWeatherStore((state) => state.setRaining);
  const setStorm = useWorldWeatherStore((state) => state.setStorm);
  const setWeatherAuto = useWorldWeatherStore((state) => state.setAuto);

  return (
    <div className="surface-glass flex h-9 sm:h-8 items-center gap-2 rounded-full border border-border/60 pr-1 pl-3 text-foreground shadow-sm">
      <TimeIcon hour={hour} />
      <Slider
        min={0}
        max={24}
        step={0.5}
        value={hour}
        onChange={(event) => setHour(event.currentTarget.valueAsNumber)}
        aria-label="Time of day"
        // Grey while the clock sets the hour; dragging takes over.
        muted={timeAuto}
        className="w-16"
      />
      <span className="w-10 text-xs text-muted-foreground tabular-nums">{formatHour(hour)}</span>
      <div className="flex items-center gap-0.5">
        <Toggle
          variant="pill"
          size="xs"
          pressed={raining}
          onPressedChange={setRaining}
          aria-label="Rain"
        >
          <CloudRainIcon className="size-4" />
        </Toggle>
        <Toggle
          variant="pill"
          size="xs"
          pressed={storm}
          onPressedChange={setStorm}
          aria-label="Storm"
        >
          <CloudLightningIcon className="size-4" />
        </Toggle>
        <Toggle
          variant="pill-solid"
          size="xs"
          pressed={timeAuto && weatherAuto}
          onPressedChange={(auto) => {
            setTimeAuto(auto);
            setWeatherAuto(auto);
          }}
          aria-label="Follow this computer's clock and the real weather here"
        >
          Auto
        </Toggle>
      </div>
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
