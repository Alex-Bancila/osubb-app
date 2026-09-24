import { describe, expect, it } from 'vitest';
import { commandErrorMessage, reasonCopy } from '../command-reasons';
import { fieldErrors } from '../form-errors';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import {
  dateRangeSchema,
  fieldForReason,
  type DateRangeValues,
} from './date-range';

const check = (range: DateRangeValues) => {
  const result = dateRangeSchema.safeParse(range);
  expectRoutable(result, fieldForReason);
  return issues(result);
};

describe('dateRangeSchema', () => {
  it('lets either end stay empty: no bound', () => {
    expect(check({})).toEqual([]);
    expect(check({ from: '2026-09-01' })).toEqual([]);
    expect(check({ to: '2026-09-30' })).toEqual([]);
  });

  it('accepts an end on or after the start and refuses one before it', () => {
    expect(check({ from: '2026-09-01', to: '2026-09-30' })).toEqual([]);
    // The same day twice is one whole day.
    expect(check({ from: '2026-09-15', to: '2026-09-15' })).toEqual([]);
    expect(check({ from: '2026-09-15', to: '2026-09-14' })).toEqual([
      'to: invalid_date_range',
    ]);
    // Across a month and a year, string order is calendar order.
    expect(check({ from: '2026-01-01', to: '2025-12-31' })).toEqual([
      'to: invalid_date_range',
    ]);
  });

  it('puts the Romanian message under Până la, as the server refusal would', () => {
    const copy = 'Data de sfârșit nu poate fi înaintea celei de început.';
    expect(
      fieldErrors(
        dateRangeSchema.safeParse({ from: '2026-09-15', to: '2026-09-14' }),
        undefined,
        fieldForReason,
      ),
    ).toEqual({ to: copy });
    expect(reasonCopy('invalid_date_range')).toBe(copy);
    expect(
      commandErrorMessage(
        { code: 'PT400', message: 'invalid_date_range' },
        'fallback',
      ),
    ).toBe(copy);
    expectMapComplete(fieldForReason, ['from', 'to'], ['invalid_date_range']);
  });
});
