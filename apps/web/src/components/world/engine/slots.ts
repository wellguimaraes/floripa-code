import type { FixedArea, Vec3, WorldDefinition, WorldIntent } from "../definition/types";
import type { CharacterFacts } from "./facts";
import { hashString } from "./hash";

export interface Placement {
  readonly area: string;
  /** Index into the area's slots or offsets; past the end means overflow. */
  readonly slotIndex: number;
  readonly position: Vec3;
  readonly facing: number;
  /** See `WorldSlot.seat`. */
  readonly seat?: number;
  /** Road node a character walks through to reach this spot. */
  readonly entry: string;
}

/** A wish for one slot; honoured when the character lands in that area and it is free. */
export interface SlotRequest {
  readonly area: string;
  readonly slotIndex: number;
}

export interface PlacementInput {
  readonly facts: CharacterFacts;
  readonly intent: WorldIntent;
}

export interface PlacedCharacter {
  readonly placement: Placement;
  /** The fallback replaces the intent when an anchored area has no placed parent. */
  readonly intent: WorldIntent;
}

const OVERFLOW_SPACING = 0.9;

/**
 * Gives every character a spot in its intended area. A character keeps the
 * slot it already had when it stays in the same area, so arrivals and
 * departures never reshuffle everyone else. New arrivals start from a slot
 * picked by their key, so the same thread tends to get the same spot.
 */
export function placeCharacters(input: {
  readonly characters: ReadonlyArray<PlacementInput>;
  readonly definition: WorldDefinition;
  readonly previous: ReadonlyMap<string, Placement>;
  /** Slots asked for by character key, e.g. the pile a new agent was started from. */
  readonly requested?: ReadonlyMap<string, SlotRequest>;
}): Map<string, PlacedCharacter> {
  const { definition, previous } = input;
  const placed = new Map<string, PlacedCharacter>();
  const occupied = new Map<string, Set<number>>();
  const taken = (area: string) => {
    let slots = occupied.get(area);
    if (slots === undefined) {
      slots = new Set();
      occupied.set(area, slots);
    }
    return slots;
  };

  const fixed: PlacementInput[] = [];
  let anchored: PlacementInput[] = [];
  for (const character of input.characters) {
    const area = definition.areas[character.intent.go];
    if (area?.kind === "anchored" && character.facts.parentKey !== null) {
      anchored.push(character);
    } else if (area?.kind === "fixed") {
      fixed.push(character);
    } else {
      fixed.push({ ...character, intent: definition.fallback });
    }
  }

  const placeFixed = (characters: ReadonlyArray<PlacementInput>) => {
    for (const [areaId, members] of groupBy(characters, (c) => c.intent.go)) {
      const area = definition.areas[areaId] as FixedArea;
      const slots = taken(areaId);
      const spots = area.slots.length + (area.spillover?.length ?? 0);
      const ordered = stickyFirst(members, areaId, spots, previous);
      for (const { character, keep } of ordered) {
        const { key } = character.facts;
        const asked = input.requested?.get(key);
        const slotIndex =
          keep !== null && !slots.has(keep)
            ? keep
            : asked !== undefined &&
                asked.area === areaId &&
                asked.slotIndex < area.slots.length &&
                !slots.has(asked.slotIndex)
              ? asked.slotIndex
              : freeSlot(slots, area.slots.length, key);
        slots.add(slotIndex);
        placed.set(key, {
          intent: character.intent,
          placement: fixedPlacement(definition, areaId, area, slotIndex),
        });
      }
    }
  };
  placeFixed(fixed);

  // Kids anchor to their parent, which may itself be anchored; place in waves.
  while (anchored.length > 0) {
    const ready = anchored.filter((c) => placed.has(c.facts.parentKey!));
    if (ready.length === 0) break;
    anchored = anchored.filter((c) => !placed.has(c.facts.parentKey!));
    for (const [parentKey, kids] of groupBy(ready, (c) => c.facts.parentKey!)) {
      const parent = placed.get(parentKey)!.placement;
      for (const [areaId, members] of groupBy(kids, (c) => c.intent.go)) {
        const area = definition.areas[areaId];
        if (area?.kind !== "anchored") continue;
        const slots = taken(`${areaId}\u0000${parentKey}`);
        const ordered = stickyFirst(members, areaId, area.offsets.length, previous);
        // Offsets are in the parent's frame: +z is the way the parent faces.
        const sin = Math.sin(parent.facing);
        const cos = Math.cos(parent.facing);
        for (const { character, keep } of ordered) {
          const slotIndex = keep !== null && !slots.has(keep) ? keep : firstFree(slots);
          slots.add(slotIndex);
          const offset = area.offsets[slotIndex % area.offsets.length]!;
          const row = Math.floor(slotIndex / area.offsets.length);
          const x = offset.position[0];
          const z = offset.position[2] - row * OVERFLOW_SPACING;
          placed.set(character.facts.key, {
            intent: character.intent,
            placement: {
              area: areaId,
              slotIndex,
              position: [
                parent.position[0] + x * cos + z * sin,
                parent.position[1] + offset.position[1],
                parent.position[2] - x * sin + z * cos,
              ],
              facing: parent.facing + offset.facing,
              entry: parent.entry,
            },
          });
        }
      }
    }
  }
  // Anything left has a parent that never got placed (a lineage cycle).
  placeFixed(anchored.map((character) => ({ ...character, intent: definition.fallback })));

  return placed;
}

function fixedPlacement(
  definition: WorldDefinition,
  areaId: string,
  area: FixedArea,
  slotIndex: number,
): Placement {
  const spillover = area.spillover ?? [];
  const slot = area.slots[slotIndex] ?? spillover[slotIndex - area.slots.length];
  if (slot !== undefined) {
    return { area: areaId, slotIndex, ...slot, entry: area.entry };
  }
  // Full area: queue up in rows beside the entry instead of stacking.
  const entry = definition.roads.nodes[area.entry]!;
  const overflow = slotIndex - area.slots.length - spillover.length;
  return {
    area: areaId,
    slotIndex,
    position: [
      entry[0] + ((overflow % 4) - 1.5) * OVERFLOW_SPACING,
      entry[1],
      entry[2] + (Math.floor(overflow / 4) + 1) * OVERFLOW_SPACING,
    ],
    facing: 0,
    entry: area.entry,
  };
}

function stickyFirst(
  members: ReadonlyArray<PlacementInput>,
  areaId: string,
  slotCount: number,
  previous: ReadonlyMap<string, Placement>,
): Array<{ character: PlacementInput; keep: number | null }> {
  return members
    .map((character) => {
      const before = previous.get(character.facts.key);
      const keep =
        before !== undefined && before.area === areaId && before.slotIndex < slotCount
          ? before.slotIndex
          : null;
      return { character, keep };
    })
    .toSorted((a, b) => {
      if ((a.keep === null) !== (b.keep === null)) return a.keep === null ? 1 : -1;
      return (
        a.character.facts.createdAt.localeCompare(b.character.facts.createdAt) ||
        a.character.facts.key.localeCompare(b.character.facts.key)
      );
    });
}

function freeSlot(slots: ReadonlySet<number>, slotCount: number, key: string): number {
  if (slotCount > 0) {
    const preferred = hashString(key) % slotCount;
    for (let step = 0; step < slotCount; step += 1) {
      const candidate = (preferred + step) % slotCount;
      if (!slots.has(candidate)) return candidate;
    }
  }
  let overflow = slotCount;
  while (slots.has(overflow)) overflow += 1;
  return overflow;
}

function firstFree(slots: ReadonlySet<number>): number {
  let index = 0;
  while (slots.has(index)) index += 1;
  return index;
}

function groupBy<T>(items: ReadonlyArray<T>, key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [item]);
    else group.push(item);
  }
  return groups;
}
