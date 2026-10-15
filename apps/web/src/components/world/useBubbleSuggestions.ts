import {
  getProviderSkillsForSlashMenu,
  getProviderSlashCommandsForSlashMenu,
  resolveProviderSkillsForCwd,
  resolveProviderSlashCommandsForCwd,
} from "@t3tools/client-runtime/providerSkills";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import { useMemo, useState } from "react";

import {
  type ComposerSlashCommand,
  detectComposerTrigger,
  replaceTextRange,
} from "../../composer-logic";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useComposerPathSearch } from "../../lib/composerPathSearchState";
import { basenameOfPath } from "../../pierre-icons";
import { searchProviderSkills } from "../../providerSkillSearch";
import type { ComposerCommandItem } from "../chat/ComposerCommandMenu";
import { resolveComposerMenuActiveItemId } from "../chat/composerMenuHighlight";
import {
  searchSlashCommandItems,
  slashCommandItemsForPromptPosition,
} from "../chat/composerSlashCommandSearch";
import { useComposerTriggerState } from "../chat/useComposerTriggerState";

/** A built-in `/` command a bubble handles itself, such as `/plan`. */
export type BubbleSlashCommand = {
  readonly command: ComposerSlashCommand;
  readonly description: string;
};

const EMPTY_ITEMS: ComposerCommandItem[] = [];

/** A space after a chip, reusing one already there. */
function rangeEndWithTrailingSpace(text: string, rangeEnd: number, replacement: string) {
  return replacement.endsWith(" ") && text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
}

/**
 * The chat composer's suggestions for a world bubble: `@` for files and
 * folders in the agent's workspace, `/` for the provider's commands and skills
 * plus the bubble's own, `$` for skills. Picks insert the same text the chat
 * inserts, so the agent reads them the same way. Thread and pull request
 * mentions are left out: they carry context records only a chat draft keeps.
 */
export function useBubbleSuggestions(input: {
  readonly environmentId: EnvironmentId;
  /** Where the agent works; null hides file suggestions. */
  readonly cwd: string | null;
  /** The provider the message goes to, for its commands and skills. */
  readonly provider: ServerProvider | null;
  readonly slashCommands: ReadonlyArray<BubbleSlashCommand>;
  readonly onSlashCommand: (command: ComposerSlashCommand) => void;
  /** False never offers `/` commands or `$` skills, e.g. before it's known who gets the message. */
  readonly commands: boolean;
}) {
  const { environmentId, cwd, provider, slashCommands, onSlashCommand, commands } = input;
  const showSkillsInSlashMenu = useEnvironmentSettings(
    environmentId,
    (settings) => settings.showSkillsInSlashMenu,
  );
  const { trigger, setTrigger, dismissTrigger } = useComposerTriggerState(() => null);
  const [highlight, setHighlight] = useState<{
    readonly itemId: string | null;
    readonly searchKey: string | null;
  }>({ itemId: null, searchKey: null });

  const pathQuery = trigger?.kind === "path" && cwd !== null ? trigger.query : null;
  const workspaceEntries = useComposerPathSearch({
    environmentId,
    cwd: pathQuery === null ? null : cwd,
    query: pathQuery,
  });
  const skills = useMemo(
    () => (provider === null ? [] : resolveProviderSkillsForCwd(provider, cwd)),
    [cwd, provider],
  );
  const providerSlashCommands = useMemo(
    () => (provider === null ? [] : resolveProviderSlashCommandsForCwd(provider, cwd)),
    [cwd, provider],
  );

  const items = useMemo<ComposerCommandItem[]>(() => {
    if (trigger === null) return EMPTY_ITEMS;
    if (trigger.kind === "path") {
      return workspaceEntries.entries.map((entry) => ({
        id: `path:${entry.kind}:${entry.path}`,
        type: "path" as const,
        path: entry.path,
        pathKind: entry.kind,
        label: basenameOfPath(entry.path),
        description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
      }));
    }
    if (provider === null) return EMPTY_ITEMS;
    const driver = provider.driver;
    if (trigger.kind === "slash-command") {
      const builtIns = slashCommands.map(({ command, description }) => ({
        id: `slash:${command}`,
        type: "slash-command" as const,
        command,
        label: `/${command}`,
        description,
      }));
      const menuSkills = getProviderSkillsForSlashMenu(skills, showSkillsInSlashMenu);
      const commands = getProviderSlashCommandsForSlashMenu(providerSlashCommands, menuSkills).map(
        (command) => ({
          id: `provider-slash-command:${driver}:${command.name}`,
          type: "provider-slash-command" as const,
          provider: driver,
          command,
          label: `/${command.name}`,
          description: command.description ?? command.input?.hint ?? "Run provider command",
        }),
      );
      const skillItems = menuSkills.map((skill) => ({
        id: `skill:${driver}:${skill.name}`,
        type: "skill" as const,
        provider: driver,
        skill,
        label: `/skill:${skill.name}`,
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : ""),
      }));
      return searchSlashCommandItems(
        slashCommandItemsForPromptPosition(
          [...builtIns, ...commands, ...skillItems],
          trigger.rangeStart === 0,
        ),
        trigger.query.trim().toLowerCase(),
      );
    }
    if (trigger.kind === "skill") {
      return searchProviderSkills(skills, trigger.query).map((skill) => ({
        id: `skill:${driver}:${skill.name}`,
        type: "skill" as const,
        provider: driver,
        skill,
        label: formatProviderSkillDisplayName(skill),
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
      }));
    }
    return EMPTY_ITEMS;
  }, [
    provider,
    providerSlashCommands,
    showSkillsInSlashMenu,
    skills,
    slashCommands,
    trigger,
    workspaceEntries.entries,
  ]);

  // Pull requests aren't offered here, and files need a workspace.
  const open =
    trigger !== null &&
    trigger.kind !== "pull-request" &&
    (trigger.kind !== "path" || cwd !== null) &&
    (commands || (trigger.kind !== "slash-command" && trigger.kind !== "skill"));
  const searchKey =
    trigger === null ? null : `${trigger.kind}:${trigger.query.trim().toLowerCase()}`;
  const activeItemId = resolveComposerMenuActiveItemId({
    items,
    highlightedItemId: highlight.itemId,
    currentSearchKey: searchKey,
    highlightedSearchKey: highlight.searchKey,
  });
  const highlightItem = (itemId: string | null) => setHighlight({ itemId, searchKey });

  /** Follow the caret: open, narrow or close the list. */
  const textChanged = (text: string, expandedCursor: number, besideChip: boolean) =>
    setTrigger(besideChip ? null : detectComposerTrigger(text, expandedCursor));

  /**
   * The text after picking an item, or null when the pick only runs a
   * bubble command. Mirrors what the chat composer inserts.
   */
  const select = (
    item: ComposerCommandItem,
    text: string,
  ): { readonly text: string; readonly cursor: number } | null => {
    if (trigger === null) return null;
    const { rangeStart, rangeEnd } = trigger;
    const replace = (replacement: string) =>
      replaceTextRange(
        text,
        rangeStart,
        rangeEndWithTrailingSpace(text, rangeEnd, replacement),
        replacement,
      );
    setHighlight({ itemId: null, searchKey: null });
    setTrigger(null);
    switch (item.type) {
      case "path":
        return replace(`${serializeComposerFileLink(item.path)} `);
      case "slash-command":
        onSlashCommand(item.command);
        return replace("");
      case "provider-slash-command":
        return replace(`/${item.command.name} `);
      case "skill":
        return replace(`$${item.skill.name} `);
      default:
        return null;
    }
  };

  /** ArrowUp and ArrowDown move through the list, wrapping at the ends. */
  const moveHighlight = (key: "ArrowUp" | "ArrowDown") => {
    if (items.length === 0) return;
    const index = Math.max(
      0,
      items.findIndex((item) => item.id === activeItemId),
    );
    const next = (index + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    highlightItem(items[next]!.id);
  };

  return {
    open,
    trigger: open ? trigger : null,
    items: open ? items : EMPTY_ITEMS,
    activeItem: open ? (items.find((item) => item.id === activeItemId) ?? null) : null,
    isLoading: open && trigger?.kind === "path" && workspaceEntries.isPending,
    highlightItem,
    moveHighlight,
    dismiss: () => dismissTrigger(trigger),
    textChanged,
    select,
  };
}
