import { useAtomValue } from "@effect/atom-react";
import { AuthSettingsWriteScope, type ServerSettingsPatch } from "@t3tools/contracts";
import { useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";

import { type EnvironmentPresentation, useEnvironments } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { readEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";

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
  const resolve = useAtomCommand(serverEnvironment.resolveRestartContinuationOffer, {
    label: "restart continuation answer",
  });
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "restart continuation preference",
  });
  const threads = offerQuery.data?.threads ?? [];
  const offerKey = threads.map((thread) => thread.threadId).join("\n");
  // An answered offer keeps streaming until the server clears it; ask once.
  const askedKey = useRef<string | null>(null);

  useEffect(() => {
    if (threads.length === 0 || askedKey.current === offerKey) return;
    askedKey.current = offerKey;
    const answer = (choice: Answer) => {
      const patch: ServerSettingsPatch | null =
        choice === "always"
          ? { continueThreadsAfterServerUpdate: true }
          : choice === "never"
            ? { askToContinueThreadsAfterRestart: false }
            : null;
      if (patch !== null && readEnvironmentScope(environmentId, AuthSettingsWriteScope))
        void updateSettings({ environmentId, input: { patch } });
      void resolve({ environmentId, input: { resume: choice === "yes" || choice === "always" } });
    };
    const listed = threads.slice(0, LISTED_THREADS).map((thread) => `• ${thread.title}`);
    const more = threads.length - listed.length;
    const agents = threads.length === 1 ? "an agent was" : `${threads.length} agents were`;
    const message = [
      `${showLabel ? environment.label : "Floripa Code"} restarted while ${agents} working:`,
      ...listed,
      ...(more > 0 ? [`and ${more} more`] : []),
    ].join("\n");
    const title = `Resume interrupted ${threads.length === 1 ? "thread" : "threads"}?`;
    if (Platform.OS === "android") {
      // Android alerts hold at most three buttons, so "Always" follows "Yes".
      Alert.alert(
        title,
        message,
        [
          { text: "Never", onPress: () => answer("never") },
          { text: "No", onPress: () => answer("no") },
          {
            text: "Yes",
            onPress: () =>
              Alert.alert(
                "Resume after future restarts too?",
                undefined,
                [
                  { text: "Just this time", onPress: () => answer("yes") },
                  { text: "Always", onPress: () => answer("always") },
                ],
                { cancelable: true, onDismiss: () => answer("yes") },
              ),
          },
        ],
        { cancelable: true, onDismiss: () => answer("no") },
      );
      return;
    }
    Alert.alert(title, message, [
      { text: "Yes", onPress: () => answer("yes") },
      { text: "Always", onPress: () => answer("always") },
      { text: "Never", style: "destructive", onPress: () => answer("never") },
      { text: "No", style: "cancel", onPress: () => answer("no") },
    ]);
  }, [environment.label, environmentId, offerKey, resolve, showLabel, threads, updateSettings]);

  return null;
}
