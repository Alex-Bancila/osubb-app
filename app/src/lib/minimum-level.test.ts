import { describe, expect, it } from 'vitest';

import {
  EVENT_MINIMUM_LEVELS,
  GROUP_MINIMUM_LEVELS,
  isMinimumLevel,
  minimumLevelFromLabel,
  minimumLevelLabel,
  minimumLevelOptions,
  minimumLevelText,
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

  it('offers only the events_min_level_ck subset, same order, for an Event', () => {
    expect(EVENT_MINIMUM_LEVELS).toEqual([0, 3, 5, 6]);
    expect(
      minimumLevelOptions(EVENT_MINIMUM_LEVELS).map((option) => option.label),
    ).toEqual(['Recrut', 'Voluntar cu Drept de Vot', 'BCE', 'BC']);
  });

  it('keeps ladder order whatever order the allowed levels come in', () => {
    expect(
      minimumLevelOptions([6, 9, 0, 4, 2], (level) => level < 6).map(
        (option) => option.level,
      ),
    ).toEqual([0, 2]);
  });
});
