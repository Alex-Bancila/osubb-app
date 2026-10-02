import type { DifficultyLevel } from '../../../lib/difficulty-levels';

/** An experience column of a Group's list ("Dificultate începător", …). */
export type Experience = 'incepator' | 'intermediar' | 'avansat';

/**
 * One cell of a list: a Difficulty level, or `'medalie'` where the sheet
 * offers any medal (🥇/🥈/🥉 — the evaluator picks by the role's scope).
 */
export type GuideCell = DifficultyLevel | 'medalie';

export type GuideTask = {
  task: string;
  /** The sheet's Descriere (Categorie for Interne); null where it gives none. */
  description: string | null;
  /**
   * One cell for every experience column (merged in the sheet), or one cell
   * per column in the sheet's order. Null where the sheet gives no Difficulty.
   */
  difficulty: GuideCell | readonly GuideCell[] | null;
  /** A Nota the sheet fixes for the task (Interne: Ședință … → 3). */
  rating?: 1 | 2 | 3 | 4 | 5;
};

export type GuideSection = {
  /** The Domeniu (Proiecte) or the sheet's own sub-heading; null for none. */
  title: string | null;
  tasks: readonly GuideTask[];
};

export type GuideSheet = {
  /** The Group `short` (or Interne / Proiecte) the list belongs to. */
  key: string;
  /** How the guide names the list: "Taskuri în <name>". */
  name: string;
  /** The sheet's experience columns, in order; empty when it has one column. */
  experiences: readonly Experience[];
  sections: readonly GuideSection[];
};
