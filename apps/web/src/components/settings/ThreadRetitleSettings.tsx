import type { EnvironmentId, ThreadRetitleProvider } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { THREAD_RETITLE_CHOICES, availableRetitleProviders } from "./threadRetitle";

const OFF = "off";

/** Retitling a thread when a follow-up message starts a different task, and who decides. */
export function ThreadRetitleSettings({
  environmentId,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly: boolean;
}) {
  const enabled = useEnvironmentSettings(environmentId, (settings) => settings.autoRetitleThreads);
  const provider =
    useEnvironmentSettings(environmentId, (settings) => settings.threadRetitleProvider) ??
    "openrouter";
  const voice = useEnvironmentSettings(environmentId, (settings) => settings.voice);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save thread retitling",
  });
  const [saving, setSaving] = useState(false);
  const available = availableRetitleProviders({
    providers,
    hasOpenRouterKey: voice.openRouterApiKey !== "" || voice.openRouterApiKeyFromEnv === true,
  });
  const value = enabled ? provider : OFF;
  const current = THREAD_RETITLE_CHOICES.find((choice) => choice.value === provider);
  const items = [
    { value: OFF, label: "Off" },
    ...THREAD_RETITLE_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
  ];

  const save = async (next: string) => {
    setSaving(true);
    try {
      await updateSettings({
        environmentId,
        input: {
          patch:
            next === OFF
              ? { autoRetitleThreads: false }
              : { autoRetitleThreads: true, threadRetitleProvider: next as ThreadRetitleProvider },
        },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title="Thread titles">
      <SettingsRow
        {...searchableSetting("auto-retitle-threads")}
        serverScoped
        description={
          enabled && current
            ? `${current.detail} Your messages are sent to it to decide. Threads you renamed keep their title.${
                available.has(provider) ? "" : " It is not available on this environment right now."
              }`
            : "When a follow-up message starts a different task, give the thread a new title. Threads you renamed keep their title."
        }
        control={
          <Select
            value={value}
            items={items}
            disabled={saving || readOnly}
            onValueChange={(next: string | null) => {
              if (next !== null && next !== value) void save(next);
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Retitle threads with">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {items.map((item) => (
                <SelectItem
                  hideIndicator
                  key={item.value}
                  value={item.value}
                  // The current choice stays pickable while its provider is away.
                  disabled={
                    item.value !== OFF &&
                    item.value !== value &&
                    !available.has(item.value as ThreadRetitleProvider)
                  }
                >
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
