import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { LegendList } from "@legendapp/list/react-native";
import {
  type ArchivedThreadSortOrder,
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type EnvironmentMachineKind,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { ScreenHeader } from "../../components/ScreenHeader";
import { SymbolView } from "../../components/AppSymbol";
import { useCallback, useMemo, useRef, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureDetector, useNativeGesture } from "react-native-gesture-handler";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { relativeTime } from "../../lib/time";
import { archivedThreadSortTime, isArchivedSubagent } from "@t3tools/client-runtime/state/threads";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useServerConfigs } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { ThreadSwipeable } from "../home/thread-swipe-actions";
import {
  DEFAULT_ARCHIVED_THREAD_SORT,
  type ArchivedThreadGroup,
  type ArchivedThreadSort,
} from "./archivedThreadList";
import { SettingsScreenContent } from "../settings/components/SettingsScreen";

export interface ArchivedThreadsHeaderEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

function ArchivedThreadsHeader(props: {
  readonly environments: ReadonlyArray<ArchivedThreadsHeaderEnvironment>;
  readonly searchQuery: string;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly sort: ArchivedThreadSort;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onRefresh: () => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onSortChange: (sort: ArchivedThreadSort) => void;
}) {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const hasCustomFilter =
    props.selectedEnvironmentId !== null ||
    props.sort.by !== DEFAULT_ARCHIVED_THREAD_SORT.by ||
    props.sort.direction !== DEFAULT_ARCHIVED_THREAD_SORT.direction;
  return (
    <ScreenHeader
      title="Archived threads"
      sidebar={false}
      onBack={() => navigation.goBack()}
      search={{
        value: props.searchQuery,
        onChangeText: props.onSearchQueryChange,
        placeholder: "Search archived threads",
        compactPlaceholder: "Search",
        mode: "inline",
        compactToolbar: width < 700,
      }}
      menus={[
        {
          title: "Archived thread options",
          icon: hasCustomFilter
            ? "line.3.horizontal.decrease.circle.fill"
            : "line.3.horizontal.decrease.circle",
          items: [
            {
              id: "environment",
              title: "Environment",
              items: [
                {
                  id: "environment:all",
                  title: "All environments",
                  selected: props.selectedEnvironmentId === null,
                  onPress: () => props.onEnvironmentChange(null),
                },
                ...props.environments.map((environment) => ({
                  id: `environment:${environment.environmentId}`,
                  title: environment.label,
                  selected: props.selectedEnvironmentId === environment.environmentId,
                  onPress: () => props.onEnvironmentChange(environment.environmentId),
                })),
              ],
            },
            {
              id: "sort",
              title: "Sort by",
              items: [
                {
                  id: "sort:archived_at",
                  title: "Date archived",
                  selected: props.sort.by === "archived_at",
                  onPress: () => props.onSortChange({ ...props.sort, by: "archived_at" }),
                },
                {
                  id: "sort:last_activity",
                  title: "Last activity",
                  selected: props.sort.by === "last_activity",
                  onPress: () => props.onSortChange({ ...props.sort, by: "last_activity" }),
                },
              ],
            },
            {
              id: "order",
              title: "Order",
              items: [
                {
                  id: "order:newest",
                  title: "Newest first",
                  selected: props.sort.direction === "newest",
                  onPress: () => props.onSortChange({ ...props.sort, direction: "newest" }),
                },
                {
                  id: "order:oldest",
                  title: "Oldest first",
                  selected: props.sort.direction === "oldest",
                  onPress: () => props.onSortChange({ ...props.sort, direction: "oldest" }),
                },
              ],
            },
            ...(Platform.OS === "android"
              ? [
                  {
                    id: "refresh",
                    title: "Refresh archived threads",
                    onPress: props.onRefresh,
                  },
                ]
              : []),
          ],
        },
      ]}
    />
  );
}

type ArchivedThreadListItem =
  | {
      readonly kind: "project";
      readonly key: string;
      readonly environmentLabel: string | null;
      readonly environmentMachine: EnvironmentMachineKind;
      readonly project: EnvironmentProject;
    }
  | {
      readonly kind: "thread";
      readonly key: string;
      readonly environmentLabel: string | null;
      readonly isFirst: boolean;
      readonly isLast: boolean;
      readonly nested: boolean;
      readonly subagentCount: number;
      readonly thread: EnvironmentThreadShell;
    };

function ProjectGroupLabel(props: {
  readonly environmentLabel: string | null;
  readonly environmentMachine: EnvironmentMachineKind;
  readonly project: EnvironmentProject;
}) {
  return (
    <View className="flex-row items-center gap-2.5 px-1 pb-2">
      <ProjectFavicon
        environmentId={props.project.environmentId}
        faviconPath={props.project.faviconPath}
        projectIcon={props.project.projectIcon}
        projectTitle={props.project.title}
        size={18}
        workspaceRoot={props.project.workspaceRoot}
      />
      <Text
        className="flex-1 text-xs font-t3-medium tracking-[0.5px] uppercase text-foreground-muted"
        numberOfLines={1}
      >
        {props.project.title}
      </Text>
      {props.environmentLabel ? (
        <View className="max-w-[42%] flex-row items-center gap-1">
          <EnvironmentMachineSymbol
            kind={props.environmentMachine}
            size={10}
            tintColorClassName="accent-foreground-tertiary"
          />
          <Text className="shrink text-2xs text-foreground-tertiary" numberOfLines={1}>
            {props.environmentLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ArchivedThreadRow(props: {
  readonly environmentLabel: string | null;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  /** A subagent sitting under its archived agent's row. */
  readonly nested: boolean;
  readonly subagentCount: number;
  readonly sortBy: ArchivedThreadSortOrder;
  readonly onDelete: () => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly simultaneousSwipeGesture?: ComponentProps<typeof ThreadSwipeable>["simultaneousWith"];
  readonly onUnarchive: () => void;
  readonly thread: EnvironmentThreadShell;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const cardColor = useUniwindTheme()["--color-grouped-card"];
  const canOperateThread = useEnvironmentScope(
    props.thread.environmentId,
    AuthOrchestrationOperateScope,
  );
  // The row shows the time the list is ordered by.
  const timestamp = relativeTime(archivedThreadSortTime(props.thread, props.sortBy));
  const subtitle = [
    props.environmentLabel,
    props.thread.branch,
    props.subagentCount === 0
      ? null
      : `${props.subagentCount} ${props.subagentCount === 1 ? "subagent" : "subagents"}`,
  ].filter((part): part is string => Boolean(part));
  const rowContent = (
    <View
      className={`flex-row items-center gap-3 bg-grouped-card py-3 pr-4 ${props.nested ? "pl-10" : "pl-4"} ${props.isLast ? "" : "border-b border-separator"}`}
    >
      <View className="h-[34px] w-[34px] items-center justify-center rounded-[11px] bg-subtle">
        <SymbolView
          name="archivebox.fill"
          size={15}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
      </View>

      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="min-w-0 flex-1 text-base font-t3-bold leading-snug text-foreground"
            numberOfLines={1}
          >
            {props.thread.title}
          </Text>
          {isArchivedSubagent(props.thread) ? (
            <View className="rounded-md bg-subtle px-1.5 py-0.5">
              <Text className="text-2xs font-t3-medium text-foreground-muted">Subagent</Text>
            </View>
          ) : null}
          <Text className="min-w-[30px] text-right text-xs tabular-nums text-foreground-tertiary">
            {timestamp}
          </Text>
        </View>
        {subtitle.length > 0 ? (
          <View className="flex-row items-center gap-1.5">
            <SymbolView
              name="arrow.triangle.branch"
              size={10}
              tintColorClassName="accent-icon-subtle"
              type="monochrome"
            />
            <Text
              className="min-w-0 flex-1 font-mono text-2xs text-foreground-tertiary"
              numberOfLines={1}
            >
              {subtitle.join(" · ")}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
  // Keep the group's rounded corners on both interactive and read-only rows.
  const containerStyle = {
    borderTopLeftRadius: props.isFirst ? 20 : 0,
    borderTopRightRadius: props.isFirst ? 20 : 0,
    borderBottomLeftRadius: props.isLast ? 20 : 0,
    borderBottomRightRadius: props.isLast ? 20 : 0,
    overflow: "hidden" as const,
  };
  if (!canOperateThread) return <View style={containerStyle}>{rowContent}</View>;

  return (
    <ThreadSwipeable
      resetKey={`${props.thread.environmentId}:${props.thread.id}`}
      threadKey={`${props.thread.environmentId}:${props.thread.id}`}
      backgroundColor={cardColor}
      containerStyle={containerStyle}
      fullSwipeWidth={windowWidth - 32}
      onDelete={props.onDelete}
      onSwipeableClose={props.onSwipeableClose}
      onSwipeableWillOpen={props.onSwipeableWillOpen}
      primaryAction={{
        accessibilityLabel: `Unarchive ${props.thread.title}`,
        icon: "arrow.uturn.backward",
        label: "Unarchive",
        onPress: props.onUnarchive,
      }}
      simultaneousWith={props.simultaneousSwipeGesture}
      threadTitle={props.thread.title}
    >
      {() => rowContent}
    </ThreadSwipeable>
  );
}

function ArchiveError(props: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <View className="rounded-[20px] border border-danger-border bg-danger p-4">
      <Text className="text-base font-t3-bold text-danger-foreground">
        Could not load every archive
      </Text>
      <Text className="mt-1 text-sm text-foreground-muted">{props.message}</Text>
      <Pressable className="mt-3 self-start active:opacity-60" onPress={props.onRetry}>
        <Text className="text-sm font-t3-bold text-danger-foreground">Try again</Text>
      </Pressable>
    </View>
  );
}

export function ArchivedThreadsScreen(props: {
  readonly environments: ReadonlyArray<ArchivedThreadsHeaderEnvironment>;
  readonly error: string | null;
  readonly groups: ReadonlyArray<ArchivedThreadGroup>;
  readonly isLoading: boolean;
  readonly searchQuery: string;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly sort: ArchivedThreadSort;
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => void;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onRefresh: () => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onSortChange: (sort: ArchivedThreadSort) => void;
  readonly onUnarchiveThread: (thread: EnvironmentThreadShell) => void;
}) {
  const { onDeleteThread, onUnarchiveThread } = props;
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const archiveScrollGesture = useNativeGesture();
  const environmentLabelsById = useMemo(
    () =>
      new Map(
        props.environments.map((environment) => [environment.environmentId, environment.label]),
      ),
    [props.environments],
  );
  const serverConfigs = useServerConfigs();
  const listItems = useMemo<ReadonlyArray<ArchivedThreadListItem>>(() => {
    const items: ArchivedThreadListItem[] = [];
    for (const group of props.groups) {
      const environmentLabel = environmentLabelsById.get(group.project.environmentId) ?? null;
      items.push({
        kind: "project",
        key: `${group.key}:project`,
        environmentLabel,
        environmentMachine: resolveEnvironmentMachineKind(
          serverConfigs.get(group.project.environmentId) ?? null,
        ),
        project: group.project,
      });

      group.rows.forEach((row, index) => {
        items.push({
          kind: "thread",
          key: `${row.thread.environmentId}:${row.thread.id}`,
          environmentLabel,
          isFirst: index === 0,
          isLast: index === group.rows.length - 1,
          nested: row.nested,
          subagentCount: row.subagentCount,
          thread: row.thread,
        });
      });
    }
    return items;
  }, [environmentLabelsById, props.groups, serverConfigs]);
  const handleSwipeableWillOpen = useCallback((methods: SwipeableMethods) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== methods) {
      openSwipeableRef.current.close();
    }
    openSwipeableRef.current = methods;
  }, []);
  const handleSwipeableClose = useCallback((methods: SwipeableMethods) => {
    if (openSwipeableRef.current === methods) {
      openSwipeableRef.current = null;
    }
  }, []);
  const isInitialLoad = props.isLoading && props.groups.length === 0 && props.error === null;
  const isFiltered = props.searchQuery.trim().length > 0 || props.selectedEnvironmentId !== null;
  const renderListItem = useCallback(
    ({ item }: { item: ArchivedThreadListItem }) => {
      if (item.kind === "project") {
        return (
          <View className="pt-4">
            <ProjectGroupLabel
              environmentLabel={item.environmentLabel}
              environmentMachine={item.environmentMachine}
              project={item.project}
            />
          </View>
        );
      }

      return (
        <ArchivedThreadRow
          environmentLabel={item.environmentLabel}
          isFirst={item.isFirst}
          isLast={item.isLast}
          nested={item.nested}
          subagentCount={item.subagentCount}
          sortBy={props.sort.by}
          onDelete={() => onDeleteThread(item.thread)}
          onSwipeableClose={handleSwipeableClose}
          onSwipeableWillOpen={handleSwipeableWillOpen}
          onUnarchive={() => onUnarchiveThread(item.thread)}
          simultaneousSwipeGesture={archiveScrollGesture}
          thread={item.thread}
        />
      );
    },
    [
      archiveScrollGesture,
      handleSwipeableClose,
      handleSwipeableWillOpen,
      onDeleteThread,
      onUnarchiveThread,
      props.sort.by,
    ],
  );
  const listEmptyComponent = useMemo(() => {
    if (isInitialLoad) {
      return (
        <View className="items-center py-16">
          <ActivityIndicator colorClassName="accent-icon" />
          <Text className="mt-3 text-sm text-foreground-muted">Loading archive...</Text>
        </View>
      );
    }

    return (
      <EmptyState
        detail={
          isFiltered
            ? "Try another search or environment."
            : "Threads you archive will appear here."
        }
        title={isFiltered ? "No matching threads" : "No archived threads"}
      />
    );
  }, [isFiltered, isInitialLoad]);

  return (
    // Keep the list inside this native container. Form-sheet resizing otherwise
    // treats the flattened background as a header and shrinks the list to zero.
    <View collapsable={false} className="flex-1 bg-sheet">
      <ArchivedThreadsHeader
        environments={props.environments}
        searchQuery={props.searchQuery}
        onEnvironmentChange={props.onEnvironmentChange}
        onRefresh={props.onRefresh}
        onSearchQueryChange={props.onSearchQueryChange}
        onSortChange={props.onSortChange}
        selectedEnvironmentId={props.selectedEnvironmentId}
        sort={props.sort}
      />

      <SettingsScreenContent>
        <GestureDetector gesture={archiveScrollGesture}>
          <LegendList
            className="flex-1"
            contentContainerStyle={{
              paddingBottom: 32,
              paddingHorizontal: 16,
              paddingTop: 4,
            }}
            contentInsetAdjustmentBehavior="automatic"
            data={listItems}
            estimatedItemSize={62}
            getItemType={(item) => item.kind}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.key}
            ListEmptyComponent={listEmptyComponent}
            ListHeaderComponent={
              props.error ? <ArchiveError message={props.error} onRetry={props.onRefresh} /> : null
            }
            onScrollBeginDrag={() => openSwipeableRef.current?.close()}
            refreshControl={
              <RefreshControl
                onRefresh={props.onRefresh}
                refreshing={props.isLoading && !isInitialLoad}
                tintColorClassName={String("accent-icon")}
              />
            }
            renderItem={renderListItem}
            showsVerticalScrollIndicator={false}
          />
        </GestureDetector>
      </SettingsScreenContent>
    </View>
  );
}
