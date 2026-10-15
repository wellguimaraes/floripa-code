import { CloudRainIcon } from "lucide-react";

import { Toggle } from "../ui/toggle";
import { selectRaining, useWorldWeatherStore } from "./worldWeatherStore";

/** Top bar toggle: rain over the world. */
export function WeatherToggle() {
  const raining = useWorldWeatherStore(selectRaining);
  const setRaining = useWorldWeatherStore((state) => state.setRaining);

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
    </div>
  );
}
