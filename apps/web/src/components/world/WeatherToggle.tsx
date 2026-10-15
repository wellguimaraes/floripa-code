import { CloudLightningIcon, CloudRainIcon } from "lucide-react";

import { Toggle } from "../ui/toggle";
import { selectRaining, selectStorm, useWorldWeatherStore } from "./worldWeatherStore";

/** Top bar toggles: rain over the world, and a storm with lightning (which brings rain). */
export function WeatherToggle() {
  const raining = useWorldWeatherStore(selectRaining);
  const storm = useWorldWeatherStore(selectStorm);
  const setRaining = useWorldWeatherStore((state) => state.setRaining);
  const setStorm = useWorldWeatherStore((state) => state.setStorm);

  return (
    <div className="surface-glass flex h-8 items-center gap-0.5 rounded-full border border-border/60 px-1 text-foreground shadow-sm">
      <Toggle
        variant="pill"
        size="xs"
        pressed={raining}
        onPressedChange={setRaining}
        aria-label="Rain"
      >
        <CloudRainIcon />
      </Toggle>
      <Toggle
        variant="pill"
        size="xs"
        pressed={storm}
        onPressedChange={setStorm}
        aria-label="Storm"
      >
        <CloudLightningIcon />
      </Toggle>
    </div>
  );
}
