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

  it('shows the actual Bucharest hour at the spring transition', () => {
    expect(formatBucharestTime('2026-03-29T00:30:00.000Z')).toBe('02:30');
    expect(isoToBucharestWallTime('2026-03-29T00:30:00.000Z')).toBe(
      '2026-03-29T02:30',
    );
    expect(bucharestWallTimeToIso('2026-03-29T04:30')).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('round-trips an instant into a form wall-time value', () => {
    expect(isoToBucharestWallTime('2026-07-15T07:30:00.000Z')).toBe(
      '2026-07-15T10:30',
    );
  });

  it('returns neutral values for malformed timestamps', () => {
    expect(bucharestDayKey('not-a-date')).toBeNull();
    expect(formatBucharestDay('not-a-date')).toBe('—');
    expect(formatBucharestTime('not-a-date')).toBe('—');
  });
});

describe('formatBucharestShort', () => {
  it('prints the short day and the time in Romania, without the year in the same year', async () => {
    const { formatBucharestShort, formatBucharestShortDay } =
      await import('./calendar-time');
    const now = '2026-10-10T09:00:00Z';
    // 20:59 UTC is 23:59 in Bucharest (EEST).
    expect(formatBucharestShort('2026-10-14T20:59:00Z', now)).toBe(
      'mie., 14 oct. · 23:59',
    );
    expect(formatBucharestShortDay('2026-10-14T20:59:00Z', now)).toBe(
      'mie., 14 oct.',
    );
  });

  it('says the year when it is not this one, and a dash for no date', async () => {
    const { formatBucharestShort } = await import('./calendar-time');
    expect(
      formatBucharestShort('2027-01-05T10:00:00Z', '2026-10-10T09:00:00Z'),
    ).toBe('mar., 5 ian. 2027 · 12:00');
    expect(formatBucharestShort('nu e o dată')).toBe('—');
  });
});
