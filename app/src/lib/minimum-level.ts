/**
 * The Minimum Level ladder a manager chooses from (ruling R29b): the system
 * level each Role stands for, shown by the Role's name — never by the number.
 *
 * The labels are the fixed list Alex ruled, not `roles.name`: that table also
 * names the Moderator, whom no picker offers. Level 4 (Responsabil) retired in
 * #593 and has no label. A change in the ladder changes this one file.
 */
export const MINIMUM_LEVEL_LADDER = [
  { level: 0, label: 'Recrut' },
  { level: 1, label: 'Voluntar' },
  { level: 2, label: 'Voluntar Activ' },
  { level: 3, label: 'Voluntar cu Drept de Vot' },
  { level: 5, label: 'BCE' },
  { level: 6, label: 'BC' },
] as const;

export type MinimumLevelOption = (typeof MINIMUM_LEVEL_LADDER)[number];

/** A Group's Minimum Level and Application Level: the whole ladder. */
export const GROUP_MINIMUM_LEVELS: readonly number[] = MINIMUM_LEVEL_LADDER.map(
  (rung) => rung.level,
);

/** An Event's Minimum Level: the ladder levels `events_min_level_ck` accepts. */
export const EVENT_MINIMUM_LEVELS: readonly number[] = [0, 3, 5, 6];

/** The Role name for a ladder level; `undefined` off the ladder (4, 9). */
export function minimumLevelLabel(level: number): string | undefined {
  return MINIMUM_LEVEL_LADDER.find((rung) => rung.level === level)?.label;
}

/** The ladder level a Role name stands for; `undefined` for any other text. */
export function minimumLevelFromLabel(label: string): number | undefined {
  return MINIMUM_LEVEL_LADDER.find((rung) => rung.label === label)?.level;
}

/** Whether a level is one a picker may offer. */
export function isMinimumLevel(level: number): boolean {
  return minimumLevelLabel(level) !== undefined;
}

/**
 * The text for a stored Minimum Level. A level no picker offers can still be
 * stored by the server (the Moderator's 9 on a Group), so a display names the
 * Moderator rather than printing a number.
 */
export function minimumLevelText(level: number): string {
  return minimumLevelLabel(level) ?? 'Moderator';
}

/**
 * The picker options, in ladder order: every rung in `allowed` (the levels the
 * server accepts for this field) that `keep` does not rule out.
 */
export function minimumLevelOptions(
  allowed: readonly number[] = GROUP_MINIMUM_LEVELS,
  keep: (level: number) => boolean = () => true,
): MinimumLevelOption[] {
  return MINIMUM_LEVEL_LADDER.filter(
    (rung) => allowed.includes(rung.level) && keep(rung.level),
  );
}
