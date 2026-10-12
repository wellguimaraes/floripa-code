import { cn } from "../../lib/utils";
import { palette } from "./scene/palette";

/** One swatch per family colour; the picked one is ringed. */
export function HuePicker(props: {
  readonly hue: number;
  readonly onChange: (hue: number) => void;
  readonly label?: string;
}) {
  const { hue, onChange, label = "Agent color" } = props;
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
      {palette.families.map((shades, index) => (
        <button
          key={shades.base}
          type="button"
          role="radio"
          aria-checked={index === hue}
          aria-label={`Color ${index + 1}`}
          className={cn(
            "size-5 cursor-pointer rounded-full outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            index === hue && "ring-3 ring-foreground/85 ring-inset",
          )}
          style={{ backgroundColor: shades.base }}
          onClick={() => onChange(index)}
        />
      ))}
    </div>
  );
}
