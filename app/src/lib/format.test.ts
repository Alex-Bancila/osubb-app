import { expect, it } from 'vitest';
import {
  formatMonthCount,
  formatDate,
  formatDay,
  formatDayMonthYear,
  formatDayOrNull,
  formatLongDate,
  formatTaskCount,
} from './format';

// Pinned because #376 briefly swapped these to date-fns, whose Romanian
// abbreviations differ ("12 noi", no full stops) — a visible change.
it.each([
  ['2026-03-12', '12 mar.'],
  ['2026-05-12', '12 mai'],
  ['2026-09-12', '12 sept.'],
  ['2026-11-12', '12 nov.'],
])('formats %s as %s', (iso, expected) => {
  expect(formatDate(iso)).toBe(expected);
});

it('formats the long date a screen leads with', () => {
  expect(formatLongDate(new Date(2026, 7, 26))).toBe(
    'miercuri, 26 august 2026',
  );
});

it('shows a dash for a missing or malformed date', () => {
  expect(formatDate(null)).toBe('—');
  expect(formatDate('2026-02-30')).toBe('—');
});

it('formats a milestone date with day, month and year', () => {
  expect(formatDayMonthYear('2024-03-12')).toBe('12 martie 2024');
  expect(formatDayMonthYear(null)).toBeNull();
  expect(formatDayMonthYear('2026-02-30')).toBeNull();
});

it('writes a calendar day dotted, as the Notifications do, and a dash for none', () => {
  expect(formatDay('2026-09-01')).toBe('01.09.2026');
  expect(formatDay('2026-12-31')).toBe('31.12.2026');
  expect(formatDay(null)).toBe('—');
  expect(formatDay(undefined)).toBe('—');
  expect(formatDay('')).toBe('—');
  expect(formatDay('1 septembrie')).toBe('—');
});

it('hands back null, not a dash, for a day it cannot write', () => {
  expect(formatDayOrNull('2026-09-01')).toBe('01.09.2026');
  expect(formatDayOrNull(null)).toBeNull();
  expect(formatDayOrNull(undefined)).toBeNull();
  expect(formatDayOrNull('')).toBeNull();
  expect(formatDayOrNull('—')).toBeNull();
});

it('counts Tasks with the Romanian plural', () => {
  expect([0, 1, 2, 19, 20, 101, 119, 120, 1000].map(formatTaskCount)).toEqual([
    '0 taskuri',
    '1 task',
    '2 taskuri',
    '19 taskuri',
    '20 de taskuri',
    '101 taskuri',
    '119 taskuri',
    '120 de taskuri',
    '1.000 de taskuri',
  ]);
});

it('counts months with the Romanian plural (#935)', () => {
  expect([0, 1, 2, 6, 19, 20, 24, 100, 101, 120].map(formatMonthCount)).toEqual(
    [
      '0 luni',
      '1 lună',
      '2 luni',
      '6 luni',
      '19 luni',
      '20 de luni',
      '24 de luni',
      '100 de luni',
      '101 luni',
      '120 de luni',
    ],
  );
});
