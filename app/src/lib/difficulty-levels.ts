/**
 * The ten Difficulty levels (#985, #986): five stars for ordinary work, three
 * medals and two named roles for a responsibility. `public.task_difficulty_levels`
 * is the reference table (house rule 6) and owns each level's base points,
 * which the app reads with `useEvaluationScale`; this module only says how a
 * level LOOKS — the same mirror the five stars always were (ruling R29a:
 * stars stay stars) — so every card can draw one without a request.
 */
export const DIFFICULTY_LEVELS = [
  { level: 1, kind: 'star', label: '1 stea', glyph: '⭐' },
  { level: 2, kind: 'star', label: '2 stele', glyph: '⭐⭐' },
  { level: 3, kind: 'star', label: '3 stele', glyph: '⭐⭐⭐' },
  { level: 4, kind: 'star', label: '4 stele', glyph: '⭐⭐⭐⭐' },
  { level: 5, kind: 'star', label: '5 stele', glyph: '⭐⭐⭐⭐⭐' },
  { level: 6, kind: 'medal', label: 'Bronz', glyph: '🥉' },
  { level: 7, kind: 'medal', label: 'Argint', glyph: '🥈' },
  { level: 8, kind: 'medal', label: 'Aur', glyph: '🥇' },
  { level: 9, kind: 'text', label: 'Responsabil', glyph: null },
  { level: 10, kind: 'text', label: 'Coordonator', glyph: null },
] as const;

export type DifficultyLevelInfo = (typeof DIFFICULTY_LEVELS)[number];
export type DifficultyLevel = DifficultyLevelInfo['level'];
export type DifficultyKind = DifficultyLevelInfo['kind'];

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;

/** The level's presentation, or null outside 1–10. */
export function difficultyLevel(value: number): DifficultyLevelInfo | null {
  return DIFFICULTY_LEVELS.find((row) => row.level === value) ?? null;
}

/**
 * The words a screen reader hears and a sentence can carry: "3 stele",
 * "Bronz", "Coordonator".
 */
export function difficultyName(value: number): string {
  return difficultyLevel(value)?.label ?? `nivelul ${value}`;
}

/** The name a Difficulty mark carries for assistive technology. */
export function difficultyMarkName(value: number) {
  const level = difficultyLevel(value);
  if (!level) return `Dificultate ${value}`;
  return level.kind === 'star'
    ? `Dificultate ${value} din 5`
    : `Dificultate ${level.label}`;
}

/** The two reference scales the points preview reads (`useEvaluationScale`). */
export type EvaluationScaleData = {
  ratings: readonly { rating: number; multiplier: number }[];
  difficulties: readonly { level: number; base_points: number }[];
};

/**
 * The points preview: the level's base points × the Rating's multiplier
 * (`private.evaluate_task`'s formula), or null until both are chosen and
 * known. The server computes the real points.
 */
export function previewPoints(
  scale: EvaluationScaleData | undefined,
  difficulty: number | string,
  rating: number | string,
): number | null {
  if (difficulty === '' || rating === '' || !scale) return null;
  const base = scale.difficulties.find(
    (row) => row.level === Number(difficulty),
  )?.base_points;
  const multiplier = scale.ratings.find(
    (row) => row.rating === Number(rating),
  )?.multiplier;
  return base === undefined || multiplier === undefined
    ? null
    : base * multiplier;
}
