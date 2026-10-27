import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ProjectScript, ScopedThreadRef } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { projectScriptCwd, resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { useMemo } from "react";

import { usePackageScripts } from "~/hooks/usePackageScripts";
import { packageScriptAsProjectScript } from "~/packageScripts";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useProject, useThreadShell } from "~/state/entities";
import { serverEnvironment } from "~/state/server";

import { ProjectActionsList } from "../ProjectScriptsControl";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { useWorldModeStore } from "./worldModeStore";

/**
 * An island's "Run script": the agent's project commands and package scripts, without opening
 * its chat. Picking one asks that chat to run it (see `scriptRun`), then `onRun` opens it.
 */
export function IslandRunScriptDialog(props: {
  readonly agentRef: ScopedThreadRef | null;
  readonly onClose: () => void;
  readonly onRun: (ref: ScopedThreadRef) => void;
}) {
  return (
    <Dialog open={props.agentRef !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">Run script</DialogTitle>
        {props.agentRef !== null ? (
          <IslandScriptList agentRef={props.agentRef} onClose={props.onClose} onRun={props.onRun} />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function IslandScriptList(props: {
  readonly agentRef: ScopedThreadRef;
  readonly onClose: () => void;
  readonly onRun: (ref: ScopedThreadRef) => void;
}) {
  const { environmentId } = props.agentRef;
  const thread = useThreadShell(props.agentRef);
  const project = useProject(thread ? scopeProjectRef(environmentId, thread.projectId) : null);
  const settings = useEnvironmentSettings(environmentId);
  const scripts = useMemo(
    () => (project ? resolveProjectScripts(settings, project) : []),
    [project, settings],
  );
  const cwd = project
    ? projectScriptCwd({
        project: { cwd: project.workspaceRoot },
        worktreePath: thread?.worktreePath ?? null,
      })
    : null;
  const packageScripts = usePackageScripts(environmentId, cwd);
  const keybindings =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.keybindings ??
    DEFAULT_RESOLVED_KEYBINDINGS;
  const run = (script: ProjectScript, remember: boolean) => {
    useWorldModeStore
      .getState()
      .requestScriptRun(scopedThreadKey(props.agentRef), script, remember);
    props.onRun(props.agentRef);
  };
  return (
    <ProjectActionsList
      onDone={props.onClose}
      keybindings={keybindings}
      scripts={scripts}
      importableScripts={[]}
      packageScripts={packageScripts}
      onRunScript={(script) => run(script, true)}
      onRunPackageScript={(script) => run(packageScriptAsProjectScript(script), false)}
    />
  );
}
