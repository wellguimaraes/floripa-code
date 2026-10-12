import { DEFAULT_TRANSCRIPTION_MODEL, type EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";

/**
 * Voice input in the world view: the environment records nothing itself, it
 * sends what the mic heard to OpenRouter with this key and model.
 */
export function VoiceInputSettings() {
  const { environment: selected } = useSettingsScope();
  const connected = selected?.connection.phase === "connected" && selected.serverConfig !== null;
  return (
    <SettingsSection id="voice" title="Voice input">
      {connected ? (
        <VoiceInputControls key={selected.environmentId} environmentId={selected.environmentId} />
      ) : (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Select a connected environment to set up voice input.
        </p>
      )}
    </SettingsSection>
  );
}

function VoiceInputControls({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const voice = useEnvironmentSettings(environmentId, (settings) => settings.voice);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save voice settings",
  });
  const models = useEnvironmentQuery(
    serverEnvironment.voiceTranscriptionModels({ environmentId, input: {} }),
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const keySaved = voice.openRouterApiKey !== "";
  const newKey = draft.trim();

  const save = async (patch: { openRouterApiKey?: string; transcriptionModel?: string }) => {
    setSaving(true);
    try {
      const result = await updateSettings({ environmentId, input: { patch: { voice: patch } } });
      if (result._tag === "Success" && patch.openRouterApiKey !== undefined) setDraft("");
    } finally {
      setSaving(false);
    }
  };

  // The saved model stays pickable even when OpenRouter's list drops it or has not loaded.
  const modelItems = [
    ...(models.data?.models.some((model) => model.id === voice.transcriptionModel)
      ? []
      : [{ id: voice.transcriptionModel, name: voice.transcriptionModel }]),
    ...(models.data?.models ?? []),
  ].map((model) => ({ value: model.id, label: model.name }));

  return (
    <>
      <SettingsRow
        {...searchableSetting("voice-openrouter-key")}
        serverScoped
        description={
          <>
            Speech is sent to OpenRouter to be turned into text. The key stays on this environment.{" "}
            <InlineButton
              render={
                <a
                  href="https://openrouter.ai/settings/keys"
                  target="_blank"
                  rel="noreferrer noopener"
                />
              }
            >
              Create a key
              <ExternalLinkIcon aria-hidden className="size-3" />
            </InlineButton>
          </>
        }
        control={
          <form
            className="flex w-full gap-2 sm:w-80"
            onSubmit={(event) => {
              event.preventDefault();
              if (newKey !== "") void save({ openRouterApiKey: newKey });
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              size="sm"
              aria-label="OpenRouter API key"
              placeholder={keySaved ? "Stored secret, enter a new value to replace" : "Not set"}
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
            />
            {keySaved && newKey === "" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void save({ openRouterApiKey: "" })}
              >
                Remove
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={saving || newKey === ""}>
                Save
              </Button>
            )}
          </form>
        }
      />
      <SettingsRow
        {...searchableSetting("voice-transcription-model")}
        serverScoped
        description={
          models.error
            ? `Could not load OpenRouter's models: ${models.error}`
            : "The model that turns speech into text."
        }
        resetAction={
          voice.transcriptionModel !== DEFAULT_TRANSCRIPTION_MODEL ? (
            <SettingResetButton
              label="transcription model"
              onClick={() => void save({ transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL })}
            />
          ) : null
        }
        control={
          <Select
            value={voice.transcriptionModel}
            items={modelItems}
            disabled={saving}
            onValueChange={(value: string | null) => {
              if (value !== null && value !== voice.transcriptionModel) {
                void save({ transcriptionModel: value });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-64" aria-label="Transcription model">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {modelItems.map((item) => (
                <SelectItem hideIndicator key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </>
  );
}
