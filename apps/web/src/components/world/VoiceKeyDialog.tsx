import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import type { VoiceKeyPrompt } from "./useVoiceInput";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

/**
 * Asks for the OpenRouter key voice input needs, right where the mic was
 * pressed. Saved to the environment like the one in Settings → Integrations.
 */
export function VoiceKeyDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly reason: VoiceKeyPrompt;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { environmentId, reason, onClose, onSaved } = props;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newKey = key.trim();

  const save = async () => {
    if (newKey === "" || saving) return;
    setSaving(true);
    setError(null);
    const result = await updateSettings({
      environmentId,
      input: { patch: { voice: { openRouterApiKey: newKey } } },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error && failure.message !== ""
          ? failure.message
          : "Could not save the key.",
      );
      return;
    }
    onSaved();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {reason === "rejected" ? "OpenRouter rejected the key" : "Add an OpenRouter API key"}
            </DialogTitle>
            <DialogDescription>
              Voice input sends what you say to OpenRouter to turn it into text.
              {reason === "rejected" ? " Enter a key that works to try again." : null}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              type="password"
              autoComplete="off"
              autoFocus
              aria-label="OpenRouter API key"
              placeholder="sk-or-…"
              value={key}
              disabled={saving}
              onChange={(event) => {
                setKey(event.target.value);
                setError(null);
              }}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              No key yet?{" "}
              <InlineButton
                render={<a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer noopener" />}
              >
                Create one on OpenRouter
                <ExternalLinkIcon aria-hidden className="size-3" />
              </InlineButton>
              . It stays on this environment; change it later in Settings → Integrations.
            </p>
            {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={newKey === "" || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
