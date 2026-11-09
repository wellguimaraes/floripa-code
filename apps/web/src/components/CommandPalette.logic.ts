import {
  foldSearchQuery,
  PALETTE_SECONDARY_LIMIT,
  PALETTE_THREAD_LIMIT,
  rankSearchGroups,
  scoreSearchTerms,
  scoreThreadSearch,
  type SearchMatchHint,
  type SearchRange,
  type ThreadSearchSubject,
} from "@t3tools/shared/paletteSearch";
import { threadSearchSubject } from "@t3tools/client-runtime/state/thread-search";
import type { CommandPaletteLinkedThreads } from "../commandPaletteBus";
import {
  type EnvironmentId,
  type FilesystemBrowseEntry,
  type KeybindingCommand,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import { filterFilesystemBrowseEntries } from "@t3tools/client-runtime/state/filesystem";
import { type ReactNode } from "react";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { type Project, type SidebarThreadSummary, type Thread } from "../types";
import { isSidebarSubagentThread } from "./Sidebar.logic";

export const RECENT_THREAD_LIMIT = 12;
export const ITEM_ICON_CLASS = "size-4 text-icon-muted";
export const ADDON_ICON_CLASS = "size-4";

/** A PR's relations include archived threads that normal palette search omits. */
export function buildLinkedThreadActionItems(
  input: CommandPaletteLinkedThreads & {
    query: string;
    icon: ReactNode;
    runThread: (thread: Pick<SidebarThreadSummary, "environmentId" | "id">) => Promise<void>;
  },
): CommandPaletteActionItem[] {
  return input.threads.map((thread) => ({
    kind: "action",
    value: `thread:${input.environmentId}:${thread.id}`,
    title: thread.title || "Untitled thread",
    description: thread.archivedAt === null ? "Linked thread" : "Archived thread",
    searchTerms: [input.query, thread.title],
    icon: input.icon,
    run: () => input.runThread({ environmentId: input.environmentId, id: thread.id }),
  }));
}

export function browseInputEndPaddingClass(input: {
  readonly willCreateProjectPath: boolean;
  readonly hasHighlightedBrowseItem: boolean;
}): string {
  if (input.willCreateProjectPath) {
    return "*:data-[slot=autocomplete-input]:pe-38!";
  }
  if (input.hasHighlightedBrowseItem) {
    return "*:data-[slot=autocomplete-input]:pe-30!";
  }
  return "*:data-[slot=autocomplete-input]:pe-24!";
}

/**
 * The global search overlay hosts three mutually exclusive surfaces: the
 * command palette (⌘K), the project file picker (⌘P), and project content
 * search (⇧⌘F). One reducer owns open/mode state so the surfaces can never
 * stack and re-triggering a mode's shortcut toggles it closed.
 */
export type SearchOverlayMode = "command" | "files" | "content";

export type CommandPaletteOpenIntent =
  | { readonly kind: "add-project" | "new-thread-in" | "change-theme" }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly linkedThreads?: CommandPaletteLinkedThreads;
    };

export interface CommandPaletteUiState {
  readonly open: boolean;
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
}

export type CommandPaletteUiAction =
  | { readonly _tag: "SetOpen"; readonly open: boolean }
  | { readonly _tag: "ToggleMode"; readonly mode: SearchOverlayMode }
  | {
      readonly _tag: "OpenSearch";
      readonly query: string;
      readonly linkedThreads?: CommandPaletteLinkedThreads;
    }
  | { readonly _tag: "OpenAddProject" }
  | { readonly _tag: "OpenNewThreadIn" }
  | { readonly _tag: "OpenChangeTheme" }
  | { readonly _tag: "ClearOpenIntent" };

export function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  switch (action._tag) {
    case "SetOpen":
      return action.open
        ? { open: true, mode: "command", openIntent: state.openIntent }
        : { ...state, open: false, openIntent: null };
    case "ToggleMode":
      return state.open && state.mode === action.mode
        ? { ...state, open: false, openIntent: null }
        : { open: true, mode: action.mode, openIntent: null };
    case "OpenSearch":
      return {
        open: true,
        mode: "command",
        openIntent: {
          kind: "search",
          query: action.query,
          ...(action.linkedThreads ? { linkedThreads: action.linkedThreads } : {}),
        },
      };
    case "OpenAddProject":
      return { open: true, mode: "command", openIntent: { kind: "add-project" } };
    case "OpenNewThreadIn":
      return { open: true, mode: "command", openIntent: { kind: "new-thread-in" } };
    case "OpenChangeTheme":
      return { open: true, mode: "command", openIntent: { kind: "change-theme" } };
    case "ClearOpenIntent":
      return state.openIntent ? { ...state, openIntent: null } : state;
  }
}

export interface CommandPaletteThreadContentMatch {
  readonly source: "user" | "assistant";
  readonly snippet: string;
  readonly query: string;
}

export interface CommandPaletteItem {
  readonly kind: "action" | "submenu";
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: ReactNode;
  /** The title as plain text, for searching, when `title` is styled. */
  readonly searchTitle?: string;
  readonly description?: ReactNode;
  readonly threadContentMatch?: CommandPaletteThreadContentMatch;
  readonly timestamp?: string;
  /** Thread rows rank by this, with use history, instead of by `searchTerms`. */
  readonly threadSearch?: ThreadSearchSubject;
  /** Shown in place of the description when the match is not in the title. */
  readonly matchHint?: SearchMatchHint;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  /** Optional content rendered inline before the title text. */
  readonly titleLeadingContent?: ReactNode;
  /** Optional content rendered inline after the title text (before the timestamp). */
  readonly titleTrailingContent?: ReactNode;
  readonly shortcutCommand?: KeybindingCommand;
  /** Sorts after every other match in its group; see `SettingsSearchItem.secondary`. */
  readonly secondary?: boolean;
}

export interface CommandPaletteActionItem extends CommandPaletteItem {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
}

export interface CommandPaletteSubmenuItem extends CommandPaletteItem {
  readonly kind: "submenu";
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

export interface CommandPaletteView {
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export type CommandPaletteRow =
  | {
      readonly kind: "label";
      readonly key: string;
      readonly label: string;
      readonly first: boolean;
    }
  | {
      readonly kind: "item";
      readonly key: string;
      readonly item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
      /** Position among enabled items, or null for disabled rows the keyboard skips. */
      readonly itemIndex: number | null;
    };

/**
 * Flattens groups into the rows a virtualized list renders. `itemValues` is the
 * highlightable item order Base UI navigates; `rowIndexByItemIndex` maps a
 * highlight back to its row for scrolling.
 */
export function buildCommandPaletteRows(groups: ReadonlyArray<CommandPaletteGroup>) {
  const rows: CommandPaletteRow[] = [];
  const itemValues: string[] = [];
  const rowIndexByItemIndex: number[] = [];
  for (const group of groups) {
    if (group.label) {
      rows.push({
        kind: "label",
        key: `group:${group.value}`,
        label: group.label,
        first: rows.length === 0,
      });
    }
    for (const item of group.items) {
      const itemIndex = item.disabled ? null : itemValues.length;
      if (itemIndex !== null) {
        itemValues.push(item.value);
        rowIndexByItemIndex.push(rows.length);
      }
      rows.push({ kind: "item", key: `${group.value}:${item.value}`, item, itemIndex });
    }
  }
  return { rows, itemValues, rowIndexByItemIndex };
}

/** The enabled item Enter should run for a highlight, whether or not its row is mounted. */
export function findHighlightedCommandPaletteItem(
  groups: ReadonlyArray<CommandPaletteGroup>,
  highlightedItemValue: string | null,
): CommandPaletteActionItem | CommandPaletteSubmenuItem | null {
  if (highlightedItemValue === null) return null;
  for (const group of groups) {
    for (const item of group.items) {
      if (item.value === highlightedItemValue && !item.disabled) return item;
    }
  }
  return null;
}

export function enumerateCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteActionItem>,
): CommandPaletteActionItem[] {
  return items.map((item, index) => {
    const shortcutCommand = THREAD_JUMP_KEYBINDING_COMMANDS[index];
    if (shortcutCommand) return { ...item, shortcutCommand };

    const { shortcutCommand: _shortcutCommand, ...itemWithoutShortcut } = item;
    return itemWithoutShortcut;
  });
}

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

// A project as the palette shows it. `displayName` is the grouped label (for
// example "owner/repo" when projects are merged across machines). Keep `title`
// as the real project title: the automatic project icon is derived from it, and
// every other surface uses the real title, so overriding it desyncs the icon.
export type CommandPaletteProject = Project & { readonly displayName: string };

export function buildCommandPaletteProjectMetadata(input: {
  readonly projects: ReadonlyArray<Pick<Project, "environmentId" | "title" | "workspaceRoot">>;
  readonly locationByEnvironmentId: ReadonlyMap<EnvironmentId, { readonly label: string }>;
}) {
  const searchTerms: string[] = [];
  const environmentLabels = new Set<string>();

  for (const project of input.projects) {
    const label = input.locationByEnvironmentId.get(project.environmentId)?.label ?? "Remote";
    searchTerms.push(project.title, project.workspaceRoot, label);
    environmentLabels.add(label);
  }

  return { searchTerms, environmentLabels: [...environmentLabels] };
}

export function buildProjectActionItems(input: {
  projects: ReadonlyArray<CommandPaletteProject>;
  valuePrefix: string;
  icon: (project: CommandPaletteProject) => ReactNode;
  runProject: (project: CommandPaletteProject) => Promise<void>;
  searchTerms?: (project: CommandPaletteProject) => ReadonlyArray<string>;
  renderDescription?: (project: CommandPaletteProject) => ReactNode;
  shortcutCommand?: KeybindingCommand;
}): CommandPaletteActionItem[] {
  return input.projects.map((project) => ({
    kind: "action",
    value: `${input.valuePrefix}:${project.environmentId}:${project.id}`,
    searchTerms: [
      project.displayName,
      project.title,
      project.workspaceRoot,
      ...(input.searchTerms?.(project) ?? []),
    ],
    title: project.displayName,
    description: input.renderDescription?.(project) ?? project.workspaceRoot,
    icon: input.icon(project),
    ...(input.shortcutCommand !== undefined ? { shortcutCommand: input.shortcutCommand } : {}),
    run: async () => {
      await input.runProject(project);
    },
  }));
}

export type BuildThreadActionItemsThread = Pick<
  SidebarThreadSummary,
  | "archivedAt"
  | "branch"
  | "createdAt"
  | "environmentId"
  | "id"
  | "lineage"
  | "modelSelection"
  | "projectId"
  | "runtime"
  | "title"
  | "worktreePath"
> &
  Partial<
    Pick<
      SidebarThreadSummary,
      "pullRequests" | "linkedPullRequest" | "branchPullRequest" | "opens" | "latestUserMessageAt"
    >
  > & {
    updatedAt: string;
  };

export function buildThreadActionItems<TThread extends BuildThreadActionItemsThread>(input: {
  threads: ReadonlyArray<TThread>;
  activeThread?: Pick<Thread, "environmentId" | "id">;
  projectByKey: ReadonlyMap<string, Pick<Project, "title">>;
  icon: ReactNode;
  /** Optional content rendered inline before the title text per-thread. */
  renderLeadingContent?: (thread: TThread) => ReactNode;
  /** Optional content rendered inline after the title text per-thread. */
  renderTrailingContent?: (thread: TThread) => ReactNode;
  /** Optional rich description (e.g. favicon + workspace icons). Falls back to text. */
  renderDescription?: (thread: TThread, meta: { projectTitle: string | undefined }) => ReactNode;
  runThread: (thread: TThread) => Promise<void>;
  /** Makes the environment searchable; pass it only with two or more environments. */
  environmentLabelOf?: (thread: TThread) => string | null;
}): CommandPaletteActionItem[] {
  // Callers order these: recents by last use, search results by rank.
  const visibleThreads = input.threads.filter(
    (thread) => thread.archivedAt === null && !isSidebarSubagentThread(thread),
  );

  return visibleThreads.map((thread) => {
    const projectTitle = input.projectByKey.get(
      `${thread.environmentId}:${thread.projectId}`,
    )?.title;
    const descriptionParts: string[] = [];

    if (projectTitle) {
      descriptionParts.push(projectTitle);
    }
    if (thread.branch) {
      descriptionParts.push(`#${thread.branch}`);
    }
    const isCurrent =
      thread.id === input.activeThread?.id &&
      thread.environmentId === input.activeThread.environmentId;
    if (isCurrent) {
      descriptionParts.push("Current thread");
    }

    const leadingContent = input.renderLeadingContent?.(thread);
    const trailingContent = input.renderTrailingContent?.(thread);
    const description = input.renderDescription
      ? input.renderDescription(thread, { projectTitle })
      : descriptionParts.join(` · `);

    return Object.assign(
      {
        kind: "action" as const,
        value: `thread:${thread.environmentId}:${thread.id}`,
        searchTerms: [thread.title],
        threadSearch: threadSearchSubject(
          {
            ...thread,
            latestUserMessageAt: thread.latestUserMessageAt ?? null,
            opens: thread.opens ?? null,
          },
          projectTitle,
          input.environmentLabelOf?.(thread),
        ),
        title: thread.title,
        description,
        timestamp: formatRelativeTimeLabel(
          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
        ),
        icon: input.icon,
      },
      leadingContent ? { titleLeadingContent: leadingContent } : {},
      trailingContent ? { titleTrailingContent: trailingContent } : {},
      // Last in its group: picking the thread already open does nothing.
      isCurrent ? { secondary: true } : {},
      {
        run: async () => {
          await input.runThread(thread);
        },
      },
    );
  });
}

type PaletteItem = CommandPaletteActionItem | CommandPaletteSubmenuItem;

function rankPaletteItem(
  item: PaletteItem,
  normalizedQuery: string,
  now: number,
  options: { readonly typos: boolean },
): {
  readonly score: number;
  readonly quality: number;
  readonly groupQuality?: number;
  readonly strong: boolean;
  readonly ranges: ReadonlyArray<SearchRange>;
  readonly explain?: () => SearchMatchHint | undefined;
  readonly pickedAt?: number;
  readonly pickedExactly?: boolean;
} | null {
  const match = scorePaletteItem(item, normalizedQuery, now, options);
  // A row listed last in its group (a keybinding setting, the open thread)
  // does not decide where the group sits.
  return match && item.secondary ? { ...match, groupQuality: 0 } : match;
}

function scorePaletteItem(
  item: PaletteItem,
  normalizedQuery: string,
  now: number,
  options: { readonly typos: boolean },
) {
  if (item.threadSearch) return scoreThreadSearch(normalizedQuery, item.threadSearch, now, options);
  // The title names the item; search terms are keywords. Ranges index the
  // first term, so they only highlight a title that is that term.
  const name = typeof item.title === "string" ? item.title : item.searchTitle;
  const terms =
    name !== undefined && name !== item.searchTerms[0]
      ? [name, ...item.searchTerms]
      : item.searchTerms;
  const match = scoreSearchTerms(normalizedQuery, terms, options);
  return match && (item.title === terms[0] ? match : { ...match, ranges: [] });
}

/**
 * Filters and ranks the palette for a query. Groups order by the class of their
 * best match, and on equal classes commands come first, then threads, so "new"
 * runs "New thread" and a thread's title is not stuck under a setting. Server
 * message matches always come last, in their own group, so rows above never
 * move when they arrive.
 */
export function filterCommandPaletteGroups(input: {
  activeGroups: ReadonlyArray<CommandPaletteGroup>;
  query: string;
  isInSubmenu: boolean;
  /** Submenu options join the root search, and a submenu with no match falls back to it. */
  allOptions?: {
    readonly rootGroups: ReadonlyArray<CommandPaletteGroup>;
    readonly nestedItems: ReadonlyArray<CommandPaletteActionItem>;
  };
  projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  settingsSearchItems?: ReadonlyArray<CommandPaletteActionItem>;
  threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  /** Threads whose messages match, best first; threads already listed are skipped. */
  threadMessageItems?: ReadonlyArray<CommandPaletteActionItem>;
  now?: number;
}): CommandPaletteGroup[] {
  if (input.allOptions && input.isInSubmenu) {
    const { allOptions, ...submenuInput } = input;
    const scoped = filterCommandPaletteGroups(submenuInput);
    if (scoped.length > 0 || input.query.trim().length === 0) return scoped;
    return filterCommandPaletteGroups({
      ...input,
      activeGroups: allOptions.rootGroups,
      isInSubmenu: false,
    });
  }

  const isActionsFilter = input.query.startsWith(">");
  const searchQuery = isActionsFilter ? input.query.slice(1) : input.query;
  const normalizedQuery = foldSearchQuery(searchQuery);

  if (normalizedQuery.length === 0) {
    if (isActionsFilter) {
      return input.activeGroups.filter((group) => group.value === "actions");
    }
    return [...input.activeGroups];
  }

  let baseGroups = [...input.activeGroups];
  if (isActionsFilter) {
    baseGroups = baseGroups.filter((group) => group.value === "actions");
  } else if (!input.isInSubmenu) {
    baseGroups = baseGroups.filter((group) => group.value !== "recent-threads");
  }

  const searchableGroups = [...baseGroups];
  const searchesEverything = !input.isInSubmenu && !isActionsFilter;
  // On equal match classes, groups keep this order: threads, what people search
  // for most, right after commands.
  if (searchesEverything) {
    if (input.allOptions && input.allOptions.nestedItems.length > 0) {
      searchableGroups.push({
        value: "nested-search",
        label: "Suggestions",
        items: input.allOptions.nestedItems,
      });
    }
    if (input.threadSearchItems.length > 0) {
      searchableGroups.push({
        value: "threads-search",
        label: "Threads",
        items: input.threadSearchItems,
      });
    }
    if (input.projectSearchItems.length > 0) {
      searchableGroups.push({
        value: "projects-search",
        label: "Projects",
        items: input.projectSearchItems,
      });
    }
    if (input.settingsSearchItems && input.settingsSearchItems.length > 0) {
      searchableGroups.push({
        value: "settings-search",
        label: "Settings",
        items: input.settingsSearchItems,
      });
    }
  }

  const now = input.now ?? Date.now();
  const ranked = rankSearchGroups(
    searchableGroups.map((group) => ({ group, items: group.items })),
    (item, options) => rankPaletteItem(item, normalizedQuery, now, options),
  );
  const threadsMatch = ranked.some(({ group }) => group.value === "threads-search");
  const groups = ranked.map(({ group, ranked }): CommandPaletteGroup => {
    // Secondary items stay below the rest; the sort is stable, so score order holds.
    const limit =
      group.value === "threads-search"
        ? PALETTE_THREAD_LIMIT
        : group.value === "nested-search" || (searchesEverything && threadsMatch)
          ? PALETTE_SECONDARY_LIMIT
          : ranked.length;
    // Hints are built only for the rows shown.
    const items = ranked
      .toSorted(
        (left, right) =>
          Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false),
      )
      .slice(0, limit)
      .map(({ item, match }) => {
        if (match.ranges.length > 0) return item;
        // Built only for the rows shown.
        const matchHint = match.explain?.();
        return matchHint ? { ...item, matchHint } : item;
      });
    return { value: group.value, label: group.label, items };
  });

  if (!searchesEverything) return groups;
  const listed = new Set(groups.flatMap((group) => group.items.map((item) => item.value)));
  // The items arrive cut to what the palette shows; see `nextShownOrder`.
  const messageItems = (input.threadMessageItems ?? []).filter((item) => !listed.has(item.value));
  return messageItems.length === 0
    ? groups
    : [...groups, { value: "threads-messages", label: "In messages", items: messageItems }];
}

/** Every option inside a submenu as one row, e.g. "New thread in t3code" or "Change theme: Dracula". */
export function buildNestedSearchItems(
  items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>,
  query: string,
): CommandPaletteActionItem[] {
  const nameOf = (item: CommandPaletteItem) =>
    typeof item.title === "string" ? item.title : item.searchTitle;
  const topLevelNames = new Set(items.map(nameOf));
  const foldedQuery = foldSearchQuery(query);
  return items.flatMap((parent) => {
    if (parent.kind !== "submenu" || typeof parent.title !== "string") return [];
    const stem = parent.title.replace(/(\.\.\.|…)$/u, "");
    // A query that only names the submenu ("new thread in") wants the submenu row itself.
    if (foldSearchQuery(stem).startsWith(foldedQuery)) return [];
    const prefix = stem === parent.title ? `${stem}: ` : `${stem.trimEnd()} `;
    return parent.groups.flatMap((group) =>
      group.items.flatMap((child) => {
        const name = nameOf(child);
        if (child.kind !== "action" || name === undefined) return [];
        const title = `${prefix}${name}`;
        if (topLevelNames.has(title)) return [];
        const { searchTitle: _searchTitle, ...rest } = child;
        // Only the combined title: child keywords like "theme" would list every theme.
        return [{ ...rest, title, searchTerms: [title] }];
      }),
    );
  });
}

export function buildBrowseGroups(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseQuery: string;
  canBrowseUp: boolean;
  upIcon: ReactNode;
  directoryIcon: ReactNode;
  browseUp: () => void | Promise<void>;
  browseTo: (name: string) => void | Promise<void>;
}): CommandPaletteGroup[] {
  const items: CommandPaletteActionItem[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: "action",
      value: "browse:up",
      searchTerms: [input.browseQuery, ".."],
      title: "..",
      icon: input.upIcon,
      keepOpen: true,
      run: async () => {
        await input.browseUp();
      },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: "action",
      value: `browse:${entry.fullPath}`,
      searchTerms: [input.browseQuery, entry.fullPath, entry.name],
      title: entry.name,
      icon: input.directoryIcon,
      keepOpen: true,
      run: async () => {
        await input.browseTo(entry.name);
      },
    });
  }

  return [{ value: "directories", label: "Directories", items }];
}

export function filterPinnedBrowseEntries(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  filterQuery: string;
  pinnedDirectoryName: string;
  caseSensitive: boolean;
}): ReturnType<typeof filterFilesystemBrowseEntries> {
  const namesMatch = (left: string, right: string) =>
    input.caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
  const visibleFilterQuery = namesMatch(input.filterQuery, input.pinnedDirectoryName)
    ? ""
    : input.filterQuery;
  const { visibleEntries } = filterFilesystemBrowseEntries(input.browseEntries, visibleFilterQuery);
  const exactEntry =
    input.filterQuery.length > 0
      ? (input.browseEntries.find((entry) => namesMatch(entry.name, input.filterQuery)) ?? null)
      : null;
  return { visibleEntries, exactEntry };
}

export function getCommandPaletteMode(input: {
  currentView: CommandPaletteView | null;
  isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.currentView) {
    return input.isBrowsing ? "submenu-browse" : "submenu";
  }
  return input.isBrowsing ? "root-browse" : "root";
}

export function buildRootGroups(input: {
  actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];
  if (input.actionItems.length > 0) {
    groups.push({ value: "actions", label: "Actions", items: input.actionItems });
  }
  if (input.recentThreadItems.length > 0) {
    groups.push({
      value: "recent-threads",
      label: "Recent Threads",
      items: input.recentThreadItems,
    });
  }
  return groups;
}

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case "root":
      return "Search commands, projects, and threads...";
    case "root-browse":
      return "Enter project path (e.g. ~/projects/my-app)";
    case "submenu":
      return "Search...";
    case "submenu-browse":
      return "Enter path (e.g. ~/projects/my-app)";
  }
}
