import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * OpenRouter features of this environment: thread retitling can ask Jev whether
 * a follow-up message moved a thread to a new task. Voice input, which also used
 * this key, is turned off (see VOICE_INPUT_ENABLED).
 */
export function VoiceInputSettings({
  environmentId,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly: boolean;
}) {
  const voice = useEnvironmentSettings(environmentId, (settings) => settings.voice);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save OpenRouter settings",
  });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const keySaved = voice.openRouterApiKey !== "";
  // With no saved key the server falls back to its OPENROUTER_API_KEY variable.
  const hasKey = keySaved || voice.openRouterApiKeyFromEnv === true;
  const newKey = draft.trim();

  const save = async (patch: { openRouterApiKey: string }) => {
    setSaving(true);
    try {
      const result = await updateSettings({ environmentId, input: { patch: { voice: patch } } });
      if (result._tag === "Success") setDraft("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection id="voice" title="OpenRouter">
      <SettingsRow
        {...searchableSetting("voice-openrouter-key")}
        serverScoped
        description={
          <>
            Used for thread retitling. The key stays on this environment.{" "}
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
            {voice.openRouterApiKeyProblem ? (
              <span className="block text-destructive">
                {voice.openRouterApiKeyProblem.reason === "rejected"
                  ? "OpenRouter rejected this key."
                  : "This key is out of OpenRouter credits."}
              </span>
            ) : null}
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
              placeholder={
                keySaved
                  ? "Stored secret, enter a new value to replace"
                  : hasKey
                    ? "Using OPENROUTER_API_KEY from the server"
                    : "Not set"
              }
              value={draft}
              disabled={saving || readOnly}
              onChange={(event) => setDraft(event.target.value)}
            />
            {keySaved && newKey === "" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={saving || readOnly}
                onClick={() => void save({ openRouterApiKey: "" })}
              >
                Remove
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={saving || readOnly || newKey === ""}>
                Save
              </Button>
            )}
          </form>
        }
      />
    </SettingsSection>
  );
}
