import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";

import { readEnvironmentScope } from "../../state/session";

/**
 * Whether this connection may change an island's project, its icon and removal
 * alike: the same operate scope is needed on every checkout the island groups.
 */
export function canOperateIsland(checkouts: ReadonlyArray<EnvironmentProject>): boolean {
  return (
    checkouts.length > 0 &&
    checkouts.every((checkout) =>
      readEnvironmentScope(checkout.environmentId, AuthOrchestrationOperateScope),
    )
  );
}
