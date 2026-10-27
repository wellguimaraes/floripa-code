import type { CSSProperties, ComponentProps } from "react";

import { cn } from "~/lib/utils";

/**
 * A native range input with a thin, light track filled up to the thumb. `muted`
 * fades and desaturates the whole slider, for a value something other than the user is setting.
 */
function Slider({
  className,
  style,
  value,
  min = 0,
  max = 100,
  muted = false,
  ...props
}: Omit<ComponentProps<"input">, "type" | "value" | "min" | "max"> & {
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly muted?: boolean;
}) {
  const progress = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      data-slot="slider"
      data-muted={muted || undefined}
      className={cn("slider", className)}
      style={{ "--slider-progress": progress, ...style } as CSSProperties}
      {...props}
    />
  );
}

export { Slider };
