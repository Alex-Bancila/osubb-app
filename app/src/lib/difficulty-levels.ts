import type { DifficultyKind } from './schemas/evaluation';

/**
 * The ten Difficulty levels (#985, #986): five stars for ordinary work, three
 * medals and two named roles for a responsibility. `public.task_difficulty_levels`
 * is the reference table (house rule 6) and owns each level's kind, label,
 * glyph and base points; the app reads it once (`useDifficultyLevels`) and
 * these helpers only interpret the rows.
 */
export type DifficultyLevelRow = {
  level: number;
  kind: DifficultyKind;
  label: string;
  glyph: string | null;
  base_points: number;
};

/** A level number the guide's content may name (1–10, `tasks_difficulty_ck`). */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** One level's row, or null while the table loads or outside it. */
export function difficultyLevel(
  levels: readonly DifficultyLevelRow[] | undefined,
  value: number,
): DifficultyLevelRow | null {
  return levels?.find((row) => row.level === value) ?? null;
}

/**
 * The words a screen reader hears and a sentence can carry: "3 stele",
 * "Bronz", "Coordonator" — "nivelul 3" until the table has loaded.
 */
export function difficultyName(
  levels: readonly DifficultyLevelRow[] | undefined,
  value: number,
): string {
  return difficultyLevel(levels, value)?.label ?? `nivelul ${value}`;
}

/** The name a Difficulty mark carries: "Dificultate 3 din 5", "Dificultate Bronz". */
export function difficultyMarkName(
  levels: readonly DifficultyLevelRow[] | undefined,
  value: number,
): string {
  const level = difficultyLevel(levels, value);
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
