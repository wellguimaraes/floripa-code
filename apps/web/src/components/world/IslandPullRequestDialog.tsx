import type { EnvironmentId, PullRequestListEntry, PullRequestRef } from "@t3tools/contracts";
import { useState } from "react";

import { isElectron } from "../../env";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { PullRequestDetailPanel } from "../pullRequest/PullRequestDetailPanel";
import { Dialog, DialogPopup } from "../ui/dialog";

function getShortcutContext() {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    modelPickerOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

/**
 * A PR's details in a dialog, for one no agent on the island works on. Picking another PR from
 * inside it, a stack layer say, shows that one in its place.
 */
export function IslandPullRequestDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  /** Row fields already listed, shown while the details load. */
  readonly listEntry: PullRequestListEntry | null;
  readonly onClose: () => void;
}) {
  const { environmentId, onClose } = props;
  const [reference, setReference] = useState(props.reference);
  const listEntry = reference === props.reference ? props.listEntry : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup showCloseButton={false} className="h-[85vh] w-full max-w-5xl overflow-hidden">
        {/* The panel's header sits flush under a page's title bar; the dialog has none. */}
        <div className="min-h-0 flex-1 bg-background pt-3">
          <PullRequestDetailPanel
            key={`${reference.host ?? ""}:${reference.repository}#${reference.number}`}
            environmentId={environmentId}
            shortcutsEnabled
            getShortcutContext={getShortcutContext}
            reference={reference}
            listEntry={listEntry}
            onSelectPullRequest={setReference}
            onClose={onClose}
            inDialog
          />
        </div>
      </DialogPopup>
    </Dialog>
  );
}
