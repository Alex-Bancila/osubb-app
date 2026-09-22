import { describe, expect, it } from 'vitest';

import {
  bucharestDayKey,
  formatBucharestDay,
  formatBucharestTime,
} from './calendar-time';

describe('Bucharest calendar time', () => {
  it('groups an instant by the Bucharest day rather than its UTC day', () => {
    expect(bucharestDayKey('2026-08-29T21:30:00.000Z')).toBe('2026-08-30');
  });

  it('formats the Romanian day and local time in Bucharest', () => {
    const instant = '2026-08-29T21:30:00.000Z';

    expect(formatBucharestDay(instant)).toBe('duminică, 30 august 2026');
    expect(formatBucharestTime(instant)).toBe('00:30');
  });

  it('returns neutral values for malformed timestamps', () => {
    expect(bucharestDayKey('not-a-date')).toBeNull();
    expect(formatBucharestDay('not-a-date')).toBe('—');
    expect(formatBucharestTime('not-a-date')).toBe('—');
  });
});
