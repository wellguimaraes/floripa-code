import { useNavigate } from "@tanstack/react-router";
import { RocketIcon } from "lucide-react";

import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Dev desktop only: a top bar button that reopens the first-run wizard without
 * resetting app state. Renders nothing elsewhere.
 */
export function DevOnboardingButton({ variant }: { readonly variant: "ghost" | "glass" }) {
  const navigate = useNavigate();
  if (!isElectron || !import.meta.env.DEV) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Open onboarding"
            className="relative z-10 shrink-0"
            onClick={() => void navigate({ to: "/welcome" })}
            size={variant === "glass" ? "icon" : "icon-sm"}
            variant={variant}
          >
            <RocketIcon />
          </Button>
        }
      />
      <TooltipPopup side="bottom">Open onboarding (dev)</TooltipPopup>
    </Tooltip>
  );
}
