import { ThreadDetailsControl } from "./chat/ThreadDetailsControl";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectScript,
  type T3ProjectFileScript,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { projectScriptMenuLabel } from "@t3tools/shared/projectScripts";
import {
  ChevronDownIcon,
  CirclePlayIcon,
  DownloadIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  SquarePlayIcon,
  WrenchIcon,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import { commandForProjectScript, primaryProjectScript } from "~/projectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import { serverEnvironment } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  ProjectScriptEditorDialog,
  ScriptIcon,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptEditorRequest,
} from "./projectScriptEditor";
import { Button } from "./ui/button";
import { Group, GroupSeparator } from "./ui/group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "./ui/menu";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./ui/command";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { usePackageScripts } from "~/hooks/usePackageScripts";
import type { PackageScript } from "~/packageScripts";
import { cn } from "~/lib/utils";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./chat/threadDetailsPanelStyles";

export type { NewProjectScriptInput, ProjectScriptActionResult };

const NO_FILE_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

interface ProjectScriptsControlProps {
  displayMode?: "toolbar" | "panel";
  /** `icon` is a single play button opening every action, as the world's chat frame shows it. */
  presentation?: "toolbar" | "menu" | "icon";
  onRequestMenuClose?: () => void;
  environmentId: EnvironmentId;
  scripts: ReadonlyArray<ProjectScript>;
  /** Scripts declared in the project's checked-in t3.json, offered for import. */
  fileScripts?: ReadonlyArray<T3ProjectFileScript>;
  preferredScriptId?: string | null;
  onRunScript?: ((script: ProjectScript) => void) | undefined;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  /** The `icon` popover also lists the scripts the manifests at this directory declare. */
  packageScriptsCwd?: string | null;
  onRunPackageScript?: ((script: PackageScript) => void) | undefined;
}

export default function ProjectScriptsControl({
  displayMode = "toolbar",
  presentation = "toolbar",
  onRequestMenuClose,
  environmentId,
  scripts,
  fileScripts = NO_FILE_SCRIPTS,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
  packageScriptsCwd = null,
  onRunPackageScript,
}: ProjectScriptsControlProps) {
  const isPanel = displayMode === "panel";
  const ActionGroup = isPanel ? "div" : Group;
  const panelAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const keybindings =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.keybindings ??
    DEFAULT_RESOLVED_KEYBINDINGS;
  const [actionsMenuOpen, setActionsMenuOpen] = useState({
    presentation,
    scripts: false,
    imports: false,
  });
  if (actionsMenuOpen.presentation !== presentation) {
    setActionsMenuOpen({ presentation, scripts: false, imports: false });
  }
  const [editorRequest, setEditorRequest] = useState<ProjectScriptEditorRequest | null>(null);
  // Read only while the popover shows them.
  const packageScripts = usePackageScripts(
    environmentId,
    presentation === "icon" && actionsMenuOpen.scripts ? packageScriptsCwd : null,
  );

  const primaryScript = useMemo(() => {
    if (preferredScriptId) {
      const preferred = scripts.find((script) => script.id === preferredScriptId);
      if (preferred) return preferred;
    }
    return primaryProjectScript(scripts);
  }, [preferredScriptId, scripts]);
  const importableScripts = useMemo(
    () =>
      fileScripts.filter(
        (fileScript) =>
          !scripts.some(
            (script) =>
              script.command === fileScript.command ||
              script.name.toLowerCase() === fileScript.name.toLowerCase(),
          ),
      ),
    [fileScripts, scripts],
  );

  const openAddDialog = () => {
    setEditorRequest({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT });
  };

  const openEditDialog = (script: ProjectScript) => {
    onRequestMenuClose?.();
    setActionsMenuOpen({ presentation, scripts: false, imports: false });
    setEditorRequest(editorRequestForScript(script, keybindings));
  };

  const submitScript = useCallback(
    (scriptId: string | null, input: NewProjectScriptInput) =>
      scriptId === null ? onAddScript(input) : onUpdateScript(scriptId, input),
    [onAddScript, onUpdateScript],
  );

  const importFileScript = async (fileScript: T3ProjectFileScript) => {
    const payload: NewProjectScriptInput = {
      name: fileScript.name,
      command: fileScript.command,
      icon: fileScript.icon ?? "play",
      runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
      waitForSetup: fileScript.runOnWorktreeCreate === true && fileScript.async === false,
      runOnSettle: fileScript.runOnSettle ?? false,
      ...(readEnvironmentScope(environmentId, AuthSettingsWriteScope) ? { keybinding: null } : {}),
      previewUrl: fileScript.previewUrl ?? null,
      autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
    };
    const result = await onAddScript(payload);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      // Surface the failure through the regular add dialog, prefilled so the
      // user can adjust and retry.
      const error = squashAtomCommandFailure(result);
      setEditorRequest({
        scriptId: null,
        initial: payload,
        error: error instanceof Error ? error.message : "Failed to import action.",
      });
    }
  };

  const importMenuItems = importableScripts.length > 0 && (
    <>
      {scripts.length > 0 && <MenuSeparator />}
      <MenuGroup>
        <MenuGroupLabel>From t3.json</MenuGroupLabel>
        {importableScripts.map((fileScript) => (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            key={`${fileScript.name} ${fileScript.command}`}
            onClick={() => void importFileScript(fileScript)}
          >
            <ScriptIcon icon={fileScript.icon ?? "play"} className="size-4" />
            <MenuItemLabel>{fileScript.name}</MenuItemLabel>
            <MenuShortcut>
              <DownloadIcon className="size-3.5" aria-label="Import" />
            </MenuShortcut>
          </MenuItem>
        ))}
      </MenuGroup>
    </>
  );

  const scriptItems = (
    <>
      {scripts.map((script) => {
        const shortcutLabel = shortcutLabelForCommand(
          keybindings,
          commandForProjectScript(script.id),
        );
        return (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            key={script.id}
            className="group"
            disabled={!onRunScript}
            onClick={() => onRunScript?.(script)}
          >
            <ScriptIcon icon={script.icon} className="size-4" />
            <MenuItemLabel>{projectScriptMenuLabel(script)}</MenuItemLabel>
            <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
              {shortcutLabel &&
                (presentation === "menu" ? (
                  <MenuShortcut className="ms-0 mr-7">{shortcutLabel}</MenuShortcut>
                ) : (
                  // The shortcut yields its slot to the edit button on hover.
                  <span className="transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                    <MenuShortcut className="ms-0">{shortcutLabel}</MenuShortcut>
                  </span>
                ))}
              <span
                className={`absolute right-0 top-1/2 flex -translate-y-1/2 ${presentation === "menu" ? "" : "opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"}`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  aria-label={`Edit ${script.name}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openEditDialog(script);
                  }}
                >
                  <SettingsIcon className="size-3.5" />
                </Button>
              </span>
            </span>
          </MenuItem>
        );
      })}
      {importMenuItems}
      <MenuItem density={presentation === "menu" ? "touch" : "default"} onClick={openAddDialog}>
        <PlusIcon className="size-4" />
        <MenuItemLabel>{isPanel ? "Add project script" : "Add action"}</MenuItemLabel>
      </MenuItem>
    </>
  );

  return (
    <>
      {presentation === "icon" ? (
        <ProjectActionsPopover
          open={actionsMenuOpen.scripts}
          onOpenChange={(open) =>
            setActionsMenuOpen({ presentation, scripts: open, imports: false })
          }
          keybindings={keybindings}
          scripts={scripts}
          importableScripts={importableScripts}
          packageScripts={onRunPackageScript ? packageScripts : []}
          onRunScript={onRunScript}
          onRunPackageScript={(script) => onRunPackageScript?.(script)}
          onEditScript={openEditDialog}
          onImportScript={(fileScript) => void importFileScript(fileScript)}
          onAddScript={openAddDialog}
        />
      ) : presentation === "menu" ? (
        <>
          {primaryScript && (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              disabled={!onRunScript}
              onClick={() => onRunScript?.(primaryScript)}
            >
              <ScriptIcon icon={primaryScript.icon} className="size-4" />
              <MenuItemLabel>Run {primaryScript.name}</MenuItemLabel>
              <MenuShortcut>
                {shortcutLabelForCommand(keybindings, commandForProjectScript(primaryScript.id))}
              </MenuShortcut>
            </MenuItem>
          )}
          {scripts.length > 0 || importableScripts.length > 0 ? (
            <MenuSub
              open={actionsMenuOpen.scripts}
              onOpenChange={(open) =>
                setActionsMenuOpen({ presentation, scripts: open, imports: false })
              }
            >
              <MenuSubTrigger density="touch">
                <ScriptIcon icon="play" className="size-4" />
                <MenuItemLabel>Project actions</MenuItemLabel>
              </MenuSubTrigger>
              <MenuSubPopup>{scriptItems}</MenuSubPopup>
            </MenuSub>
          ) : (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              onClick={openAddDialog}
            >
              <PlusIcon className="size-4" />
              <MenuItemLabel>Add project action…</MenuItemLabel>
            </MenuItem>
          )}
        </>
      ) : primaryScript ? (
        <ActionGroup
          role="group"
          aria-label="Project scripts"
          {...(isPanel
            ? { className: THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS, ref: panelAnchorRef }
            : {})}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  size="xs"
                  variant={isPanel ? "ghost" : "outline"}
                  part="primary"
                  panel={isPanel}
                  className={isPanel ? undefined : "w-7 sm:w-6 @3xl/header-actions:w-auto!"}
                  aria-label={`Run ${primaryScript.name}`}
                  // The tooltip wrapper replaces data-slot="button", so themed
                  // toolbar styling needs its own hook.
                  data-toolbar-control=""
                  aria-disabled={!onRunScript || undefined}
                  onClick={() => onRunScript?.(primaryScript)}
                />
              }
            >
              <ScriptIcon
                icon={primaryScript.icon}
                {...(isPanel ? { className: THREAD_DETAILS_PANEL_ICON_CLASS } : {})}
              />
              <span
                className={cn(
                  "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5",
                  isPanel && cn("not-sr-only ml-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS),
                )}
              >
                {primaryScript.name}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top">
              {onRunScript
                ? `Run ${primaryScript.name}`
                : "Pair this client again with permission to run terminal commands."}
            </TooltipPopup>
          </Tooltip>
          {isPanel ? (
            <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
          ) : (
            <GroupSeparator className="hidden @3xl/header-actions:block" />
          )}
          <Menu
            open={actionsMenuOpen.scripts}
            onOpenChange={(open) =>
              setActionsMenuOpen({ presentation, scripts: open, imports: false })
            }
          >
            <MenuTrigger
              render={
                <ThreadDetailsControl
                  size={isPanel ? "sm" : "icon-xs"}
                  variant={isPanel ? "ghost" : "outline"}
                  part="secondary"
                  panel={isPanel}
                  aria-label="Script actions"
                />
              }
            >
              <ChevronDownIcon
                className={isPanel ? THREAD_DETAILS_PANEL_CHEVRON_CLASS : "size-4"}
              />
            </MenuTrigger>
            <MenuPopup
              align="end"
              {...(isPanel ? { anchor: panelAnchorRef } : {})}
              className={isPanel ? "w-(--anchor-width)" : undefined}
            >
              {scriptItems}
            </MenuPopup>
          </Menu>
        </ActionGroup>
      ) : scripts.length > 0 || importableScripts.length > 0 ? (
        // No one-click action (only a settle action, or only t3.json imports),
        // so the saved actions stay reachable through this menu.
        isPanel ? (
          <div
            role="group"
            aria-label="Project actions"
            className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}
            ref={panelAnchorRef}
          >
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="primary"
              aria-label="Project actions"
              onClick={() => setActionsMenuOpen({ presentation, scripts: false, imports: true })}
            >
              <WrenchIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
              <span className={cn("min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
                Actions
              </span>
            </ThreadDetailsControl>
            <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
            <Menu
              highlightItemOnHover={false}
              open={actionsMenuOpen.imports}
              onOpenChange={(open) =>
                setActionsMenuOpen({ presentation, scripts: false, imports: open })
              }
            >
              <MenuTrigger
                render={
                  <ThreadDetailsControl
                    size="sm"
                    variant="ghost"
                    part="secondary"
                    aria-label="Choose project action"
                  />
                }
              >
                <ChevronDownIcon className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
              </MenuTrigger>
              <MenuPopup align="end" anchor={panelAnchorRef} className="w-(--anchor-width)">
                {scriptItems}
              </MenuPopup>
            </Menu>
          </div>
        ) : (
          <Menu
            highlightItemOnHover={false}
            open={actionsMenuOpen.imports}
            onOpenChange={(open) =>
              setActionsMenuOpen({ presentation, scripts: false, imports: open })
            }
          >
            <MenuTrigger
              render={<Button size="xs" variant="outline" aria-label="Project actions" />}
            >
              <WrenchIcon className="size-3.5" />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                Actions
              </span>
              <ChevronDownIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end">{scriptItems}</MenuPopup>
          </Menu>
        )
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="xs"
                variant={isPanel ? "ghost" : "outline"}
                part="row"
                panel={isPanel}
                className={isPanel ? undefined : "w-7 sm:w-6 @3xl/header-actions:w-auto!"}
                aria-label={isPanel ? "Add project script" : "Add action"}
                // The tooltip wrapper replaces data-slot="button", so themed
                // toolbar styling needs its own hook.
                data-toolbar-control=""
                onClick={openAddDialog}
              />
            }
          >
            <PlusIcon className="size-3.5" />
            <span
              className={cn(
                "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5",
                isPanel && cn("not-sr-only ml-0.5", THREAD_DETAILS_PANEL_LABEL_CLASS),
              )}
            >
              {isPanel ? "Add project script" : "Add action"}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top">{isPanel ? "Add project script" : "Add action"}</TooltipPopup>
        </Tooltip>
      )}

      <ProjectScriptEditorDialog
        environmentId={environmentId}
        request={editorRequest}
        scripts={scripts}
        onSubmit={submitScript}
        onDelete={(scriptId) => void onDeleteScript(scriptId)}
        onClose={() => setEditorRequest(null)}
      />
    </>
  );
}

/**
 * The project's actions, its t3.json imports, and its manifests' scripts in one searchable list
 * behind a play button. Arrow keys move through every row; Enter runs the highlighted one.
 */
/**
 * The project's commands, its t3.json imports, and its manifests' scripts in one searchable list.
 * Arrow keys move through every row; Enter runs the highlighted one. Without the edit, import,
 * and add handlers it only runs.
 */
export function ProjectActionsList(props: {
  /** Closes whatever holds the list; each row calls it before acting. */
  onDone: () => void;
  keybindings: ResolvedKeybindingsConfig;
  scripts: ReadonlyArray<ProjectScript>;
  importableScripts: ReadonlyArray<T3ProjectFileScript>;
  packageScripts: ReadonlyArray<PackageScript>;
  onRunScript: ((script: ProjectScript) => void) | undefined;
  onRunPackageScript: (script: PackageScript) => void;
  onEditScript?: ((script: ProjectScript) => void) | undefined;
  onImportScript?: ((script: T3ProjectFileScript) => void) | undefined;
  onAddScript?: (() => void) | undefined;
}) {
  const { onEditScript, onImportScript, onAddScript } = props;
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const matches = (...fields: ReadonlyArray<string>) =>
    search === "" || fields.some((field) => field.toLocaleLowerCase().includes(search));
  const scripts = props.scripts.filter((script) => matches(script.name, script.command));
  const imports = onImportScript
    ? props.importableScripts.filter((script) => matches(script.name, script.command))
    : [];
  const packageGroups = new Map<string, PackageScript[]>();
  for (const script of props.packageScripts) {
    if (!matches(script.name, script.command)) continue;
    packageGroups.set(script.runner, [...(packageGroups.get(script.runner) ?? []), script]);
  }
  // Each row closes the list before acting, so a dialog it opens takes focus.
  const act = (run: () => void) => () => {
    props.onDone();
    run();
  };
  return (
    <Command mode="none" value={query} onValueChange={setQuery} aria-label="Project actions">
      <div className="flex items-center border-border border-b pe-2">
        <div className="min-w-0 flex-1">
          <CommandInput placeholder="Search actions and scripts..." />
        </div>
        {onAddScript ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add action"
                  onClick={act(onAddScript)}
                />
              }
            >
              <PlusIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Add action</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {scripts.length === 0 && imports.length === 0 && packageGroups.size === 0 ? (
        <p className="px-4 pt-2 pb-5 text-center text-muted-foreground text-sm">
          {search === "" ? "No actions or scripts yet." : "No matches."}
        </p>
      ) : null}
      {/* Square, so the scroll area does not inherit the popup's rounded corners. */}
      <div className="grid max-h-96 grid-rows-[minmax(0,1fr)] rounded-none">
        <CommandList>
          {scripts.length > 0 ? (
            <CommandGroup>
              <CommandGroupLabel>Custom commands</CommandGroupLabel>
              {scripts.map((script) => {
                const shortcutLabel = shortcutLabelForCommand(
                  props.keybindings,
                  commandForProjectScript(script.id),
                );
                return (
                  <CommandItem
                    key={script.id}
                    value={`action:${script.id}`}
                    className="group"
                    disabled={!props.onRunScript}
                    onClick={act(() => props.onRunScript?.(script))}
                  >
                    <CirclePlayIcon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {projectScriptMenuLabel(script)}
                    </span>
                    {shortcutLabel ? (
                      <CommandShortcut className={cn(onEditScript && "group-hover:hidden")}>
                        {shortcutLabel}
                      </CommandShortcut>
                    ) : null}
                    {onEditScript ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="hidden size-6 group-hover:flex"
                        aria-label={`Edit ${script.name}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          act(() => onEditScript(script))();
                        }}
                      >
                        <SettingsIcon className="size-3.5" />
                      </Button>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
          {imports.length > 0 ? (
            <CommandGroup>
              <CommandGroupLabel>From t3.json</CommandGroupLabel>
              {imports.map((script) => (
                <CommandItem
                  key={`${script.name} ${script.command}`}
                  value={`import:${script.name}:${script.command}`}
                  onClick={act(() => onImportScript?.(script))}
                >
                  <ScriptIcon icon={script.icon ?? "play"} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{script.name}</span>
                  <DownloadIcon className="size-3.5 text-muted-foreground" aria-label="Import" />
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {[...packageGroups].map(([runner, runnerScripts]) => (
            <CommandGroup key={runner}>
              <CommandGroupLabel>{runner}</CommandGroupLabel>
              {runnerScripts.map((script) => (
                <CommandItem
                  key={script.id}
                  value={`package:${script.id}`}
                  onClick={act(() => props.onRunPackageScript(script))}
                >
                  <SquarePlayIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{script.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </div>
    </Command>
  );
}

function ProjectActionsPopover(
  props: Omit<React.ComponentProps<typeof ProjectActionsList>, "onDone"> & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  },
) {
  const { open, onOpenChange, ...listProps } = props;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Project actions" />}
            />
          }
        >
          <PlayIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Actions</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" padding="none" className="w-80">
        <ProjectActionsList {...listProps} onDone={() => onOpenChange(false)} />
      </PopoverPopup>
    </Popover>
  );
}
