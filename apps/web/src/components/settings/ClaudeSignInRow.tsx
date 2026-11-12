import {
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";
import { TerminalIcon } from "lucide-react";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";

import { resolveOnboardingProviderLoginCommand } from "../../onboarding/providerReadiness.logic";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { ProviderSetupTerminal } from "./ProviderSetupTerminal";
import { SettingsRow } from "./settingsLayout";

/**
 * Claude has no in-app auth flow, so sign-in runs `claude auth login` in a
 * terminal on the provider's environment. The server's terminal already applies
 * the instance's CLAUDE_CONFIG_DIR, so a second instance logs into its own account.
 */
export function ClaudeSignInRow({
  environmentId,
  environmentLabel,
  provider,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly provider: ServerProvider;
}) {
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [command, setCommand] = useState<string | null>(null);

  return (
    <>
      <SettingsRow
        title="Claude account"
        description={`Sign in on ${environmentLabel}. This instance keeps its own login when it has a CLAUDE_CONFIG_DIR path.`}
        control={
          <Button
            size="xs"
            variant="outline"
            disabled={command !== null || serverConfig === null || !canOperateTerminal}
            onClick={() => {
              if (serverConfig === null) return;
              setCommand(
                resolveOnboardingProviderLoginCommand(
                  provider,
                  serverConfig.settings,
                  serverConfig.environment.platform.os,
                ),
              );
            }}
          >
            <TerminalIcon className="size-3.5" />
            Sign in
          </Button>
        }
      />
      {command !== null && serverConfig !== null ? (
        <div className="px-4 pb-3">
          <ProviderSetupTerminal
            autoRun
            session={{
              environmentId,
              driver: provider.driver,
              providerInstanceId: provider.instanceId,
              cwd: serverConfig.cwd,
              command,
              keybindings: serverConfig.keybindings,
            }}
            onClose={() => {
              setCommand(null);
              void refreshProviders({ environmentId, input: {} });
            }}
          />
        </div>
      ) : null}
    </>
  );
}
