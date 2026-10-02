/** What a Setează writes into the open form. */
export type GuidePatch = { difficulty?: number; rating?: number };
/** The Dificultate and Nota the open form holds now. */
export type GuideSelection = {
  difficulty: number | null;
  rating: number | null;
};

/** Whether the form already holds every value a Setează would write. */
export function isApplied(patch: GuidePatch, selection: GuideSelection) {
  return (
    (patch.difficulty === undefined ||
      patch.difficulty === selection.difficulty) &&
    (patch.rating === undefined || patch.rating === selection.rating)
  );
}
