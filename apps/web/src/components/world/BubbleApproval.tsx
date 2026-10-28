import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  ProviderApprovalDecision,
  RuntimeRequestId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { ShieldIcon } from "lucide-react";
import { useState } from "react";

import type { PendingApproval } from "../../session-logic";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { ComposerBanner } from "../chat/ComposerBanner";
import { ComposerPendingApprovalActions } from "../chat/ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "../chat/ComposerPendingApprovalPanel";

/**
 * The agent's oldest open approval, decided from a world bubble with the chat's own banner and
 * buttons. The next one, if any, takes its place once the server records the decision.
 */
export function BubbleApproval(props: {
  readonly threadRef: ScopedThreadRef;
  readonly approval: PendingApproval;
  readonly pendingCount: number;
  readonly onError: (message: string | null) => void;
}) {
  const { threadRef, approval, onError } = props;
  const [respondingId, setRespondingId] = useState<RuntimeRequestId | null>(null);
  const respondToApproval = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });

  const respond = async (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => {
    setRespondingId(requestId);
    const result = await respondToApproval({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, requestId, decision },
    });
    setRespondingId(null);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      onError(
        error instanceof Error && error.message !== ""
          ? error.message
          : "Could not send the decision.",
      );
    }
  };

  return (
    <ComposerBanner.Root placement="floating" variant="warning" density="spacious" className="mt-2">
      <ComposerBanner.Row layout="approval">
        <ComposerBanner.Icon>
          <ShieldIcon />
        </ComposerBanner.Icon>
        <ComposerBanner.Content>
          <ComposerPendingApprovalPanel approval={approval} pendingCount={props.pendingCount} />
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          <ComposerPendingApprovalActions
            requestId={approval.requestId}
            isResponding={respondingId === approval.requestId}
            options={approval.options}
            canRespond={approval.responseCapability === "live"}
            onRespondToApproval={respond}
          />
        </ComposerBanner.Actions>
      </ComposerBanner.Row>
    </ComposerBanner.Root>
  );
}
