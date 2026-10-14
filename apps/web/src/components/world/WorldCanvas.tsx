import { Canvas, events, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { PlusIcon } from "lucide-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
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
import { cn } from "../../lib/utils";
import { formatElapsedDurationLabel } from "../../timestampFormat";
import { buildProjectGroups, selectProjectGroupingSettings } from "../../logicalProject";
import {
  readEnvironmentSupportsTitleRegeneration,
  readThreadShell,
  useProjects,
  useThreadShells,
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
  type IslandArrangement,
  type WorldIsland,
} from "./engine/archipelago";
import { EMPTY_BEAT_GATE, gateBeats } from "./engine/beats";
import { ageReplies, buildCharacterFacts, type CharacterFacts, isResting } from "./engine/facts";
import { hashString } from "./engine/hash";
import { islandObstacles } from "./engine/route";
import type { SlotRequest } from "./engine/slots";
import type { WorldCharacter } from "./engine/world";
import { type AbductedFigure, Abduction } from "./scene/Abduction";
import { BALLOON_NAME, BALLOON_PX, Character, HITBOX_NAME } from "./scene/Character";
import { geometry } from "./scene/geometries";
import { HAT_COUNT } from "./scene/Hat";
import { Island, type FurnitureSpot } from "./scene/Island";
import { afterPaint, whenIdle } from "./scene/frames";
import { SceneContrast } from "./scene/contrast";
import { FadedContext, toFaded } from "./scene/lighting";
import { palette } from "./scene/palette";
import { SharkSightings } from "./scene/Sharks";
import { groundHeight, surfaceAt } from "./scene/terrain";
import { SIGN_TOP, Sign, signTextColor } from "./scene/Sign";
import { NewAgentBubble } from "./NewAgentBubble";
import { NewAgentProjectPicker } from "./NewAgentProjectPicker";
import { useIslandPullRequests } from "./useIslandPullRequests";
import { useWorldHueStore } from "./worldHueStore";
import { useWorldLookStore, type WorldLook } from "./worldLookStore";
import { useWorldArrangementStore } from "./worldArrangementStore";
import { useWorldModeStore } from "./worldModeStore";
import { useWorldVisibilityStore } from "./worldVisibilityStore";
import { AddProjectButton } from "./AddProjectButton";
import { IslandArrangementMenu } from "./IslandArrangementMenu";
import { ProjectVisibilityMenu } from "./ProjectVisibilityMenu";
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
  /** The chat panel, if open; framing the islands keeps clear of it. */
  readonly panel: () => HTMLElement | null;
  /** The top bar spot where the project visibility menu goes. */
  readonly toolbar: HTMLElement | null;
}) {
  const { definitions, selectedKey, onExpand, panel, toolbar } = props;
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
  const { islandOf, projectOrder, projectTitles, projectRefs, projectMembers } = useMemo(() => {
    const groups = buildProjectGroups({ projects, settings: groupingSettings });
    const islandOf = new Map<string, string>();
    for (const group of groups) {
      for (const ref of group.memberProjectRefs) islandOf.set(scopedProjectKey(ref), group.key);
    }
    const createdAt = (group: (typeof groups)[number]) =>
      group.members.map((member) => member.project.createdAt).toSorted()[0] ?? "";
    const sorted = groups.toSorted(
      (a, b) => createdAt(a).localeCompare(createdAt(b)) || a.key.localeCompare(b.key),
    );
    return {
      islandOf,
      projectOrder: sorted.map((group) => group.key),
      // Signs are read at a glance: "owner/repo" groups show just the repo.
      projectTitles: new Map(
        sorted.map((group) => [group.key, group.label.slice(group.label.lastIndexOf("/") + 1)]),
      ),
      // New agents on an island start in its group's main project.
      projectRefs: new Map(
        sorted.map((group) => [
          group.key,
          { environmentId: group.representative.environmentId, projectId: group.representative.id },
        ]),
      ),
      projectMembers: new Map(sorted.map((group) => [group.key, group.memberProjectRefs])),
    };
  }, [projects, groupingSettings]);
  const islandFacts = useMemo(
    () => facts.map((f) => ({ ...f, projectKey: islandOf.get(f.projectKey) ?? f.projectKey })),
    [facts, islandOf],
  );
  // Islands hidden from the projects menu leave the map; the rest close up.
  const hidden = useWorldVisibilityStore((state) => state.hidden);
  const hideIsland = useWorldVisibilityStore((state) => state.toggleHidden);
  const showOnlyIsland = useWorldVisibilityStore((state) => state.showOnly);
  const visibleOrder = useMemo(
    () => projectOrder.filter((key) => !hidden[key]),
    [projectOrder, hidden],
  );
  const visibleFacts = useMemo(
    () => islandFacts.filter((f) => !hidden[f.projectKey]),
    [islandFacts, hidden],
  );
  const visibleMembers = useMemo(
    () => new Map(visibleOrder.map((key) => [key, projectMembers.get(key) ?? []])),
    [visibleOrder, projectMembers],
  );
  const pullRequestCounts = useIslandPullRequests(visibleMembers, projects);
  const arrangement = useWorldArrangementStore((state) => state.arrangement);
  const [memory] = useState(createArchipelagoMemory);
  // Piles picked for agents started from them, by the thread they will become.
  const [requested, setRequested] = useState<ReadonlyMap<string, SlotRequest>>(new Map());
  const chosenHues = useWorldHueStore((state) => state.chosen);
  const chooseHue = useWorldHueStore((state) => state.choose);
  // Re-check while anyone works, so a thread that goes quiet is noticed, and
  // more slowly while anyone rests, so resters change pose as their reply ages.
  const anyoneWorking = facts.some((f) => f.status === "working");
  const anyoneResting = facts.some(isResting);
  const clock = useClock(anyoneWorking ? QUIET_CHECK_MS : anyoneResting ? REST_CHECK_MS : null);
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
      const plate = palette.plates[hashString(island.key) % palette.plates.length]!;
      for (const { facts: character } of island.characters) {
        families.set(character.key, { island, seed: character.lookSeed });
        looks.set(character.key, {
          kid: character.kid,
          plate: { background: plate, text: signTextColor(plate) },
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
  }, [islands, setLooks, recolorFamily]);
  useEffect(() => () => setLooks(new Map(), null), [setLooks]);
  const bounds = useMemo(() => archipelagoBounds(islands), [islands]);
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
  const obstacles = useMemo(
    () => new Map(definitions.map((sized) => [sized, islandObstacles(sized)])),
    [definitions],
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
  const ambientFps = Math.max(
    0,
    ...islands.flatMap((island) => island.characters.map((c) => c.activity.ambientFps ?? 0)),
    islands.some((island) => island.ripple) ? definition.archipelago.ripple.fps : 0,
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
  const toggleBubble = (character: WorldCharacter) => {
    setPicked(new Set());
    setListenKey(null);
    // With a chat open, a click switches the chat to that character instead.
    if (selectedKey !== null) {
      switchChat(character.facts);
      return;
    }
    // Opening a character's bubble drops a new-agent bubble nothing was typed into.
    if (bubbleKey !== character.facts.key) dropUntypedNewAgent();
    setBubbleKey((current) => (current === character.facts.key ? null : character.facts.key));
  };
  const togglePicked = (character: WorldCharacter) => {
    // The character already singled out (its bubble or open chat) starts the selection.
    const anchor = bubble?.facts.key ?? chatKey;
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
  const roots = useRef(new Map<string, Object3D>());
  const registerRoot = useCallback((key: string, root: Object3D | null) => {
    if (root === null) roots.current.delete(key);
    else roots.current.set(key, root);
  }, []);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Archived characters leave by saucer: the real one is hidden at once and
  // a stand-in of it is beamed up from where it stood.
  const [abductions, setAbductions] = useState<
    ReadonlyArray<{
      readonly id: number;
      readonly islandKeys: ReadonlyArray<string>;
      readonly figures: ReadonlyArray<AbductedFigure>;
    }>
  >([]);
  const abductionId = useRef(0);
  /** One saucer takes everyone archived together. An open chat stays open. */
  const abduct = (characters: ReadonlyArray<WorldCharacter>) => {
    const islandKeys = new Set<string>();
    const figures = characters.flatMap((character): AbductedFigure[] => {
      const root = roots.current.get(character.facts.key);
      if (root === undefined) return [];
      const at = root.getWorldPosition(new Vector3());
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
      { id: abductionId.current, islandKeys: [...islandKeys], figures },
    ]);
  };
  const abducted = new Set(abductions.flatMap((a) => a.figures.map((figure) => figure.key)));
  // An island keeps its colour while a saucer is still carrying its last agents away.
  const leaving = new Set(abductions.flatMap((a) => a.islandKeys));

  const { archiveThread } = useThreadActions();
  // Archive, not delete: each can be undone from its toast or Settings → Archived.
  const archiveAll = async (characters: ReadonlyArray<WorldCharacter>) => {
    setPicked(new Set());
    setBubbleKey(null);
    const results = await Promise.all(
      characters.map(async (character) => ({
        character,
        result: await archiveThread(character.facts.ref),
      })),
    );
    abduct(results.filter((r) => r.result._tag === "Success").map((r) => r.character));
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
  const [restoringOn, setRestoringOn] = useState<string | null>(null);
  const showIslandMenu = async (key: string, point: { x: number; y: number }) => {
    const api = readLocalApi();
    if (api === undefined) return;
    const idle =
      islands
        .find((island) => island.key === key)
        ?.characters.filter((c) => isResting(c.facts) && !abducted.has(c.facts.key)) ?? [];
    const clicked = await api.contextMenu.show(
      [
        { id: "only", label: "Show only this island" },
        { id: "hide", label: "Hide this island" },
        { id: "zoom", label: "Zoom to this island", separatorBefore: true },
        {
          id: "archive-idle",
          label: `Archive ${idle.length} idle ${idle.length === 1 ? "agent" : "agents"}`,
          disabled: idle.length === 0,
          separatorBefore: true,
        },
        { id: "restore-archived", label: "Restore archived agent…" },
      ],
      point,
    );
    if (clicked === "only") showOnlyIsland(key, projectOrder);
    else if (clicked === "hide") hideIsland(key);
    else if (clicked === "zoom") setZoomTo({ key });
    else if (clicked === "archive-idle") void archiveAll(idle);
    else if (clicked === "restore-archived") setRestoringOn(key);
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
          { id: "stop", label: `Stop (${running})`, disabled: running === 0 },
          { id: "archive", label: `Archive (${group.length})` },
        ],
        point,
      );
      if (clicked === "stop") void stopAll(group);
      else if (clicked === "archive") void archiveAll(group);
      return;
    }
    const regenerating = readThreadShell(character.facts.ref)?.titleRegeneration != null;
    const clicked = await api.contextMenu.show(
      [
        { id: "open", label: "Open chat" },
        { id: "voice", label: "Send voice command", disabled: !voiceInputSupported() },
        ...(readEnvironmentSupportsTitleRegeneration(character.facts.ref.environmentId)
          ? [
              {
                id: "regenerate-title",
                label: regenerating ? "Regenerating…" : "Regenerate title",
                disabled: regenerating,
              },
            ]
          : []),
        {
          id: "stop",
          label: "Stop",
          disabled: !isStoppable(character.facts),
          separatorBefore: true,
        },
        { id: "archive", label: "Archive" },
      ],
      point,
    );
    if (clicked === "open") openChat(character);
    else if (clicked === "stop") void stopAll([character]);
    else if (clicked === "archive") void archiveAll([character]);
    else if (clicked === "regenerate-title") void regenerateTitle(character);
    else if (clicked === "voice") {
      setPicked(new Set());
      setListenKey(character.facts.key);
      setBubbleKey(character.facts.key);
    }
  };
  const moveBubble = useCallback((points: ReadonlyArray<ScreenPoint>) => {
    const point = points[0];
    if (point !== undefined && bubbleRef.current !== null) {
      bubbleRef.current.style.transform = `translate(${point.x}px, ${point.y}px)`;
    }
  }, []);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  // A click on the sea or an island's ground closes the bubble; the end of a pan does not.
  const clickGround = (event: MouseEvent) => {
    const start = pressedAt.current;
    if (start === null) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) {
      setBubbleKey(null);
      setPicked(new Set());
      dropUntypedNewAgent();
    }
  };

  // Hovering an island tags every character on it with its thread title;
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
  const chatCharacterKey = chatCharacter?.facts.key ?? null;
  useEffect(() => {
    if (chatCharacterKey === null) return;
    const { setArchiveChatAgent } = useWorldModeStore.getState();
    setArchiveChatAgent(() => archiveChat.current());
    return () => setArchiveChatAgent(null);
  }, [archiveChat, chatCharacterKey]);
  const tagged = [
    ...(islands.find((island) => island.key === hoveredIsland)?.characters ?? []),
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
  const newAgentDraft = useRef("");
  // Closing loses only an empty draft; one with a typed task stays until closed.
  const dropUntypedNewAgent = () => {
    if (newAgentDraft.current.trim() === "") setNewAgent(null);
  };
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
    newAgentDraft.current = "";
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
  const newAgentRef = useRef<HTMLDivElement>(null);
  const moveNewAgent = useCallback((points: ReadonlyArray<ScreenPoint>) => {
    const point = points[0];
    if (point !== undefined && newAgentRef.current !== null) {
      newAgentRef.current.style.transform = `translate(${point.x}px, ${point.y}px)`;
    }
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  // The map zooms on wheel; overlays pass it on so that keeps working under the pointer.
  const forwardWheel = (event: React.WheelEvent) =>
    containerRef.current
      ?.querySelector("canvas")
      ?.dispatchEvent(new WheelEvent("wheel", event.nativeEvent));
  // A press anywhere outside the bubble closes it. The canvas decides for
  // itself: a character click toggles or switches, empty ground closes.
  const bubbleOpen = bubbleKey !== null;
  useEffect(() => {
    if (!bubbleOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null || bubbleRef.current?.contains(target)) return;
      // The bubble's own popovers (its colour picker) and dialogs (the voice
      // key prompt) portal out of it.
      if (
        target instanceof Element &&
        target.closest(
          '[data-slot="popover-positioner"], [data-slot="dialog-viewport"], [data-slot="dialog-backdrop"]',
        )
      ) {
        return;
      }
      if (containerRef.current?.querySelector("canvas")?.contains(target)) return;
      setBubbleKey(null);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [bubbleOpen]);
  // Same for the new-agent bubble, unless a task was typed into it. Presses on
  // the canvas go through clickGround, so dragging the map keeps it open.
  const newAgentOpen = newAgent !== null;
  useEffect(() => {
    if (!newAgentOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null || newAgentRef.current?.contains(target)) return;
      // Its workspace select, colour picker and voice key prompt portal out of it.
      if (
        target instanceof Element &&
        target.closest(
          '[data-slot="select-positioner"], [data-slot="popover-positioner"], [data-slot="dialog-viewport"], [data-slot="dialog-backdrop"]',
        )
      ) {
        return;
      }
      if (containerRef.current?.querySelector("canvas")?.contains(target)) return;
      if (newAgentDraft.current.trim() === "") setNewAgent(null);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [newAgentOpen]);

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

  return (
    // Isolated so its overlays (tags, buttons, bubbles) stack under the chat panel.
    <div ref={containerRef} className="relative isolate size-full">
      <Canvas
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
        <SceneContrast />
        <WorldControls
          bounds={bounds}
          islands={islandSpots}
          panel={panel}
          focusKey={selectedKey}
          roots={roots}
          zoomTo={zoomTo}
          reveal={reveal}
          arrangement={arrangement}
        />
        <FollowTracker
          roots={roots}
          keys={bubble === null ? [] : [bubble.facts.key]}
          hatted={hatted}
          onMove={moveBubble}
        />
        <FollowTracker
          roots={roots}
          keys={tagged.map((c) => c.facts.key)}
          hatted={hatted}
          onMove={moveTags}
        />
        <PointTracker points={newAgentSpots} onMove={moveSpots} />
        <PointTracker
          points={newAgent === null ? [] : [{ key: "new-agent", position: newAgent.position }]}
          onMove={moveNewAgent}
        />
        <IslandHoverTracker
          target={containerRef}
          islands={islandSpots}
          onChange={setHoveredIsland}
        />
        <hemisphereLight args={[palette.skyLight, palette.groundLight, 1.7]} />
        <directionalLight position={[6, 14, 9]} intensity={1.6} />
        <AmbientTicker fps={ambientFps} />
        {/* Far wider than any archipelago, so the water never ends on screen. */}
        <mesh geometry={geometry.plane} rotation-x={-Math.PI / 2} position-y={-0.25} scale={4000}>
          <meshLambertMaterial color={palette.water} />
        </mesh>
        <SharkSightings islands={islandSpots} config={definition.archipelago.sharks} />
        {islands.map((island) => {
          // Everyone there archived: once the saucer has left, the island stays
          // washed out until new work lands.
          const faded = island.characters.length === 0 && !leaving.has(island.key);
          const plate = palette.plates[hashString(island.key) % palette.plates.length]!;
          return (
            <FadedContext key={island.key} value={faded}>
              <group
                position={island.offset as [number, number, number]}
                // A prop or limb in front of a character is hit first; the character still wins.
                onClick={(event) => {
                  if (!hitsCharacter(event)) clickGround(event.nativeEvent);
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
                  ripple={island.ripple}
                />
                <Sign
                  slot={island.definition.archipelago.sign}
                  text={projectTitles.get(island.key) ?? "Project"}
                  color={faded ? toFaded(plate) : plate}
                  pullRequests={pullRequestCounts.get(island.key) ?? 0}
                />
                {island.characters
                  .filter((character) => !abducted.has(character.facts.key))
                  .map((character) => (
                    <Character
                      key={character.facts.key}
                      character={character}
                      shades={palette.families[island.hues.get(character.facts.lookSeed) ?? 0]!}
                      hat={
                        character.facts.worktreePath === null
                          ? null
                          : (island.hats.get(character.facts.worktreePath) ?? null)
                      }
                      obstacles={obstacles.get(island.definition)!}
                      ground={groundHeight(island.definition)}
                      surface={surfaceAt(island.definition)}
                      movement={definition.movement}
                      selected={
                        character.facts.key === (bubble?.facts.key ?? chatKey) ||
                        picked.has(character.facts.key)
                      }
                      onSelect={toggleBubble}
                      onOpen={openChat}
                      onPick={togglePicked}
                      onMenu={(target, point) => void showMenu(target, point)}
                      onRoot={registerRoot}
                      onHover={onHover}
                    />
                  ))}
              </group>
            </FadedContext>
          );
        })}
        {abductions.map((abduction) => (
          <Abduction
            key={abduction.id}
            figures={abduction.figures}
            onDone={() => setAbductions((all) => all.filter((a) => a.id !== abduction.id))}
          />
        ))}
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
            newAgentDraft.current = "";
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
      {newAgent !== null ? (
        <div ref={newAgentRef} className="pointer-events-none absolute top-0 left-0 z-30">
          <div className="pointer-events-auto -translate-x-1/2 -translate-y-[calc(100%+0.75rem)]">
            <NewAgentBubble
              key={`${newAgent.islandKey}#${newAgent.slotIndex}`}
              islandName={projectTitles.get(newAgent.islandKey) ?? "this island"}
              project={projectRefs.get(newAgent.islandKey)!}
              onClose={() => setNewAgent(null)}
              onTextChange={(text) => {
                newAgentDraft.current = text;
              }}
              suggestedHue={suggestHue(
                islands.find((island) => island.key === newAgent.islandKey) ?? { hues: new Map() },
                palette.families.length,
              )}
              onStarted={(thread) => {
                const { slotIndex } = newAgent;
                chooseHue(thread.ref.threadId, thread.hue);
                setRequested((all) =>
                  new Map(all).set(thread.key, {
                    area: definition.archipelago.newAgents.area,
                    slotIndex,
                  }),
                );
                setNewAgent(null);
                // An open chat moves on to the new agent.
                if (selectedKey !== null) switchChat(thread);
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
          color: palette.plates[hashString(island.key) % palette.plates.length]!,
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
      {restoringOn !== null ? (
        <RestoreArchivedDialog
          title={projectTitles.get(restoringOn) ?? "this island"}
          color={palette.plates[hashString(restoringOn) % palette.plates.length]!}
          projectRefs={projectMembers.get(restoringOn) ?? []}
          onClose={() => setRestoringOn(null)}
        />
      ) : null}
      {toolbar !== null
        ? createPortal(
            <>
              <AddProjectButton islandOf={islandOf} />
              <IslandArrangementMenu />
              <ProjectVisibilityMenu
                projects={projectOrder.map((key) => ({
                  key,
                  title: projectTitles.get(key) ?? "Project",
                  color: palette.plates[hashString(key) % palette.plates.length]!,
                }))}
              />
            </>,
            toolbar,
          )
        : null}
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
                else toggleBubble(character);
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
        "-translate-x-1/2 -translate-y-full pointer-events-auto flex cursor-pointer items-center gap-1 rounded leading-tight shadow-sm",
        !chatting && "max-w-36 px-1.5 py-0.5 text-3xs",
        chatting && "max-w-56 gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium shadow-md",
        focused || chatting
          ? "bg-popover text-popover-foreground"
          : "bg-popover/80 text-popover-foreground/90",
      )}
    >
      <span className="truncate">{facts.title || "Untitled thread"}</span>
      {elapsed !== "" ? (
        // Red for a reply in the last 5 minutes, yellow within the hour, gray after.
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            chatting && "size-2",
            elapsedMs <= 5 * 60_000 && "bg-red-500",
            elapsedMs > 5 * 60_000 && elapsedMs <= 60 * 60_000 && "bg-yellow-400",
            elapsedMs > 60 * 60_000 && "bg-gray-400",
          )}
        />
      ) : null}
      {elapsed !== "" ? (
        <span className="shrink-0 tabular-nums opacity-60">
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
/** Extra height over a hatted head: the tallest hats rise about this far. */
const HAT_LIFT = 0.35;
/** Room between a balloon's top and the overlay above it. */
const BALLOON_CLEARANCE_PX = 4;
const SPOT_MIN_SPACING_PX = 34;
// Reused on every frame; trackers only touch them inside their frame callback.
const followPoint = new Vector3();
const balloonPoint = new Vector3();

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
  /** Called once per drawn frame with every followed character's screen point. */
  readonly onMove: (points: ReadonlyArray<ScreenPoint>) => void;
}) {
  const { roots, keys, hatted, onMove } = props;
  const invalidate = useThree((state) => state.invalidate);
  const signature = keys.join("\u0000");
  useEffect(() => {
    if (signature !== "") invalidate();
  }, [signature, invalidate]);
  useFrame((state) => {
    if (keys.length === 0) return;
    const points: ScreenPoint[] = [];
    for (const key of keys) {
      const root = roots.current.get(key);
      if (root === undefined) continue;
      root.getWorldPosition(followPoint);
      followPoint.y += (FOLLOW_HEIGHT + (hatted.has(key) ? HAT_LIFT : 0)) * root.scale.y;
      followPoint.project(state.camera);
      let y = ((1 - followPoint.y) / 2) * state.size.height;
      const balloon = root.getObjectByName(BALLOON_NAME);
      if (balloon !== undefined) {
        balloon.getWorldPosition(balloonPoint).project(state.camera);
        const top = ((1 - balloonPoint.y) / 2) * state.size.height - BALLOON_PX / 2;
        y = Math.min(y, top - BALLOON_CLEARANCE_PX);
      }
      points.push({ key, x: ((followPoint.x + 1) / 2) * state.size.width, y });
    }
    onMove(points);
  });
  return null;
}

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
}

const CAMERA_OFFSET = new Vector3(18, 20, 18);
const PANEL_CLOSE_SPACE = 48;

/**
 * Pan and zoom only, like a strategy map. Redraws on change instead of every
 * frame. Frames the whole archipelago once, when the first islands appear;
 * after that the camera stays where the user puts it.
 */
function WorldControls({
  bounds,
  islands,
  panel,
  focusKey,
  roots,
  zoomTo,
  reveal,
  arrangement,
}: {
  /** Each island's ground, in the same order as `islands`. */
  readonly bounds: ReadonlyArray<Bounds> | null;
  readonly islands: ReadonlyArray<IslandSpot>;
  readonly panel: () => HTMLElement | null;
  /** The character whose chat is open: slid into view beside the panel. */
  readonly focusKey: string | null;
  readonly roots: React.RefObject<Map<string, Object3D>>;
  /** An island to frame, from its menu; a new object frames it again. */
  readonly zoomTo: { readonly key: string } | null;
  /** A spot that must show with room above it for the new-agent bubble; a new object checks again. */
  readonly reveal: { readonly islandKey: string; readonly position: Vec3 } | null;
  /** How the islands line up; a new one frames them all where they now stand. */
  readonly arrangement: IslandArrangement;
}) {
  const camera = useThree((state) => state.camera);
  const element = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const controlsRef = useRef<MapControls | null>(null);
  const fitted = useRef(false);
  /** How much of the canvas's right side the chat panel hides. */
  const coveredRight = useCallback(() => {
    const panelRect = panel()?.getBoundingClientRect();
    // The panel's close button sits just outside it, on the left.
    return panelRect
      ? element.getBoundingClientRect().right - (panelRect.left - PANEL_CLOSE_SPACE)
      : 0;
  }, [element, panel]);
  // Camera moves the app makes glide; grabbing the map stops them.
  const flight = useRef<{
    readonly from: View;
    readonly to: View;
    readonly startedAt: number;
  } | null>(null);
  useEffect(() => {
    const controls = new MapControls(camera, element);
    controls.enableRotate = false;
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
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
    const stopFlight = () => {
      flight.current = null;
    };
    controls.addEventListener("change", redraw);
    controls.addEventListener("start", stopFlight);
    redraw();
    return () => {
      controls.removeEventListener("change", redraw);
      controls.removeEventListener("start", stopFlight);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, element, invalidate]);
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls === null || bounds === null || fitted.current) return;
    if (!(camera instanceof OrthographicCamera) || size.width === 0) return;
    fitted.current = true;
    applyView(
      camera,
      controls,
      frameView({ camera, controls, bounds, viewport: size, coveredRight: coveredRight() }),
    );
    invalidate();
  }, [bounds, camera, invalidate, coveredRight, size]);

  const fly = useCallback(
    (to: View) => {
      const controls = controlsRef.current;
      if (controls === null) return;
      flight.current = { from: currentView(camera, controls), to, startedAt: performance.now() };
      invalidate();
    },
    [camera, invalidate],
  );
  const framedArrangement = useRef(arrangement);
  useEffect(() => {
    if (framedArrangement.current === arrangement) return;
    framedArrangement.current = arrangement;
    const controls = controlsRef.current;
    if (controls === null || bounds === null || !(camera instanceof OrthographicCamera)) return;
    fly(frameView({ camera, controls, bounds, viewport: size, coveredRight: coveredRight() }));
  }, [arrangement, bounds, camera, fly, size, coveredRight]);
  useFrame((state) => {
    const controls = controlsRef.current;
    const moving = flight.current;
    if (moving === null || controls === null || !(camera instanceof OrthographicCamera)) return;
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
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls === null || bounds === null || !(camera instanceof OrthographicCamera)) return;
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const hit = new Vector3();
    const onDoubleClick = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      castFromNearPlane(raycaster, pointer, camera);
      const ground = raycaster.ray.intersectPlane(seaLevel, hit);
      const index = ground === null ? -1 : islands.findIndex((island) => isOverIsland(hit, island));
      const island = bounds[index];
      fly(
        frameView({
          camera,
          controls,
          bounds: island === undefined ? bounds : [island],
          viewport: size,
          coveredRight: coveredRight(),
        }),
      );
    };
    element.addEventListener("dblclick", onDoubleClick);
    return () => element.removeEventListener("dblclick", onDoubleClick);
  }, [bounds, islands, camera, element, fly, coveredRight, size]);

  // Opening a chat waits for its panel to settle, then frames its character's
  // island beside it, but only when the panel hides part of the island or the
  // character. Closing it flies back to wherever the map was before.
  const beforeChat = useRef<View | null>(null);
  const waitForPanel = useRef<(() => void) | null>(null);
  const stopWaiting = useCallback(() => {
    waitForPanel.current?.();
    waitForPanel.current = null;
  }, []);
  const frameFocus = useEffectEvent((key: string) => {
    const controls = controlsRef.current;
    const root = roots.current.get(key);
    if (controls === null || root === undefined || bounds === null) return;
    if (!(camera instanceof OrthographicCamera)) return;
    root.getWorldPosition(focusPoint);
    const distances = islands.map((spot) =>
      Math.hypot(focusPoint.x - spot.x, focusPoint.z - spot.z),
    );
    const nearest = distances.indexOf(Math.min(...distances));
    const island = bounds[nearest];
    const spot = islands[nearest];
    if (island === undefined || spot === undefined) return;
    const covered = coveredRight();
    const head = focusPoint.clone().setY(focusPoint.y + FOLLOW_HEIGHT * root.scale.y);
    const shore = Array.from({ length: SHORE_SAMPLES }, (_, index) => {
      const angle = (index / SHORE_SAMPLES) * Math.PI * 2;
      return new Vector3(
        spot.x + Math.cos(angle) * spot.shoreRadius,
        0,
        spot.z + Math.sin(angle) * spot.shoreRadius,
      );
    });
    if (onScreen(camera, [focusPoint, head, ...shore], size, covered)) return;
    // Switching chats keeps the view from before the first move.
    beforeChat.current ??= currentView(camera, controls);
    fly(frameView({ camera, controls, bounds: [island], viewport: size, coveredRight: covered }));
  });
  const onFocus = useEffectEvent((key: string | null) => {
    stopWaiting();
    if (key === null) {
      if (beforeChat.current !== null) fly(beforeChat.current);
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
      const frame = requestAnimationFrame(check);
      waitForPanel.current = () => cancelAnimationFrame(frame);
    };
    waitFrame();
  });
  useEffect(() => onFocus(focusKey), [focusKey]);
  useEffect(() => stopWaiting, [stopWaiting]);

  const onZoomTo = useEffectEvent((key: string) => {
    const controls = controlsRef.current;
    const island = bounds?.[islands.findIndex((spot) => spot.key === key)];
    if (controls === null || island === undefined || !(camera instanceof OrthographicCamera)) {
      return;
    }
    fly(
      frameView({
        camera,
        controls,
        bounds: [island],
        viewport: size,
        coveredRight: coveredRight(),
      }),
    );
  });
  useEffect(() => {
    if (zoomTo !== null) onZoomTo(zoomTo.key);
  }, [zoomTo]);

  // Leaves the map alone when the spot already shows, zoomed in enough, with
  // room for the bubble; otherwise frames its island and slides the spot clear.
  const onReveal = useEffectEvent((islandKey: string, position: Vec3) => {
    const controls = controlsRef.current;
    const island = bounds?.[islands.findIndex((spot) => spot.key === islandKey)];
    if (controls === null || island === undefined || !(camera instanceof OrthographicCamera)) {
      return;
    }
    const covered = coveredRight();
    const point = new Vector3(...position);
    const framed = frameView({
      camera,
      controls,
      bounds: [island],
      viewport: size,
      coveredRight: covered,
    });
    const current = currentView(camera, controls);
    if (
      current.zoom >= framed.zoom * REVEAL_MIN_ZOOM &&
      bubbleRoom(camera, current, point, size, covered).equals(ZERO)
    ) {
      return;
    }
    const shift = bubbleRoom(camera, framed, point, size, covered);
    fly({ target: framed.target.add(shift), zoom: framed.zoom });
  });
  useEffect(() => {
    if (reveal !== null) onReveal(reveal.islandKey, reveal.position);
  }, [reveal]);
  return null;
}

/** How far in, against framing its island, the map must be to start an agent there as is. */
const REVEAL_MIN_ZOOM = 0.6;
/** The new-agent bubble's size above its spot, with a little air. */
const BUBBLE_ROOM = { width: 464, height: 372, below: 24, top: 56 };
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
  coveredRight: number,
): Vector3 {
  const probe = camera.clone();
  probe.position.copy(view.target).add(CAMERA_OFFSET);
  probe.lookAt(view.target);
  probe.zoom = view.zoom;
  probe.updateProjectionMatrix();
  probe.updateMatrixWorld();
  const projected = point.clone().project(probe);
  const x = ((projected.x + 1) / 2) * viewport.width;
  const y = ((1 - projected.y) / 2) * viewport.height;
  const half = BUBBLE_ROOM.width / 2;
  const right = Math.max(half, viewport.width - coveredRight - half);
  const top = BUBBLE_ROOM.top + BUBBLE_ROOM.height;
  const bottom = Math.max(top, viewport.height - BUBBLE_ROOM.below);
  // Pixels the spot must move on screen: right and down are positive.
  const dx = x < half ? half - x : x > right ? right - x : 0;
  const dy = y < top ? top - y : y > bottom ? bottom - y : 0;
  if (dx === 0 && dy === 0) return new Vector3();
  // Moving the target the other way moves the spot this way on screen.
  const shift = new Vector3(-dx, dy, 0)
    .transformDirection(probe.matrixWorld)
    .multiplyScalar(Math.hypot(dx, dy) / view.zoom);
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

/** True when every point falls inside the part of the canvas the panel leaves visible. */
function onScreen(
  camera: OrthographicCamera,
  points: ReadonlyArray<Vector3>,
  viewport: { readonly width: number; readonly height: number },
  coveredRight: number,
): boolean {
  camera.updateMatrixWorld();
  const projected = new Vector3();
  return points.every((point) => {
    projected.copy(point).project(camera);
    const x = ((projected.x + 1) / 2) * viewport.width;
    const y = ((1 - projected.y) / 2) * viewport.height;
    return x >= 0 && x <= viewport.width - coveredRight && y >= 0 && y <= viewport.height;
  });
}

/** Where the map looks and how far in it is zoomed. */
interface View {
  readonly target: Vector3;
  readonly zoom: number;
}

function currentView(camera: Object3D & { zoom?: number }, controls: MapControls): View {
  return { target: controls.target.clone(), zoom: camera.zoom ?? 1 };
}

function applyView(camera: OrthographicCamera, controls: MapControls, view: View) {
  controls.target.copy(view.target);
  camera.position.copy(view.target).add(CAMERA_OFFSET);
  camera.zoom = view.zoom;
  camera.updateProjectionMatrix();
  controls.update();
}

/** The view that fits `bounds` into the part of the canvas the panel leaves visible. */
function frameView(input: {
  readonly camera: OrthographicCamera;
  readonly controls: MapControls;
  readonly bounds: ReadonlyArray<Bounds>;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly coveredRight: number;
}): View {
  const { controls, bounds, viewport } = input;
  // Measured on a copy, so the real camera only moves when the view is applied.
  const probe = input.camera.clone();
  // Keep a usable strip of world even when the panel covers most of the canvas.
  const coveredRight = Math.max(0, Math.min(input.coveredRight, viewport.width - 320));
  const first = bounds[0]!;
  const target = new Vector3((first.minX + first.maxX) / 2, 0, (first.minZ + first.maxZ) / 2);
  probe.position.copy(target).add(CAMERA_OFFSET);
  probe.lookAt(target);
  probe.updateMatrixWorld();
  // Measure every island on screen at zoom 1 (one unit per pixel).
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  const corner = new Vector3();
  for (const island of bounds) {
    for (const x of [island.minX, island.maxX]) {
      for (const z of [island.minZ, island.maxZ]) {
        for (const y of [-0.6, SIGN_TOP]) {
          corner.set(x, y, z).applyMatrix4(probe.matrixWorldInverse);
          left = Math.min(left, corner.x);
          right = Math.max(right, corner.x);
          bottom = Math.min(bottom, corner.y);
          top = Math.max(top, corner.y);
        }
      }
    }
  }
  // Slide the view sideways onto the middle of that, then zoom to fit.
  target.add(
    new Vector3((left + right) / 2, (bottom + top) / 2, 0)
      .transformDirection(probe.matrixWorld)
      .multiplyScalar(Math.hypot((left + right) / 2, (bottom + top) / 2)),
  );
  const margin = 1.15;
  const zoom = Math.min(
    controls.maxZoom,
    Math.max(
      controls.minZoom,
      Math.min(
        (viewport.width - coveredRight) / ((right - left) * margin),
        viewport.height / ((top - bottom) * margin),
      ),
    ),
  );
  // Centre the islands in the part of the canvas the panel leaves visible.
  target.add(
    new Vector3(1, 0, 0)
      .transformDirection(probe.matrixWorld)
      .multiplyScalar(coveredRight / 2 / zoom),
  );
  // The screen-space shifts above also move the target up or down; slide it
  // back along the line of sight onto sea level, where the camera aims.
  const sight = new Vector3().copy(CAMERA_OFFSET).normalize();
  target.addScaledVector(sight, -target.y / sight.y);
  return { target, zoom };
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
function archipelagoBounds(islands: ReadonlyArray<WorldIsland>): Bounds[] | null {
  if (islands.length === 0) return null;
  return islands.map(({ offset, definition }) => {
    const island = islandBounds(definition);
    return {
      minX: offset[0] + island.minX,
      maxX: offset[0] + island.maxX,
      minZ: offset[2] + island.minZ,
      maxZ: offset[2] + island.maxZ,
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
