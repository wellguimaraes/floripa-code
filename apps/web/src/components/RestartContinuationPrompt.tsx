import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, RestartContinuationOffer } from "@t3tools/contracts";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../hooks/useSettings";
import { type EnvironmentPresentation, useEnvironments } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

/** Titles listed before the rest collapse into "and N more". */
const LISTED_THREADS = 5;

type Answer = "never" | "no" | "yes" | "always";

/**
 * Asks, per environment, whether to resume the threads its last restart
 * interrupted. Shown only while continuing after restarts is off; the server
 * clears the offer once any client answers.
 */
export function RestartContinuationPrompt() {
  const { environments } = useEnvironments();
  return environments.map((environment) => (
    <EnvironmentRestartContinuationPrompt
      key={environment.environmentId}
      environment={environment}
      showLabel={environments.length > 1}
    />
  ));
}

function EnvironmentRestartContinuationPrompt({
  environment,
  showLabel,
}: {
  readonly environment: EnvironmentPresentation;
  readonly showLabel: boolean;
}) {
  const { environmentId } = environment;
  const canOperate = useAtomValue(
    serverEnvironment.resolveRestartContinuationOffer.permissionAtom(environmentId),
  );
  const supported =
    environment.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities.restartContinuationOffer === true;
  const offerQuery = useEnvironmentQuery(
    supported && canOperate
      ? serverEnvironment.restartContinuationOffer({ environmentId, input: {} })
      : null,
  );
  const threads = offerQuery.data?.threads ?? [];
  if (threads.length === 0) return null;
  return (
    <RestartContinuationDialog
      environmentId={environmentId}
      label={showLabel ? environment.label : null}
      threads={threads}
    />
  );
}

function RestartContinuationDialog({
  environmentId,
  label,
  threads,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string | null;
  readonly threads: RestartContinuationOffer["threads"];
}) {
  const [busy, setBusy] = useState(false);
  const resolve = useAtomCommand(serverEnvironment.resolveRestartContinuationOffer, {
    label: "restart continuation answer",
  });
  const updateSettings = useUpdateEnvironmentSettings(environmentId);

  const answer = async (choice: Answer) => {
    if (busy) return;
    setBusy(true);
    if (choice === "always") updateSettings({ continueThreadsAfterServerUpdate: true });
    if (choice === "never") updateSettings({ askToContinueThreadsAfterRestart: false });
    // The offer stream empties on success, which unmounts this dialog.
    await resolve({
      environmentId,
      input: { resume: choice === "yes" || choice === "always" },
    });
    setBusy(false);
  };

  const listed = threads.slice(0, LISTED_THREADS);
  const more = threads.length - listed.length;
  const agents = threads.length === 1 ? "an agent was" : `${threads.length} agents were`;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) void answer("no");
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Resume interrupted {threads.length === 1 ? "thread" : "threads"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {label === null ? "Floripa Code" : label} restarted while {agents} working.
          </AlertDialogDescription>
          <ul className="min-w-0 list-disc space-y-1 pl-5 text-left text-sm">
            {listed.map((thread) => (
              <li key={thread.threadId} className="truncate">
                {thread.title}
              </li>
            ))}
            {more > 0 ? <li className="text-muted-foreground">and {more} more</li> : null}
          </ul>
          <p className="text-muted-foreground text-xs">
            Always and Never apply to future restarts. Change this later in Settings → General.
          </p>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => void answer("never")}>
            Never
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void answer("no")}>
            No
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void answer("yes")}>
            Yes
          </Button>
          <Button disabled={busy} onClick={() => void answer("always")}>
            Always
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
