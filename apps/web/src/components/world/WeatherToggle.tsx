import { CloudLightningIcon, CloudRainIcon } from "lucide-react";

import { Toggle } from "../ui/toggle";
import {
  selectRaining,
  selectStorm,
  useLiveWeather,
  useWorldWeatherStore,
} from "./worldWeatherStore";

/**
 * Top bar toggles: rain over the world, a storm with lightning (which brings
 * rain), and Auto, which follows the real weather here. Picking rain or storm
 * turns Auto off.
 */
export function WeatherToggle() {
  useLiveWeather();
  const raining = useWorldWeatherStore(selectRaining);
  const storm = useWorldWeatherStore(selectStorm);
  const auto = useWorldWeatherStore((state) => state.auto);
  const setRaining = useWorldWeatherStore((state) => state.setRaining);
  const setStorm = useWorldWeatherStore((state) => state.setStorm);
  const setAuto = useWorldWeatherStore((state) => state.setAuto);

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
      <Toggle
        variant="pill"
        size="xs"
        pressed={auto}
        onPressedChange={setAuto}
        aria-label="Follow the real weather here"
      >
        Auto
      </Toggle>
    </div>
  );
}
