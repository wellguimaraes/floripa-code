import type { WorldDefinition, WorldIntent } from "./types";

/**
 * Lists every broken reference in a definition: unknown areas, activities,
 * road nodes, and areas that cannot reach each other by road. An empty list
 * means the engine can place and route every character.
 */
export function validateWorldDefinition(definition: WorldDefinition): string[] {
  const errors: string[] = [];
  const { areas, activities, roads } = definition;

  for (const [from, to] of roads.edges) {
    if (!(from in roads.nodes)) errors.push(`Road edge uses unknown node "${from}".`);
    if (!(to in roads.nodes)) errors.push(`Road edge uses unknown node "${to}".`);
  }

  const entries: string[] = [];
  for (const [id, area] of Object.entries(areas)) {
    if (area.kind === "fixed") {
      if (!(area.entry in roads.nodes)) {
        errors.push(`Area "${id}" enters through unknown node "${area.entry}".`);
      } else {
        entries.push(area.entry);
      }
      if (area.slots.length === 0) errors.push(`Area "${id}" has no slots.`);
    } else if (area.offsets.length === 0) {
      errors.push(`Area "${id}" has no offsets.`);
    }
  }

  const checkIntent = (intent: WorldIntent, label: string) => {
    if (!(intent.go in areas)) errors.push(`${label} goes to unknown area "${intent.go}".`);
    if (!(intent.do in activities)) errors.push(`${label} uses unknown activity "${intent.do}".`);
  };
  definition.rules.forEach((rule, index) => checkIntent(rule, `Rule ${index + 1}`));
  checkIntent(definition.fallback, "Fallback");
  const fallbackArea = areas[definition.fallback.go];
  if (fallbackArea?.kind === "anchored") {
    errors.push("Fallback must go to a fixed area; it is used when there is no parent.");
  }

  const newAgentArea = areas[definition.archipelago.newAgents.area];
  if (newAgentArea?.kind !== "fixed") {
    errors.push(
      `New agents start in "${definition.archipelago.newAgents.area}", which is not a fixed area.`,
    );
  }

  const { columns, gap } = definition.archipelago;
  if (!Number.isInteger(columns) || columns < 1) errors.push("Archipelago needs 1+ columns.");
  if (gap < 0) errors.push("Archipelago gap cannot be negative.");

  const reachable = reachableNodes(definition, entries[0]);
  for (const entry of entries) {
    if (!reachable.has(entry)) errors.push(`Road node "${entry}" is not connected to the rest.`);
  }

  return errors;
}

function reachableNodes(definition: WorldDefinition, start: string | undefined): Set<string> {
  const seen = new Set<string>();
  if (start === undefined) return seen;
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const [from, to] of definition.roads.edges) {
      if (from === node) stack.push(to);
      if (to === node) stack.push(from);
    }
  }
  return seen;
}
