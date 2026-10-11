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
}

export type PropKind =
  | "towel"
  | "beachChair"
  | "umbrella"
  | "palm"
  | "tree"
  | "pier"
  | "raft"
  | "rope"
  | "rockPile";

export interface WorldProp {
  readonly kind: PropKind;
  readonly position: Vec3;
  readonly facing: number;
  /** Stretches the prop along its facing, e.g. a rope's length. */
  readonly length?: number;
}

/** Fixed slots in the world, entered through one road node. */
export interface FixedArea {
  readonly kind: "fixed";
  readonly entry: string;
  readonly slots: ReadonlyArray<WorldSlot>;
  /** Placed at every slot, e.g. a rock pile per mining site. */
  readonly slotProp?: PropKind;
  /**
   * Extra spots without a prop, filled in order once every slot is taken and
   * before anyone queues at the entry, e.g. lying on the sand past the towels.
   */
  readonly spillover?: ReadonlyArray<WorldSlot>;
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
  /** A background task, such as a long command, is still running. */
  readonly backgroundTask?: boolean;
  /** The thread has produced nothing new for `movement.quietSeconds`. */
  readonly quiet?: boolean;
  /** Night has fallen on the character's island; see `archipelago.night`. */
  readonly night?: boolean;
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
export type Pose = "stand" | "lie" | "sleep" | "wave" | "slump" | "fish" | "mine" | "ponder";

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
  /** Where the project's name sign stands on each island. */
  readonly sign: WorldSlot;
  /**
   * The water ripples around an island while any character on it matches one
   * of these, e.g. one that needs you or has news. Animates at `fps` only then.
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
   * An island falls asleep once every character on it has matched `when`
   * for `afterMinutes`, counted from the most recent `restingSince` there:
   * it turns dark, a campfire lights at `campfire`, and its characters get
   * `night: true` so rules can send them to bed.
   */
  readonly night: {
    readonly when: CharacterFactMatch;
    readonly afterMinutes: number;
    readonly campfire: readonly [x: number, z: number];
  };
  /**
   * Now and then a shark fin surfaces in the water near a random island,
   * swims a little and dives. Frames are drawn at `fps` only while one is up.
   */
  readonly sharks: {
    /** Wait between sightings, picked at random in this range. */
    readonly intervalSeconds: readonly [min: number, max: number];
    readonly surfaceSeconds: number;
    /** How far past the island's edge the fin shows up. */
    readonly offshore: readonly [min: number, max: number];
    readonly fps: number;
  };
}

export interface WorldDefinition {
  readonly terrain: ReadonlyArray<TerrainPatch>;
  readonly props: ReadonlyArray<WorldProp>;
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
