import { MegaphoneIcon, MegaphoneOffIcon } from "lucide-react";

import { Toggle } from "../ui/toggle";
import { useWorldManagerStore } from "./worldManagerStore";

/** Top bar toggle: shows or hides every island's manager. */
export function ManagerToggle() {
  const enabled = useWorldManagerStore((state) => state.enabled);
  const setEnabled = useWorldManagerStore((state) => state.setEnabled);
  return (
    <div className="surface-glass flex h-8 items-center rounded-full border border-border/60 px-1 text-foreground shadow-sm">
      <Toggle
        variant="pill"
        size="xs"
        pressed={enabled}
        onPressedChange={setEnabled}
        aria-label={enabled ? "Hide the island managers" : "Show the island managers"}
      >
        {enabled ? <MegaphoneIcon /> : <MegaphoneOffIcon />}
      </Toggle>
    </div>
  );
}
