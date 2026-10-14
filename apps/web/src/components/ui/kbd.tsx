import type * as React from "react";

import { cn } from "~/lib/utils";

/** A key or shortcut. `outline` draws a bordered key instead of a filled one, e.g. inline in a line of text. */
function Kbd({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"kbd"> & { readonly variant?: "default" | "outline" }) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1",
        "rounded px-1 font-medium font-sans text-muted-foreground text-xs",
        "[&_svg:not([class*='size-'])]:size-3",
        variant === "default" && "bg-muted",
        variant === "outline" && "border border-border",
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
