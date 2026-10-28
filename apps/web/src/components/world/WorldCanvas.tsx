import { Canvas, events, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { PlusIcon, SquareTerminalIcon } from "lucide-react";
import { scopedProjectKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Camera,
  CustomToneMapping,
  type Object3D,
  OrthographicCamera,
  Plane,
  Ray,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { readLocalApi } from "../../localApi";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { formatElapsedDurationLabel } from "../../timestampFormat";
import { buildProjectGroups, selectProjectGroupingSettings } from "../../logicalProject";
import {
  readEnvironmentSupportsTitleRegeneration,
  readThreadShell,
  useProjects,
  useThreadShells,
  waitForThreadShell,
} from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { toastManager } from "../ui/toast";
import type { Vec3, WorldDefinition } from "./definition/types";
import { validateWorldDefinition } from "./definition/validate";
import {
  arrangementColumns,
  EMPTY_ARCHIPELAGO_MEMORY,
  islandBounds,
  resolveArchipelago,
  suggestHue,
  type WorldIsland,
} from "./engine/archipelago";
import { EMPTY_BEAT_GATE, gateBeats } from "./engine/beats";
import {
  ageReplies,
  buildCharacterFacts,
  type CharacterFacts,
  isResting,
  islandIdleSeconds,
} from "./engine/facts";
import { islandObstacles } from "./engine/route";
import type { SlotRequest } from "./engine/slots";
import type { WorldCharacter } from "./engine/world";
import { type AbductedFigure, Abduction } from "./scene/Abduction";
import {
  BALLOON_NAME,
  BALLOON_PX,
  Character,
  HITBOX_NAME,
  WALK_DESTINATION,
  WALKING_FLAG,
} from "./scene/Character";
import { geometry } from "./scene/geometries";
import { HAT_COUNT } from "./scene/Hat";
import { Island, LAGOON_REACH, WIDE_LAGOON_REACH, type FurnitureSpot } from "./scene/Island";
import { ISLAND_MOVE_MS, ISLAND_SINK_MS, IslandMotion } from "./scene/IslandMotion";
import { afterPaint, whenIdle } from "./scene/frames";
import { FadedContext, WorldDaylight } from "./scene/lighting";
import { palette } from "./scene/palette";
import { Manager } from "./scene/Manager";
import { WhaleSightings } from "./scene/Whales";
import { groundHeight, surfaceAt } from "./scene/terrain";
import { SIGN_TOP, Sign, signCorners, signTextColor } from "./scene/Sign";
import { ManagerBubble, type ManagerStatus } from "./ManagerBubble";
import { MissingFolderPill, useMissingProjects } from "./MissingFolderPill";
import { NewAgentBubble } from "./NewAgentBubble";
import { useNewAgentDraftStore } from "./newAgentDraftStore";
import { NewAgentProjectPicker } from "./NewAgentProjectPicker";
import { useIslandSignStats } from "./useIslandSignStats";
import { useWorldHueStore } from "./worldHueStore";
import { islandPlate, islandStaleDays, useWorldIslandPrefsStore } from "./worldIslandPrefsStore";
import { useWorldLookStore, type WorldLook } from "./worldLookStore";
import { useWorldArrangementStore } from "./worldArrangementStore";
import { useWorldManagerStore, WORLD_MANAGERS_AVAILABLE } from "./worldManagerStore";
import { useWorldModeStore } from "./worldModeStore";
import { useWorldVisibilityStore } from "./worldVisibilityStore";
import { AddProjectButton, useAddProject } from "./AddProjectButton";
import { ARRANGEMENTS, IslandsMenu } from "./IslandsMenu";
import { IslandBranchesPopover, type WorktreeSurfacesTarget } from "./IslandBranchesPopover";
import { useCreateIdleWorldThread } from "./useStartWorldAgent";
import { canChangeIslandIcon, IslandIconPicker, useSetIslandIcon } from "./IslandIconPicker";
import { IslandPrefsDialog } from "./IslandPrefsDialog";
import { useRemoveIsland } from "./useRemoveIsland";
import { IslandRunScriptDialog } from "./IslandRunScriptDialog";
import { RestoreArchivedDialog } from "./RestoreArchivedDialog";
import { layoutTags, type ScreenPoint } from "./scene/tagLayout";
import { isStoppable, WorldBubble } from "./WorldBubble";
import { voiceInputSupported } from "./useVoiceInput";

/**
 * The 3D world. Renders on demand only: a still scene draws no frames.
 * Walkers request frames until they arrive, and characters with an idle
 * animation share one throttled ticker that stops while the tab is hidden.
 */
export default function WorldCanvas(props: {
  /** The island at every size, smallest first; islands start at the smallest. */
  readonly definitions: ReadonlyArray<WorldDefinition>;
  readonly selectedKey: string | null;
  /** Opens a thread's full chat; settles once the chat shows it. */
  readonly onExpand: (ref: ScopedThreadRef) => Promise<void>;
  /** Closes the full chat; settles once it has gone. */
  readonly onCollapse: () => Promise<void>;
  /** Shows only the surfaces of a thread's worktree, its chat collapsed. */
  readonly onOpenSurfaces: (ref: ScopedThreadRef) => Promise<void>;
  /** The open chat is hidden behind its worktree's surfaces; clicks then leave it hidden. */
  readonly chatCollapsed: boolean;
  /** The chat panel, if open; framing the islands keeps clear of it. */
  readonly panel: () => HTMLElement | null;
  /** The bars over the canvas's top and bottom edges; framing keeps clear of them too. */
  readonly bars: () => { readonly top: HTMLElement | null; readonly bottom: HTMLElement | null };
  /** The top bar spot where the project visibility menu goes. */
  readonly toolbar: HTMLElement | null;
}) {
  const {
    definitions,
    selectedKey,
    onExpand,
    onCollapse,
    onOpenSurfaces,
    chatCollapsed,
    panel,
    bars,
    toolbar,
  } = props;
  if (import.meta.env.DEV) definitions.forEach(assertValidDefinition);
  // Rules, pacing and the archipelago's settings are the same at every size.
  const definition = definitions[0]!;

  const threads = useThreadShells();
  const projects = useProjects();
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const facts = useMemo(
    () => buildCharacterFacts({ threads, localLastVisitedAt: (key) => localVisits[key] }),
    [threads, localVisits],
  );
  // One island per sidebar project group, so clones of the same repository
  // share an island under the same name the sidebar shows.
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const {
    islandOf,
    projectOrder,
    projectTitles,
    projectRefs,
    projectRecords,
    projectMembers,
    projectCheckouts,
  } = useMemo(() => {
    const groups = buildProjectGroups({ projects, settings: groupingSettings });
    const islandOf = new Map<string, string>();
    for (const group of groups) {
      for (const ref of group.memberProjectRefs) islandOf.set(scopedProjectKey(ref), group.key);
    }
    // Signs are read at a glance: "owner/repo" groups show just the repo.
    const title = (group: (typeof groups)[number]) =>
      group.label.slice(group.label.lastIndexOf("/") + 1);
    // Islands line up by the name on their sign.
    const sorted = groups.toSorted(
      (a, b) =>
        title(a).localeCompare(title(b), undefined, { sensitivity: "base", numeric: true }) ||
        a.key.localeCompare(b.key),
    );
    return {
      islandOf,
      projectOrder: sorted.map((group) => group.key),
      projectTitles: new Map(sorted.map((group) => [group.key, title(group)])),
      // New agents on an island start in its group's main project.
      projectRefs: new Map(
        sorted.map((group) => [
          group.key,
          {
            environmentId: group.representative.environmentId,
            projectId: group.representative.id,
          },
        ]),
      ),
      // Signs show the main project's icon, as the sidebar does for the group.
      projectRecords: new Map(sorted.map((group) => [group.key, group.representative])),
      projectMembers: new Map(sorted.map((group) => [group.key, group.memberProjectRefs])),
      // An icon is the group's, so changing it from the sign changes it on every checkout.
      projectCheckouts: new Map(
        sorted.map((group) => [
          group.key,
          [
            group.representative,
            ...group.members
              .map((member) => member.project)
              .filter((project) => project !== group.representative),
          ],
        ]),
      ),
    };
  }, [projects, groupingSettings]);
  const islandFacts = useMemo(
    () => facts.map((f) => ({ ...f, projectKey: islandOf.get(f.projectKey) ?? f.projectKey })),
    [facts, islandOf],
  );
  // Archived characters leave by saucer: the real one is hidden at once and
  // a stand-in of it is beamed up from where it stood. New agents started here
  // arrive the same way, hidden until their stand-in has landed on their pile.
  const [abductions, setAbductions] = useState<
    ReadonlyArray<{
      readonly id: number;
      readonly islandKeys: ReadonlyArray<string>;
      readonly figures: ReadonlyArray<AbductedFigure>;
      /** The archived agents' facts, keeping their places until the saucer has gone. */
      readonly held?: ReadonlyArray<CharacterFacts>;
      /** Where on its island the new agent lands, so it walks on from there to its spot. */
      readonly arriving?: { readonly landed: boolean; readonly at: Vec3 };
    }>
  >([]);
  const abductionId = useRef(0);
  // Agents being archived hold their places from the moment it is asked, so
  // the island does not shrink while the server answers and the saucer comes.
  const [archiving, setArchiving] = useState<ReadonlyArray<CharacterFacts>>([]);
  // Islands hidden from the projects menu leave the map; the rest close up.
  const hideIsland = useWorldVisibilityStore((state) => state.toggleHidden);
  const showOnlyIsland = useWorldVisibilityStore((state) => state.showOnly);
  // What the layout has caught up to: islands being hidden sink first and only then
  // leave it, so the rest close up after; islands being shown join it at once, and rise
  // once the rest have moved aside.
  const [layout, setLayout] = useState(() => ({
    hidden: useWorldVisibilityStore.getState().hidden,
    // Islands just shown, which wait for the rest to move aside before growing in.
    appearing: NO_KEYS,
    leaving: NO_KEYS,
  }));
  const laidOut = layout.hidden;
  // Told by each island when it has finished sinking (or rising back).
  const onIslandSunk = useRef<(key: string, sunk: boolean) => void>(() => {});
  useEffect(() => {
    let caughtUp = useWorldVisibilityStore.getState().hidden;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Islands all the way under the water, and the hide waiting on them.
    const sunk = new Set<string>();
    let waiting: { readonly leaving: ReadonlyArray<string>; readonly commit: () => void } | null =
      null;
    const commitOnceSunk = () => {
      if (waiting?.leaving.every((key) => sunk.has(key))) waiting.commit();
    };
    onIslandSunk.current = (key, isSunk) => {
      if (isSunk) sunk.add(key);
      else sunk.delete(key);
      commitOnceSunk();
    };
    const unsubscribe = useWorldVisibilityStore.subscribe(({ hidden }, previous) => {
      if (hidden === previous.hidden) return;
      clearTimeout(timer);
      waiting = null;
      const leaving = Object.keys(hidden).filter((key) => !caughtUp[key]);
      const commit = () => {
        clearTimeout(timer);
        waiting = null;
        // They leave the map, so a later show starts them under the water afresh.
        for (const key of leaving) sunk.delete(key);
        const appearing = new Set(Object.keys(caughtUp).filter((key) => !hidden[key]));
        caughtUp = hidden;
        setLayout({ hidden, appearing, leaving: NO_KEYS });
      };
      if (leaving.length === 0 || reducedMotion()) return commit();
      setLayout((current) => ({ ...current, leaving: new Set(leaving) }));
      waiting = { leaving, commit };
      // In case an island never reports back, as in a tab that draws no frames.
      timer = setTimeout(commit, ISLAND_SINK_MS * 3);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      onIslandSunk.current = () => {};
    };
  }, []);
  const visibleOrder = useMemo(
    () => projectOrder.filter((key) => !laidOut[key]),
    [projectOrder, laidOut],
  );
  const visibleFacts = useMemo(() => {
    // Archived agents still hold their spots while archiving and under the beam,
    // so the beach only closes ranks once the saucer has flown off with them.
    const live = new Set(islandFacts.map((f) => f.key));
    const held = [...archiving, ...abductions.flatMap((a) => a.held ?? [])].filter(
      (f) => !live.has(f.key),
    );
    return [...islandFacts, ...held].filter((f) => !laidOut[f.projectKey]);
  }, [islandFacts, archiving, abductions, laidOut]);
  const visibleMembers = useMemo(
    () => new Map(visibleOrder.map((key) => [key, projectMembers.get(key) ?? []])),
    [visibleOrder, projectMembers],
  );
  const islandPrefs = useWorldIslandPrefsStore((state) => state.prefs);
  const signStats = useIslandSignStats(visibleMembers, projects);
  const missingProjects = useMissingProjects(projects);
  const arrangement = useWorldArrangementStore((state) => state.arrangement);
  const setArrangement = useWorldArrangementStore((state) => state.setArrangement);
  // A new one makes the camera frame every island where they settle.
  // Rising islands come last, once the rest have moved aside.
  const islandLayout = useMemo(
    () => ({
      arrangement,
      laidOut,
      settleMs: reducedMotion()
        ? 0
        : ISLAND_MOVE_MS + (layout.appearing.size > 0 ? ISLAND_SINK_MS : 0),
    }),
    [arrangement, laidOut, layout.appearing],
  );
  const [memory] = useState(createArchipelagoMemory);
  // Piles picked for agents started from them, by the thread they will become.
  const [requested, setRequested] = useState<ReadonlyMap<string, SlotRequest>>(new Map());
  const chosenHues = useWorldHueStore((state) => state.chosen);
  const chooseHue = useWorldHueStore((state) => state.choose);
  // Re-check while anyone works, so a thread that goes quiet is noticed, and
  // more slowly while anyone rests, so resters change pose as their reply ages.
  const anyoneWorking = facts.some((f) => f.status === "working");
  const anyoneResting = facts.some(isResting);
  // An idle alarm also needs the time, to notice when an island has sat idle long enough.
  const anyIdleAlarm = Object.values(islandPrefs).some(
    (prefs) => prefs.idleAlarmMinutes !== undefined,
  );
  const clock = useClock(
    anyoneWorking ? QUIET_CHECK_MS : anyoneResting || anyIdleAlarm ? REST_CHECK_MS : null,
  );
  const islands = useMemo(
    () =>
      memory.resolve({
        facts: visibleFacts,
        definition,
        sizes: definitions,
        projectOrder: visibleOrder,
        hueCount: palette.families.length,
        hatCount: HAT_COUNT,
        chosenHues,
        checkedAt: clock,
        requested,
        columns: arrangementColumns(arrangement, visibleOrder.length),
      }),
    [
      memory,
      visibleFacts,
      definition,
      definitions,
      visibleOrder,
      clock,
      requested,
      chosenHues,
      arrangement,
    ],
  );
  // The open chat's header shows its character, so it needs the same look.
  const setLooks = useWorldLookStore((state) => state.setLooks);
  const recolorFamily = useCallback(
    (
      island: { readonly hues: ReadonlyMap<string, number> } | undefined,
      seed: string,
      hue: number,
    ) =>
      // A family already wearing it on this island steps aside to a free colour.
      chooseHue(
        seed,
        hue,
        [...(island?.hues ?? [])].flatMap(([other, worn]) => (worn === hue ? [other] : [])),
      ),
    [chooseHue],
  );
  useEffect(() => {
    const looks = new Map<string, WorldLook>();
    // The chat header's colour picker finds its character's family by thread key.
    const families = new Map<string, { readonly island: WorldIsland; readonly seed: string }>();
    for (const island of islands) {
      const plate = signPlate(islandPlate(island.key, islandPrefs[island.key]));
      for (const { facts: character } of island.characters) {
        families.set(character.key, { island, seed: character.lookSeed });
        looks.set(character.key, {
          kid: character.kid,
          plate,
          hue: island.hues.get(character.lookSeed) ?? 0,
          hat:
            character.worktreePath === null
              ? null
              : (island.hats.get(character.worktreePath) ?? null),
        });
      }
    }
    setLooks(looks, (threadKey, hue) => {
      const family = families.get(threadKey);
      if (family !== undefined) recolorFamily(family.island, family.seed, hue);
    });
  }, [islands, islandPrefs, setLooks, recolorFamily]);
  useEffect(() => () => setLooks(new Map(), null), [setLooks]);
  // Overlays above a hat sit higher, so the hat stays in view.
  const hatted = useMemo(
    () =>
      new Set(
        islands.flatMap((island) =>
          island.characters.flatMap(({ facts: character }) =>
            character.worktreePath !== null && island.hats.has(character.worktreePath)
              ? [character.key]
              : [],
          ),
        ),
      ),
    [islands],
  );
  const islandSpots = useMemo(
    () =>
      islands.map(({ key, offset, definition: sized }) => {
        const island = islandBounds(sized);
        return {
          key,
          x: offset[0] + (island.minX + island.maxX) / 2,
          z: offset[2] + (island.minZ + island.maxZ) / 2,
          shoreRadius: Math.max(island.maxX - island.minX, island.maxZ - island.minZ) / 2,
        };
      }),
    [islands],
  );
  // When each snoozed island's idle alarm may go off again, by island key.
  const [idleSnoozedUntil, setIdleSnoozedUntil] = useState<Readonly<Record<string, number>>>({});
  // Islands idle for longer than their alarm allows, which ripple for you in wavy rings.
  const idleAlarmed = useMemo(
    () =>
      new Set(
        islands.flatMap((island) => {
          const minutes = islandPrefs[island.key]?.idleAlarmMinutes;
          if (minutes === undefined) return [];
          const facts = island.characters.map((c) => c.facts);
          const idle = islandIdleSeconds(facts);
          if (idle === null) return [];
          if (idle < minutes * 60 || clock < (idleSnoozedUntil[island.key] ?? 0)) return [];
          return [island.key];
        }),
      ),
    [islands, islandPrefs, idleSnoozedUntil, clock],
  );
  const ambientFps = Math.max(
    0,
    ...islands.flatMap((island) => island.characters.map((c) => c.activity.ambientFps ?? 0)),
    islands.some((island) => island.ripple || idleAlarmed.has(island.key))
      ? definition.archipelago.ripple.fps
      : 0,
  );

  // The reply bubble belongs to one character at a time; clicking it again,
  // or empty ground, closes it.
  const [bubbleKey, setBubbleKey] = useState<string | null>(null);
  const bubble =
    bubbleKey === null
      ? null
      : (islands.flatMap((island) => island.characters).find((c) => c.facts.key === bubbleKey) ??
        null);
  const bubbleIsland =
    bubble === null ? undefined : islands.find((island) => island.key === bubble.facts.projectKey);
  // Characters cmd-clicked together, e.g. to archive them in one go.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // The bubble opened by "Send voice command" starts listening right away.
  const [listenKey, setListenKey] = useState<string | null>(null);
  const selectCharacter = (character: WorldCharacter, clicks: number) => {
    const { key } = character.facts;
    setPicked(new Set());
    setListenKey(null);
    // The second click of a double-click trades the bubble for the chat, and the chat for
    // the bubble.
    if (clicks === 2 && bubbleKey === key) {
      openChat(character);
      return;
    }
    if (clicks === 2 && chatKey === key && !chatCollapsed) {
      dropPendingChat();
      setSwitchingTo(null);
      closeManager();
      setBubbleKey(key);
      void onCollapse();
      return;
    }
    // With a chat shown, a click switches the chat to that character instead. A collapsed
    // chat stays collapsed: the click opens the bubble, whose expand button shows the chat.
    if (selectedKey !== null && !chatCollapsed) {
      setBubbleKey(null);
      switchChat(character.facts);
      return;
    }
    // Opening a character's bubble closes a new-agent bubble, which keeps its task as a draft.
    // Clicking it again leaves the bubble open.
    if (bubbleKey !== key) setNewAgent(null);
    closeManager();
    setBubbleKey(key);
  };
  // One island's manager popover at a time. Closed while he is thinking or
  // waiting on an answer, it stays mounted but hidden, so the question waits
  // and his balloon shows; clicking him brings it back.
  const [manager, setManager] = useState<{
    readonly islandKey: string;
    readonly open: boolean;
  } | null>(null);
  const [managerStatus, setManagerStatus] = useState<ManagerStatus>("idle");
  // The top bar's megaphone toggle hides every manager, and drops a talk in progress.
  const managersOn = useWorldManagerStore((state) => WORLD_MANAGERS_AVAILABLE && state.enabled);
  useEffect(() => {
    if (managersOn) return;
    setManager(null);
    setCalling(null);
  }, [managersOn]);
  // Who he is calling a message over to, for a few seconds after you send it.
  const [calling, setCalling] = useState<{
    readonly islandKey: string;
    readonly agentKey: string | null;
  } | null>(null);
  useEffect(() => {
    if (calling === null) return;
    const id = setTimeout(() => setCalling(null), MANAGER_CALL_MS);
    return () => clearTimeout(id);
  }, [calling]);
  const closeManager = () =>
    setManager((current) =>
      current === null || managerStatus === "idle" ? null : { ...current, open: false },
    );
  const toggleManager = (islandKey: string) => {
    setBubbleKey(null);
    setPicked(new Set());
    setNewAgent(null);
    if (manager?.islandKey === islandKey && manager.open) closeManager();
    else setManager({ islandKey, open: true });
  };
  const managerKeys = useMemo(
    () => (manager?.open === true ? [`manager:${manager.islandKey}`] : []),
    [manager],
  );
  const togglePicked = (character: WorldCharacter) => {
    // The character already singled out (its bubble or open chat) starts the selection.
    const anchor = bubble?.facts.key ?? ringKey;
    const anchorShown = islands.some((island) =>
      island.characters.some((c) => c.facts.key === anchor),
    );
    setBubbleKey(null);
    setPicked((current) => {
      const next = new Set(current);
      if (next.size === 0 && anchor !== null && anchorShown) next.add(anchor);
      if (!next.delete(character.facts.key)) next.add(character.facts.key);
      return next;
    });
  };
  const openChat = (character: WorldCharacter) => {
    setBubbleKey(null);
    useWorldModeStore.getState().focusChatOf(character.facts.key);
    switchChat(character.facts);
  };
  // The ring moves to the clicked character (and its bubble closes) at once;
  // the chat, heavier to mount or swap, follows once that has been drawn.
  // Clicking on before it does drops the chat still waiting.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const pendingChat = useRef<(() => void) | null>(null);
  const dropPendingChat = useCallback(() => {
    pendingChat.current?.();
    pendingChat.current = null;
  }, []);
  const switchChat = ({ key, ref }: { readonly key: string; readonly ref: ScopedThreadRef }) => {
    dropPendingChat();
    if (key === selectedKey) {
      setSwitchingTo(null);
      // The chat may be collapsed to its surfaces; picking its agent shows it again.
      void onExpand(ref);
      return;
    }
    setSwitchingTo(key);
    pendingChat.current = afterPaint(() => {
      pendingChat.current = null;
      void onExpand(ref).finally(() =>
        setSwitchingTo((current) => (current === key ? null : current)),
      );
    });
  };
  useEffect(() => dropPendingChat, [dropPendingChat]);
  const chatKey = switchingTo ?? selectedKey;
  // A chat collapsed to its worktree's surfaces singles out no agent: nobody wears the ring
  // and the map does not fly to its thread.
  const shownChatKey = chatCollapsed ? null : selectedKey;
  const ringKey = switchingTo ?? shownChatKey;
  const roots = useRef(new Map<string, Object3D>());
  const registerRoot = useCallback((key: string, root: Object3D | null) => {
    if (root === null) roots.current.delete(key);
    else roots.current.set(key, root);
  }, []);
  // Each island's sign, so framing an island keeps its whole board in view.
  const signs = useRef(new Map<string, Object3D>());
  const bubbleRef = useRef<HTMLDivElement>(null);

  /** One saucer takes everyone archived together. */
  const abduct = (characters: ReadonlyArray<WorldCharacter>) => {
    const islandKeys = new Set<string>();
    // Their feet and heads, so the map can make sure they are seen leaving.
    const seen: Vector3[] = [];
    const figures = characters.flatMap((character): AbductedFigure[] => {
      const root = roots.current.get(character.facts.key);
      if (root === undefined) return [];
      const at = root.getWorldPosition(new Vector3());
      seen.push(at, at.clone().setY(at.y + FOLLOW_HEIGHT * root.scale.y));
      const island = islands.find((i) => i.characters.includes(character));
      if (island !== undefined) islandKeys.add(island.key);
      const hue = island?.hues.get(character.facts.lookSeed) ?? 0;
      return [
        {
          key: character.facts.key,
          position: [at.x, at.y, at.z],
          scale: root.scale.y,
          facing: root.rotation.y,
          shades: palette.families[hue]!,
        },
      ];
    });
    if (figures.length === 0) return;
    abductionId.current += 1;
    setAbductions((all) => [
      ...all,
      {
        id: abductionId.current,
        islandKeys: [...islandKeys],
        figures,
        held: characters.map((character) => character.facts),
      },
    ]);
    keepInView.current?.(seen);
  };
  /** The saucer brings a new agent down onto its pile. */
  const arrive = (
    island: WorldIsland,
    slotIndex: number,
    thread: { readonly key: string; readonly hue: number },
  ) => {
    const area = island.definition.areas[definition.archipelago.newAgents.area];
    const slot = area?.kind === "fixed" ? area.slots[slotIndex] : undefined;
    if (slot === undefined) return;
    const [x, y, z] = slot.position;
    abductionId.current += 1;
    setAbductions((all) => [
      ...all,
      {
        id: abductionId.current,
        islandKeys: [island.key],
        figures: [
          {
            key: thread.key,
            position: [
              island.offset[0] + x,
              island.offset[1] + y + groundHeight(island.definition)(x, z),
              island.offset[2] + z,
            ],
            scale: definition.movement.characterScale,
            facing: slot.facing,
            shades: palette.families[thread.hue]!,
          },
        ],
        arriving: { landed: false, at: slot.position },
      },
    ]);
  };
  const abducted = new Set(
    abductions.flatMap((a) =>
      a.arriving?.landed === true ? [] : a.figures.map((figure) => figure.key),
    ),
  );
  const landedAt = new Map(
    abductions.flatMap((a) =>
      a.arriving?.landed === true
        ? a.figures.map((figure): [string, Vec3] => [figure.key, a.arriving!.at])
        : [],
    ),
  );
  // An island keeps its colour while a saucer is over it, taking or bringing agents.
  const leaving = new Set(abductions.flatMap((a) => a.islandKeys));

  const holdViewOnClose = useRef<(() => void) | null>(null);
  const keepInView = useRef<((points: ReadonlyArray<Vector3>) => void) | null>(null);
  const { archiveThread } = useThreadActions();
  // Archive, not delete: each can be undone from its toast or Settings → Archived.
  const archiveAll = async (characters: ReadonlyArray<WorldCharacter>) => {
    setPicked(new Set());
    setBubbleKey(null);
    const keys = new Set(characters.map((character) => character.facts.key));
    // The open chat closes when its agent is archived, maybe before the archive call
    // returns; the map stays where it is rather than going back to its view before the chat.
    if (selectedKey !== null && keys.has(selectedKey)) holdViewOnClose.current?.();
    setArchiving((all) => [...all, ...characters.map((character) => character.facts)]);
    const results = await Promise.all(
      characters.map(async (character) => ({
        character,
        result: await archiveThread(character.facts.ref),
      })),
    );
    const archived = results.filter((r) => r.result._tag === "Success").map((r) => r.character);
    try {
      // The open chat of an archived agent closes first, so its saucer is seen leaving.
      if (archived.some((character) => character.facts.key === selectedKey)) {
        await onCollapse();
      }
      abduct(archived);
    } finally {
      setArchiving((all) => all.filter((f) => !keys.has(f.key)));
    }
    const failed = results.flatMap(({ character, result }) =>
      result._tag === "Failure" ? [{ character, error: squashAtomCommandFailure(result) }] : [],
    );
    const first = failed[0];
    if (first !== undefined) {
      toastManager.add({
        type: "error",
        title:
          failed.length === 1
            ? `Could not archive "${first.character.facts.title || "Untitled thread"}"`
            : `Could not archive ${failed.length} agents`,
        description:
          first.error instanceof Error && first.error.message !== ""
            ? first.error.message
            : "Try again.",
      });
    }
  };

  const [zoomTo, setZoomTo] = useState<{ readonly key: string } | null>(null);
  // The chat frame's project chip asks for its agent's island.
  const islandFocusRequest = useWorldModeStore((state) => state.islandFocusRequest);
  const focusIsland = useEffectEvent((threadKey: string) => {
    const island = islands.find((entry) =>
      entry.characters.some((character) => character.facts.key === threadKey),
    );
    if (island !== undefined) setZoomTo({ key: island.key });
  });
  useEffect(() => {
    if (islandFocusRequest !== null) focusIsland(islandFocusRequest.threadKey);
  }, [islandFocusRequest]);
  const [restoringOn, setRestoringOn] = useState<string | null>(null);
  const [listOn, setListOn] = useState<{
    readonly key: string;
    readonly point: { readonly x: number; readonly y: number };
  } | null>(null);
  // The island whose preferences are open.
  const [prefsOn, setPrefsOn] = useState<string | null>(null);
  const [iconPicking, setIconPicking] = useState<{
    readonly key: string;
    readonly picker: "icon" | "file";
  } | null>(null);
  const setIslandIcon = useSetIslandIcon();
  const showIconMenu = async (key: string, point: { x: number; y: number }) => {
    const api = readLocalApi();
    const checkouts = projectCheckouts.get(key) ?? [];
    if (api === undefined || checkouts.length === 0) return;
    const disabled = !canChangeIslandIcon(checkouts);
    const clicked = await api.contextMenu.show(
      [
        { id: "detect", label: "Detect automatically", disabled },
        { id: "icon", label: "Choose icon…", disabled, separatorBefore: true },
        { id: "file", label: "Choose image file…", disabled },
      ],
      awayFromPointer(point),
    );
    if (clicked === "detect")
      void setIslandIcon(checkouts, { faviconPath: null, projectIcon: null });
    else if (clicked === "icon" || clicked === "file") setIconPicking({ key, picker: clicked });
  };
  // A click goes straight to the icon picker; automatic detection and image files stay on the
  // right-click menu. Without permission the menu shows its choices turned off instead.
  const openIconPicker = (key: string, point: { x: number; y: number }) => {
    if (!canChangeIslandIcon(projectCheckouts.get(key) ?? [])) {
      void showIconMenu(key, point);
      return;
    }
    setIconPicking({ key, picker: "icon" });
  };
  const removeIsland = useRemoveIsland();
  // The agent an island's "Run script" runs in; its chat opens only once a script runs.
  const [scriptAgent, setScriptAgent] = useState<ScopedThreadRef | null>(null);
  const showIslandMenu = async (key: string, point: { x: number; y: number }) => {
    const api = readLocalApi();
    if (api === undefined) return;
    const checkouts = projectCheckouts.get(key) ?? [];
    const idle =
      islands
        .find((island) => island.key === key)
        ?.characters.filter((c) => isResting(c.facts) && !abducted.has(c.facts.key)) ?? [];
    const snoozedUntil = idleSnoozedUntil[key] ?? 0;
    const snoozed = snoozedUntil > Date.now();
    // Scripts run in an agent's terminal: the latest in the main checkout, else the latest here.
    const agents = (islands.find((island) => island.key === key)?.characters ?? [])
      .filter((c) => !c.facts.kid && !abducted.has(c.facts.key))
      .toSorted((a, b) => b.facts.lastReplyAt.localeCompare(a.facts.lastReplyAt));
    const scriptAgent = agents.find((c) => c.facts.worktreePath === null) ?? agents[0];
    const clicked = await api.contextMenu.show(
      [
        { id: "only", label: "Show only this island", icon: "eye" },
        { id: "hide", label: "Hide this island", icon: "eye-off" },
        { id: "zoom", label: "Zoom to this island", icon: "zoom-in" },
        {
          id: "run-script",
          label: "Run script…",
          icon: "square-play",
          disabled: scriptAgent === undefined,
          separatorBefore: true,
        },
        ...(islandPrefs[key]?.idleAlarmMinutes !== undefined
          ? [
              {
                id: "snooze-idle",
                label: snoozed
                  ? `Idle alarm snoozed until ${new Date(snoozedUntil).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}`
                  : "Snooze idle alarm",
                icon: "bell-off",
                // Nothing to snooze until the alarm goes off; a snoozed one stays open to unsnooze.
                disabled: !snoozed && !idleAlarmed.has(key),
                separatorBefore: true,
                children: [
                  ...IDLE_SNOOZE_OPTIONS.map((option) => ({
                    id: `snooze-idle:${option.minutes}`,
                    label: option.label,
                  })),
                  ...(snoozed
                    ? [{ id: "unsnooze-idle", label: "Unsnooze", separatorBefore: true }]
                    : []),
                ],
              },
            ]
          : []),
        {
          id: "archive-idle",
          label: `Archive ${idle.length} idle ${idle.length === 1 ? "agent" : "agents"}`,
          icon: "archive",
          disabled: idle.length === 0,
          separatorBefore: true,
        },
        { id: "restore-archived", label: "Restore archived agent…", icon: "archive-restore" },
        { id: "prefs", label: "Island preferences…", icon: "settings", separatorBefore: true },
        // Hiding keeps the project; removing it drops the project and its threads.
        {
          id: "remove",
          label: "Remove project…",
          icon: "trash",
          disabled: !canChangeIslandIcon(checkouts),
        },
      ],
      awayFromPointer(point),
    );
    if (clicked === "only") showOnlyIsland(key, projectOrder);
    else if (clicked === "run-script" && scriptAgent !== undefined)
      setScriptAgent(scriptAgent.facts.ref);
    else if (clicked === "remove")
      void removeIsland(checkouts, projectTitles.get(key) ?? "Project");
    else if (clicked === "hide") hideIsland(key);
    else if (clicked === "zoom") setZoomTo({ key });
    else if (clicked === "prefs") setPrefsOn(key);
    else if (clicked?.startsWith("snooze-idle:")) {
      const minutes = Number(clicked.slice("snooze-idle:".length));
      setIdleSnoozedUntil((snoozed) => ({ ...snoozed, [key]: Date.now() + minutes * 60_000 }));
    } else if (clicked === "unsnooze-idle") {
      setIdleSnoozedUntil(({ [key]: _, ...rest }) => rest);
    } else if (clicked === "archive-idle") void archiveAll(idle);
    else if (clicked === "restore-archived") setRestoringOn(key);
  };

  const addProject = useAddProject(islandOf);
  const showOceanMenu = async (point: { x: number; y: number }) => {
    const api = readLocalApi();
    if (api === undefined) return;
    const clicked = await api.contextMenu.show(
      [
        ...(addProject.available
          ? [
              {
                id: "add-island",
                label: "Add new island (project)…",
                icon: "plus",
                disabled: addProject.picking,
              },
            ]
          : []),
        {
          id: "arrange",
          label: "Arrange islands",
          icon: "layout-grid",
          children: ARRANGEMENTS.map((option) => ({
            id: `arrange:${option.value}`,
            label: option.label,
            checked: option.value === arrangement,
          })),
        },
      ],
      awayFromPointer(point),
    );
    if (clicked === "add-island") void addProject.addProject();
    else if (clicked?.startsWith("arrange:")) {
      const value = clicked.slice("arrange:".length);
      const option = ARRANGEMENTS.find((candidate) => candidate.value === value);
      if (option !== undefined) setArrangement(option.value);
    }
  };

  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const stopAll = async (characters: ReadonlyArray<WorldCharacter>) => {
    setPicked(new Set());
    const results = await Promise.all(
      characters
        .filter((c) => isStoppable(c.facts))
        .map(async (character) => ({
          character,
          result: await interruptTurn({
            environmentId: character.facts.ref.environmentId,
            input: { threadId: character.facts.ref.threadId },
          }),
        })),
    );
    const failed = results.flatMap(({ character, result }) =>
      result._tag === "Failure" ? [{ character, error: squashAtomCommandFailure(result) }] : [],
    );
    const first = failed[0];
    if (first !== undefined) {
      toastManager.add({
        type: "error",
        title:
          failed.length === 1
            ? `Could not stop "${first.character.facts.title || "Untitled thread"}"`
            : `Could not stop ${failed.length} agents`,
        description: first.error instanceof Error ? first.error.message : undefined,
      });
    }
  };

  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  // The new title arrives on the thread shell, like the bubble's regenerate button.
  const regenerateTitle = async (character: WorldCharacter) => {
    const result = await updateMetadata({
      environmentId: character.facts.ref.environmentId,
      input: { threadId: character.facts.ref.threadId, regenerateTitle: true },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `Could not regenerate the title of "${character.facts.title || "Untitled thread"}"`,
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const showMenu = async (character: WorldCharacter, point: { x: number; y: number }) => {
    const api = readLocalApi();
    if (api === undefined) return;
    const all = islands.flatMap((island) => island.characters);
    const group =
      picked.has(character.facts.key) && picked.size > 1
        ? all.filter((c) => picked.has(c.facts.key))
        : null;
    if (group !== null) {
      const running = group.filter((c) => isStoppable(c.facts)).length;
      const clicked = await api.contextMenu.show(
        [
          {
            id: "stop",
            label: `Stop (${running})`,
            icon: "circle-stop",
            disabled: running === 0,
          },
          { id: "archive", label: `Archive (${group.length})`, icon: "archive" },
        ],
        awayFromPointer(point),
      );
      if (clicked === "stop") void stopAll(group);
      else if (clicked === "archive") void archiveAll(group);
      return;
    }
    const regenerating = readThreadShell(character.facts.ref)?.titleRegeneration != null;
    // The other agents on its island, not subagents or ones already leaving.
    const others =
      islands
        .find((island) => island.key === character.facts.projectKey)
        ?.characters.filter(
          (c) => c.facts.key !== character.facts.key && !c.facts.kid && !abducted.has(c.facts.key),
        ) ?? [];
    // The camera looks from +x+z and never turns, so x - z grows to the right of the screen.
    const screenX = (c: WorldCharacter) => c.placement.position[0] - c.placement.position[2];
    const toTheLeft = others.filter((c) => screenX(c) < screenX(character));
    const clicked = await api.contextMenu.show(
      [
        { id: "open", label: "Open chat", icon: "message-square" },
        {
          id: "voice",
          label: "Send voice command",
          icon: "mic",
          disabled: !voiceInputSupported(),
        },
        ...(readEnvironmentSupportsTitleRegeneration(character.facts.ref.environmentId)
          ? [
              {
                id: "regenerate-title",
                label: regenerating ? "Regenerating…" : "Regenerate title",
                icon: "refresh-cw",
                disabled: regenerating,
              },
            ]
          : []),
        {
          id: "stop",
          label: "Stop",
          icon: "circle-stop",
          disabled: !isStoppable(character.facts),
          separatorBefore: true,
        },
        { id: "archive", label: "Archive", icon: "archive" },
        {
          id: "archive-others",
          label: `Archive others (${others.length})`,
          icon: "archive",
          disabled: others.length === 0,
        },
        {
          id: "archive-left",
          label: `Archive to the left (${toTheLeft.length})`,
          icon: "archive",
          disabled: toTheLeft.length === 0,
        },
      ],
      awayFromPointer(point),
    );
    if (clicked === "open") openChat(character);
    else if (clicked === "stop") void stopAll([character]);
    else if (clicked === "archive") void archiveAll([character]);
    else if (clicked === "archive-others") void archiveAll(others);
    else if (clicked === "archive-left") void archiveAll(toTheLeft);
    else if (clicked === "regenerate-title") void regenerateTitle(character);
    else if (clicked === "voice") {
      setPicked(new Set());
      setListenKey(character.facts.key);
      setBubbleKey(character.facts.key);
    }
  };
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  // A click on the sea or an island's ground closes the bubbles; the end of a pan does not.
  const clickGround = (event: MouseEvent) => {
    const start = pressedAt.current;
    if (start === null) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) {
      setBubbleKey(null);
      setPicked(new Set());
      setNewAgent(null);
      closeManager();
    }
  };

  // Hovering an island tags its characters with their thread titles;
  // the one under the pointer comes to the front. Clicking it shows the full title.
  // The character whose chat is open keeps its tag, a bigger one, hovered or not.
  const [hoveredIsland, setHoveredIsland] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const onHover = (character: WorldCharacter, point: { x: number; y: number } | null) => {
    if (point !== null) setHoveredKey(character.facts.key);
    else setHoveredKey((current) => (current === character.facts.key ? null : current));
  };
  const chatCharacter = islands
    .flatMap((island) => island.characters)
    .find((character) => character.facts.key === chatKey);
  // The chat header's archive button goes through archiveAll, so the agent leaves by saucer.
  const archiveChat = useRef(async () => {});
  useEffect(() => {
    archiveChat.current = async () => {
      if (chatCharacter !== undefined) await archiveAll([chatCharacter]);
    };
  });
  // The open chat's island gets wider shallows, so it stands out.
  const chatIsland = chatCharacter?.facts.projectKey ?? null;
  const bounds = useMemo(() => archipelagoBounds(islands, chatIsland), [islands, chatIsland]);
  const chatCharacterKey = chatCharacter?.facts.key ?? null;
  useEffect(() => {
    if (chatCharacterKey === null) return;
    const { setArchiveChatAgent } = useWorldModeStore.getState();
    setArchiveChatAgent(() => archiveChat.current());
    return () => setArchiveChatAgent(null);
  }, [archiveChat, chatCharacterKey]);
  // Subagents tag only under the pointer, so they don't crowd their parent's tag.
  const tagged = [
    ...(islands.find((island) => island.key === hoveredIsland)?.characters ?? []).filter(
      (character) => !character.facts.kid || character.facts.key === hoveredKey,
    ),
    ...(chatCharacter !== undefined && chatCharacter.facts.projectKey !== hoveredIsland
      ? [chatCharacter]
      : []),
  ].filter((character) => character.facts.key !== bubble?.facts.key);
  // Empty spots on the hovered island get a start button for a new agent.
  const [newAgent, setNewAgent] = useState<{
    readonly islandKey: string;
    readonly slotIndex: number;
    readonly position: Vec3;
  } | null>(null);
  // The island's draft, left by a bubble closed before its agent started.
  const newAgentDraft = useNewAgentDraftStore((state) =>
    newAgent === null ? null : (state.drafts[newAgent.islandKey] ?? null),
  );
  // None while a saucer is over the island: the buttons draw above the canvas, saucer included.
  const hoveredLeaving = hoveredIsland !== null && leaving.has(hoveredIsland);
  const newAgentSpots = useMemo(() => {
    const island = islands.find((i) => i.key === hoveredIsland);
    if (island === undefined || hoveredLeaving) return [];
    return freePiles(island, definition).map((pile) => ({
      key: `${island.key}#${pile.slotIndex}`,
      islandKey: island.key,
      ...pile,
    }));
  }, [definition, islands, hoveredIsland, hoveredLeaving]);
  // The new-thread shortcut asks for an island, then opens the bubble at its
  // first free pile and brings that into view.
  const pickingProject = useWorldModeStore((state) => state.pickingProject);
  const setPickingProject = useWorldModeStore((state) => state.setPickingProject);
  const [reveal, setReveal] = useState<{
    readonly islandKey: string;
    readonly position: Vec3;
  } | null>(null);
  const startOnIsland = (key: string) => {
    setPickingProject(false);
    const island = islands.find((i) => i.key === key);
    const pile = island === undefined ? undefined : freePiles(island, definition)[0];
    if (pile === undefined) return;
    setBubbleKey(null);
    setNewAgent({ islandKey: key, ...pile });
    setReveal({ islandKey: key, position: pile.position });
  };
  // With one island there is nothing to pick.
  const skipPicker = useEffectEvent(() => {
    const only = islands.length === 1 ? islands[0] : undefined;
    if (only !== undefined) startOnIsland(only.key);
  });
  useEffect(
    () =>
      useWorldModeStore.subscribe((state, previous) => {
        if (state.pickingProject && !previous.pickingProject) skipPicker();
      }),
    [],
  );
  // A picker left open when the world closes would show again on its return.
  useEffect(() => () => setPickingProject(false), [setPickingProject]);
  const spotRefs = useRef(new Map<string, HTMLButtonElement>());
  const moveSpots = useCallback((points: ReadonlyArray<ScreenPoint>) => {
    // Zoomed out, the buttons would pile onto each other: show none until
    // they sit clearly apart.
    let closest = Infinity;
    for (const [index, a] of points.entries()) {
      for (const b of points.slice(index + 1)) {
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    const visible = closest >= SPOT_MIN_SPACING_PX;
    for (const point of points) {
      const spot = spotRefs.current.get(point.key);
      if (spot === undefined) continue;
      spot.style.transform = `translate(${point.x}px, ${point.y}px)`;
      spot.style.visibility = visible ? "visible" : "hidden";
    }
  }, []);
  // Islands whose project folder is gone get an alert over their sign.
  const missingFolders = useMemo(() => {
    const lostOn = new Map<string, Array<(typeof missingProjects)[number]>>();
    for (const project of missingProjects) {
      const island = islandOf.get(
        scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
      );
      if (island !== undefined) lostOn.set(island, [...(lostOn.get(island) ?? []), project]);
    }
    return islands.flatMap((island) => {
      const lost = lostOn.get(island.key);
      if (lost === undefined) return [];
      const sign = island.definition.archipelago.sign.position;
      const position: Vec3 = [
        island.offset[0] + sign[0],
        island.offset[1] + sign[1] + SIGN_TOP + 0.6,
        island.offset[2] + sign[2],
      ];
      return [{ key: island.key, projects: lost, position }];
    });
  }, [missingProjects, islandOf, islands]);
  const missingFolderRefs = useRef(new Map<string, HTMLDivElement>());
  const moveMissingFolders = useCallback((points: ReadonlyArray<ScreenPoint>) => {
    for (const point of points) {
      const pill = missingFolderRefs.current.get(point.key);
      if (pill !== undefined) pill.style.transform = `translate(${point.x}px, ${point.y}px)`;
    }
  }, []);
  const openSurfacesOf = (ref: ScopedThreadRef) => {
    setBubbleKey(null);
    closeManager();
    void onOpenSurfaces(ref);
  };
  const createIdleThread = useCreateIdleWorldThread();
  // Surfaces belong to a thread: a worktree's latest one, else a new idle thread made there.
  const openWorktreeSurfaces = async (islandKey: string, worktree: WorktreeSurfacesTarget) => {
    const worktreePath = worktree.inProjectFolder ? null : worktree.path;
    const existing =
      latestThreadIn(
        islands.find((island) => island.key === islandKey),
        worktreePath,
        worktree.path,
      ) ??
      // Only recent threads walk the world, so a quiet worktree, the main one most often,
      // falls back to any of its island's threads that worked there.
      latestShellIn(threads, islandOf, islandKey, worktreePath, worktree.path);
    if (existing !== null) return openSurfacesOf(existing);
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === worktree.environmentId &&
        candidate.workspaceRoot === worktree.cwd,
    );
    try {
      if (project === undefined) throw new Error("The worktree's project is gone.");
      const ref = {
        environmentId: project.environmentId,
        threadId: await createIdleThread(
          { environmentId: project.environmentId, projectId: project.id },
          { branch: worktree.branch, worktreePath },
          worktree.branch,
        ),
      };
      // The thread route closes on a thread the client hasn't heard of yet.
      if (await waitForThreadShell(ref)) openSurfacesOf(ref);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not open surfaces",
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };
  const newAgentRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleArea = useCallback((): VisibleArea | null => {
    const container = containerRef.current;
    if (container === null) return null;
    return {
      width: container.clientWidth,
      height: container.clientHeight,
      covered: coveredOf(container.getBoundingClientRect(), panel(), bars()),
    };
  }, [panel, bars]);
  const moveBubble = useBubblePlacement(bubbleRef, visibleArea, bubble !== null);
  const moveNewAgent = useBubblePlacement(newAgentRef, visibleArea, newAgent !== null);
  const moveManager = useBubblePlacement(managerRef, visibleArea, manager?.open === true);
  // The map zooms on wheel; overlays pass it on so that keeps working under the pointer.
  const forwardWheel = (event: React.WheelEvent) =>
    containerRef.current
      ?.querySelector("canvas")
      ?.dispatchEvent(new WheelEvent("wheel", event.nativeEvent));
  // A press anywhere outside the bubble closes it. The canvas and name tags decide
  // for themselves: a character click keeps or switches, empty ground closes.
  const bubbleOpen = bubbleKey !== null;
  useEffect(() => {
    if (!bubbleOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null || bubbleRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(PORTALED_LAYERS)) return;
      if (containerRef.current?.querySelector("canvas")?.contains(target)) return;
      if ([...tagRefs.current.values()].some((tag) => tag.contains(target))) return;
      setBubbleKey(null);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [bubbleOpen]);
  // Same for the new-agent bubble, which leaves a typed task as the island's draft.
  // Presses on the canvas go through clickGround, so dragging the map keeps it open.
  const newAgentOpen = newAgent !== null;
  useEffect(() => {
    if (!newAgentOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null || newAgentRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(PORTALED_LAYERS)) return;
      if (containerRef.current?.querySelector("canvas")?.contains(target)) return;
      setNewAgent(null);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [newAgentOpen, setNewAgent]);

  // And the manager's, which keeps a question it is waiting on (see closeManager).
  const managerOpen = manager?.open === true;
  const closeManagerOutside = useEffectEvent(() => closeManager());
  useEffect(() => {
    if (!managerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null || managerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(PORTALED_LAYERS)) return;
      if (containerRef.current?.querySelector("canvas")?.contains(target)) return;
      closeManagerOutside();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [managerOpen]);

  // The hovered island's manager gets a tag too, unless his popover is open over him.
  const managerTagKey =
    !managersOn ||
    hoveredIsland === null ||
    hoveredLeaving ||
    (manager?.islandKey === hoveredIsland && manager.open)
      ? null
      : `manager:${hoveredIsland}`;
  const tagRefs = useRef(new Map<string, HTMLDivElement>());
  const moveTags = useCallback((points: ReadonlyArray<ScreenPoint>) => {
    const sizes = new Map<string, { width: number; height: number }>();
    for (const [key, tag] of tagRefs.current) {
      const label = tag.firstElementChild as HTMLElement | null;
      if (label !== null) sizes.set(key, { width: label.offsetWidth, height: label.offsetHeight });
    }
    const lifted = layoutTags(points, sizes);
    for (const point of points) {
      const tag = tagRefs.current.get(point.key);
      const bottom = lifted.get(point.key);
      if (tag !== undefined && bottom !== undefined) {
        tag.style.transform = `translate(${point.x}px, ${bottom}px)`;
      }
    }
  }, []);

  const [drawn, setDrawn] = useState(false);

  return (
    // Isolated so its overlays (tags, buttons, bubbles) stack under the chat panel.
    <div ref={containerRef} className="relative isolate size-full">
      <Canvas
        // Fades in once drawn, over the layout's sea blue, so the first look is never a flash
        // of whatever sky the hour has.
        className={cn("transition-opacity duration-500", !drawn && "opacity-0")}
        onCreated={() => requestAnimationFrame(() => setDrawn(true))}
        frameloop="demand"
        dpr={[1, 1.5]}
        // CustomToneMapping is ACES plus the contrast slider; see scene/contrast.
        // The stencil keeps overlapping ground shadows from stacking; see SHADOW_STENCIL.
        gl={{ antialias: true, toneMapping: CustomToneMapping, stencil: true }}
        orthographic
        camera={{ position: [18, 20, 18], zoom: 42, near: -1000, far: 2000 }}
        events={nearPlaneEvents}
        onPointerDown={(event) => {
          pressedAt.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMissed={clickGround}
      >
        {/* The time of day: lights, sky, and when lamps come on (see scene/daylight). */}
        <WorldDaylight>
          <WorldControls
            bounds={bounds}
            islands={islandSpots}
            panel={panel}
            bars={bars}
            focusKey={shownChatKey}
            roots={roots}
            signs={signs}
            zoomTo={zoomTo}
            holdViewOnClose={holdViewOnClose}
            keepInView={keepInView}
            reveal={reveal}
            layout={islandLayout}
          />
          <FollowTracker
            roots={roots}
            keys={bubble === null ? [] : [bubble.facts.key]}
            hatted={hatted}
            holdWhileWalking
            onMove={moveBubble}
          />
          <FollowTracker
            roots={roots}
            keys={[
              ...tagged.map((c) => c.facts.key),
              ...(managerTagKey === null ? [] : [managerTagKey]),
            ]}
            hatted={hatted}
            onMove={moveTags}
          />
          <FollowTracker roots={roots} keys={managerKeys} hatted={NO_HATS} onMove={moveManager} />
          <PointTracker points={newAgentSpots} onMove={moveSpots} />
          <PointTracker points={missingFolders} onMove={moveMissingFolders} />
          <PointTracker
            points={newAgent === null ? [] : [{ key: "new-agent", position: newAgent.position }]}
            onMove={moveNewAgent}
          />
          <IslandHoverTracker
            target={containerRef}
            islands={islandSpots}
            onChange={setHoveredIsland}
          />
          <AmbientTicker fps={ambientFps} />
          {/* Far wider than any archipelago, so the water never ends on screen. */}
          {/* Islands and characters stop their clicks, so only open water reaches here. */}
          {/* Its handlers make it a hit, so it takes the clicks onPointerMissed would get. */}
          <mesh
            geometry={geometry.plane}
            rotation-x={-Math.PI / 2}
            position-y={-0.25}
            scale={4000}
            onClick={(event) => clickGround(event.nativeEvent)}
            onContextMenu={(event) => {
              event.stopPropagation();
              event.nativeEvent.preventDefault();
              void showOceanMenu({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
            }}
          >
            <meshLambertMaterial color={palette.water} />
          </mesh>
          <WhaleSightings islands={islandSpots} config={definition.archipelago.whales} />
          {islands.map((island) => {
            // Everyone there archived: once the saucer has left, the island stays
            // washed out until new work lands.
            const faded = island.characters.length === 0 && !leaving.has(island.key);
            const plate = islandPlate(island.key, islandPrefs[island.key]);
            return (
              <FadedContext key={island.key} value={faded}>
                <IslandMotion
                  position={island.offset}
                  leaving={layout.leaving.has(island.key)}
                  appear={layout.appearing.has(island.key)}
                  onSunk={(isSunk) => onIslandSunk.current(island.key, isSunk)}
                  // A prop or limb in front of a character is hit first; the character still wins.
                  onClick={(event) => {
                    if (hitsCharacter(event)) return;
                    // Stopped, so the sea under the island doesn't take it too.
                    event.stopPropagation();
                    clickGround(event.nativeEvent);
                  }}
                  onContextMenu={(event) => {
                    if (hitsCharacter(event)) return;
                    event.stopPropagation();
                    event.nativeEvent.preventDefault();
                    void showIslandMenu(island.key, {
                      x: event.nativeEvent.clientX,
                      y: event.nativeEvent.clientY,
                    });
                  }}
                >
                  <Island
                    definition={island.definition}
                    furniture={buildFurniture(island.definition, island.characters)}
                    ripple={island.ripple ? "plain" : idleAlarmed.has(island.key) ? "wavy" : null}
                    wide={island.key === chatIsland}
                  />
                  {/* The sign names the project, so it keeps its colours on an empty island. */}
                  <FadedContext value={false}>
                    <Sign
                      slot={island.definition.archipelago.sign}
                      project={projectRecords.get(island.key)!}
                      text={projectTitles.get(island.key) ?? "Project"}
                      color={plate}
                      branches={signStats.get(island.key)?.branches ?? 0}
                      pullRequests={signStats.get(island.key)?.pullRequests ?? 0}
                      onListClick={(point) => {
                        // The sign is on the canvas, so it is not a press outside the bubbles.
                        setBubbleKey(null);
                        setNewAgent(null);
                        closeManager();
                        setListOn({ key: island.key, point });
                      }}
                      onPrefsClick={() => {
                        setBubbleKey(null);
                        setNewAgent(null);
                        closeManager();
                        setPrefsOn(island.key);
                      }}
                      onIconClick={(point) => openIconPicker(island.key, point)}
                      onIconMenu={(point) => void showIconMenu(island.key, point)}
                      ref={(sign) => {
                        if (sign === null) signs.current.delete(island.key);
                        else signs.current.set(island.key, sign);
                      }}
                    />
                  </FadedContext>
                  {/* Like the sign, he keeps his colours on an empty island. */}
                  {managersOn ? (
                    <FadedContext value={false}>
                      <Manager
                        definition={island.definition}
                        ground={groundHeight(island.definition)}
                        scale={definition.movement.characterScale}
                        thinking={manager?.islandKey === island.key && managerStatus === "thinking"}
                        asking={
                          manager?.islandKey === island.key &&
                          !manager.open &&
                          managerStatus === "asking"
                        }
                        hair={plate}
                        callTarget={
                          calling?.islandKey === island.key
                            ? () =>
                                calling.agentKey === null
                                  ? null
                                  : (roots.current.get(calling.agentKey) ?? null)
                            : null
                        }
                        onSelect={() => toggleManager(island.key)}
                        rootKey={`manager:${island.key}`}
                        onRoot={registerRoot}
                      />
                    </FadedContext>
                  ) : null}
                  {island.characters
                    .filter((character) => !abducted.has(character.facts.key))
                    .map((character) => (
                      <Character
                        key={character.facts.key}
                        character={character}
                        startAt={landedAt.get(character.facts.key)}
                        shades={palette.families[island.hues.get(character.facts.lookSeed) ?? 0]!}
                        hat={
                          character.facts.worktreePath === null
                            ? null
                            : (island.hats.get(character.facts.worktreePath) ?? null)
                        }
                        obstacles={islandObstacles(island.definition)}
                        ground={groundHeight(island.definition)}
                        surface={surfaceAt(island.definition)}
                        movement={definition.movement}
                        selected={
                          character.facts.key === (bubble?.facts.key ?? ringKey) ||
                          picked.has(character.facts.key)
                        }
                        onSelect={selectCharacter}
                        onOpen={openChat}
                        onPick={togglePicked}
                        onMenu={(target, point) => void showMenu(target, point)}
                        onRoot={registerRoot}
                        onHover={onHover}
                      />
                    ))}
                </IslandMotion>
              </FadedContext>
            );
          })}
          {abductions.map((abduction) => (
            <Abduction
              key={abduction.id}
              figures={abduction.figures}
              arriving={abduction.arriving !== undefined}
              onLanded={() =>
                setAbductions((all) =>
                  all.map((a) =>
                    a.id === abduction.id && a.arriving !== undefined
                      ? { ...a, arriving: { ...a.arriving, landed: true } }
                      : a,
                  ),
                )
              }
              onDone={() => setAbductions((all) => all.filter((a) => a.id !== abduction.id))}
            />
          ))}
        </WorldDaylight>
      </Canvas>
      {bubble !== null ? (
        // Positioned by FollowTracker on every drawn frame, above the character's head.
        <div ref={bubbleRef} className="pointer-events-none absolute top-0 left-0 z-30">
          <div className="pointer-events-auto -translate-x-1/2 -translate-y-[calc(100%+0.75rem)]">
            <WorldBubble
              key={`${bubble.facts.key}:${listenKey === bubble.facts.key}`}
              facts={bubble.facts}
              listen={listenKey === bubble.facts.key}
              hue={bubbleIsland?.hues.get(bubble.facts.lookSeed) ?? 0}
              onHueChange={(hue) => recolorFamily(bubbleIsland, bubble.facts.lookSeed, hue)}
              onClose={() => setBubbleKey(null)}
              onExpand={() => openChat(bubble)}
              onArchived={() => {
                setBubbleKey(null);
                abduct([bubble]);
              }}
            />
          </div>
        </div>
      ) : null}
      {newAgentSpots.map((spot) => (
        // Positioned by PointTracker on drawn frames, over the empty pile.
        <button
          key={spot.key}
          type="button"
          ref={(button) => {
            if (button === null) spotRefs.current.delete(spot.key);
            else spotRefs.current.set(spot.key, button);
          }}
          aria-label={`Start a new agent on ${projectTitles.get(spot.islandKey) ?? "this island"}`}
          // Under the name tags and popovers: a pile sits right below a miner's head.
          // Only the circle takes the pointer; the button's own box sits off it.
          className="pointer-events-none invisible absolute top-0 left-0 z-0"
          onWheel={forwardWheel}
          onClick={() => {
            setBubbleKey(null);
            closeManager();
            setNewAgent({
              islandKey: spot.islandKey,
              slotIndex: spot.slotIndex,
              position: spot.position,
            });
          }}
        >
          <span className="pointer-events-auto flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background transition-transform hover:scale-110">
            <PlusIcon className="size-3.5" />
          </span>
        </button>
      ))}
      {missingFolders.map((spot) => (
        // Positioned by PointTracker on drawn frames, over the island's sign.
        <div
          key={spot.key}
          ref={(pill) => {
            if (pill === null) missingFolderRefs.current.delete(spot.key);
            else missingFolderRefs.current.set(spot.key, pill);
          }}
          className="pointer-events-none absolute top-0 left-0 z-10"
          onWheel={forwardWheel}
        >
          <div className="pointer-events-auto w-max -translate-x-1/2 -translate-y-full">
            <MissingFolderPill projects={spot.projects} />
          </div>
        </div>
      ))}
      {newAgent !== null ? (
        <div ref={newAgentRef} className="pointer-events-none absolute top-0 left-0 z-30">
          <div className="pointer-events-auto -translate-x-1/2 -translate-y-[calc(100%+0.75rem)]">
            <NewAgentBubble
              key={`${newAgent.islandKey}#${newAgent.slotIndex}`}
              islandName={projectTitles.get(newAgent.islandKey) ?? "this island"}
              project={projectRefs.get(newAgent.islandKey)!}
              draft={newAgentDraft}
              onClose={() => setNewAgent(null)}
              onLeave={(draft) => {
                const { keep, drop } = useNewAgentDraftStore.getState();
                if (draft.text.trim() === "") drop(newAgent.islandKey);
                else keep(newAgent.islandKey, draft);
              }}
              suggestedHue={suggestHue(
                islands.find((island) => island.key === newAgent.islandKey) ?? { hues: new Map() },
                palette.families.length,
              )}
              island={islands.find((island) => island.key === newAgent.islandKey) ?? null}
              onStarted={(thread) => {
                const { islandKey, slotIndex } = newAgent;
                useNewAgentDraftStore.getState().drop(islandKey);
                chooseHue(thread.ref.threadId, thread.hue);
                const island = islands.find((i) => i.key === islandKey);
                if (island !== undefined) arrive(island, slotIndex, thread);
                setRequested((all) =>
                  new Map(all).set(thread.key, {
                    area: definition.archipelago.newAgents.area,
                    slotIndex,
                  }),
                );
                setNewAgent(null);
                // An open chat moves on to the new agent, once the client has its
                // thread: the chat route closes on a thread it hasn't heard of.
                if (selectedKey !== null) {
                  void waitForThreadShell(thread.ref).then((found) => {
                    if (found) switchChat(thread);
                  });
                }
              }}
            />
          </div>
        </div>
      ) : null}
      {manager !== null ? (
        // Positioned by FollowTracker over the manager's head; hidden, not
        // unmounted, while he waits on an answer with the popover closed.
        <div
          ref={managerRef}
          className={cn(
            "pointer-events-none absolute top-0 left-0 z-30",
            !manager.open && "hidden",
          )}
        >
          <div className="pointer-events-auto -translate-x-1/2 -translate-y-[calc(100%+0.75rem)]">
            <ManagerBubble
              key={manager.islandKey}
              islandName={projectTitles.get(manager.islandKey) ?? "this island"}
              project={projectRefs.get(manager.islandKey)!}
              agents={(
                islands.find((island) => island.key === manager.islandKey)?.characters ?? []
              ).flatMap((character) =>
                character.facts.kid ||
                character.facts.ref.environmentId !==
                  projectRefs.get(manager.islandKey)?.environmentId
                  ? []
                  : [
                      {
                        key: character.facts.key,
                        ref: character.facts.ref,
                        title: character.facts.title,
                        worktreePath: character.facts.worktreePath,
                        lastReplyAt: character.facts.lastReplyAt,
                        working: character.facts.status === "working",
                      },
                    ],
              )}
              suggestedHue={suggestHue(
                islands.find((island) => island.key === manager.islandKey) ?? { hues: new Map() },
                palette.families.length,
              )}
              onStatus={setManagerStatus}
              onClose={closeManager}
              onCancel={() => setManager(null)}
              onCall={(agentKey) => setCalling({ islandKey: manager.islandKey, agentKey })}
              onStarted={(thread) => {
                chooseHue(thread.ref.threadId, thread.hue);
                const island = islands.find((i) => i.key === manager.islandKey);
                const pile = island === undefined ? undefined : freePiles(island, definition)[0];
                if (island === undefined || pile === undefined) return;
                arrive(island, pile.slotIndex, thread);
                setRequested((all) =>
                  new Map(all).set(thread.key, {
                    area: definition.archipelago.newAgents.area,
                    slotIndex: pile.slotIndex,
                  }),
                );
              }}
            />
          </div>
        </div>
      ) : null}
      <NewAgentProjectPicker
        open={pickingProject && islands.length !== 1}
        islands={islands.map((island) => ({
          key: island.key,
          title: projectTitles.get(island.key) ?? "Project",
          color: islandPlate(island.key, islandPrefs[island.key]),
          freePiles: freePiles(island, definition).length,
        }))}
        // The agent in focus (its bubble, else its open chat) picks its own island first.
        defaultKey={
          islands.find((island) =>
            island.characters.some((c) => c.facts.key === (bubble?.facts.key ?? chatKey)),
          )?.key ?? null
        }
        onPick={startOnIsland}
        onClose={() => setPickingProject(false)}
      />
      <IslandRunScriptDialog
        agentRef={scriptAgent}
        onClose={() => setScriptAgent(null)}
        onRun={(ref) => {
          setBubbleKey(null);
          switchChat({ key: scopedThreadKey(ref), ref });
        }}
      />
      {restoringOn !== null ? (
        <RestoreArchivedDialog
          title={projectTitles.get(restoringOn) ?? "this island"}
          project={projectRecords.get(restoringOn) ?? null}
          color={islandPlate(restoringOn, islandPrefs[restoringOn])}
          projectRefs={projectMembers.get(restoringOn) ?? []}
          onClose={() => setRestoringOn(null)}
        />
      ) : null}
      {iconPicking !== null && (projectCheckouts.get(iconPicking.key)?.length ?? 0) > 0 ? (
        <IslandIconPicker
          checkouts={projectCheckouts.get(iconPicking.key)!}
          projectName={projectTitles.get(iconPicking.key) ?? "Project"}
          picker={iconPicking.picker}
          onSelect={(icon) => void setIslandIcon(projectCheckouts.get(iconPicking.key)!, icon)}
          onClose={() => setIconPicking(null)}
        />
      ) : null}
      {prefsOn !== null ? (
        <IslandPrefsDialog
          islandKey={prefsOn}
          title={projectTitles.get(prefsOn) ?? "Project"}
          checkouts={projectCheckouts.get(prefsOn) ?? []}
          onClose={() => setPrefsOn(null)}
        />
      ) : null}
      {listOn !== null ? (
        <IslandBranchesPopover
          point={listOn.point}
          targets={signStats.get(listOn.key)?.targets ?? []}
          staleDays={islandStaleDays(islandPrefs[listOn.key])}
          onOpenSurfaces={(worktree) => void openWorktreeSurfaces(listOn.key, worktree)}
          hatOf={(path) =>
            islands.find((island) => island.key === listOn.key)?.hats.get(path) ?? null
          }
          onClose={() => setListOn(null)}
        />
      ) : null}
      {toolbar !== null
        ? createPortal(
            <>
              <AddProjectButton islandOf={islandOf} />
              <IslandsMenu
                projects={projectOrder.map((key) => ({
                  key,
                  title: projectTitles.get(key) ?? "Project",
                  color: islandPlate(key, islandPrefs[key]),
                  removable: canChangeIslandIcon(projectCheckouts.get(key) ?? []),
                }))}
                onRemove={(key) =>
                  void removeIsland(
                    projectCheckouts.get(key) ?? [],
                    projectTitles.get(key) ?? "Project",
                  )
                }
              />
            </>,
            toolbar,
          )
        : null}
      {managerTagKey !== null && hoveredIsland !== null ? (
        // Positioned by FollowTracker with the other tags, above his head.
        <div
          key={managerTagKey}
          ref={(tag) => {
            if (tag === null) tagRefs.current.delete(managerTagKey);
            else tagRefs.current.set(managerTagKey, tag);
          }}
          className="pointer-events-none absolute top-0 left-0 z-10"
        >
          <button
            type="button"
            onWheel={forwardWheel}
            onClick={() => toggleManager(hoveredIsland)}
            className="-translate-x-1/2 -translate-y-full pointer-events-auto flex cursor-pointer items-center rounded bg-popover/80 px-1.5 py-0.5 text-3xs leading-tight text-popover-foreground/90 shadow-sm"
          >
            Manager
          </button>
        </div>
      ) : null}
      {tagged.map((character) => {
        const focused = character.facts.key === hoveredKey;
        const chatting = character.facts.key === chatKey;
        return (
          // Positioned by FollowTracker on drawn frames, above the character's head.
          <div
            key={character.facts.key}
            ref={(tag) => {
              if (tag === null) tagRefs.current.delete(character.facts.key);
              else tagRefs.current.set(character.facts.key, tag);
            }}
            className={cn(
              "pointer-events-none absolute top-0 left-0",
              focused || chatting ? "z-20" : "z-10",
            )}
          >
            {/* Clicks, hovers and right-clicks on the tag act as they would on the character. */}
            <CharacterTag
              facts={character.facts}
              focused={focused}
              chatting={chatting}
              onPointerEnter={() => setHoveredKey(character.facts.key)}
              onPointerLeave={() =>
                setHoveredKey((current) => (current === character.facts.key ? null : current))
              }
              onWheel={forwardWheel}
              onClick={(event) => {
                if (event.altKey) openChat(character);
                else if (event.metaKey || event.ctrlKey) togglePicked(character);
                else if (character.intent.balloon !== undefined) openChat(character);
                else selectCharacter(character, event.detail);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                void showMenu(character, { x: event.clientX, y: event.clientY });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** A resting agent's tag also says how long ago it last replied, kept current while shown. */
function CharacterTag(props: {
  readonly facts: CharacterFacts;
  readonly focused: boolean;
  /** Its chat is open: bigger, and solid, so it is easy to find. */
  readonly chatting: boolean;
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
  readonly onWheel: (event: React.WheelEvent) => void;
  readonly onClick: (event: React.MouseEvent) => void;
  readonly onContextMenu: (event: React.MouseEvent) => void;
}) {
  const { facts, focused, chatting, ...handlers } = props;
  const resting = isResting(facts);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!resting) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [resting]);
  const elapsed = resting ? formatElapsedDurationLabel(facts.lastReplyAt, nowMs) : "";
  const elapsedMs = nowMs - Date.parse(facts.lastReplyAt);
  return (
    <button
      type="button"
      {...handlers}
      className={cn(
        "-translate-x-1/2 -translate-y-full pointer-events-auto flex cursor-pointer items-stretch overflow-hidden rounded border border-popover leading-tight shadow-sm",
        !chatting && "max-w-36 text-3xs",
        chatting && "max-w-56 rounded-md text-sm font-medium shadow-md",
        focused || chatting
          ? "bg-popover text-popover-foreground"
          : "bg-popover/80 text-popover-foreground/90",
      )}
    >
      <span
        className={cn(
          "flex min-w-0 items-center",
          chatting ? "gap-1.5 px-2.5 py-1" : "gap-1 px-1.5 py-0.5",
        )}
      >
        {facts.backgroundTask ? (
          <SquareTerminalIcon
            aria-label="Running a background command"
            className={cn("shrink-0 opacity-70", chatting ? "size-3.5" : "size-2.5")}
          />
        ) : null}
        <span className="truncate">{facts.title || "Untitled thread"}</span>
      </span>
      {elapsed !== "" ? (
        // Red for a reply in the last 5 minutes, amber within the hour, green within 12 hours, gray after.
        <span
          className={cn(
            "flex shrink-0 items-center font-semibold tabular-nums text-white",
            chatting ? "px-1.5" : "px-1",
            elapsedMs <= 5 * 60_000 && "bg-error",
            elapsedMs > 5 * 60_000 && elapsedMs <= 60 * 60_000 && "bg-warning",
            elapsedMs > 60 * 60_000 && elapsedMs <= 12 * 60 * 60_000 && "bg-success",
            elapsedMs > 12 * 60 * 60_000 && "bg-muted-foreground",
          )}
        >
          {elapsed === "just now" ? "now" : elapsed}
        </span>
      ) : null}
    </button>
  );
}

/** Whether a pointer event on an island also went through a character's hitbox or balloon. */
function hitsCharacter(event: ThreeEvent<MouseEvent>): boolean {
  return event.intersections.some(
    (hit) => hit.object.name === HITBOX_NAME || hit.object.name === BALLOON_NAME,
  );
}

const FOLLOW_HEIGHT = 1.6;
/** An island sign's colours, for UI naming the island. */
function signPlate(background: string) {
  return { background, text: signTextColor(background) };
}
/**
 * What the bubbles' selects, menus, popovers and dialogs portal out of them. A press there is
 * not outside the bubble. Modal menus (the reasoning picker) also cover the page with an inert
 * backdrop, so a press anywhere while one is open only closes the menu.
 */
const PORTALED_LAYERS = [
  '[data-slot="select-positioner"]',
  '[data-slot="menu-positioner"]',
  '[data-slot="popover-positioner"]',
  '[data-slot="dialog-viewport"]',
  '[data-slot="dialog-backdrop"]',
  "[data-base-ui-inert]",
].join(", ");
/** How long the manager holds up his megaphone after you send a message. */
const MANAGER_CALL_MS = 3000;
/** The manager wears no hat. */
const NO_HATS: ReadonlySet<string> = new Set();
const NO_KEYS: ReadonlySet<string> = new Set();
/** Extra height over a hatted head: the tallest hats rise about this far. */
const HAT_LIFT = 0.35;
/** How long the island menu can snooze an idle alarm for. */
/** How far the world's menus open from the pointer, down and right, so they don't sit under it. */
const MENU_OFFSET = 8;

function awayFromPointer(point: { readonly x: number; readonly y: number }) {
  return { x: point.x + MENU_OFFSET, y: point.y + MENU_OFFSET };
}

const IDLE_SNOOZE_OPTIONS = [
  { minutes: 15, label: "For 15 minutes" },
  { minutes: 60, label: "For 1 hour" },
  { minutes: 4 * 60, label: "For 4 hours" },
  { minutes: 24 * 60, label: "For 1 day" },
] as const;
/** Room between a balloon's top and the overlay above it. */
const BALLOON_CLEARANCE_PX = 4;
/** How long a held overlay takes to glide onto its character once the walk ends. */
const GLIDE_MS = 320;
const SPOT_MIN_SPACING_PX = 34;
// Reused on every frame; trackers only touch them inside their frame callback.
const followPoint = new Vector3();
const balloonPoint = new Vector3();
const destinationPoint = new Vector3();
const projectedPoint = new Vector3();

/**
 * Reports where characters are on screen, just above their heads (or their
 * balloon, when they hold one), so DOM overlays (the reply bubble, name tags)
 * can follow them. Runs only on drawn
 * frames, so a still scene costs nothing; a pan, zoom or walk moves them along.
 */
function FollowTracker(props: {
  readonly roots: React.RefObject<Map<string, Object3D>>;
  readonly keys: ReadonlyArray<string>;
  /** Characters wearing a hat, followed from higher up. */
  readonly hatted: ReadonlySet<string>;
  /**
   * Wait out a walk at a fixed spot in the world, then glide over once the character arrives.
   * A walk up the screen glides to where it ends right away, so the character walks up under
   * the overlay rather than into it; any other waits where it began.
   */
  readonly holdWhileWalking?: boolean;
  /** Called once per drawn frame with every followed character's screen point. */
  readonly onMove: (points: ReadonlyArray<ScreenPoint>) => void;
}) {
  const { roots, keys, hatted, holdWhileWalking = false, onMove } = props;
  const invalidate = useThree((state) => state.invalidate);
  const held = useRef(new Map<string, Vector3>());
  // Where each overlay was last put, and the glides from there to a new spot.
  const shown = useRef(new Map<string, ScreenPoint>());
  const glides = useRef(new Map<string, { readonly from: ScreenPoint; readonly at: number }>());
  const signature = keys.join("\u0000");
  useEffect(() => {
    if (signature !== "") invalidate();
  }, [signature, invalidate]);
  const camera = useThree((state) => state.camera);
  // Up the screen from the bottom, in the camera's -1 to 1.
  const screenHeight = (point: Vector3) => projectedPoint.copy(point).project(camera).y;
  useFrame((state) => {
    for (const map of [held.current, shown.current, glides.current]) {
      for (const key of map.keys()) if (!keys.includes(key)) map.delete(key);
    }
    if (keys.length === 0) return;
    const points: ScreenPoint[] = [];
    for (const key of keys) {
      const root = roots.current.get(key);
      if (root === undefined) continue;
      const walking = holdWhileWalking && root.userData[WALKING_FLAG] === true;
      const wasWalking = held.current.has(key);
      const lift = (FOLLOW_HEIGHT + (hatted.has(key) ? HAT_LIFT : 0)) * root.scale.y;
      root.getWorldPosition(followPoint);
      followPoint.y += lift;
      if (walking && !wasWalking) {
        const to = root.userData[WALK_DESTINATION] as Vec3 | undefined;
        if (to !== undefined) {
          root.parent?.localToWorld(destinationPoint.set(...to));
          destinationPoint.y += lift;
        }
        const up = to !== undefined && screenHeight(destinationPoint) > screenHeight(followPoint);
        held.current.set(key, (up ? destinationPoint : followPoint).clone());
      }
      if (!walking) held.current.delete(key);
      const hold = held.current.get(key);
      if (hold !== undefined) followPoint.copy(hold);
      followPoint.project(state.camera);
      let y = ((1 - followPoint.y) / 2) * state.size.height;
      const balloon = walking ? undefined : root.getObjectByName(BALLOON_NAME);
      if (balloon !== undefined) {
        balloon.getWorldPosition(balloonPoint).project(state.camera);
        const top = ((1 - balloonPoint.y) / 2) * state.size.height - BALLOON_PX / 2;
        y = Math.min(y, top - BALLOON_CLEARANCE_PX);
      }
      let point: ScreenPoint = { key, x: ((followPoint.x + 1) / 2) * state.size.width, y };
      // A walk starting or ending moves the spot; glide there from where the overlay is.
      const from = shown.current.get(key);
      if (walking !== wasWalking && from !== undefined && !reducedMotion()) {
        glides.current.set(key, { from, at: performance.now() });
      }
      const glide = glides.current.get(key);
      if (glide !== undefined) {
        const t = Math.min(1, (performance.now() - glide.at) / GLIDE_MS);
        const ease = 1 - (1 - t) ** 3;
        point = {
          key,
          x: glide.from.x + (point.x - glide.from.x) * ease,
          y: glide.from.y + (point.y - glide.from.y) * ease,
        };
        if (t < 1) state.invalidate();
        else glides.current.delete(key);
      }
      shown.current.set(key, point);
      points.push(point);
    }
    onMove(points);
  });
  return null;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Like FollowTracker, for fixed points in the world (e.g. empty rock piles). */
function PointTracker(props: {
  readonly points: ReadonlyArray<{ readonly key: string; readonly position: Vec3 }>;
  readonly onMove: (points: ReadonlyArray<ScreenPoint>) => void;
}) {
  const { points, onMove } = props;
  const invalidate = useThree((state) => state.invalidate);
  const signature = points.map((point) => point.key).join("\u0000");
  useEffect(() => {
    if (signature !== "") invalidate();
  }, [signature, invalidate]);
  useFrame((state) => {
    if (points.length === 0) return;
    onMove(
      points.map((point) => {
        followPoint.set(...point.position).project(state.camera);
        return {
          key: point.key,
          x: ((followPoint.x + 1) / 2) * state.size.width,
          y: ((1 - followPoint.y) / 2) * state.size.height,
        };
      }),
    );
  });
  return null;
}

// Covers the shore and the raft just offshore.
const ISLAND_HOVER_MARGIN = 3.5;
const seaLevel = new Plane(new Vector3(0, 1, 0), 0);

/**
 * Aims `raycaster` through `pointer` (in normalized device coordinates) from
 * the camera's near plane. three starts an orthographic ray in the camera's
 * own plane, but this camera draws from far behind it (a negative near), so
 * zoomed out, everything far enough down the screen would sit behind the ray
 * and could not be hovered or clicked.
 */
function castFromNearPlane(raycaster: Raycaster, pointer: Vector2, camera: Camera): void {
  raycaster.setFromCamera(pointer, camera);
  raycaster.ray.origin.set(pointer.x, pointer.y, -1).unproject(camera);
}

/** The canvas's pointer events, with their rays cast from the near plane too. */
function nearPlaneEvents(store: Parameters<typeof events>[0]): ReturnType<typeof events> {
  const manager = events(store);
  return {
    ...manager,
    compute: (event, state, previous) => {
      manager.compute?.(event, state, previous);
      castFromNearPlane(state.raycaster, state.pointer, state.camera);
    },
  };
}

/** An island's middle in world space and how far its ground reaches from it. */
interface IslandSpot {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly shoreRadius: number;
}

/** Whether a point at sea level is on the island or the water just off it. */
function isOverIsland(point: { readonly x: number; readonly z: number }, island: IslandSpot) {
  return (
    Math.hypot(point.x - island.x, point.z - island.z) <= island.shoreRadius + ISLAND_HOVER_MARGIN
  );
}

/** Reports which island the pointer is over, by where it meets sea level. */
function IslandHoverTracker(props: {
  /** Listened on instead of the canvas, so overlays on top keep the island hovered. */
  readonly target: React.RefObject<HTMLElement | null>;
  readonly islands: ReadonlyArray<IslandSpot>;
  readonly onChange: (key: string | null) => void;
}) {
  const { target, islands, onChange } = props;
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    const element = target.current;
    if (element === null) return;
    let current: string | null = null;
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const hit = new Vector3();
    const report = (key: string | null) => {
      if (key === current) return;
      current = key;
      onChange(key);
    };
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      castFromNearPlane(raycaster, pointer, camera);
      if (raycaster.ray.intersectPlane(seaLevel, hit) === null) {
        report(null);
        return;
      }
      report(islands.find((island) => isOverIsland(hit, island))?.key ?? null);
    };
    const onLeave = () => report(null);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
    };
  }, [target, camera, islands, onChange]);
  return null;
}

interface Bounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  /** How far the island's shallows reach past its ground, so framing takes them in. */
  readonly reach: number;
}

const CAMERA_OFFSET = new Vector3(18, 20, 18);
const PANEL_CLOSE_SPACE = 48;

/** How much of the canvas the chat panel hides on the right, and the bars at the top and bottom. */
function coveredOf(
  canvas: DOMRect,
  panel: HTMLElement | null,
  bars: { readonly top: HTMLElement | null; readonly bottom: HTMLElement | null },
): Covered {
  const panelRect = panel?.getBoundingClientRect();
  const topRect = bars.top?.getBoundingClientRect();
  const bottomRect = bars.bottom?.getBoundingClientRect();
  return {
    top: topRect ? Math.max(0, topRect.bottom - canvas.top) : 0,
    // The panel's close button sits just outside it, on the left. A hidden panel takes no room.
    right:
      panelRect && panelRect.width > 0 ? canvas.right - (panelRect.left - PANEL_CLOSE_SPACE) : 0,
    // An empty bar takes no room.
    bottom: bottomRect && bottomRect.height > 0 ? Math.max(0, canvas.bottom - bottomRect.top) : 0,
  };
}

/** The canvas's size, and how much of it the panel and the bars hide. */
interface VisibleArea {
  readonly width: number;
  readonly height: number;
  readonly covered: Covered;
}

/** Room kept between a bubble and the edges of the visible canvas. */
const BUBBLE_EDGE_PX = 8;
/** How far above its point a bubble floats; the bubble's own wrapper adds the same 0.75rem. */
const BUBBLE_GAP_PX = 12;

/**
 * Places a bubble over its tracked point, shifted as little as it takes to stay in the part of
 * the canvas the panel and the bars leave visible. Returns the tracker's `onMove`. The bubble's
 * wrapper (`anchor`'s first child) centres it above the point; a change in its size draws no
 * frame, so that places it again too.
 */
function useBubblePlacement(
  anchor: React.RefObject<HTMLDivElement | null>,
  visibleArea: () => VisibleArea | null,
  open: boolean,
): (points: ReadonlyArray<ScreenPoint>) => void {
  const last = useRef<ScreenPoint | null>(null);
  const place = () => {
    const element = anchor.current;
    const bubble = element?.firstElementChild as HTMLElement | null | undefined;
    const point = last.current;
    const area = visibleArea();
    if (element == null || bubble == null || point === null || area === null) return;
    const { offsetWidth: width, offsetHeight: height } = bubble;
    const { covered } = area;
    const clamp = (value: number, low: number, high: number) =>
      Math.min(Math.max(value, low), Math.max(low, high));
    const left = clamp(
      point.x - width / 2,
      BUBBLE_EDGE_PX,
      area.width - covered.right - width - BUBBLE_EDGE_PX,
    );
    const top = clamp(
      point.y - height - BUBBLE_GAP_PX,
      covered.top + BUBBLE_EDGE_PX,
      area.height - covered.bottom - height - BUBBLE_EDGE_PX,
    );
    element.style.transform = `translate(${left + width / 2}px, ${top + height + BUBBLE_GAP_PX}px)`;
  };
  const placeOnResize = useEffectEvent(place);
  useEffect(() => {
    const bubble = anchor.current?.firstElementChild;
    if (!open || bubble == null) return;
    return observeResize(bubble, () => placeOnResize());
  }, [anchor, open]);
  return (points: ReadonlyArray<ScreenPoint>) => {
    last.current = points[0] ?? null;
    place();
  };
}

/**
 * Pan and zoom only, like a strategy map. Redraws on change instead of every
 * frame. Frames the whole archipelago once, when the first islands appear;
 * after that the camera stays where the user puts it, never zoomed out past
 * what shows every island.
 */
function WorldControls({
  bounds,
  islands,
  panel,
  bars,
  focusKey,
  roots,
  signs,
  zoomTo,
  holdViewOnClose,
  keepInView,
  reveal,
  layout,
}: {
  /** Each island's ground, in the same order as `islands`. */
  readonly bounds: ReadonlyArray<Bounds> | null;
  readonly islands: ReadonlyArray<IslandSpot>;
  readonly panel: () => HTMLElement | null;
  readonly bars: () => { readonly top: HTMLElement | null; readonly bottom: HTMLElement | null };
  /** The character whose chat is open: slid into view beside the panel. */
  readonly focusKey: string | null;
  readonly roots: React.RefObject<Map<string, Object3D>>;
  /** Each island's sign, by island key. */
  readonly signs: React.RefObject<Map<string, Object3D>>;
  /** An island to frame, from its menu; a new object frames it again. */
  readonly zoomTo: { readonly key: string } | null;
  /** Set here: makes closing the open chat leave the map where it is, instead of going back. */
  readonly holdViewOnClose: React.RefObject<(() => void) | null>;
  /** Set here: moves the map as little as it takes to show every point, if any is hidden. */
  readonly keepInView: React.RefObject<((points: ReadonlyArray<Vector3>) => void) | null>;
  /** A spot that must show with room above it for the new-agent bubble; a new object checks again. */
  readonly reveal: { readonly islandKey: string; readonly position: Vec3 } | null;
  /**
   * Which islands show and how they line up; a new object, on rearranging, showing or
   * hiding, frames them all once they have stopped moving, `settleMs` later.
   */
  readonly layout: { readonly settleMs: number };
}) {
  // The canvas is orthographic.
  const camera = useThree((state) => state.camera) as OrthographicCamera;
  const element = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const controlsRef = useRef<MapControls | null>(null);
  // Camera moves the app makes glide; grabbing the map stops them.
  const flight = useRef<{
    readonly from: View;
    readonly to: View;
    readonly startedAt: number;
  } | null>(null);
  const gesturing = useRef(false);
  const fitted = useRef(false);
  const covered = useCallback(
    (): Covered => coveredOf(element.getBoundingClientRect(), panel(), bars()),
    [element, panel, bars],
  );
  /** The corners of these islands' signs, which stand above and past their ground. */
  const signsOf = useCallback(
    (keys: ReadonlyArray<string>) =>
      keys.flatMap((key) => {
        const sign = signs.current.get(key);
        return sign === undefined ? [] : signCorners(sign);
      }),
    [signs],
  );
  /**
   * The view that frames the island with `key` in the visible canvas, or every
   * island without one. Framing them all also sets the zoom floor.
   */
  const frame = useCallback(
    (key?: string): View | null => {
      const controls = controlsRef.current;
      if (controls === null || bounds === null || size.width === 0) return null;
      const picked =
        key === undefined ? bounds : bounds.filter((_, index) => islands[index]?.key === key);
      if (picked.length === 0) return null;
      const view = frameView({
        camera,
        maxZoom: controls.maxZoom,
        bounds: picked,
        signs: signsOf(key === undefined ? islands.map((spot) => spot.key) : [key]),
        viewport: size,
        covered: covered(),
      });
      if (key === undefined) controls.minZoom = view.zoom;
      return view;
    },
    [bounds, islands, camera, size, covered, signsOf],
  );
  const jump = useCallback(
    (to: View) => {
      const controls = controlsRef.current;
      if (controls === null) return;
      flight.current = null;
      applyView(camera, controls, to);
      invalidate();
    },
    [camera, invalidate],
  );
  const fly = useCallback(
    (to: View | null) => {
      const controls = controlsRef.current;
      if (controls === null || to === null) return;
      // Further out than every island needs frames them all instead.
      const all = frame();
      flight.current = {
        from: currentView(camera, controls),
        to: all !== null && to.zoom < all.zoom ? all : to,
        startedAt: performance.now(),
      };
      invalidate();
    },
    [camera, invalidate, frame],
  );

  const onGestureStart = useEffectEvent(() => {
    flight.current = null;
    gesturing.current = true;
    // The panel may have changed the visible canvas, and with it the floor.
    frame();
  });
  // Let go on the zoom floor, the map glides to centre every island.
  const onGestureEnd = useEffectEvent(() => {
    gesturing.current = false;
    const controls = controlsRef.current;
    const all = frame();
    if (controls !== null && all !== null && offFloor(currentView(camera, controls), all)) {
      fly(all);
    }
  });
  useEffect(() => {
    const controls = new MapControls(camera, element);
    controls.enableRotate = false;
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    // The spot under the pointer stays put while zooming, like a map.
    controls.zoomToCursor = true;
    controls.minZoom = 3;
    controls.maxZoom = 110;
    // A fresh control looks at the origin, which would swing an already panned
    // camera round to it on a remount (hot reload). Keep the spot it looks at
    // and the fixed viewing angle instead.
    const ground = new Ray(camera.position, camera.getWorldDirection(new Vector3())).intersectPlane(
      seaLevel,
      new Vector3(),
    );
    if (ground !== null) {
      controls.target.copy(ground);
      camera.position.copy(ground).add(CAMERA_OFFSET);
    }
    controls.update();
    controlsRef.current = controls;
    // Wrapped: invalidate's argument is a frame count, not the event.
    const redraw = () => invalidate();
    const start = () => onGestureStart();
    const end = () => onGestureEnd();
    controls.addEventListener("change", redraw);
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    redraw();
    return () => {
      controls.removeEventListener("change", redraw);
      controls.removeEventListener("start", start);
      controls.removeEventListener("end", end);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, element, invalidate]);

  // Until the islands settle the floor holds still, so the view does not chase them.
  const settling = useRef(false);
  const mountLayout = useRef(layout);
  const frameSettled = useEffectEvent(() => {
    settling.current = false;
    fly(frame());
  });
  useEffect(() => {
    if (layout === mountLayout.current) return;
    settling.current = true;
    const timer = setTimeout(frameSettled, layout.settleMs);
    return () => clearTimeout(timer);
  }, [layout]);
  // Frames every island when they first show; after that, only when the view
  // ends up under the zoom floor, as when the canvas grows, the panel narrows
  // or islands go.
  const holdFloor = useEffectEvent(() => {
    const controls = controlsRef.current;
    if (settling.current && fitted.current) return;
    const all = frame();
    if (controls === null || all === null || gesturing.current) return;
    if (!fitted.current) {
      fitted.current = true;
      jump(all);
      return;
    }
    if (!offFloor(currentView(camera, controls), all)) return;
    const moving = flight.current;
    if (moving === null) jump(all);
    // A glide headed under the floor turns towards it; one headed in far enough lands fine.
    else if (moving.to.zoom < all.zoom) fly(all);
  });
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- New islands or a resized canvas move the floor.
  useEffect(() => holdFloor(), [frame]);
  // Resizing the open panel zooms about what showed beside it, so the same
  // stretch of map stays in view. Opening and closing it start or end at zero.
  const panelWidth = useRef(0);
  const keepShownBesidePanel = useEffectEvent(() => {
    const controls = controlsRef.current;
    const width = panel()?.getBoundingClientRect().width ?? 0;
    const grown = panelWidth.current > 0 ? width - panelWidth.current : 0;
    panelWidth.current = width;
    if (controls === null || grown === 0 || gesturing.current || flight.current !== null) return;
    // Measures the floor afresh: the panel's width moves it.
    frame();
    const hidden = covered();
    const visible = Math.max(1, size.width - hidden.right);
    const view = currentView(camera, controls);
    const zoom = Math.min(
      controls.maxZoom,
      Math.max(controls.minZoom, (view.zoom * visible) / (visible + grown)),
    );
    // Zooming keeps the middle of the canvas still; slide what was in the middle
    // of the visible part back onto the middle of what is visible now.
    const scale = zoom / view.zoom;
    const middleX = size.width / 2;
    const middleY = size.height / 2;
    const shownY = (hidden.top + size.height - hidden.bottom) / 2;
    const dx = visible / 2 - (middleX + ((visible + grown) / 2 - middleX) * scale);
    const dy = shownY - (middleY + (shownY - middleY) * scale);
    jump({
      target: view.target.clone().add(targetShift(probeAt(camera, view), dx, dy, zoom)),
      zoom,
    });
  });
  // The panel and bars hide part of the canvas, so their size moves the floor too.
  useEffect(() => {
    const { top, bottom } = bars();
    const elements = [panel(), top, bottom].filter((element) => element !== null);
    return observeResize(elements, () => {
      keepShownBesidePanel();
      holdFloor();
    });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The panel mounts with the first chat.
  }, [panel, bars, focusKey]);

  useFrame((state) => {
    const controls = controlsRef.current;
    const moving = flight.current;
    if (moving === null || controls === null) return;
    const t = Math.min(1, (performance.now() - moving.startedAt) / FLIGHT_MS);
    const ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    applyView(camera, controls, {
      target: flightTarget.lerpVectors(moving.from.target, moving.to.target, ease),
      // Zoom is a scale: interpolating its log keeps the speed even.
      zoom: moving.from.zoom * (moving.to.zoom / moving.from.zoom) ** ease,
    });
    if (t >= 1) flight.current = null;
    else state.invalidate();
  });

  // Double-click an island to frame it, or the sea to frame them all again.
  const onDoubleClick = useEffectEvent((event: MouseEvent) => {
    const rect = element.getBoundingClientRect();
    const raycaster = new Raycaster();
    const pointer = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    castFromNearPlane(raycaster, pointer, camera);
    const hit = raycaster.ray.intersectPlane(seaLevel, new Vector3());
    const island = hit === null ? undefined : islands.find((spot) => isOverIsland(hit, spot));
    fly(frame(island?.key));
  });
  useEffect(() => {
    const listener = (event: MouseEvent) => onDoubleClick(event);
    element.addEventListener("dblclick", listener);
    return () => element.removeEventListener("dblclick", listener);
  }, [element]);

  // Opening a chat waits for its panel to settle, then frames its character's
  // island beside it, but only when the panel hides part of the island or the
  // character. Closing it flies back to wherever the map was before.
  const beforeChat = useRef<View | null>(null);
  useEffect(() => {
    holdViewOnClose.current = () => {
      beforeChat.current = null;
    };
    return () => {
      holdViewOnClose.current = null;
    };
  }, [holdViewOnClose]);
  const keepInViewWait = useRef<(() => void) | null>(null);
  useEffect(() => {
    keepInView.current = (points) => {
      keepInViewWait.current?.();
      // Measured after the next paint, once a chat closing with it has left the map.
      keepInViewWait.current = afterPaint(() => {
        keepInViewWait.current = null;
        const controls = controlsRef.current;
        if (controls === null) return;
        fly(
          viewShowing({
            camera,
            view: currentView(camera, controls),
            points,
            viewport: size,
            covered: covered(),
            minZoom: controls.minZoom,
          }),
        );
      });
    };
    return () => {
      keepInView.current = null;
      keepInViewWait.current?.();
      keepInViewWait.current = null;
    };
  }, [camera, size, covered, fly, keepInView]);
  const waitForPanel = useRef<(() => void) | null>(null);
  const stopWaiting = useCallback(() => {
    waitForPanel.current?.();
    waitForPanel.current = null;
  }, []);
  const frameFocus = useEffectEvent((key: string) => {
    const controls = controlsRef.current;
    const root = roots.current.get(key);
    if (controls === null || root === undefined || bounds === null) return;
    root.getWorldPosition(focusPoint);
    const distances = islands.map((spot) =>
      Math.hypot(focusPoint.x - spot.x, focusPoint.z - spot.z),
    );
    const nearest = distances.indexOf(Math.min(...distances));
    const island = bounds[nearest];
    const spot = islands[nearest];
    if (island === undefined || spot === undefined) return;
    const head = focusPoint.clone().setY(focusPoint.y + FOLLOW_HEIGHT * root.scale.y);
    const shown = [focusPoint, head, ...shorePoints(spot, island.reach), ...signsOf([spot.key])];
    if (onScreen(camera, shown, size, covered())) return;
    // Switching chats keeps the view from before the first move.
    beforeChat.current ??= currentView(camera, controls);
    fly(frame(spot.key));
  });
  const onFocus = useEffectEvent((key: string | null) => {
    stopWaiting();
    if (key === null) {
      fly(beforeChat.current);
      beforeChat.current = null;
      return;
    }
    // The panel mounts with the chat; its width can still change as the
    // chat lays out. Wait until it holds still for a few frames, then until
    // the chat's own mount work is done, so the glide does not stutter.
    let last: DOMRect | null = null;
    let still = 0;
    let frames = 0;
    const check = () => {
      const rect = panel()?.getBoundingClientRect() ?? null;
      frames += 1;
      still = rect !== null && last !== null && sameRect(rect, last) ? still + 1 : 0;
      last = rect;
      if (still >= PANEL_STILL_FRAMES || (rect !== null && frames >= PANEL_WAIT_FRAMES)) {
        waitForPanel.current = whenIdle(() => {
          waitForPanel.current = null;
          frameFocus(key);
        }, PANEL_IDLE_WAIT_MS);
      } else if (frames < PANEL_WAIT_FRAMES) {
        waitFrame();
      } else {
        waitForPanel.current = null;
      }
    };
    const waitFrame = () => {
      const request = requestAnimationFrame(check);
      waitForPanel.current = () => cancelAnimationFrame(request);
    };
    waitFrame();
  });
  useEffect(() => onFocus(focusKey), [focusKey]);
  useEffect(() => stopWaiting, [stopWaiting]);

  const onZoomTo = useEffectEvent((key: string) => fly(frame(key)));
  useEffect(() => {
    if (zoomTo !== null) onZoomTo(zoomTo.key);
  }, [zoomTo]);

  // Leaves the map alone when the spot already shows, zoomed in enough, with
  // room for the bubble; otherwise frames its island and slides the spot clear.
  const onReveal = useEffectEvent((islandKey: string, position: Vec3) => {
    const controls = controlsRef.current;
    const framed = frame(islandKey);
    if (controls === null || framed === null) return;
    const hidden = covered();
    const point = new Vector3(...position);
    const current = currentView(camera, controls);
    if (
      current.zoom >= framed.zoom * REVEAL_MIN_ZOOM &&
      bubbleRoom(camera, current, point, size, hidden).equals(ZERO)
    ) {
      return;
    }
    const shift = bubbleRoom(camera, framed, point, size, hidden);
    fly({ target: framed.target.add(shift), zoom: framed.zoom });
  });
  useEffect(() => {
    if (reveal !== null) onReveal(reveal.islandKey, reveal.position);
  }, [reveal]);
  return null;
}

/** How close to the zoom floor counts as resting on it. */
const FLOOR_SLACK = 1.001;

/** True when `view` sits on or under the zoom floor without framing every island as `all` does. */
function offFloor(view: View, all: View): boolean {
  if (view.zoom > all.zoom * FLOOR_SLACK) return false;
  return view.zoom < all.zoom || view.target.distanceTo(all.target) >= 0.01;
}

/** How far in, against framing its island, the map must be to start an agent there as is. */
const REVEAL_MIN_ZOOM = 0.6;
/** The new-agent bubble's size above its spot, with a little air. */
const BUBBLE_ROOM = { width: 464, height: 372, below: 24, top: 4 };
const ZERO = new Vector3();

/**
 * How far to move the view's target so the bubble over `point` fits in the
 * part of the canvas the panel leaves visible; zero when it already does.
 * The shift stays at sea level, where the camera aims.
 */
function bubbleRoom(
  camera: OrthographicCamera,
  view: View,
  point: Vector3,
  viewport: { readonly width: number; readonly height: number },
  covered: Covered,
): Vector3 {
  const probe = probeAt(camera, view);
  const { x, y } = toScreen(point, probe, viewport);
  const half = BUBBLE_ROOM.width / 2;
  const right = Math.max(half, viewport.width - covered.right - half);
  const top = covered.top + BUBBLE_ROOM.top + BUBBLE_ROOM.height;
  const bottom = Math.max(top, viewport.height - covered.bottom - BUBBLE_ROOM.below);
  // Pixels the spot must move on screen: right and down are positive.
  const dx = x < half ? half - x : x > right ? right - x : 0;
  const dy = y < top ? top - y : y > bottom ? bottom - y : 0;
  return targetShift(probe, dx, dy, view.zoom);
}

/** Room kept between points brought into view and the edges of the visible canvas. */
const KEEP_IN_VIEW_MARGIN = 48;

/**
 * The view nearest `view` that shows every point in the part of the canvas the
 * panel leaves visible: slid just far enough, and zoomed out only when they
 * cannot fit otherwise. Null when they all show already.
 */
function viewShowing(input: {
  readonly camera: OrthographicCamera;
  readonly view: View;
  readonly points: ReadonlyArray<Vector3>;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly covered: Covered;
  readonly minZoom: number;
}): View | null {
  const { view, points, viewport } = input;
  if (points.length === 0) return null;
  const probe = probeAt(input.camera, view);
  const screen = points.map((point) => toScreen(point, probe, viewport));
  const xs = screen.map((p) => p.x);
  const ys = screen.map((p) => p.y);
  const left = KEEP_IN_VIEW_MARGIN;
  const right = Math.max(left, viewport.width - input.covered.right - KEEP_IN_VIEW_MARGIN);
  const top = input.covered.top + KEEP_IN_VIEW_MARGIN;
  const bottom = Math.max(top, viewport.height - input.covered.bottom - KEEP_IN_VIEW_MARGIN);
  // Zooming keeps the middle of the canvas still and scales everything about it.
  const fit = Math.min(
    1,
    (right - left) / Math.max(1, Math.max(...xs) - Math.min(...xs)),
    (bottom - top) / Math.max(1, Math.max(...ys) - Math.min(...ys)),
  );
  const zoom = Math.max(input.minZoom, Math.min(view.zoom, view.zoom * fit));
  const scale = zoom / view.zoom;
  const scaled = (values: ReadonlyArray<number>, middle: number) =>
    values.map((value) => middle + (value - middle) * scale);
  const dx = edgeShift(scaled(xs, viewport.width / 2), left, right);
  const dy = edgeShift(scaled(ys, viewport.height / 2), top, bottom);
  if (dx === 0 && dy === 0 && zoom === view.zoom) return null;
  return { target: view.target.clone().add(targetShift(probe, dx, dy, zoom)), zoom };
}

/** How far to move values, all at once, to bring them between `low` and `high`. */
function edgeShift(values: ReadonlyArray<number>, low: number, high: number): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Too spread out to fit even zoomed all the way out: centre them instead.
  if (max - min > high - low) return (low + high - min - max) / 2;
  return min < low ? low - min : max > high ? high - max : 0;
}

/** A copy of the camera placed for `view`, to measure with. */
function probeAt(camera: OrthographicCamera, view: View): OrthographicCamera {
  const probe = camera.clone();
  probe.position.copy(view.target).add(CAMERA_OFFSET);
  probe.lookAt(view.target);
  probe.zoom = view.zoom;
  probe.updateProjectionMatrix();
  probe.updateMatrixWorld();
  return probe;
}

/** Where `point` shows on the canvas, in pixels from its top left corner. */
function toScreen(
  point: Vector3,
  camera: OrthographicCamera,
  viewport: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  const projected = point.clone().project(camera);
  return {
    x: ((projected.x + 1) / 2) * viewport.width,
    y: ((1 - projected.y) / 2) * viewport.height,
  };
}

/**
 * How far to move the view's target, at `zoom`, so what shows on screen moves
 * `dx` right and `dy` down. The shift stays at sea level, where the camera aims.
 */
function targetShift(probe: OrthographicCamera, dx: number, dy: number, zoom: number): Vector3 {
  // Moving the target the other way moves the spot this way on screen.
  const shift = new Vector3(-dx, dy, 0)
    .transformDirection(probe.matrixWorld)
    .multiplyScalar(Math.hypot(dx, dy) / zoom);
  const sight = new Vector3().copy(CAMERA_OFFSET).normalize();
  return shift.addScaledVector(sight, -shift.y / sight.y);
}

const FLIGHT_MS = 450;
const PANEL_STILL_FRAMES = 2;
const PANEL_WAIT_FRAMES = 60;
/** The longest a settled panel waits for the chat to finish its work before the camera glides. */
const PANEL_IDLE_WAIT_MS = 300;
const SHORE_SAMPLES = 16;
const flightTarget = new Vector3();
const focusPoint = new Vector3();

function sameRect(a: DOMRect, b: DOMRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** Points around an island's shoreline at sea level, `reach` out into the shallows. */
function shorePoints(spot: IslandSpot, reach: number): Vector3[] {
  const radius = spot.shoreRadius + reach;
  return Array.from({ length: SHORE_SAMPLES }, (_, index) => {
    const angle = (index / SHORE_SAMPLES) * Math.PI * 2;
    return new Vector3(spot.x + Math.cos(angle) * radius, 0, spot.z + Math.sin(angle) * radius);
  });
}

/** True when every point falls inside the part of the canvas the panel leaves visible. */
function onScreen(
  camera: OrthographicCamera,
  points: ReadonlyArray<Vector3>,
  viewport: { readonly width: number; readonly height: number },
  covered: Covered,
): boolean {
  camera.updateMatrixWorld();
  return points.every((point) => {
    const { x, y } = toScreen(point, camera, viewport);
    return (
      x >= 0 &&
      x <= viewport.width - covered.right &&
      y >= covered.top &&
      y <= viewport.height - covered.bottom
    );
  });
}

/** How far in from each edge something sits over the canvas, in pixels. */
interface Covered {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Where the map looks and how far in it is zoomed. */
interface View {
  readonly target: Vector3;
  readonly zoom: number;
}

function currentView(camera: OrthographicCamera, controls: MapControls): View {
  return { target: controls.target.clone(), zoom: camera.zoom };
}

function applyView(camera: OrthographicCamera, controls: MapControls, view: View) {
  controls.target.copy(view.target);
  camera.position.copy(view.target).add(CAMERA_OFFSET);
  camera.zoom = view.zoom;
  camera.updateProjectionMatrix();
  controls.update();
}

/** The view that fits `bounds` into the part of the canvas the panel and bars leave visible. */
function frameView(input: {
  readonly camera: OrthographicCamera;
  readonly maxZoom: number;
  readonly bounds: ReadonlyArray<Bounds>;
  /** Points that must show too, like the corners of the islands' signs. */
  readonly signs: ReadonlyArray<Vector3>;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly covered: Covered;
}): View {
  const { bounds, viewport } = input;
  // Keep a usable strip of world even when the panel covers most of the canvas.
  const coveredRight = Math.max(0, Math.min(input.covered.right, viewport.width - 320));
  const coveredTop = Math.max(0, Math.min(input.covered.top, viewport.height / 4));
  const coveredBottom = Math.max(0, Math.min(input.covered.bottom, viewport.height / 4));
  const first = bounds[0]!;
  const target = new Vector3((first.minX + first.maxX) / 2, 0, (first.minZ + first.maxZ) / 2);
  // Measured on a copy, so the real camera only moves when the view is applied.
  const probe = probeAt(input.camera, { target, zoom: 1 });
  // Measure every island on screen at zoom 1 (one unit per pixel). Islands are
  // round, so trace a ring inside each box rather than its corners, which
  // would stick out on every side of the tilted view. At sea level the ring
  // takes in the shallows around the sand; up high, it is the island's own.
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  const point = new Vector3();
  const measure = () => {
    point.applyMatrix4(probe.matrixWorldInverse);
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    bottom = Math.min(bottom, point.y);
    top = Math.max(top, point.y);
  };
  for (const island of bounds) {
    const centerX = (island.minX + island.maxX) / 2;
    const centerZ = (island.minZ + island.maxZ) / 2;
    const halfX = (island.maxX - island.minX) / 2;
    const halfZ = (island.maxZ - island.minZ) / 2;
    for (let index = 0; index < SHORE_SAMPLES; index += 1) {
      const angle = (index / SHORE_SAMPLES) * Math.PI * 2;
      for (const [y, reach] of [
        [-0.6, island.reach],
        [SIGN_TOP, 0],
      ] as const) {
        point.set(
          centerX + Math.cos(angle) * (halfX + reach),
          y,
          centerZ + Math.sin(angle) * (halfZ + reach),
        );
        measure();
      }
    }
  }
  for (const corner of input.signs) {
    point.copy(corner);
    measure();
  }
  const margin = 1.15;
  // Not held to a minimum: framing every island is what sets the zoom floor.
  const zoom = Math.min(
    input.maxZoom,
    (viewport.width - coveredRight) / ((right - left) * margin),
    (viewport.height - coveredTop - coveredBottom) / ((top - bottom) * margin),
  );
  // Slide what was measured onto the middle of the part of the canvas the
  // panel and bars leave visible.
  const dx = -((left + right) / 2) * zoom - coveredRight / 2;
  const dy = ((bottom + top) / 2) * zoom + (coveredTop - coveredBottom) / 2;
  return { target: target.add(targetShift(probe, dx, dy, zoom)), zoom };
}

/** The new-agent piles on an island nobody works at, with where their buttons sit in the world. */
function freePiles(
  island: WorldIsland,
  definition: WorldDefinition,
): Array<{ readonly slotIndex: number; readonly position: Vec3 }> {
  const { area: areaId, marker } = definition.archipelago.newAgents;
  const area = island.definition.areas[areaId];
  if (area?.kind !== "fixed") return [];
  const taken = new Set(
    island.characters.filter((c) => c.placement.area === areaId).map((c) => c.placement.slotIndex),
  );
  return area.slots.flatMap((slot, slotIndex) => {
    if (taken.has(slotIndex)) return [];
    // The marker sits in the slot's frame: +z is the way the slot faces.
    const sin = Math.sin(slot.facing);
    const cos = Math.cos(slot.facing);
    const position: Vec3 = [
      island.offset[0] + slot.position[0] + marker[0] * cos + marker[2] * sin,
      island.offset[1] + slot.position[1] + marker[1],
      island.offset[2] + slot.position[2] - marker[0] * sin + marker[2] * cos,
    ];
    return [{ slotIndex, position }];
  });
}

/** Each island's ground in world coordinates. */
/** Each island's ground, and its shallows' reach: wider round `wideKey`, the open chat's island. */
function archipelagoBounds(
  islands: ReadonlyArray<WorldIsland>,
  wideKey: string | null,
): Bounds[] | null {
  if (islands.length === 0) return null;
  return islands.map(({ key, offset, definition }) => {
    const island = islandBounds(definition);
    return {
      minX: offset[0] + island.minX,
      maxX: offset[0] + island.maxX,
      minZ: offset[2] + island.minZ,
      maxZ: offset[2] + island.maxZ,
      reach: key === wideKey ? WIDE_LAGOON_REACH : LAGOON_REACH,
    };
  });
}

const QUIET_CHECK_MS = 5000;
const REST_CHECK_MS = 30_000;

/** The current time, refreshed every `intervalMs` while given; null pauses it. */
function useClock(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Requests frames for idle animations at a low, fixed rate, and none while hidden. */
function AmbientTicker({ fps }: { readonly fps: number }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (fps <= 0) return;
    let timer: number | null = null;
    const sync = () => {
      const visible = document.visibilityState === "visible";
      if (visible && timer === null) timer = window.setInterval(() => invalidate(), 1000 / fps);
      if (!visible && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [fps, invalidate]);
  return null;
}

/** Remembers island cells, placements and work pacing so nothing jumps across updates. */
function createArchipelagoMemory() {
  let previous = EMPTY_ARCHIPELAGO_MEMORY;
  let beats = EMPTY_BEAT_GATE;
  let layout: string | null = null;
  return {
    resolve(input: {
      readonly facts: ReadonlyArray<CharacterFacts>;
      readonly definition: WorldDefinition;
      readonly sizes: ReadonlyArray<WorldDefinition>;
      readonly projectOrder: ReadonlyArray<string>;
      readonly hueCount: number;
      readonly hatCount: number;
      readonly chosenHues: Readonly<Record<string, number>>;
      /** Last clock tick; a new one re-checks pacing, quiet threads and reply ages. */
      readonly checkedAt: number;
      readonly requested: ReadonlyMap<string, SlotRequest>;
      readonly columns: number;
    }): WorldIsland[] {
      const { movement } = input.definition;
      const now = Math.max(input.checkedAt, Date.now());
      const paced = gateBeats({
        facts: ageReplies(input.facts, now),
        previous: beats,
        now,
        dwellMs: movement.beatSeconds * 1000,
        quietMs: movement.quietSeconds * 1000,
      });
      beats = paced.gate;
      // When the set of islands changes, they pack up again from the top.
      const nextLayout = input.projectOrder.join("|");
      if (layout !== null && layout !== nextLayout) previous = { ...previous, cells: new Map() };
      layout = nextLayout;
      const result = resolveArchipelago({ ...input, facts: paced.facts, previous });
      previous = result.memory;
      return result.islands;
    },
  };
}

/** A prop at every fixed slot, plus one under each character in an anchored area. */
function buildFurniture(
  definition: WorldDefinition,
  characters: ReadonlyArray<WorldCharacter>,
): FurnitureSpot[] {
  const spots: FurnitureSpot[] = [];
  for (const area of Object.values(definition.areas)) {
    if (area.kind !== "fixed") continue;
    for (const slot of area.slots) {
      const kind = slot.prop ?? area.slotProp;
      if (kind === undefined) continue;
      spots.push({
        kind,
        position: slot.position,
        facing: slot.facing,
        scale: area.slotPropScale ?? 1,
      });
    }
  }
  for (const character of characters) {
    const area = definition.areas[character.placement.area];
    if (area?.kind !== "anchored" || area.slotProp === undefined) continue;
    spots.push({
      kind: area.slotProp,
      position: character.placement.position,
      facing: character.placement.facing,
      scale: definition.movement.kidScale,
    });
  }
  return spots;
}

const validatedDefinitions = new WeakSet<WorldDefinition>();
function assertValidDefinition(definition: WorldDefinition) {
  if (validatedDefinitions.has(definition)) return;
  validatedDefinitions.add(definition);
  const errors = validateWorldDefinition(definition);
  if (errors.length > 0) throw new Error(`Invalid world definition:\n${errors.join("\n")}`);
}

/** The most recently updated unarchived thread of an island in a worktree, its subagents aside. */
function latestShellIn(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  islandOf: ReadonlyMap<string, string>,
  island: string,
  worktreePath: string | null,
  folder: string,
): ScopedThreadRef | null {
  let best: EnvironmentThreadShell | null = null;
  for (const thread of threads) {
    if (thread.archivedAt != null || thread.lineage.relationshipToParent === "subagent") continue;
    if (thread.worktreePath !== worktreePath && thread.worktreePath !== folder) continue;
    const projectKey = scopedProjectKey({
      environmentId: thread.environmentId,
      projectId: thread.projectId,
    });
    if ((islandOf.get(projectKey) ?? projectKey) !== island) continue;
    if (best === null || thread.updatedAt > best.updatedAt) best = thread;
  }
  return best === null ? null : { environmentId: best.environmentId, threadId: best.id };
}

/**
 * The most recently active agent working in a worktree, its subagents aside. The project
 * folder's agents have no worktree path, so `null` finds them (`folder` catches any that do).
 */
function latestThreadIn(
  island: WorldIsland | undefined,
  worktreePath: string | null,
  folder: string,
): ScopedThreadRef | null {
  let best: { readonly ref: ScopedThreadRef; readonly rank: string } | null = null;
  for (const { facts } of island?.characters ?? []) {
    if (facts.worktreePath !== worktreePath && facts.worktreePath !== folder) continue;
    const rank = `${facts.kid ? 0 : 1}${facts.lastReplyAt}`;
    if (best === null || rank > best.rank) best = { ref: facts.ref, rank };
  }
  return best?.ref ?? null;
}
