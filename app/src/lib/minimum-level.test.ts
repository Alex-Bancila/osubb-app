import { describe, expect, it } from 'vitest';

import {
  EVENT_MINIMUM_LEVELS,
  GROUP_MINIMUM_LEVELS,
  isMinimumLevel,
  minimumLevelFromLabel,
  minimumLevelLabel,
  minimumLevelOptions,
  minimumLevelText,
  taskMinimumLevelChoices,
} from './minimum-level';

const LADDER: Array<[number, string]> = [
  [0, 'Recrut'],
  [1, 'Voluntar'],
  [2, 'Voluntar Activ'],
  [3, 'Voluntar cu Drept de Vot'],
  [5, 'BCE'],
  [6, 'BC'],
];

describe('Minimum Level ladder (R29b)', () => {
  it.each(LADDER)('maps level %i to %s and back', (level, label) => {
    expect(minimumLevelLabel(level)).toBe(label);
    expect(minimumLevelFromLabel(label)).toBe(level);
    expect(minimumLevelText(level)).toBe(label);
    expect(isMinimumLevel(level)).toBe(true);
  });

  it('has no label for the retired Responsabil (4) or the Moderator (9)', () => {
    expect(minimumLevelLabel(4)).toBeUndefined();
    expect(minimumLevelLabel(9)).toBeUndefined();
    expect(isMinimumLevel(4)).toBe(false);
    expect(isMinimumLevel(9)).toBe(false);
    expect(minimumLevelFromLabel('Moderator')).toBeUndefined();
    expect(minimumLevelFromLabel('Responsabil de proiect')).toBeUndefined();
    expect(minimumLevelFromLabel('3')).toBeUndefined();
  });

  it('never prints a number for a stored off-ladder level', () => {
    expect(minimumLevelText(9)).toBe('Moderator');
  });

  it('offers exactly the six labels, in ladder order, for a Group', () => {
    expect(GROUP_MINIMUM_LEVELS).toEqual([0, 1, 2, 3, 5, 6]);
    expect(minimumLevelOptions().map((option) => option.label)).toEqual(
      LADDER.map(([, label]) => label),
    );
  });

  it('offers every rung for an Event, same order (R57)', () => {
    expect(EVENT_MINIMUM_LEVELS).toEqual([0, 1, 2, 3, 5, 6]);
    expect(
      minimumLevelOptions(EVENT_MINIMUM_LEVELS).map((option) => option.label),
    ).toEqual([
      'Recrut',
      'Voluntar',
      'Voluntar Activ',
      'Voluntar cu Drept de Vot',
      'BCE',
      'BC',
    ]);
  });

  it('keeps ladder order whatever order the allowed levels come in', () => {
    expect(
      minimumLevelOptions([6, 9, 0, 4, 2], (level) => level < 6).map(
        (option) => option.level,
      ),
    ).toEqual([0, 2]);
  });

  it('offers a Task every Role when org-wide, the Group floor up when local, never above the actor (R57)', () => {
    const levels = (floor: number, audience: 'local' | 'org', actor: number) =>
      taskMinimumLevelChoices({ min_level: floor }, audience, actor).map(
        (rung) => rung.level,
      );
    expect(levels(3, 'org', 6)).toEqual([0, 1, 2, 3, 5, 6]);
    expect(levels(3, 'local', 6)).toEqual([3, 5, 6]);
    expect(levels(0, 'org', 2)).toEqual([0, 1, 2]);
    expect(levels(0, 'org', 9)).toEqual([0, 1, 2, 3, 5, 6]);
    expect(levels(5, 'local', 2)).toEqual([]);
    expect(
      taskMinimumLevelChoices(undefined, 'local', 6).map((rung) => rung.level),
    ).toEqual([0, 1, 2, 3, 5, 6]);
  });
});
