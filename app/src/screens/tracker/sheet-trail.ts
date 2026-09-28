/**
 * Where the sheet is: the Task opened from the list, and the Tasks reached
 * from it (its Umbrella, the Task it was duplicated from, a Subtask), newest
 * last. "Înapoi" pops one step (navigation D20).
 */
export type SheetTrail = { opened: number; visited: number[] };

export function sheetTrailPush(trail: SheetTrail, id: number): SheetTrail {
  return { ...trail, visited: [...trail.visited, id] };
}

export function sheetTrailBack(trail: SheetTrail): SheetTrail {
  return { ...trail, visited: trail.visited.slice(0, -1) };
}

/** The Task on screen. */
export function sheetTrailCurrent(trail: SheetTrail): number {
  return trail.visited.at(-1) ?? trail.opened;
}

/** The Task "Înapoi" returns to, or null on the Task first opened. */
export function sheetTrailPrevious(trail: SheetTrail): number | null {
  if (!trail.visited.length) return null;
  return trail.visited.at(-2) ?? trail.opened;
}
