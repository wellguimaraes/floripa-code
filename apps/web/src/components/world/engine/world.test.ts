import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { FixedArea, WorldDefinition } from "../definition/types";
import { validateWorldDefinition } from "../definition/validate";
import { islandWorld } from "../definitions/island";
import {
  EMPTY_ARCHIPELAGO_MEMORY,
  islandBounds,
  islandOffset,
  resolveArchipelago,
} from "./archipelago";
import { EMPTY_BEAT_GATE, gateBeats, type BeatGate } from "./beats";
import type { CharacterFacts } from "./facts";
import { planRoute, shortestPath } from "./roads";
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
    kidScale: 0.5,
  },
  archipelago: {
    columns: 2,
    gap: 2,
    sign: { position: [0, 0, 0], facing: 0 },
    ripple: { when: [{ status: "approval" }], fps: 20 },
    newAgents: { area: "desks", marker: [0, 1, 0] },
    night: { when: { status: "ready", unread: false }, afterMinutes: 60, campfire: [0, 0] },
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
    status: "working",
    unread: false,
    kid: false,
    parentKey: null,
    hasWorkingKids: false,
    backgroundTask: false,
    beat: 0,
    quiet: false,
    restingSince: "2026-01-01T00:00:00.000Z",
    night: false,
    provider: "codex",
    lookSeed: key,
    projectKey: "env:project",
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
    now = Date.parse("2026-01-01T00:30:00.000Z"),
  ) =>
    resolveArchipelago({ facts, definition: testWorld, projectOrder, hueCount: 3, now, previous });
  const cells = (result: ReturnType<typeof archipelago>) =>
    Object.fromEntries(result.islands.map((island) => [island.key, island.cell]));

  it("gives each project its own island, in project order", () => {
    const result = archipelago(
      [character({ projectKey: "b" }), character({ projectKey: "a" })],
      ["a", "b"],
    );
    expect(cells(result)).toEqual({ a: 0, b: 1 });
    // Islands 10 by 6 with a gap of 2: a step of 8 clears the depth and half the width.
    expect(result.islands.map((island) => island.offset)).toEqual([
      [0, 0, 0],
      [8, 0, -8],
    ]);
  });

  it("keeps islands in place when another project leaves or arrives", () => {
    const a = character({ projectKey: "a" });
    const b = character({ projectKey: "b" });
    const c = character({ projectKey: "c" });
    const first = archipelago([a, b, c], ["a", "b", "c"]);
    const withoutA = archipelago([b, c], ["a", "b", "c"], first.memory);
    expect(cells(withoutA)).toEqual({ b: 1, c: 2 });
    const newcomer = archipelago(
      [b, c, character({ projectKey: "d" })],
      ["a", "b", "c", "d"],
      withoutA.memory,
    );
    expect(cells(newcomer)).toEqual({ b: 1, c: 2, d: 0 });
  });

  it("ripples the water around an island while someone on it matches the ripple rule", () => {
    const result = archipelago(
      [character({ projectKey: "a", status: "approval" }), character({ projectKey: "b" })],
      ["a", "b"],
    );
    expect(Object.fromEntries(result.islands.map((i) => [i.key, i.ripple]))).toEqual({
      a: true,
      b: false,
    });
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

  it("puts an island to sleep once everyone there has rested long enough", () => {
    const rested = (at: string) =>
      character({ projectKey: "a", status: "ready", unread: false, restingSince: at });
    const people = [rested("2026-01-01T00:00:00.000Z"), rested("2026-01-01T00:10:00.000Z")];
    const at = (iso: string, facts = people) =>
      archipelago(facts, ["a"], EMPTY_ARCHIPELAGO_MEMORY, Date.parse(iso)).islands[0]!;
    // An hour from the most recent finish, not the first.
    expect(at("2026-01-01T01:05:00.000Z").night).toBe(false);
    const night = at("2026-01-01T01:10:00.000Z");
    expect(night.night).toBe(true);
    expect(night.characters.every((c) => c.facts.night)).toBe(true);
    // One character still working keeps the lights on.
    const busy = [...people, character({ projectKey: "a", status: "working" })];
    expect(at("2026-01-01T05:00:00.000Z", busy).night).toBe(false);
  });

  it("never overlaps two islands", () => {
    const { minX, minZ, maxX, maxZ } = islandBounds(testWorld);
    const offsets = Array.from({ length: 12 }, (_, cell) => islandOffset(cell, testWorld));
    for (const [i, a] of offsets.entries()) {
      for (const b of offsets.slice(i + 1)) {
        const apartX = Math.abs(a[0] - b[0]) >= maxX - minX + testWorld.archipelago.gap;
        const apartZ = Math.abs(a[2] - b[2]) >= maxZ - minZ + testWorld.archipelago.gap;
        expect(apartX || apartZ).toBe(true);
      }
    }
  });
});

describe("roads", () => {
  it("takes the shortest road, not the fewest stops", () => {
    expect(shortestPath(testWorld.roads, "a", "c")).toEqual(["a", "b", "c"]);
  });

  it("walks straight within an area and along the road between areas", () => {
    const desk: Placement = {
      area: "desks",
      slotIndex: 0,
      position: [0, 0, 0],
      facing: 0,
      entry: "a",
    };
    const otherDesk: Placement = { ...desk, slotIndex: 2, position: [2, 0, 0] };
    const beach: Placement = {
      area: "beach",
      slotIndex: 0,
      position: [10, 0, 10],
      facing: 0,
      entry: "c",
    };
    const roads = testWorld.roads;

    expect(planRoute({ roads, from: [0, 0, 0], fromPlacement: desk, to: otherDesk })).toEqual([
      [0, 0, 0],
      [2, 0, 0],
    ]);
    expect(planRoute({ roads, from: [0, 0, 0], fromPlacement: desk, to: beach })).toEqual([
      [0, 0, 0],
      [0, 0, 5],
      [5, 0, 5],
      [10, 0, 5],
      [10, 0, 10],
    ]);
  });
});

describe("validateWorldDefinition", () => {
  it("accepts the island", () => {
    expect(validateWorldDefinition(islandWorld)).toEqual([]);
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
