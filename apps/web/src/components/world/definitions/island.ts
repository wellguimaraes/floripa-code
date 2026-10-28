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
// Bigger islands have bigger piles, `pileScale` times the usual size, and
// everyone working one stands back by as much.
const PILE_DISTANCE = 0.95;
const FACE_CAMERA = Math.PI / 4;
const site = (pileX: number, pileZ: number, pileScale: number): WorldSlot => ({
  position: [
    pileX - Math.sin(FACE_CAMERA) * PILE_DISTANCE * pileScale,
    0,
    pileZ - Math.cos(FACE_CAMERA) * PILE_DISTANCE * pileScale,
  ],
  facing: FACE_CAMERA,
});

// Rock piles on the lawn, one layout per island size (see `ISLAND_SIZES`),
// laid out on the smallest lawn with neighbours about 4 apart; bigger sizes
// scale them up with the island, so they spread out as it grows. A pile keeps
// its index (and its miner) through every size, so each layout lists first
// the piles nearest the smaller size's ones.
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
 * smallest island's rock piles, and the beach has a spot per pile. Every size
 * also has the pier's seats (see `PIER_SEATS`).
 */
export const ISLAND_SIZES = [8, 12, 16].map((piles) => ({ piles, restSpots: piles }));

// Seat height of the loungers on the beach (see the `beachChair` prop).
const LOUNGER_SEAT = 0.4;

// The pier curves along the shore at the left end of the beach, from just up
// the sand out over the shallows. Its seats line the outer edge, facing the
// sea: agents sit on the edge, legs and rods over the water.
const PIER_ANGLE = (91 * Math.PI) / 180;
/** How far up the sand the pier starts, from the shore. */
const PIER_LANDING = 1;
/**
 * How far round the shore the pier reaches either side of `PIER_ANGLE`, in
 * degrees: up to the palm on its left, and short of the beach's last towel
 * on its right.
 */
const PIER_RIGHT = 19;
const PIER_LEFT = 9;
/** Round the shore, in degrees, inside the pier's reach. */
const PIER_SEATS = [96, 89, 82, 75];
/** How far the pier's deck reaches out from the sand onto the water. */
const PIER_WIDTH = 2.4;
/** Out from the pier's inner edge, so a sitter's knees reach just past its outer edge. */
const PIER_SEAT_OUT = PIER_WIDTH - 0.3;
/** The top of the pier's deck. */
const PIER_DECK = 0.02;

/** Lying along the shore rather than across it, so arms spread out don't reach the lawn. */
const alongShore = (slot: WorldSlot): WorldSlot => ({ ...slot, facing: slot.facing + Math.PI / 2 });

/**
 * A round sand island with a round lawn pushed toward the mining side, which
 * leaves a crescent of beach facing the camera. Bigger sizes stretch the
 * whole island just enough to keep the beach's spots as far apart as on the
 * smallest one, and the rock piles spread out with it (see `PILES`).
 */
function island(size: (typeof ISLAND_SIZES)[number], sizeIndex: number): WorldDefinition {
  const smallest = ISLAND_SIZES[0]!;
  const scale = (size.restSpots - 1) / (smallest.restSpots - 1);
  // How much further apart neighbouring piles stand than the layouts' 4.
  const pileSpread = scale / Math.sqrt(size.piles / smallest.piles);
  const at = (x: number, z: number): readonly [number, number] => [x * scale, z * scale];
  const prop = (kind: WorldProp["kind"], x: number, z: number, facing = 0): WorldProp => ({
    kind,
    position: [x * scale, 0, z * scale],
    facing,
  });
  const node = (x: number, z: number): Vec3 => [x * scale, 0, z * scale];
  const perArea = (count: number) => Math.round(count * scale * scale);
  const dunes = { center: at(1.5, -6.8), radius: 3 * scale };

  // The pier's inner edge, round the island's middle.
  const pierRadius = 9.5 * scale - PIER_LANDING;
  const pierSeats: WorldSlot[] = PIER_SEATS.map((degrees) => {
    const angle = (degrees * Math.PI) / 180;
    const out = pierRadius + PIER_SEAT_OUT;
    return {
      position: [out * Math.cos(angle), 0, out * Math.sin(angle)],
      facing: Math.PI / 2 - angle,
      seat: PIER_DECK,
      ledge: true,
      fishing: true,
    };
  });

  return {
    terrain: [
      { shape: "disc", kind: "sand", center: [0, 0], radius: 9.5 * scale },
      { shape: "disc", kind: "grass", center: at(-2, 0), radius: 7.2 * scale },
    ],
    props: [
      prop("sibipiruna", -3.2, -5.8),
      // The lawn's far-left edge, behind the miners, where it hides no one.
      prop("tree", -7.5, -4.4),
      prop("palm", 3.4, -8.2, 0.4),
      prop("palm", 4.6, -7.6, 1.3),
      prop("palm", -0.8, -9, 3.6),
      prop("palm", -2.3, 8.7, 5),
      // Big rocks at the waterline round the far-left shore.
      ...[153, 168, 183].map((degrees, index) =>
        prop(
          "boulder",
          9.6 * Math.cos((degrees * Math.PI) / 180),
          9.6 * Math.sin((degrees * Math.PI) / 180),
          index * 2.1,
        ),
      ),
      {
        kind: "pier",
        position: [pierRadius * Math.cos(PIER_ANGLE), 0, pierRadius * Math.sin(PIER_ANGLE)],
        facing: Math.PI / 2 - PIER_ANGLE,
        arc: {
          radius: pierRadius,
          left: (pierRadius * PIER_LEFT * Math.PI) / 180,
          right: (pierRadius * PIER_RIGHT * Math.PI) / 180,
          width: PIER_WIDTH,
        },
      },
      // Street lamps for the night, clear of every spot, road, and walk at every
      // size: by the pier, off its deck, and round the shore, off the lawn.
      prop("lamp", 1.9, 7.7),
      prop("lamp", -6.6, 5.4),
      prop("lamp", -8.7, -2.2),
      prop("lamp", -1.6, -6.6),
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
        // Reaches neighbouring piles (about 4 apart, spread out) but not the
        // next ring out (5.4+).
        worktreeReach: 5.2 * pileSpread,
        // Piles grow with the gaps between them.
        slotPropScale: pileSpread,
        slots: PILES[sizeIndex]!.map(([x, z]) => site(x * scale, z * scale, pileSpread)),
      },
      beach: {
        kind: "fixed",
        entry: "beach-path",
        slotProp: "towel",
        // Agents who stopped last sit furthest right, so both lists below run
        // left to right on screen (falling angles on the arcs).
        lineUp: true,
        // Towels with a lounger every third spot, spread across the front of the
        // island from the pier to the manager: where the shore runs further away
        // from the camera they would hide each other.
        slots: arc({ radius: 8.2 * scale, degrees: spread(-35, 61, size.restSpots) })
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
      // The wide sand behind the beach, between the palms and the lawn.
      dunes: {
        kind: "fixed",
        entry: "dunes-path",
        // Clear of the manager, who stands at -55 degrees.
        slots: arc({ radius: 7.9 * scale, degrees: spread(-118, -80, 4) }).map(alongShore),
        spillover: [
          ...arc({ radius: 6.4 * scale, degrees: [-35, -75] }),
          ...arc({ radius: 8.75 * scale, degrees: [-120] }),
        ].map(alongShore),
      },
      // Around the parent's pile: its left, its right, then the near side.
      helpers: {
        kind: "anchored",
        anchor: "parent",
        offsets: [
          { position: [-0.9 * pileSpread, 0, PILE_DISTANCE * pileSpread], facing: Math.PI / 2 },
          { position: [0.9 * pileSpread, 0, PILE_DISTANCE * pileSpread], facing: -Math.PI / 2 },
          { position: [0, 0, PILE_DISTANCE * 2 * pileSpread], facing: Math.PI },
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
      // A finished kid walks back to work with its parent and stands by, without digging.
      { when: { kid: true, parentBusy: true }, go: "helpers", do: "idle" },
      { when: { status: "approval" }, go: "mine", do: "idle", balloon: "approval" },
      { when: { status: "input" }, go: "mine", do: "idle", balloon: "question" },
      // The run ended but a subagent it started is still at it: dig alongside it.
      { when: { status: "waiting", hasWorkingKids: true }, go: "mine", do: "mine" },
      // A long command still running in the background, such as a dev server, even after the
      // agent is done: sitting up at the pile, waiting it out.
      { when: { status: ["ready", "waiting"], backgroundTask: true }, go: "mine", do: "wait" },
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
      wait: { pose: "sitUp" },
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
      gap: 8,
      // Islands drift about their slots, so the column doesn't look ruled.
      wander: 3,
      // Turned a little off the camera so the board's depth shows.
      sign: { position: node(-5.4, -6.4), facing: Math.PI / 4 - 0.35 },
      // On the sand between the beach's right end and the back palms, watching
      // the miners, turned enough toward the camera to show his face.
      manager: {
        position: node(7 * Math.cos((-55 * Math.PI) / 180), 7 * Math.sin((-55 * Math.PI) / 180)),
        facing: -0.45,
      },
      ripple: {
        when: [{ status: ["approval", "input"] }],
        fps: 20,
      },
      // Over the rock pile in front of each mining spot.
      newAgents: { area: "mine", marker: [0, 1.3 * pileSpread, PILE_DISTANCE * pileSpread] },
      whales: { intervalSeconds: [20, 45], leapSeconds: 3, offshore: [2.5, 5], fps: 30 },
    },
  };
}

/** The island at every size in `ISLAND_SIZES`, smallest first. */
export const islandWorlds: ReadonlyArray<WorldDefinition> = ISLAND_SIZES.map(island);
