import type { EnvironmentId, ServerSettingsPatch, ThreadRetitleProvider } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { THREAD_RETITLE_CHOICES, availableRetitleProviders } from "../settings/threadRetitle";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Radio, RadioGroup } from "../ui/radio-group";

const OFF = "off";

/** One environment's answer to the onboarding retitle question; each pick saves right away. */
export function ThreadRetitleChoice({
  environmentId,
  machineLabel,
}: {
  readonly environmentId: EnvironmentId;
  /** Shown when the wizard sets up more than one computer. */
  readonly machineLabel?: string | undefined;
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
  // OpenRouter picked before a key exists waits here for one.
  const [needsKey, setNeedsKey] = useState(false);
  const [draft, setDraft] = useState("");
  const keyFromEnv = voice.openRouterApiKey === "" && voice.openRouterApiKeyFromEnv === true;
  const hasKey = voice.openRouterApiKey !== "" || keyFromEnv;
  const available = availableRetitleProviders({ providers, hasOpenRouterKey: hasKey });
  const value = needsKey ? "openrouter" : enabled ? provider : OFF;

  const save = async (patch: ServerSettingsPatch) => {
    setSaving(true);
    try {
      return await updateSettings({ environmentId, input: { patch } });
    } finally {
      setSaving(false);
    }
  };

  const choose = (next: string) => {
    if (next === "openrouter" && !hasKey) {
      setNeedsKey(true);
      return;
    }
    setNeedsKey(false);
    void save(
      next === OFF
        ? { autoRetitleThreads: false }
        : { autoRetitleThreads: true, threadRetitleProvider: next as ThreadRetitleProvider },
    );
  };

  const saveKey = async () => {
    const key = draft.trim();
    if (key === "") return;
    const result = await save({
      voice: { openRouterApiKey: key },
      autoRetitleThreads: true,
      threadRetitleProvider: "openrouter",
    });
    if (result._tag === "Success") {
      setDraft("");
      setNeedsKey(false);
    }
  };

  return (
    <div className="space-y-2">
      {machineLabel ? <p className="text-sm font-medium text-foreground">{machineLabel}</p> : null}
      <RadioGroup
        aria-label="Retitle threads with"
        value={value}
        disabled={saving}
        onValueChange={(next) => choose(String(next))}
      >
        {THREAD_RETITLE_CHOICES.map((choice) => {
          // OpenRouter stays pickable without a key: picking it asks for one.
          const usable = choice.value === "openrouter" || available.has(choice.value);
          return (
            <label
              key={choice.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-3 py-2.5 has-data-disabled:cursor-default has-data-disabled:opacity-64"
            >
              <Radio value={choice.value} disabled={!usable} className="mt-0.5" />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-medium text-foreground">{choice.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {choice.value === "openrouter" && keyFromEnv
                    ? `${choice.detail} Uses OPENROUTER_API_KEY from this computer.`
                    : usable
                      ? choice.detail
                      : "Sign in to this provider to use it."}
                </span>
              </span>
            </label>
          );
        })}
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
          <Radio value={OFF} />
          <span className="text-sm font-medium text-foreground">Don't retitle threads</span>
        </label>
      </RadioGroup>
      {needsKey ? (
        <form
          className="flex gap-2 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            void saveKey();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            size="sm"
            aria-label="OpenRouter API key"
            placeholder="Paste an OpenRouter API key"
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={saving || draft.trim() === ""}>
            Save
          </Button>
        </form>
      ) : null}
    </div>
  );
}
