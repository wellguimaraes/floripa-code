import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { usePrimaryEnvironmentId } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { toastManager } from "./ui/toast";

// One toast per failure for the app's lifetime; Settings keeps showing it until it is fixed.
const shownProblems = new Set<string>();

/** Tells the user when OpenRouter turns the primary environment's API key down. */
export function OpenRouterKeyProblemToast() {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? null : (
    <EnvironmentKeyProblemToast key={environmentId} environmentId={environmentId} />
  );
}

function EnvironmentKeyProblemToast({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const problem = useAtomValue(serverEnvironment.settingsValueAtom(environmentId))?.voice
    .openRouterApiKeyProblem;
  const navigate = useNavigate();

  useEffect(() => {
    if (problem === undefined) return;
    const shownKey = `${environmentId}:${problem.at}`;
    if (shownProblems.has(shownKey)) return;
    shownProblems.add(shownKey);
    const toastId = toastManager.add({
      type: "error",
      title:
        problem.reason === "rejected"
          ? "OpenRouter rejected the API key"
          : "OpenRouter is out of credits",
      description: "Voice input, thread retitling and branch names need a working key.",
      actionProps: {
        children: "Settings",
        onClick: () => {
          toastManager.close(toastId);
          void navigate({ to: "/settings/providers" });
        },
      },
    });
  }, [environmentId, problem, navigate]);

  return null;
}
