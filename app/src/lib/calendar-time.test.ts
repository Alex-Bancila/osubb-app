import { describe, expect, it } from 'vitest';

import {
  bucharestDayKey,
  bucharestWallTimeToIso,
  formatBucharestDay,
  formatBucharestTime,
  isoToBucharestWallTime,
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

  it('uses the winter UTC+2 offset for a Bucharest wall time', () => {
    expect(bucharestWallTimeToIso('2026-01-15T10:30')).toBe(
      '2026-01-15T08:30:00.000Z',
    );
  });

  it('uses the summer UTC+3 offset for a Bucharest wall time', () => {
    expect(bucharestWallTimeToIso('2026-07-15T10:30')).toBe(
      '2026-07-15T07:30:00.000Z',
    );
  });

  it('rejects a wall time skipped by the spring daylight-saving transition', () => {
    expect(bucharestWallTimeToIso('2026-03-29T03:30')).toBeNull();
  });

  it('round-trips an instant into an event form wall-time value', () => {
    expect(isoToBucharestWallTime('2026-07-15T07:30:00.000Z')).toBe(
      '2026-07-15T10:30',
    );
  });

  it('returns neutral values for malformed timestamps', () => {
    expect(bucharestDayKey('not-a-date')).toBeNull();
    expect(formatBucharestDay('not-a-date')).toBe('—');
    expect(formatBucharestTime('not-a-date')).toBe('—');
    expect(bucharestWallTimeToIso('not-a-date')).toBeNull();
    expect(isoToBucharestWallTime('not-a-date')).toBe('');
  });
});
