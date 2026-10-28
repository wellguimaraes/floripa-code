import { ContrastIcon } from "lucide-react";

import { Slider } from "../ui/slider";
import { useWorldContrastStore } from "./worldContrastStore";

/** Top bar slider: higher contrast greys out the world so the characters stand out. */
export function ContrastSlider() {
  const contrast = useWorldContrastStore((state) => state.contrast);
  const setContrast = useWorldContrastStore((state) => state.setContrast);

  return (
    <label className="surface-glass flex h-9 sm:h-8 items-center gap-2 rounded-full border border-border/60 px-3 text-foreground shadow-sm">
      <ContrastIcon className="size-4 text-muted-foreground" />
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={contrast}
        onChange={(event) => setContrast(event.currentTarget.valueAsNumber)}
        aria-label="Contrast"
        className="w-14"
      />
    </label>
  );
}
