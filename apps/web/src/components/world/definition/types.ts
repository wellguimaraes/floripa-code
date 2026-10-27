import type { SidebarThreadStatus } from "../../Sidebar.logic";

/**
 * A world is plain data: areas characters go to, roads they walk along, and
 * rules that pick an area and activity from a character's facts. Keep it free
 * of functions so a definition can later be loaded from JSON and validated
 * without changing its shape. The engine (`../engine`) owns the meaning.
 */
export type Vec3 = readonly [x: number, y: number, z: number];

/** A spot a character stands, sits, or lies at. `facing` is yaw in radians. */
export interface WorldSlot {
  readonly position: Vec3;
  readonly facing: number;
  /** Placed at this slot instead of the area's `slotProp`. */
  readonly prop?: PropKind;
  /**
   * A seat this high off the ground, e.g. a lounger: the occupant climbs on
   * and sits back instead of lying down, and waves with a raised arm.
   */
  readonly seat?: number;
  /** Walked through on the way to the slot and on the way off it, e.g. the foot of a pier. */
  readonly via?: Vec3;
  /** The occupant holds a rod out over the water while resting here. */
  readonly fishing?: boolean;
  /** On the `seat`, sits at a drop with legs hanging over it, e.g. a pier's side. */
  readonly ledge?: boolean;
}

/** Small things strewn around for looks; see `SceneryRule`. */
export type SceneryKind = "rock" | "grass";

export type PropKind =
  | "towel"
  | "beachChair"
  | "pier"
  | "palm"
  | "tree"
  | "sibipiruna"
  | "rockPile"
  | "boulder"
  | "lamp"
  | SceneryKind;

export interface WorldProp {
  readonly kind: PropKind;
  readonly position: Vec3;
  readonly facing: number;
  /** Grows or shrinks the prop; 1 is its usual size. */
  readonly scale?: number;
  /** A pier's curve; see `PierArc`. */
  readonly arc?: PierArc;
}

/**
 * A pier curving along the shore, on the circle `radius` from the island's
 * middle, which lies straight behind the pier's position. It reaches `left`
 * and `right` units round that circle either side of it: right is local +x.
 * Its deck runs `width` out from that circle, onto the water.
 */
export interface PierArc {
  readonly radius: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

/**
 * Scenery strewn over one kind of ground, e.g. pebbles on the sand. The
 * engine places it the same way on every island: clear of slots, roads and
 * props, and never between the camera and a slot (see `islandScenery`).
 */
export interface SceneryRule {
  readonly kind: SceneryKind;
  readonly on: TerrainKind;
  readonly count: number;
  /** Picked at random in this range, 1 being the kind's usual size. */
  readonly scale: readonly [min: number, max: number];
  /** Only within this circle, e.g. a cluster in one stretch of beach. */
  readonly near?: { readonly center: readonly [x: number, z: number]; readonly radius: number };
}

/** Fixed slots in the world, entered through one road node. */
export interface FixedArea {
  readonly kind: "fixed";
  readonly entry: string;
  readonly slots: ReadonlyArray<WorldSlot>;
  /** Placed at every slot, e.g. a rock pile per mining site. */
  readonly slotProp?: PropKind;
  /** Grows the props at the slots, e.g. bigger rock piles on a bigger island. */
  readonly slotPropScale?: number;
  /**
   * Extra spots without a prop, filled in order once every slot is taken and
   * before anyone queues at the entry, e.g. lying on the sand past the towels.
   */
  readonly spillover?: ReadonlyArray<WorldSlot>;
  /**
   * Characters line up across the slots by when their agent last replied,
   * oldest at the first slot, and close the gap when one leaves. Once the
   * slots run out, the oldest move back to the spillover. A family lines up
   * as one block, placed by its latest reply.
   */
  readonly lineUp?: boolean;
  /**
   * Agents sharing a worktree take slots no farther apart than this, so they
   * work side by side. An agent outside any worktree moves aside to make room.
   */
  readonly worktreeReach?: number;
}

/**
 * Slots relative to the parent character's spot, in the parent's frame (+z is
 * the way the parent faces), e.g. kids around their parent's rock pile. A
 * character without a placed parent uses the fallback.
 */
export interface AnchoredArea {
  readonly kind: "anchored";
  readonly anchor: "parent";
  readonly offsets: ReadonlyArray<WorldSlot>;
  readonly slotProp?: PropKind;
}

export type WorldArea = FixedArea | AnchoredArea;

export interface WorldRoads {
  readonly nodes: Readonly<Record<string, Vec3>>;
  readonly edges: ReadonlyArray<readonly [from: string, to: string]>;
}

/** Facts the engine derives per character. Rules can only match on these. */
export interface CharacterFactMatch {
  readonly status?: SidebarThreadStatus | ReadonlyArray<SidebarThreadStatus>;
  readonly unread?: boolean;
  readonly kid?: boolean;
  readonly hasWorkingKids?: boolean;
  /** A kid whose parent is working or waiting on something, so it tags along. */
  readonly parentBusy?: boolean;
  /** A background task, such as a long command, is still running. */
  readonly backgroundTask?: boolean;
  /** The thread has produced nothing new for `movement.quietSeconds`. */
  readonly quiet?: boolean;
  /** The agent last replied no more than this many seconds ago. */
  readonly repliedWithin?: number;
  readonly provider?: string | ReadonlyArray<string>;
}

export type Balloon = "approval" | "question";
export type Effect = "cloud";

export interface WorldIntent {
  readonly go: string;
  readonly do: string;
  readonly balloon?: Balloon;
  readonly effect?: Effect;
}

export interface WorldRule extends WorldIntent {
  readonly when: CharacterFactMatch;
}

/** Poses are the renderer's vocabulary; activities name a pose plus timing. */
export type Pose = "stand" | "lie" | "dead" | "wave" | "slump" | "mine" | "ponder" | "crossArms";

export interface WorldActivity {
  readonly pose: Pose;
  /**
   * Frame rate for the activity's idle motion. Omit for a still pose, which
   * costs no frames at all once the character has arrived.
   */
  readonly ambientFps?: number;
}

export type TerrainKind = "grass" | "sand" | "path";

/** Ground patch on the water plane: an axis-aligned box or a round disc. */
export type TerrainPatch =
  | {
      readonly shape: "box";
      readonly kind: TerrainKind;
      readonly center: readonly [x: number, z: number];
      readonly size: readonly [width: number, depth: number];
    }
  | {
      readonly shape: "disc";
      readonly kind: TerrainKind;
      readonly center: readonly [x: number, z: number];
      readonly radius: number;
    };

export interface WorldMovement {
  /** World units per second. */
  readonly walkSpeed: number;
  /** Frames per second while anyone walks; walking is smooth well below the display rate. */
  readonly walkFps: number;
  /** Shortest time between two beats, so a busy agent's nugget pile grows at a readable pace. */
  readonly beatSeconds: number;
  /** A thread with no new output for this long counts as `quiet`. */
  readonly quietSeconds: number;
  readonly kidSpeedScale: number;
  /** Every character's size; kids are `kidScale` of it. */
  readonly characterScale: number;
  readonly kidScale: number;
}

/**
 * Every project gets its own copy of the island. Islands sit on a grid,
 * filled row by row, with `gap` units of water between neighbours.
 */
export interface WorldArchipelago {
  readonly columns: number;
  readonly gap: number;
  /**
   * Spare room round each island in its grid slot; each island sits
   * somewhere in its slot, so the grid doesn't look ruled. None when left out.
   */
  readonly wander?: number;
  /** Where the project's name sign stands on each island. */
  readonly sign: WorldSlot;
  /** Where the island's manager stands, who forwards your messages to its agents. */
  readonly manager: WorldSlot;
  /**
   * The water ripples around an island while any character on it matches one
   * of these, e.g. one waiting on your answer. Animates at `fps` only then.
   */
  readonly ripple: {
    readonly when: ReadonlyArray<CharacterFactMatch>;
    readonly fps: number;
  };
  /**
   * Where new agents start: hovering an island marks each free slot of
   * `area` with a start button, drawn at `marker` in the slot's own frame
   * (+z is the way the slot faces), e.g. over a rock pile.
   */
  readonly newAgents: {
    readonly area: string;
    readonly marker: Vec3;
  };
  /**
   * Now and then a whale leaps out of the water near a random island and
   * splashes back in. Frames are drawn at `fps` only while one is up.
   */
  readonly whales: {
    /** Wait between sightings, picked at random in this range. */
    readonly intervalSeconds: readonly [min: number, max: number];
    /** From the dive under the surface to the dive back in. */
    readonly leapSeconds: number;
    /** How far past the island's edge the whale shows up. */
    readonly offshore: readonly [min: number, max: number];
    readonly fps: number;
  };
}

export interface WorldDefinition {
  /**
   * Mixed into the look of every prop, so islands of the same size don't
   * share rock piles, palms and the like. Each project's island has its own.
   */
  readonly seed?: number;
  readonly terrain: ReadonlyArray<TerrainPatch>;
  readonly props: ReadonlyArray<WorldProp>;
  /** Placed in order, so list the biggest first: smaller things fill the gaps. */
  readonly scenery?: ReadonlyArray<SceneryRule>;
  readonly areas: Readonly<Record<string, WorldArea>>;
  readonly roads: WorldRoads;
  /** Checked top to bottom; the first match wins. */
  readonly rules: ReadonlyArray<WorldRule>;
  /** Used when no rule matches or an anchored area has no placed parent. */
  readonly fallback: WorldIntent;
  readonly activities: Readonly<Record<string, WorldActivity>>;
  readonly movement: WorldMovement;
  readonly archipelago: WorldArchipelago;
}
