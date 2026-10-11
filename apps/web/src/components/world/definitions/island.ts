import type { WorldDefinition, WorldProp, WorldSlot } from "../definition/types";

// Coordinates: x to the right, z toward the camera, y up. A facing of 0 looks
// toward +z; PI / 2 looks toward +x.

const prop = (kind: WorldProp["kind"], x: number, z: number, facing = 0): WorldProp => ({
  kind,
  position: [x, 0, z],
  facing,
});

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

// At night everyone sleeps in a ring around the campfire, feet to the fire.
// Back from the beach so the umbrellas never stand between it and the camera.
const CAMPFIRE: readonly [number, number] = [3, -1.2];
const ring = (radius: number, count: number): WorldSlot[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + (radius > 2 ? Math.PI / count : 0);
    const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
    return {
      position: [CAMPFIRE[0] + dx * radius, 0, CAMPFIRE[1] + dz * radius] as const,
      facing: Math.atan2(-dx, -dz),
    };
  });

// Seat height of the loungers on the beach (see the `beachChair` prop).
const LOUNGER_SEAT = 0.4;

// The raft floats off the front-left shore, tied to the lawn's front tree.
const RAFT: readonly [number, number] = [-8.4, 8.4];
const RAFT_TREE: readonly [number, number] = [-7, 4];
const RAFT_FACING_SHORE = Math.atan2(1, -1);

// A round sand island with a round lawn pushed toward the mining side, which
// leaves a crescent of beach facing the camera.
export const islandWorld: WorldDefinition = {
  terrain: [
    { shape: "disc", kind: "sand", center: [0, 0], radius: 9.5 },
    { shape: "disc", kind: "grass", center: [-2, 0], radius: 7.2 },
  ],
  props: [
    prop("tree", -7.4, -3.4),
    prop("tree", RAFT_TREE[0], RAFT_TREE[1]),
    prop("tree", -3.2, -5.8),
    prop("tree", -1.2, 5.6),
    prop("palm", 3.4, -8.2, 0.4),
    prop("palm", 3.6, 8, 2.2),
    prop("palm", 4.6, -7.6, 1.3),
    prop("palm", -0.8, -9, 3.6),
    prop("palm", -2.3, 8.7, 5),
    prop("palm", -4.4, 7.7, 2.9),
    ...arc({ radius: 6.6, degrees: [-40, 40] }).map((slot) => ({
      kind: "umbrella" as const,
      position: slot.position,
      facing: 0,
    })),
    { kind: "pier", position: [0, 0, 8.4], facing: 0, length: 4.8 },
    { kind: "raft", position: [RAFT[0], -0.2, RAFT[1]], facing: Math.PI / 4 },
    rope([RAFT[0] + 0.33, RAFT[1] - 1.05], [RAFT_TREE[0] - 0.1, RAFT_TREE[1] + 0.3]),
  ],
  areas: {
    mine: {
      kind: "fixed",
      entry: "lawn-gate",
      slotProp: "rockPile",
      slots: [
        site(-5.8, -2.8),
        site(-2.8, -3),
        site(-6.6, 0.4),
        site(-3.8, 0.2),
        site(-0.6, -1.6),
        site(-4.6, 3.4),
      ],
    },
    pier: {
      kind: "fixed",
      entry: "pier-head",
      slots: [-0.35, 0.35].map((x) => ({
        position: [x, 0, 12.6] as const,
        facing: 0,
      })),
    },
    beach: {
      kind: "fixed",
      entry: "beach-path",
      slotProp: "towel",
      // Towels with a lounger every third spot, two of them in an umbrella's shade.
      slots: arc({ radius: 7.6, degrees: [-54, -40, -26, -13, 0, 13, 26, 40, 54] }).map(
        (slot, index) =>
          index % 3 === 1 ? { ...slot, prop: "beachChair" as const, seat: LOUNGER_SEAT } : slot,
      ),
      // A row on the sand behind the towels and loungers.
      spillover: arc({ radius: 5.8, degrees: [-55, -40, -25, -10, 10, 25, 40, 55] }),
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
        position: [RAFT[0] + dx!, -0.05, RAFT[1] + dz!] as const,
        facing: RAFT_FACING_SHORE,
      })),
    },
    camp: {
      kind: "fixed",
      entry: "plaza",
      slots: ring(1.9, 8),
      spillover: ring(3.1, 12),
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
      "lawn-gate": [-1.4, 0, 0.6],
      plaza: [1, 0, 0.6],
      "beach-path": [5.4, 0, 0.6],
      "pier-head": [0, 0, 8.2],
      "lawn-south": [-2, 0, 5],
      "raft-landing": [-6.2, 0, 6.2],
    },
    edges: [
      ["lawn-gate", "plaza"],
      ["plaza", "beach-path"],
      ["plaza", "pier-head"],
      ["lawn-gate", "lawn-south"],
      ["lawn-south", "raft-landing"],
    ],
  },
  rules: [
    { when: { night: true }, go: "camp", do: "sleepByFire" },
    { when: { kid: true, status: "approval" }, go: "helpers", do: "idle", balloon: "approval" },
    { when: { kid: true, status: "input" }, go: "helpers", do: "idle", balloon: "question" },
    { when: { kid: true, status: "working", quiet: true }, go: "helpers", do: "ponder" },
    { when: { kid: true, status: "working" }, go: "helpers", do: "mine" },
    { when: { kid: true, status: "waiting" }, go: "helpers", do: "idle" },
    { when: { status: "approval" }, go: "mine", do: "idle", balloon: "approval" },
    { when: { status: "input" }, go: "mine", do: "idle", balloon: "question" },
    // A long command running in the background: fishing off the pier until it bites.
    { when: { status: "working", backgroundTask: true }, go: "pier", do: "fish" },
    // No new output for a while: lean on the pickaxe and think.
    { when: { status: "working", quiet: true }, go: "mine", do: "ponder" },
    { when: { status: "working" }, go: "mine", do: "mine" },
    { when: { status: "waiting" }, go: "mine", do: "idle" },
    { when: { status: ["failed", "limited"] }, go: "raft", do: "stranded", effect: "cloud" },
    { when: { status: "ready", unread: true }, go: "beach", do: "wave" },
    { when: { status: "ready" }, go: "beach", do: "sleep" },
  ],
  fallback: { go: "beach", do: "sleep" },
  activities: {
    mine: { pose: "mine", ambientFps: 12 },
    ponder: { pose: "ponder" },
    fish: { pose: "fish" },
    idle: { pose: "stand" },
    wave: { pose: "wave", ambientFps: 12 },
    sleep: { pose: "lie" },
    sleepByFire: { pose: "sleep" },
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
    columns: 2,
    gap: 6,
    // Turned a little off the camera so the board's depth shows.
    sign: { position: [-5.4, 0, -6.4], facing: Math.PI / 4 - 0.35 },
    ripple: {
      when: [{ status: ["approval", "input"] }, { status: "ready", unread: true }],
      fps: 20,
    },
    // Over the rock pile in front of each mining spot.
    newAgents: { area: "mine", marker: [0, 1.3, PILE_DISTANCE] },
    // Done, read, and nothing new for an hour: lights out on that island.
    night: { when: { status: "ready", unread: false }, afterMinutes: 60, campfire: CAMPFIRE },
    sharks: { intervalSeconds: [20, 45], surfaceSeconds: 4, offshore: [1.5, 4], fps: 24 },
  },
};
