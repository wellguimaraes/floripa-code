import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PlusIcon } from "lucide-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Object3D, OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";

import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { buildProjectGroups, selectProjectGroupingSettings } from "../../logicalProject";
import { useProjects, useThreadShells } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import type { Vec3, WorldDefinition } from "./definition/types";
import { validateWorldDefinition } from "./definition/validate";
import {
  EMPTY_ARCHIPELAGO_MEMORY,
  islandBounds,
  resolveArchipelago,
  type WorldIsland,
} from "./engine/archipelago";
import { EMPTY_BEAT_GATE, gateBeats } from "./engine/beats";
import { buildCharacterFacts, type CharacterFacts } from "./engine/facts";
import { hashString } from "./engine/hash";
import type { SlotRequest } from "./engine/slots";
import type { WorldCharacter } from "./engine/world";
import { Abduction } from "./scene/Abduction";
import { Character, type FamilyShades } from "./scene/Character";
import { geometry } from "./scene/geometries";
import { Island, type FurnitureSpot } from "./scene/Island";
import { palette } from "./scene/palette";
import { SharkSightings } from "./scene/Sharks";
import { NightContext } from "./scene/lighting";
import { Sign } from "./scene/Sign";
import { NewAgentBubble } from "./NewAgentBubble";
import { layoutTags, type ScreenPoint } from "./scene/tagLayout";
import { WorldBubble } from "./WorldBubble";

/**
 * The 3D world. Renders on demand only: a still scene draws no frames.
 * Walkers request frames until they arrive, and characters with an idle
 * animation share one throttled ticker that stops while the tab is hidden.
 */
export default function WorldCanvas(props: {
  readonly definition: WorldDefinition;
  readonly selectedKey: string | null;
  /** Opens a thread's full chat. */
  readonly onExpand: (ref: ScopedThreadRef) => void;
  /** The chat panel, if open; framing the islands keeps clear of it. */
  readonly panel: () => HTMLElement | null;
}) {
  const { definition, selectedKey, onExpand, panel } = props;
  if (import.meta.env.DEV) assertValidDefinition(definition);

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
  const { islandOf, projectOrder, projectTitles, projectRefs } = useMemo(() => {
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
    };
  }, [projects, groupingSettings]);
  const islandFacts = useMemo(
    () => facts.map((f) => ({ ...f, projectKey: islandOf.get(f.projectKey) ?? f.projectKey })),
    [facts, islandOf],
  );
  const [memory] = useState(createArchipelagoMemory);
  // Piles picked for agents started from them, by the thread they will become.
  const [requested, setRequested] = useState<ReadonlyMap<string, SlotRequest>>(new Map());
  // Re-check often while anyone works (quiet threads), and slowly otherwise
  // so a resting island still falls asleep without any update arriving.
  const anyoneWorking = facts.some((f) => f.status === "working");
  const clock = useClock(anyoneWorking ? QUIET_CHECK_MS : NIGHT_CHECK_MS);
  const islands = useMemo(
    () =>
      memory.resolve({
        facts: islandFacts,
        definition,
        projectOrder,
        hueCount: palette.families.length,
        checkedAt: clock,
        requested,
      }),
    [memory, islandFacts, definition, projectOrder, clock, requested],
  );
  const bounds = useMemo(() => archipelagoBounds(definition, islands), [definition, islands]);
  const { islandSpots, shoreRadius } = useMemo(() => {
    const island = islandBounds(definition);
    const center = [(island.minX + island.maxX) / 2, (island.minZ + island.maxZ) / 2] as const;
    return {
      islandSpots: islands.map(({ key, offset }) => ({
        key,
        x: offset[0] + center[0],
        z: offset[2] + center[1],
      })),
      shoreRadius: Math.max(island.maxX - island.minX, island.maxZ - island.minZ) / 2,
    };
  }, [definition, islands]);
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
  const toggleBubble = (character: WorldCharacter) =>
    setBubbleKey((current) => (current === character.facts.key ? null : character.facts.key));
  const roots = useRef(new Map<string, Object3D>());
  const registerRoot = useCallback((key: string, root: Object3D | null) => {
    if (root === null) roots.current.delete(key);
    else roots.current.set(key, root);
  }, []);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Archived characters leave by saucer: the real one is hidden at once and
  // a stand-in in its colours is beamed up from where it stood.
  const [abductions, setAbductions] = useState<
    ReadonlyArray<{
      readonly key: string;
      readonly position: Vec3;
      readonly scale: number;
      readonly shades: FamilyShades;
    }>
  >([]);
  const abduct = (character: WorldCharacter) => {
    const root = roots.current.get(character.facts.key);
    if (root === undefined) return;
    const at = root.getWorldPosition(new Vector3());
    const island = islands.find((i) => i.characters.includes(character));
    const hue = island?.hues.get(character.facts.lookSeed) ?? 0;
    setAbductions((all) => [
      ...all,
      {
        key: character.facts.key,
        position: [at.x, at.y, at.z],
        scale: root.scale.y,
        shades: palette.families[hue]!,
      },
    ]);
  };
  const moveBubble = useCallback((points: ReadonlyArray<ScreenPoint>) => {
    const point = points[0];
    if (point !== undefined && bubbleRef.current !== null) {
      bubbleRef.current.style.transform = `translate(${point.x}px, ${point.y}px)`;
    }
  }, []);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  // Hovering an island tags every character on it with its thread title;
  // the one under the pointer shows its full title.
  const [hoveredIsland, setHoveredIsland] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const onHover = (character: WorldCharacter, point: { x: number; y: number } | null) => {
    if (point !== null) setHoveredKey(character.facts.key);
    else setHoveredKey((current) => (current === character.facts.key ? null : current));
  };
  const tagged =
    islands
      .find((island) => island.key === hoveredIsland)
      ?.characters.filter((character) => character.facts.key !== bubble?.facts.key) ?? [];
  // Empty spots on the hovered island get a start button for a new agent.
  const [newAgent, setNewAgent] = useState<{
    readonly islandKey: string;
    readonly slotIndex: number;
    readonly position: Vec3;
  } | null>(null);
  const newAgentSpots = useMemo(() => {
    const { area: areaId, marker } = definition.archipelago.newAgents;
    const area = definition.areas[areaId];
    const island = islands.find((i) => i.key === hoveredIsland);
    if (area?.kind !== "fixed" || island === undefined) return [];
    const taken = new Set(
      island.characters
        .filter((c) => c.placement.area === areaId)
        .map((c) => c.placement.slotIndex),
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
      return [{ key: `${island.key}#${slotIndex}`, islandKey: island.key, slotIndex, position }];
    });
  }, [definition, islands, hoveredIsland]);
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
        gl={{ antialias: true }}
        orthographic
        camera={{ position: [18, 20, 18], zoom: 42, near: -1000, far: 2000 }}
        onPointerDown={(event) => {
          pressedAt.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMissed={(event) => {
          // A click on empty ground closes the bubble; the end of a pan does not.
          const start = pressedAt.current;
          if (start === null) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) {
            setBubbleKey(null);
          }
        }}
      >
        <color attach="background" args={[palette.sky]} />
        <WorldControls bounds={bounds} panel={panel} />
        <FollowTracker
          roots={roots}
          keys={bubble === null ? [] : [bubble.facts.key]}
          onMove={moveBubble}
        />
        <FollowTracker roots={roots} keys={tagged.map((c) => c.facts.key)} onMove={moveTags} />
        <PointTracker points={newAgentSpots} onMove={moveSpots} />
        <PointTracker
          points={newAgent === null ? [] : [{ key: "new-agent", position: newAgent.position }]}
          onMove={moveNewAgent}
        />
        <IslandHoverTracker
          target={containerRef}
          islands={islandSpots}
          radius={shoreRadius + ISLAND_HOVER_MARGIN}
          onChange={setHoveredIsland}
        />
        <hemisphereLight args={[palette.skyLight, palette.groundLight, 1.7]} />
        <directionalLight position={[6, 14, 9]} intensity={1.6} />
        <AmbientTicker fps={ambientFps} />
        {/* Far wider than any archipelago, so the water never ends on screen. */}
        <mesh geometry={geometry.plane} rotation-x={-Math.PI / 2} position-y={-0.25} scale={4000}>
          <meshLambertMaterial color={palette.water} />
        </mesh>
        <SharkSightings
          islands={islandSpots}
          shoreRadius={shoreRadius}
          config={definition.archipelago.sharks}
        />
        {islands.map((island) => (
          <NightContext value={island.night} key={island.key}>
            <group position={island.offset as [number, number, number]}>
              <Island
                definition={definition}
                furniture={buildFurniture(definition, island.characters)}
                ripple={island.ripple}
                night={island.night}
              />
              <Sign
                slot={definition.archipelago.sign}
                text={projectTitles.get(island.key) ?? "Project"}
                color={palette.plates[hashString(island.key) % palette.plates.length]!}
              />
              {island.characters
                .filter((character) => !abductions.some((a) => a.key === character.facts.key))
                .map((character) => (
                  <Character
                    key={character.facts.key}
                    character={character}
                    shades={palette.families[island.hues.get(character.facts.lookSeed) ?? 0]!}
                    roads={definition.roads}
                    movement={definition.movement}
                    selected={character.facts.key === (bubble?.facts.key ?? selectedKey)}
                    onSelect={toggleBubble}
                    onRoot={registerRoot}
                    onHover={onHover}
                  />
                ))}
            </group>
          </NightContext>
        ))}
        {abductions.map((abduction) => (
          <Abduction
            key={abduction.key}
            position={abduction.position}
            scale={abduction.scale}
            shades={abduction.shades}
            onDone={() => setAbductions((all) => all.filter((a) => a.key !== abduction.key))}
          />
        ))}
      </Canvas>
      {bubble !== null ? (
        // Positioned by FollowTracker on every drawn frame, above the character's head.
        <div ref={bubbleRef} className="pointer-events-none absolute top-0 left-0 z-10">
          <div className="pointer-events-auto -translate-x-1/2 -translate-y-[calc(100%+0.75rem)]">
            <WorldBubble
              key={bubble.facts.key}
              facts={bubble.facts}
              onClose={() => setBubbleKey(null)}
              onExpand={() => {
                setBubbleKey(null);
                onExpand(bubble.facts.ref);
              }}
              onArchived={() => {
                setBubbleKey(null);
                abduct(bubble);
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
          className="invisible absolute top-0 left-0 z-10"
          // The map zooms on wheel; keep that working with the pointer on a button.
          onWheel={(event) =>
            containerRef.current
              ?.querySelector("canvas")
              ?.dispatchEvent(new WheelEvent("wheel", event.nativeEvent))
          }
          onClick={() => {
            setBubbleKey(null);
            setNewAgent({
              islandKey: spot.islandKey,
              slotIndex: spot.slotIndex,
              position: spot.position,
            });
          }}
        >
          <span className="flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background transition-transform hover:scale-110">
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
              onStarted={(thread) => {
                const { slotIndex } = newAgent;
                setRequested((all) =>
                  new Map(all).set(thread.key, {
                    area: definition.archipelago.newAgents.area,
                    slotIndex,
                  }),
                );
                setNewAgent(null);
              }}
            />
          </div>
        </div>
      ) : null}
      {tagged.map((character) => {
        const focused = character.facts.key === hoveredKey;
        return (
          // Positioned by FollowTracker on drawn frames, above the character's head.
          <div
            key={character.facts.key}
            ref={(tag) => {
              if (tag === null) tagRefs.current.delete(character.facts.key);
              else tagRefs.current.set(character.facts.key, tag);
            }}
            className={cn("pointer-events-none absolute top-0 left-0", focused ? "z-20" : "z-10")}
          >
            <div
              className={cn(
                "-translate-x-1/2 -translate-y-full truncate rounded px-1.5 py-0.5 text-3xs leading-tight shadow-sm",
                focused
                  ? "max-w-64 bg-popover text-popover-foreground"
                  : "max-w-32 bg-popover/80 text-popover-foreground/90",
              )}
            >
              {character.facts.title || "Untitled thread"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const FOLLOW_HEIGHT = 1.6;
const SPOT_MIN_SPACING_PX = 34;
// Reused on every frame; trackers only touch it inside their frame callback.
const followPoint = new Vector3();

/**
 * Reports where characters are on screen, just above their heads, so DOM
 * overlays (the reply bubble, name tags) can follow them. Runs only on drawn
 * frames, so a still scene costs nothing; a pan, zoom or walk moves them along.
 */
function FollowTracker(props: {
  readonly roots: React.RefObject<Map<string, Object3D>>;
  readonly keys: ReadonlyArray<string>;
  /** Called once per drawn frame with every followed character's screen point. */
  readonly onMove: (points: ReadonlyArray<ScreenPoint>) => void;
}) {
  const { roots, keys, onMove } = props;
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
      followPoint.y += FOLLOW_HEIGHT * root.scale.y;
      followPoint.project(state.camera);
      points.push({
        key,
        x: ((followPoint.x + 1) / 2) * state.size.width,
        y: ((1 - followPoint.y) / 2) * state.size.height,
      });
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

// Covers the shore, the pier and the raft just offshore.
const ISLAND_HOVER_MARGIN = 3.5;
const seaLevel = new Plane(new Vector3(0, 1, 0), 0);

/** Reports which island the pointer is over, by where it meets sea level. */
function IslandHoverTracker(props: {
  /** Listened on instead of the canvas, so overlays on top keep the island hovered. */
  readonly target: React.RefObject<HTMLElement | null>;
  readonly islands: ReadonlyArray<{ readonly key: string; readonly x: number; readonly z: number }>;
  readonly radius: number;
  readonly onChange: (key: string | null) => void;
}) {
  const { target, islands, radius, onChange } = props;
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
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(seaLevel, hit) === null) {
        report(null);
        return;
      }
      const island = islands.find((i) => Math.hypot(hit.x - i.x, hit.z - i.z) <= radius);
      report(island?.key ?? null);
    };
    const onLeave = () => report(null);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
    };
  }, [target, camera, islands, radius, onChange]);
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
  panel,
}: {
  readonly bounds: ReadonlyArray<Bounds> | null;
  readonly panel: () => HTMLElement | null;
}) {
  const camera = useThree((state) => state.camera);
  const element = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const controlsRef = useRef<MapControls | null>(null);
  const fitted = useRef(false);
  useEffect(() => {
    const controls = new MapControls(camera, element);
    controls.enableRotate = false;
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.minZoom = 3;
    controls.maxZoom = 110;
    controls.update();
    controlsRef.current = controls;
    // Wrapped: invalidate's argument is a frame count, not the event.
    const redraw = () => invalidate();
    controls.addEventListener("change", redraw);
    redraw();
    return () => {
      controls.removeEventListener("change", redraw);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, element, invalidate]);
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls === null || bounds === null || fitted.current) return;
    if (!(camera instanceof OrthographicCamera) || size.width === 0) return;
    fitted.current = true;
    const canvasRect = element.getBoundingClientRect();
    const panelRect = panel()?.getBoundingClientRect();
    fitCamera({
      camera,
      controls,
      bounds,
      viewport: size,
      // The panel's close button sits just outside it, on the left.
      coveredRight: panelRect ? canvasRect.right - (panelRect.left - PANEL_CLOSE_SPACE) : 0,
    });
    invalidate();
  }, [bounds, camera, element, invalidate, panel, size]);
  return null;
}

function fitCamera(input: {
  readonly camera: OrthographicCamera;
  readonly controls: MapControls;
  readonly bounds: ReadonlyArray<Bounds>;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly coveredRight: number;
}) {
  const { camera, controls, bounds, viewport } = input;
  // Keep a usable strip of world even when the panel covers most of the canvas.
  const coveredRight = Math.max(0, Math.min(input.coveredRight, viewport.width - 320));
  const first = bounds[0]!;
  const start = new Vector3((first.minX + first.maxX) / 2, 0, (first.minZ + first.maxZ) / 2);
  controls.target.copy(start);
  camera.position.copy(start).add(CAMERA_OFFSET);
  camera.lookAt(start);
  camera.updateMatrixWorld();
  // Measure every island on screen at zoom 1 (one unit per pixel).
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  const corner = new Vector3();
  for (const island of bounds) {
    for (const x of [island.minX, island.maxX]) {
      for (const z of [island.minZ, island.maxZ]) {
        for (const y of [-0.6, 3.2]) {
          corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          left = Math.min(left, corner.x);
          right = Math.max(right, corner.x);
          bottom = Math.min(bottom, corner.y);
          top = Math.max(top, corner.y);
        }
      }
    }
  }
  // Slide the view sideways onto the middle of that, then zoom to fit.
  const shift = new Vector3((left + right) / 2, (bottom + top) / 2, 0).transformDirection(
    camera.matrixWorld,
  );
  shift.multiplyScalar(Math.hypot((left + right) / 2, (bottom + top) / 2));
  controls.target.add(shift);
  camera.position.add(shift);
  const margin = 1.15;
  const zoom = Math.min(
    (viewport.width - coveredRight) / ((right - left) * margin),
    viewport.height / ((top - bottom) * margin),
  );
  camera.zoom = Math.min(controls.maxZoom, Math.max(controls.minZoom, zoom));
  // Centre the islands in the part of the canvas the panel leaves visible.
  const panelShift = new Vector3(coveredRight / 2 / camera.zoom, 0, 0).transformDirection(
    camera.matrixWorld,
  );
  panelShift.multiplyScalar(coveredRight / 2 / camera.zoom);
  controls.target.add(panelShift);
  camera.position.add(panelShift);
  camera.updateProjectionMatrix();
  controls.update();
}

/** Each island's ground in world coordinates. */
function archipelagoBounds(
  definition: WorldDefinition,
  islands: ReadonlyArray<WorldIsland>,
): Bounds[] | null {
  if (islands.length === 0) return null;
  const island = islandBounds(definition);
  return islands.map(({ offset }) => ({
    minX: offset[0] + island.minX,
    maxX: offset[0] + island.maxX,
    minZ: offset[2] + island.minZ,
    maxZ: offset[2] + island.maxZ,
  }));
}

const QUIET_CHECK_MS = 5000;
const NIGHT_CHECK_MS = 60_000;

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
  return {
    resolve(input: {
      readonly facts: ReadonlyArray<CharacterFacts>;
      readonly definition: WorldDefinition;
      readonly projectOrder: ReadonlyArray<string>;
      readonly hueCount: number;
      /** Last clock tick; a new one re-checks pacing and quiet threads. */
      readonly checkedAt: number;
      readonly requested: ReadonlyMap<string, SlotRequest>;
    }): WorldIsland[] {
      const { movement } = input.definition;
      const paced = gateBeats({
        facts: input.facts,
        previous: beats,
        now: Math.max(input.checkedAt, Date.now()),
        dwellMs: movement.beatSeconds * 1000,
        quietMs: movement.quietSeconds * 1000,
      });
      beats = paced.gate;
      const result = resolveArchipelago({
        ...input,
        facts: paced.facts,
        now: Math.max(input.checkedAt, Date.now()),
        previous,
      });
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
    if (area.kind !== "fixed" || area.slotProp === undefined) continue;
    for (const slot of area.slots) {
      spots.push({ kind: area.slotProp, position: slot.position, facing: slot.facing, scale: 1 });
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

let validatedDefinition: WorldDefinition | null = null;
function assertValidDefinition(definition: WorldDefinition) {
  if (validatedDefinition === definition) return;
  validatedDefinition = definition;
  const errors = validateWorldDefinition(definition);
  if (errors.length > 0) throw new Error(`Invalid world definition:\n${errors.join("\n")}`);
}
