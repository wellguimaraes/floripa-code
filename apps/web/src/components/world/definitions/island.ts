import type { Vec3, WorldDefinition, WorldProp, WorldSlot } from "../definition/types";

// Coordinates: x to the right, z toward the camera, y up. A facing of 0 looks
// toward +z; PI / 2 looks toward +x.

/** Spots on an arc around the island's centre, each facing out to sea. */
const arc = (input: {
  readonly radius: number;
  readonly degrees: ReadonlyArray<number>;
}): WorldSlot[] =>
  input.degrees.map((degree) => {
    const angle = (degree * Math.PI) / 180;
    return {
      position: [input.radius * Math.cos(angle), 0, input.radius * Math.sin(angle)] as const,
      // Facing f looks toward (sin f, cos f); this points away from the centre.
      facing: Math.PI / 2 - angle,
    };
  });

/** `count` evenly spaced angles from `from` to `to` degrees. */
const spread = (from: number, to: number, count: number): number[] =>
  Array.from({ length: count }, (_, index) => from + ((to - from) * index) / (count - 1));

/** A rope lying from `from` to `to`, e.g. tying the raft to a tree. */
const rope = (from: readonly [number, number], to: readonly [number, number]): WorldProp => ({
  kind: "rope",
  position: [from[0], 0.08, from[1]],
  facing: Math.atan2(to[0] - from[0], to[1] - from[1]),
  length: Math.hypot(to[0] - from[0], to[1] - from[1]),
});

// Mining sites on the lawn, one family per site. The parent stands behind its
// rock pile facing the camera (+x/+z) so its face shows; its kids work the
// same pile from the sides and front (see the `helpers` offsets).
const PILE_DISTANCE = 0.95;
const FACE_CAMERA = Math.PI / 4;
const site = (pileX: number, pileZ: number): WorldSlot => ({
  position: [
    pileX - Math.sin(FACE_CAMERA) * PILE_DISTANCE,
    0,
    pileZ - Math.cos(FACE_CAMERA) * PILE_DISTANCE,
  ],
  facing: FACE_CAMERA,
});

// Rock piles on the lawn, one layout per island size (see `ISLAND_SIZES`),
// each spread evenly over that size's lawn. Bigger sizes scale these up with
// the island. A pile keeps its index (and its miner) through every size, so
// each layout lists first the piles nearest the smaller size's ones.
const PILES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [-5.8, -2.8],
    [-2.4, -3.5],
    [-6.6, 0.4],
    [-1.6, 1.2],
    [0.8, 4.1],
    [-4.6, 3.4],
    // The lawn's open right side, toward the beach.
    [1, -4.7],
    [3.3, 0.3],
  ],
  [
    [-4.7, -3.9],
    [-0.8, -1.8],
    [-7.4, 0.3],
    [-0.8, 1.5],
    [-0.5, 5.1],
    [-4.3, 2.1],
    [-0.3, -5],
    [3.1, 0.1],
    [-4.2, -1],
    [2.3, 3.3],
    [-3.8, 5.1],
    [2.4, -3],
  ],
  [
    [-5.1, -4.3],
    [0.2, -1.8],
    [-7.6, 0.3],
    [0.6, 1.1],
    [-1.3, 5.6],
    [-4.9, 1.9],
    [-0.3, -5.2],
    [3.4, -0.9],
    [-5.2, -1.3],
    [1.3, 4.3],
    [-4.2, 5],
    [2.3, -3.7],
    [-1.8, 2.9],
    [-2.4, 0],
    [3.3, 2],
    [-2.5, -2.9],
  ],
];

/**
 * What each island size holds, smallest first: every step up adds half the
 * smallest island's rock piles and spots on the beach.
 */
export const ISLAND_SIZES = [
  { piles: 8, restSpots: 9 },
  { piles: 12, restSpots: 14 },
  { piles: 16, restSpots: 18 },
] as const;

// Seat height of the loungers on the beach (see the `beachChair` prop).
const LOUNGER_SEAT = 0.4;

const RAFT_FACING_SHORE = Math.atan2(1, -1);
const RAFT_FACING = Math.PI / 4;
/** The point on a tree trunk's bark facing `from`. */
const towardTrunk = (
  tree: readonly [number, number],
  from: readonly [number, number],
): readonly [number, number] => {
  const distance = Math.hypot(from[0] - tree[0], from[1] - tree[1]);
  const bark = 0.12 / distance;
  return [tree[0] + (from[0] - tree[0]) * bark, tree[1] + (from[1] - tree[1]) * bark];
};

/**
 * A round sand island with a round lawn pushed toward the mining side, which
 * leaves a crescent of beach facing the camera. Bigger sizes stretch the
 * whole island, keeping the lawn's ground per rock pile about the same.
 */
function island(size: (typeof ISLAND_SIZES)[number], sizeIndex: number): WorldDefinition {
  const scale = Math.sqrt(size.piles / ISLAND_SIZES[0].piles);
  const at = (x: number, z: number): readonly [number, number] => [x * scale, z * scale];
  const prop = (kind: WorldProp["kind"], x: number, z: number, facing = 0): WorldProp => ({
    kind,
    position: [x * scale, 0, z * scale],
    facing,
  });
  const node = (x: number, z: number): Vec3 => [x * scale, 0, z * scale];

  // The raft floats off the front-left shore, tied to the lawn's front tree.
  const raft = at(-8.4, 8.4);
  const raftTree = at(-7, 4);
  /** The end of the raft's shoreward crossbar (see the raft prop), where the rope is tied. */
  const raftCleat: readonly [number, number] = [
    raft[0] + 0.75 * Math.cos(RAFT_FACING) - Math.sin(RAFT_FACING),
    raft[1] - 0.75 * Math.sin(RAFT_FACING) - Math.cos(RAFT_FACING),
  ];

  return {
    terrain: [
      { shape: "disc", kind: "sand", center: [0, 0], radius: 9.5 * scale },
      { shape: "disc", kind: "grass", center: at(-2, 0), radius: 7.2 * scale },
    ],
    props: [
      prop("tree", -7, 4),
      prop("tree", -3.2, -5.8),
      prop("palm", 3.4, -8.2, 0.4),
      // Off the right end of the beach: in front of the towels its crown hid them.
      prop("palm", 6.6, -6.2, 2.2),
      prop("palm", 4.6, -7.6, 1.3),
      prop("palm", -0.8, -9, 3.6),
      prop("palm", -2.3, 8.7, 5),
      // Up the left shore, clear of the line from the raft to its tree.
      prop("palm", -8.6, -1.2, 2.9),
      // Beside the beach spots, never in front of one: a canopy hides whoever is under it.
      ...[
        ...arc({ radius: 7.6 * scale, degrees: [-30] }),
        ...arc({ radius: 7.2 * scale, degrees: [88] }),
      ].map((slot) => ({ kind: "umbrella" as const, position: slot.position, facing: 0 })),
      { kind: "raft", position: [raft[0], -0.2, raft[1]], facing: RAFT_FACING },
      rope(raftCleat, towardTrunk(raftTree, raftCleat)),
    ],
    areas: {
      mine: {
        kind: "fixed",
        entry: "lawn-gate",
        slotProp: "rockPile",
        slots: PILES[sizeIndex]!.map(([x, z]) => site(x * scale, z * scale)),
      },
      beach: {
        kind: "fixed",
        entry: "beach-path",
        slotProp: "towel",
        // Towels with a lounger every third spot, spread across the front of the
        // island: where the shore runs away from the camera they would hide each other.
        slots: arc({ radius: 8.2 * scale, degrees: spread(-15, 95, size.restSpots) }).map(
          (slot, index) =>
            index % 3 === 1 ? { ...slot, prop: "beachChair" as const, seat: LOUNGER_SEAT } : slot,
        ),
        // A row behind the towels, where the shore faces the camera: there, behind
        // also means higher on screen, so the front row hides no one.
        spillover: arc({ radius: 6.5 * scale, degrees: spread(0, 60, 8) }),
      },
      raft: {
        kind: "fixed",
        entry: "raft-landing",
        slots: [
          [-0.5, -0.5],
          [0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
        ].map(([dx, dz]) => ({
          position: [raft[0] + dx!, -0.05, raft[1] + dz!] as const,
          facing: RAFT_FACING_SHORE,
        })),
      },
      // Around the parent's pile: its left, its right, then the near side.
      helpers: {
        kind: "anchored",
        anchor: "parent",
        offsets: [
          { position: [-0.9, 0, PILE_DISTANCE], facing: Math.PI / 2 },
          { position: [0.9, 0, PILE_DISTANCE], facing: -Math.PI / 2 },
          { position: [0, 0, PILE_DISTANCE * 2], facing: Math.PI },
        ],
      },
    },
    roads: {
      nodes: {
        "lawn-gate": node(-1.4, 0.6),
        plaza: node(1, 0.6),
        "beach-path": node(5.4, 0.6),
        "lawn-south": node(-2, 5),
        "raft-landing": node(-6.2, 6.2),
      },
      edges: [
        ["lawn-gate", "plaza"],
        ["plaza", "beach-path"],
        ["lawn-gate", "lawn-south"],
        ["lawn-south", "raft-landing"],
      ],
    },
    rules: [
      { when: { kid: true, status: "approval" }, go: "helpers", do: "idle", balloon: "approval" },
      { when: { kid: true, status: "input" }, go: "helpers", do: "idle", balloon: "question" },
      { when: { kid: true, status: "working", quiet: true }, go: "helpers", do: "ponder" },
      { when: { kid: true, status: "working" }, go: "helpers", do: "mine" },
      { when: { kid: true, status: "waiting" }, go: "helpers", do: "idle" },
      { when: { status: "approval" }, go: "mine", do: "idle", balloon: "approval" },
      { when: { status: "input" }, go: "mine", do: "idle", balloon: "question" },
      // The run ended but a subagent it started is still at it: dig alongside it.
      { when: { status: "waiting", hasWorkingKids: true }, go: "mine", do: "mine" },
      // A long command still running in the background: keep digging.
      { when: { status: "waiting", backgroundTask: true }, go: "mine", do: "mine" },
      // No new output for a while: keep swinging, slowly.
      { when: { status: "working", quiet: true }, go: "mine", do: "ponder" },
      { when: { status: "working" }, go: "mine", do: "mine" },
      { when: { status: ["failed", "limited"] }, go: "raft", do: "stranded", effect: "cloud" },
      // Waiting is a finished turn whose session stays open: done, as far as the world goes.
      { when: { status: ["ready", "waiting"], unread: true }, go: "beach", do: "wave" },
      { when: { status: ["ready", "waiting"] }, go: "beach", do: "sleep" },
    ],
    fallback: { go: "beach", do: "sleep" },
    activities: {
      mine: { pose: "mine", ambientFps: 12 },
      // A slow swing, so it needs frames, but fewer than full-speed mining.
      ponder: { pose: "ponder", ambientFps: 8 },
      idle: { pose: "stand" },
      wave: { pose: "wave", ambientFps: 12 },
      sleep: { pose: "lie" },
      stranded: { pose: "slump" },
    },
    movement: {
      walkSpeed: 3,
      walkFps: 30,
      beatSeconds: 3,
      quietSeconds: 45,
      kidSpeedScale: 1.25,
      characterScale: 1.2,
      kidScale: 0.6,
    },
    // The camera looks from +x/+z: the sign stands on the far edge behind the
    // mining sites, facing it, so it never hides anyone.
    archipelago: {
      // One island per row: a single column running down the screen.
      columns: 1,
      // The camera tilt squashes rows on screen; this keeps each sign clear of the beach above.
      gap: 11,
      // Turned a little off the camera so the board's depth shows.
      sign: { position: node(-5.4, -6.4), facing: Math.PI / 4 - 0.35 },
      ripple: {
        when: [{ status: ["approval", "input"] }],
        fps: 20,
      },
      // Over the rock pile in front of each mining spot.
      newAgents: { area: "mine", marker: [0, 1.3, PILE_DISTANCE] },
      sharks: { intervalSeconds: [20, 45], surfaceSeconds: 4, offshore: [1.5, 4], fps: 24 },
    },
  };
}

/** The island at every size in `ISLAND_SIZES`, smallest first. */
export const islandWorlds: ReadonlyArray<WorldDefinition> = ISLAND_SIZES.map(island);
