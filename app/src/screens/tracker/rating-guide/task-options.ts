import type { DifficultyLevel } from '../../../lib/difficulty-levels';
import type { Experience, GuideCell, GuideTask } from './types';

/** A list longer than this gets a search field (Proiecte has 87 rows). */
export const SEARCH_FROM = 12;

export type TaskOption = {
  /** The experience columns the value applies to; null: every level. */
  experiences: readonly Experience[] | null;
  level: DifficultyLevel;
};

const MEDALS = [6, 7, 8] as const satisfies readonly DifficultyLevel[];

const isCells = (
  value: GuideTask['difficulty'],
): value is readonly GuideCell[] => Array.isArray(value);

/**
 * The Setează options of one row, left to right: one per run of experience
 * columns that share a value (the sheet's merged cells), or one per medal
 * where the sheet lets the evaluator pick (🥇/🥈/🥉).
 */
export function taskOptions(
  task: GuideTask,
  experiences: readonly Experience[],
): TaskOption[] {
  const cells = task.difficulty;
  if (cells === null) return [];
  if (!isCells(cells))
    return cells === 'medalie'
      ? MEDALS.map((level) => ({ experiences: null, level }))
      : [{ experiences: null, level: cells }];
  const options: TaskOption[] = [];
  cells.forEach((cell, index) => {
    const experience = experiences[index];
    if (!experience || cell === 'medalie') return;
    const last = options.at(-1);
    if (last?.experiences && last.level === cell)
      last.experiences = [...last.experiences, experience];
    else options.push({ experiences: [experience], level: cell });
  });
  const [only, ...rest] = options;
  return only && rest.length === 0
    ? [{ experiences: null, level: only.level }]
    : options;
}
