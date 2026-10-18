import { expect, it, describe } from 'vitest';
import { pointsPeriodText, pointsSinceText } from './points-period';

describe('pointsSinceText', () => {
  it('writes the date as the Notifications do, dotted', () => {
    expect(pointsSinceText('2026-09-01')).toBe('din 01.09.2026');
    expect(pointsSinceText('2026-12-31')).toBe('din 31.12.2026');
  });

  it('is null while there is no date, or the date is not one', () => {
    expect(pointsSinceText(null)).toBeNull();
    expect(pointsSinceText(undefined)).toBeNull();
    expect(pointsSinceText('')).toBeNull();
    // Not the display dash of a missing day: a malformed one is simply not a day.
    expect(pointsSinceText('—')).toBeNull();
    expect(pointsSinceText('1 septembrie')).toBeNull();
  });
});

describe('pointsPeriodText', () => {
  it('begins at the Points Start Date when the filter has no De la', () => {
    expect(pointsPeriodText({}, '2026-09-01')).toBe('din 01.09.2026');
    expect(pointsPeriodText({ to: '2026-09-30' }, '2026-09-01')).toBe(
      'din 01.09.2026 până la 30 septembrie 2026',
    );
  });

  it('reads an explicit De la as the range it is, before the start or not', () => {
    expect(pointsPeriodText({ from: '2026-08-01' }, '2026-09-01')).toBe(
      'din 1 august 2026',
    );
    expect(
      pointsPeriodText({ from: '2026-08-01', to: '2026-09-30' }, '2026-09-01'),
    ).toBe('între 1 august 2026 și 30 septembrie 2026');
  });

  it('is null for the whole record: no date set, nothing chosen', () => {
    expect(pointsPeriodText({}, null)).toBeNull();
    expect(pointsPeriodText({ to: '2026-09-30' }, null)).toBe(
      'până la 30 septembrie 2026',
    );
  });

  it('is undefined while the date is unknown, unless a De la is chosen', () => {
    expect(pointsPeriodText({}, undefined)).toBeUndefined();
    expect(pointsPeriodText({ to: '2026-09-30' }, undefined)).toBeUndefined();
    expect(pointsPeriodText({ from: '2026-08-01' }, undefined)).toBe(
      'din 1 august 2026',
    );
  });
});
