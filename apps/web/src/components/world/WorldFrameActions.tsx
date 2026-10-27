import type {
  EditorId,
  EnvironmentId,
  ProjectScript,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import type { ComponentProps } from "react";

import { useT3ProjectFileScripts } from "~/hooks/useT3ProjectFileScripts";
import type { PackageScript } from "~/packageScripts";

import { OpenInPicker } from "../chat/OpenInPicker";
import ProjectScriptsControl from "../ProjectScriptsControl";

type ScriptsControlProps = ComponentProps<typeof ProjectScriptsControl>;

/**
 * The world chat frame's trailing buttons: the project's actions and the worktree's package
 * scripts behind a play button, and the editors to open the worktree with. ChatView owns the
 * editor shortcut, so this picker skips it.
 */
export function WorldFrameActions(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly showOpenIn: boolean;
  /** Null without a project to keep actions for. */
  readonly scripts: ReadonlyArray<ProjectScript> | null;
  readonly preferredScriptId: string | null;
  readonly onRunScript: (script: ProjectScript) => void;
  readonly onAddScript: ScriptsControlProps["onAddScript"];
  readonly onUpdateScript: ScriptsControlProps["onUpdateScript"];
  readonly onDeleteScript: ScriptsControlProps["onDeleteScript"];
  readonly onRunPackageScript: (script: PackageScript) => void;
}) {
  const fileScripts = useT3ProjectFileScripts(
    props.environmentId,
    props.scripts ? props.cwd : null,
  );
  return (
    <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
      {props.scripts ? (
        <ProjectScriptsControl
          presentation="icon"
          environmentId={props.environmentId}
          scripts={props.scripts}
          fileScripts={fileScripts}
          preferredScriptId={props.preferredScriptId}
          onRunScript={props.onRunScript}
          onAddScript={props.onAddScript}
          onUpdateScript={props.onUpdateScript}
          onDeleteScript={props.onDeleteScript}
          packageScriptsCwd={props.cwd}
          onRunPackageScript={props.onRunPackageScript}
        />
      ) : null}
      {props.showOpenIn ? (
        <OpenInPicker
          presentation="icon"
          environmentId={props.environmentId}
          keybindings={props.keybindings}
          availableEditors={props.availableEditors}
          openInCwd={props.cwd}
          enableShortcut={false}
        />
      ) : null}
    </div>
  );
}
