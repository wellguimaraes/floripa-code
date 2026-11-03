import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useEnvironments } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * The mainland is always on the map: for each connected environment that
 * offers threads without a project, makes its "No project" project once if
 * this client has none yet. The server finds the one it has, so asking twice
 * is harmless. A connection that may not create projects just goes without.
 */
export function useEnsureMainland(projects: ReadonlyArray<EnvironmentProject>) {
  const { environments } = useEnvironments();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, {
    reportFailure: false,
    reportDefect: false,
  });
  const asked = useRef(new Set<EnvironmentId>());
  useEffect(() => {
    for (const environment of environments) {
      const { environmentId } = environment;
      const root = availableScratchWorkspaceRoot(
        environment.connection.phase,
        environment.serverConfig,
      );
      if (root === null || asked.current.has(environmentId)) continue;
      const has = projects.some(
        (project) => project.environmentId === environmentId && isScratchProject(project, root),
      );
      if (has) continue;
      asked.current.add(environmentId);
      void openScratch({ environmentId, input: {} });
    }
  }, [environments, projects, openScratch]);
}
