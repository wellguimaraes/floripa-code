import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { FixedArea, WorldDefinition } from "../definition/types";
import { validateWorldDefinition } from "../definition/validate";
import { ISLAND_SIZES, islandWorlds } from "../definitions/island";
import {
  EMPTY_ARCHIPELAGO_MEMORY,
  islandOffsets,
  islandRadius,
  resolveArchipelago,
  arrangementColumns,
  type IslandArrangement,
  suggestHue,
} from "./archipelago";
import { EMPTY_BEAT_GATE, gateBeats, type BeatGate } from "./beats";
import type { CharacterFacts } from "./facts";
import { planRoute } from "./route";
import { resolveIntent } from "./rules";
import type { Placement } from "./slots";
import { resolveWorld } from "./world";

const testWorld: WorldDefinition = {
  terrain: [{ shape: "box", kind: "grass", center: [5, 0], size: [10, 6] }],
  props: [],
  areas: {
    desks: {
      kind: "fixed",
      entry: "a",
      slots: [0, 1, 2].map((x) => ({ position: [x, 0, 0] as const, facing: 0 })),
    },
    beach: { kind: "fixed", entry: "c", slots: [{ position: [10, 0, 10], facing: 0 }] },
    kidDesks: {
      kind: "anchored",
      anchor: "parent",
      offsets: [{ position: [0, 0, 1], facing: 0 }],
    },
  },
  roads: {
    nodes: { a: [0, 0, 5], b: [5, 0, 5], c: [10, 0, 5], shortcut: [5, 0, 50] },
    edges: [
      ["a", "b"],
      ["b", "c"],
      ["a", "shortcut"],
      ["shortcut", "c"],
    ],
  },
  rules: [
    { when: { kid: true, status: "working" }, go: "kidDesks", do: "type" },
    { when: { status: ["working", "approval"] }, go: "desks", do: "type" },
    { when: { status: "ready", unread: true }, go: "beach", do: "wave" },
  ],
  fallback: { go: "beach", do: "sleep" },
  activities: { type: { pose: "mine" }, wave: { pose: "wave" }, sleep: { pose: "lie" } },
  movement: {
    walkSpeed: 1,
    walkFps: 30,
    beatSeconds: 8,
    quietSeconds: 45,
    kidSpeedScale: 1,
    characterScale: 1,
    kidScale: 0.5,
  },
  archipelago: {
    columns: 2,
    gap: 2,
    sign: { position: [0, 0, 0], facing: 0 },
    ripple: { when: [{ status: "approval" }], fps: 20 },
    newAgents: { area: "desks", marker: [0, 1, 0] },
    sharks: { intervalSeconds: [20, 45], surfaceSeconds: 4, offshore: [1, 2], fps: 24 },
  },
};

let counter = 0;
const character = (overrides: Partial<CharacterFacts> = {}): CharacterFacts => {
  counter += 1;
  const key = overrides.key ?? `env:thread-${counter}`;
  return {
    key,
    ref: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make(key) },
    title: key,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, "0")}.000Z`,
    lastReplyAt: "2026-01-01T00:00:00.000Z",
    status: "working",
    unread: false,
    kid: false,
    parentKey: null,
    hasWorkingKids: false,
    backgroundTask: false,
    beat: 0,
    quiet: false,
    provider: "codex",
    lookSeed: key,
    projectKey: "env:project",
    worktreePath: null,
    ...overrides,
  };
};

const resolve = (facts: CharacterFacts[], previous = new Map<string, Placement>()) =>
  new Map(resolveWorld({ facts, definition: testWorld, previous }).map((c) => [c.facts.key, c]));

describe("resolveIntent", () => {
  it("takes the first matching rule, matching lists and every listed fact", () => {
    expect(resolveIntent(character({ status: "approval" }), testWorld)).toEqual({
      go: "desks",
      do: "type",
    });
    expect(resolveIntent(character({ status: "ready", unread: true }), testWorld).do).toBe("wave");
    expect(resolveIntent(character({ status: "ready", unread: false }), testWorld)).toEqual(
      testWorld.fallback,
    );
  });
});

describe("resolveWorld", () => {
  it("keeps everyone's slot when a character leaves the area", () => {
    const people = [character(), character(), character()];
    const before = resolve(people);
    const previous = new Map([...before].map(([key, c]) => [key, c.placement]));

    const after = resolve(people.slice(1), previous);
    for (const person of people.slice(1)) {
      expect(after.get(person.key)!.placement.slotIndex).toBe(
        before.get(person.key)!.placement.slotIndex,
      );
    }
  });

  it("gives distinct slots and queues extras beside the entry when an area is full", () => {
    const world = resolve([character(), character(), character(), character()]);
    const slots = [...world.values()].map((c) => c.placement.slotIndex).toSorted();
    expect(slots).toEqual([0, 1, 2, 3]);
    const overflow = [...world.values()].find((c) => c.placement.slotIndex === 3)!;
    expect(overflow.placement.area).toBe("desks");
  });

  it("fills spillover spots in order before queueing at the entry", () => {
    const world: WorldDefinition = {
      ...testWorld,
      areas: {
        ...testWorld.areas,
        beach: {
          ...(testWorld.areas.beach as FixedArea),
          spillover: [{ position: [11, 0, 11], facing: 0 }],
        },
      },
    };
    const people = [1, 2, 3].map(() => character({ status: "ready" }));
    const placed = resolveWorld({ facts: people, definition: world, previous: new Map() });
    expect(placed.map((c) => c.placement.position).toSorted()).toEqual([
      [10, 0, 10],
      [11, 0, 11],
      // Past the spillover, the queue starts beside the entry node "c".
      [10 - 1.5 * 0.9, 0, 5 + 0.9],
    ]);
  });

  it("puts a new character on the slot it asked for when that slot is free", () => {
    const sitter = character();
    const asker = character();
    const first = resolve([sitter]);
    const taken = first.get(sitter.key)!.placement.slotIndex;
    const free = [0, 1, 2].find((slot) => slot !== taken)!;
    const previous = new Map([[sitter.key, first.get(sitter.key)!.placement]]);
    const placed = (slotIndex: number) =>
      resolveWorld({
        facts: [sitter, asker],
        definition: testWorld,
        previous,
        requested: new Map([[asker.key, { area: "desks", slotIndex }]]),
      }).find((c) => c.facts.key === asker.key)!.placement.slotIndex;
    expect(placed(free)).toBe(free);
    // A taken slot is not stolen from the one already there.
    expect(placed(taken)).not.toBe(taken);
  });

  it("anchors a kid beside its parent's spot", () => {
    const parent = character();
    const kid = character({ kid: true, parentKey: parent.key });
    const world = resolve([kid, parent]);
    const parentSpot = world.get(parent.key)!.placement;
    expect(world.get(kid.key)!.placement).toMatchObject({
      area: "kidDesks",
      entry: parentSpot.entry,
      position: [parentSpot.position[0], 0, parentSpot.position[2] + 1],
    });
  });

  it("turns a kid's spot with its parent, so offsets stay around the parent's pile", () => {
    const facingEast: WorldDefinition = {
      ...testWorld,
      areas: {
        ...testWorld.areas,
        desks: {
          ...(testWorld.areas.desks as FixedArea),
          slots: [{ position: [0, 0, 0], facing: Math.PI / 2 }],
        },
        kidDesks: {
          kind: "anchored",
          anchor: "parent",
          offsets: [{ position: [0.5, 0, 1], facing: Math.PI }],
        },
      },
    };
    const parent = character();
    const kid = character({ kid: true, parentKey: parent.key });
    const placed = resolveWorld({
      facts: [parent, kid],
      definition: facingEast,
      previous: new Map(),
    });
    const kidSpot = placed.find((c) => c.facts.key === kid.key)!.placement;
    // Ahead of an east-facing parent is +x; its right-hand side is -z.
    expect(kidSpot.position[0]).toBeCloseTo(1);
    expect(kidSpot.position[2]).toBeCloseTo(-0.5);
    expect(kidSpot.facing).toBeCloseTo(Math.PI * 1.5);
  });

  it("sends a character to the fallback when its anchored area has no parent", () => {
    const orphan = character({ kid: true, parentKey: "env:missing" });
    const placed = resolve([orphan]).get(orphan.key)!;
    expect(placed.intent).toEqual(testWorld.fallback);
    expect(placed.placement.area).toBe("beach");
  });
});

describe("gateBeats", () => {
  it("advances a beat at most once per dwell, only when work moved on", () => {
    const worker = character({ beat: 10 });
    const at = (beat: number, now: number, previous: BeatGate) =>
      gateBeats({ facts: [{ ...worker, beat }], previous, now, dwellMs: 1000, quietMs: 60_000 });
    const start = at(10, 0, EMPTY_BEAT_GATE);
    expect(start.facts[0]!.beat).toBe(0);
    const tooSoon = at(11, 500, start.gate);
    expect(tooSoon.facts[0]!.beat).toBe(0);
    const later = at(12, 1500, tooSoon.gate);
    expect(later.facts[0]!.beat).toBe(1);
    const idle = at(12, 5000, later.gate);
    expect(idle.facts[0]!.beat).toBe(1);
  });

  it("marks a thread quiet once its work stops changing for a while, and not before", () => {
    const worker = character({ beat: 1 });
    const at = (beat: number, now: number, previous: BeatGate) =>
      gateBeats({ facts: [{ ...worker, beat }], previous, now, dwellMs: 1000, quietMs: 10_000 })
        .facts[0]!.quiet;
    const start = gateBeats({
      facts: [worker],
      previous: EMPTY_BEAT_GATE,
      now: 0,
      dwellMs: 1000,
      quietMs: 10_000,
    });
    expect(at(1, 9_000, start.gate)).toBe(false);
    expect(at(1, 10_000, start.gate)).toBe(true);
    // New work even within the dwell counts as output.
    const busy = gateBeats({
      facts: [{ ...worker, beat: 2 }],
      previous: start.gate,
      now: 9_500,
      dwellMs: 20_000,
      quietMs: 10_000,
    });
    expect(at(2, 15_000, busy.gate)).toBe(false);
  });
});

describe("resolveArchipelago", () => {
  const archipelago = (
    facts: CharacterFacts[],
    projectOrder: string[],
    previous = EMPTY_ARCHIPELAGO_MEMORY,
  ) =>
    resolveArchipelago({
      facts,
      definition: testWorld,
      projectOrder,
      hueCount: 3,
      hatCount: 3,
      previous,
    });
  const cells = (result: ReturnType<typeof archipelago>) =>
    Object.fromEntries(result.islands.map((island) => [island.key, island.cell]));

  it("gives each project its own island, in project order", () => {
    const result = archipelago(
      [character({ projectKey: "b" }), character({ projectKey: "a" })],
      ["a", "b"],
    );
    expect(cells(result)).toEqual({ a: 0, b: 1 });
    // A 10 by 6 island reaches sqrt(34) from its middle; with a gap of 2 the
    // neighbour sits 2 * sqrt(34) + 2 away along the screen's "right".
    const [first, second] = result.islands.map((island) => island.offset);
    expect(first).toEqual([0, 0, 0]);
    expect(Math.hypot(second![0], second![2])).toBeCloseTo(2 * Math.sqrt(34) + 2);
    expect(second![0]).toBeCloseTo(-second![2]);
  });

  it("keeps islands in place when another project leaves or arrives", () => {
    const a = character({ projectKey: "a" });
    const b = character({ projectKey: "b" });
    const c = character({ projectKey: "c" });
    const first = archipelago([a, b, c], ["a", "b", "c"]);
    // With its last thread archived, a project keeps its island, empty.
    const emptyA = archipelago([b, c], ["a", "b", "c"], first.memory);
    expect(cells(emptyA)).toEqual({ a: 0, b: 1, c: 2 });
    expect(emptyA.islands.find((island) => island.key === "a")!.characters).toEqual([]);
    const withoutA = archipelago([b, c], ["b", "c"], emptyA.memory);
    expect(cells(withoutA)).toEqual({ b: 1, c: 2 });
    const newcomer = archipelago(
      [b, c, character({ projectKey: "d" })],
      ["b", "c", "d"],
      withoutA.memory,
    );
    expect(cells(newcomer)).toEqual({ b: 1, c: 2, d: 0 });
  });

  it("ripples an island only while someone on it waits on you", () => {
    const asking = character({ projectKey: "a", status: "approval" });
    const quiet = character({ projectKey: "b" });
    const rippling = (facts: CharacterFacts[]) =>
      archipelago(facts, ["a", "b"]).islands.map((island) => island.ripple);

    expect(rippling([asking, quiet])).toEqual([true, false]);
    // Stops as soon as the answer comes in.
    expect(rippling([{ ...asking, status: "working" }, quiet])).toEqual([false, false]);
  });

  it("gives each family on an island its own colour, kids sharing their parent's", () => {
    const parent = character({ projectKey: "a", lookSeed: "p" });
    const kid = character({ projectKey: "a", lookSeed: "p", kid: true, parentKey: parent.key });
    const other = character({ projectKey: "a", lookSeed: "q" });
    const third = character({ projectKey: "a", lookSeed: "r" });
    const [island] = archipelago([parent, kid, other, third], ["a"]).islands;
    expect(island!.hues.size).toBe(3);
    expect(new Set(island!.hues.values()).size).toBe(3);
  });

  it("keeps a family's colour when another family leaves or arrives", () => {
    const families = ["p", "q", "r"].map((seed) => character({ projectKey: "a", lookSeed: seed }));
    const first = archipelago(families, ["a"]);
    const later = archipelago(
      [families[1]!, character({ projectKey: "a", lookSeed: "s" })],
      ["a"],
      first.memory,
    );
    expect(later.islands[0]!.hues.get("q")).toBe(first.islands[0]!.hues.get("q"));
  });

  it("dresses a family in the colour picked for it, and suggests a free one", () => {
    const families = ["p", "q"].map((seed) => character({ projectKey: "a", lookSeed: seed }));
    const auto = archipelago(families, ["a"]).islands[0]!;
    const picked = (auto.hues.get("p")! + 1) % 3;
    const [island] = resolveArchipelago({
      facts: families,
      definition: testWorld,
      projectOrder: ["a"],
      hueCount: 3,
      hatCount: 3,
      chosenHues: { p: picked },
      previous: EMPTY_ARCHIPELAGO_MEMORY,
    }).islands;
    expect(island!.hues.get("p")).toBe(picked);
    expect(island!.hues.get("q")).not.toBe(picked);
    expect(suggestHue(island!, 3)).toBe(3 - picked - island!.hues.get("q")!);
  });

  it("gives agents sharing a worktree the same hat, and none in the project checkout", () => {
    const first = character({ projectKey: "a", worktreePath: "/wt/one" });
    const second = character({ projectKey: "a", worktreePath: "/wt/one" });
    const other = character({ projectKey: "a", worktreePath: "/wt/two" });
    const local = character({ projectKey: "a" });
    const [island] = archipelago([first, second, other, local], ["a"]).islands;
    expect([...island!.hats.keys()].toSorted()).toEqual(["/wt/one", "/wt/two"]);
    expect(island!.hats.get("/wt/one")).not.toBe(island!.hats.get("/wt/two"));
  });

  it("never overlaps two islands, whatever their sizes", () => {
    const { gap } = testWorld.archipelago;
    for (const columns of [1, 3, 12]) {
      const islands = Array.from({ length: 12 }, (_, cell) => ({ cell, radius: 2 + (cell % 4) }));
      const offsets = islandOffsets({ islands, gap, columns });
      for (const [i, a] of offsets.entries()) {
        for (const [j, b] of offsets.entries()) {
          if (j <= i) continue;
          expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThanOrEqual(
            islands[i]!.radius + islands[j]!.radius + gap - 1e-9,
          );
        }
      }
    }
  });

  it("lays each island out at its own size", () => {
    const big: WorldDefinition = {
      ...testWorld,
      terrain: [{ shape: "box", kind: "grass", center: [5, 0], size: [20, 12] }],
    };
    const result = resolveArchipelago({
      facts: [character({ projectKey: "a" }), character({ projectKey: "b" })],
      definition: testWorld,
      definitionOf: (key) => (key === "b" ? big : testWorld),
      projectOrder: ["a", "b"],
      hueCount: 3,
      hatCount: 3,
      previous: EMPTY_ARCHIPELAGO_MEMORY,
    });
    const [a, b] = result.islands;
    expect(b!.definition).toBe(big);
    expect(Math.hypot(b!.offset[0] - a!.offset[0], b!.offset[2] - a!.offset[2])).toBeCloseTo(
      islandRadius(testWorld) + islandRadius(big) + testWorld.archipelago.gap,
    );
  });

  it("lines islands up down the screen, along it, or in a square grid", () => {
    // The camera looks down the (1, 1) diagonal: x - z runs right, x + z runs down.
    const onScreen = (arrangement: IslandArrangement, count: number) =>
      Array.from({ length: count }, (_, cell) => {
        const [x, , z] = islandOffsets({
          islands: Array.from({ length: count }, (_, index) => ({ cell: index, radius: 5 })),
          gap: testWorld.archipelago.gap,
          columns: arrangementColumns(arrangement, count),
        })[cell]!;
        return [Math.round(x - z), Math.round(x + z)] as const;
      });
    const column = onScreen("column", 3);
    expect(new Set(column.map(([right]) => right)).size).toBe(1);
    expect(new Set(column.map(([, down]) => down)).size).toBe(3);
    const row = onScreen("row", 3);
    expect(new Set(row.map(([right]) => right)).size).toBe(3);
    expect(new Set(row.map(([, down]) => down)).size).toBe(1);
    const grid = onScreen("grid", 5);
    expect(new Set(grid.map(([right]) => right)).size).toBe(3);
    expect(new Set(grid.map(([, down]) => down)).size).toBe(2);
  });
});

describe("planRoute", () => {
  const pile = { x: 5, z: 0, radius: 0.65 };

  it("walks straight when nothing is in the way", () => {
    expect(planRoute({ from: [0, 0, 0], to: [10, 0, 0], obstacles: [] })).toEqual([[10, 0, 0]]);
  });

  it("steps around an obstacle on the side it is already passing", () => {
    const route = planRoute({ from: [0, 0, 0.3], to: [10, 0, 0.3], obstacles: [pile] });
    expect(route).toHaveLength(2);
    const [detour, end] = route;
    expect(end).toEqual([10, 0, 0.3]);
    // Past the pile's edge plus room to spare, on the +z side the line was on.
    expect(detour![2]).toBeGreaterThan(pile.radius);
    expect(Math.hypot(detour![0] - pile.x, detour![2] - pile.z)).toBeGreaterThan(pile.radius + 0.4);
  });

  it("walks right up to an obstacle at either end", () => {
    // Mining a pile means standing next to it.
    expect(planRoute({ from: [0, 0, 0], to: [4, 0, 0], obstacles: [pile] })).toEqual([[4, 0, 0]]);
  });
});

describe("validateWorldDefinition", () => {
  it("accepts the island at every size", () => {
    for (const island of islandWorlds) expect(validateWorldDefinition(island)).toEqual([]);
  });

  it("gives every island size its rock piles, beach spots and pier chairs", () => {
    const counts = islandWorlds.map((island) => {
      const { mine, beach } = island.areas as Record<string, FixedArea>;
      const fishing = beach!.slots.filter((slot) => slot.fishing === true).length;
      return { piles: mine!.slots.length, restSpots: beach!.slots.length - fishing, fishing };
    });
    expect(counts).toEqual(ISLAND_SIZES.map((size) => ({ ...size, fishing: 4 })));
  });

  it("names broken references and disconnected areas", () => {
    const broken: WorldDefinition = {
      ...testWorld,
      areas: {
        ...testWorld.areas,
        island: { kind: "fixed", entry: "lonely", slots: [{ position: [0, 0, 0], facing: 0 }] },
      },
      roads: { ...testWorld.roads, nodes: { ...testWorld.roads.nodes, lonely: [99, 0, 99] } },
      rules: [{ when: {}, go: "nowhere", do: "dance" }],
    };
    expect(validateWorldDefinition(broken)).toEqual([
      'Rule 1 goes to unknown area "nowhere".',
      'Rule 1 uses unknown activity "dance".',
      'Road node "lonely" is not connected to the rest.',
    ]);
  });
});
