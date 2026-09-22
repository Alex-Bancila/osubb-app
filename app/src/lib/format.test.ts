import { expect, it } from 'vitest';
import { formatDate, formatLongDate } from './format';

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
