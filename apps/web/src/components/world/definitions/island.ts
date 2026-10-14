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
 * smallest island's rock piles and spots on the beach. Every size also has
 * the pier's seats (see `PIER_SEATS`).
 */
export const ISLAND_SIZES = [
  { piles: 8, restSpots: 9 },
  { piles: 12, restSpots: 14 },
  { piles: 16, restSpots: 18 },
] as const;

// Seat height of the loungers on the beach (see the `beachChair` prop).
const LOUNGER_SEAT = 0.4;

// The pier runs out from the right end of the beach, square to the camera's
// view, so it crosses the screen sideways and hides no one. Its seats line the
// camera's side, facing it: agents sit on the edge, legs and rods over the water.
const PIER_ANGLE = (-45 * Math.PI) / 180;
const PIER_FACING = Math.PI / 2 - PIER_ANGLE;
const PIER_LENGTH = 7;
/** How far up the sand the pier starts, from the shore. */
const PIER_LANDING = 1;
/** Along the pier from its foot: the first stretch stays on the sand. */
const PIER_SEATS = [2.2, 3.5, 4.8, 6.1];
/**
 * Off the deck's middle toward the camera's side (local -x): the deck is 1.8
 * wide (see the `pier` prop), so a sitter's knees reach just past its edge.
 */
const PIER_SEAT_SIDE = 0.6;
/** The top of the pier's deck. */
const PIER_DECK = 0.02;

/** Lying along the shore rather than across it, so arms spread out don't reach the lawn. */
const alongShore = (slot: WorldSlot): WorldSlot => ({ ...slot, facing: slot.facing + Math.PI / 2 });

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
  const perArea = (count: number) => Math.round(count * scale * scale);
  const dunes = { center: at(2.5, -6), radius: 3 * scale };

  // A point `along` the pier from its foot and `side` units to its right (local +x).
  const shore = 9.5 * scale - PIER_LANDING;
  const onPier = (along: number, side: number): Vec3 => [
    shore * Math.cos(PIER_ANGLE) + along * Math.sin(PIER_FACING) + side * Math.cos(PIER_FACING),
    0,
    shore * Math.sin(PIER_ANGLE) + along * Math.cos(PIER_FACING) - side * Math.sin(PIER_FACING),
  ];
  const pierFoot = onPier(0.5, 0);
  const pierSeats: WorldSlot[] = PIER_SEATS.map((along) => ({
    position: onPier(along, -PIER_SEAT_SIDE),
    // Square to the pier, toward the camera's side.
    facing: PIER_FACING - Math.PI / 2,
    seat: PIER_DECK,
    ledge: true,
    via: pierFoot,
    fishing: true,
  }));

  return {
    terrain: [
      { shape: "disc", kind: "sand", center: [0, 0], radius: 9.5 * scale },
      { shape: "disc", kind: "grass", center: at(-2, 0), radius: 7.2 * scale },
    ],
    props: [
      prop("tree", -7, 4),
      prop("tree", -3.2, -5.8),
      prop("palm", 3.4, -8.2, 0.4),
      prop("palm", 4.6, -7.6, 1.3),
      prop("palm", -0.8, -9, 3.6),
      prop("palm", -2.3, 8.7, 5),
      prop("palm", -8.6, -1.2, 2.9),
      { kind: "pier", position: onPier(0, 0), facing: PIER_FACING, length: PIER_LENGTH },
    ],
    // Pebbles and tufts on the sand, as many per unit of ground at every size.
    scenery: [
      { kind: "rock", on: "sand", count: perArea(4), scale: [0.6, 1.2] },
      { kind: "grass", on: "sand", count: perArea(14), scale: [0.7, 1.1] },
      // A thicker patch on the sand between the lawn and the dunes.
      { kind: "grass", on: "sand", count: perArea(8), scale: [0.7, 1.1], near: dunes },
      { kind: "rock", on: "sand", count: perArea(3), scale: [0.4, 0.7], near: dunes },
    ],
    areas: {
      mine: {
        kind: "fixed",
        entry: "lawn-gate",
        slotProp: "rockPile",
        // Neighbouring piles are about 4 apart at every size; the next ring out is 5.4+.
        worktreeReach: 5.2,
        slots: PILES[sizeIndex]!.map(([x, z]) => site(x * scale, z * scale)),
      },
      beach: {
        kind: "fixed",
        entry: "beach-path",
        slotProp: "towel",
        // Agents who stopped last sit furthest right, so both lists below run
        // left to right on screen (falling angles on the arcs).
        lineUp: true,
        // Towels with a lounger every third spot, spread across the front of the
        // island: where the shore runs away from the camera they would hide each other.
        slots: arc({ radius: 8.2 * scale, degrees: spread(-15, 95, size.restSpots) })
          .map((slot, index) =>
            index % 3 === 1 ? { ...slot, prop: "beachChair" as const, seat: LOUNGER_SEAT } : slot,
          )
          .toReversed(),
        // A row behind the towels, where the shore faces the camera: there, behind
        // also means higher on screen, so the front row hides no one.
        spillover: arc({ radius: 6.5 * scale, degrees: spread(60, 0, 8) }),
      },
      // Agents idle for over a day go fishing: off the pier's edge first, then
      // the far shore, sitting on the sand between the trees and palms.
      pier: {
        kind: "fixed",
        entry: "beach-path",
        slots: pierSeats,
        spillover: arc({
          radius: 8.9 * scale,
          degrees: [118, 132, 162, 174, 202, 215, 242, 254],
        }).map((slot) => ({ ...slot, fishing: true })),
      },
      // The wide sand behind the beach, between the palms and the lawn, clear of
      // the walk out to the pier.
      dunes: {
        kind: "fixed",
        entry: "dunes-path",
        slots: arc({ radius: 7.9 * scale, degrees: spread(-105, -62, 4) }).map(alongShore),
        spillover: [
          ...arc({ radius: 6.4 * scale, degrees: [-35, -50] }),
          ...arc({ radius: 8.75 * scale, degrees: [-120] }),
        ].map(alongShore),
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
        "dunes-path": node(2.4, -5.4),
      },
      edges: [
        ["lawn-gate", "plaza"],
        ["plaza", "beach-path"],
        ["plaza", "dunes-path"],
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
      // A long command still running in the background: at the pile, arms crossed, waiting it out.
      { when: { status: "waiting", backgroundTask: true }, go: "mine", do: "wait" },
      // No new output for a while: keep swinging, slowly.
      { when: { status: "working", quiet: true }, go: "mine", do: "ponder" },
      { when: { status: "working" }, go: "mine", do: "mine" },
      // Out of quota: flat out on the sand until the limit resets.
      { when: { status: "limited" }, go: "dunes", do: "dead" },
      { when: { status: "failed" }, go: "dunes", do: "stranded", effect: "cloud" },
      // Waiting is a finished turn whose session stays open: done, as far as the world goes.
      // Resting winds down as the last reply ages, in the steps its tag's colour takes:
      // celebrating, then sitting, then lying down, and after a day, off fishing.
      {
        when: { status: ["ready", "waiting"], repliedWithin: 5 * 60 },
        go: "beach",
        do: "celebrate",
      },
      { when: { status: ["ready", "waiting"], repliedWithin: 60 * 60 }, go: "beach", do: "sit" },
      {
        when: { status: ["ready", "waiting"], repliedWithin: 24 * 60 * 60 },
        go: "beach",
        do: "sleep",
      },
      { when: { status: ["ready", "waiting"] }, go: "pier", do: "fish" },
    ],
    fallback: { go: "beach", do: "sleep" },
    activities: {
      mine: { pose: "mine", ambientFps: 12 },
      // A slow swing, so it needs frames, but fewer than full-speed mining.
      ponder: { pose: "ponder", ambientFps: 8 },
      idle: { pose: "stand" },
      wait: { pose: "crossArms" },
      celebrate: { pose: "wave", ambientFps: 12 },
      sit: { pose: "slump" },
      sleep: { pose: "lie" },
      // Sits on the sand off the pier; the spot hands over the rod. Frames for
      // the swinging legs and the glances around.
      fish: { pose: "slump", ambientFps: 10 },
      stranded: { pose: "slump" },
      dead: { pose: "dead" },
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
