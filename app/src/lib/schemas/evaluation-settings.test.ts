import { expect, it } from 'vitest';
import {
  cutoffFieldForReason,
  cutoffSchema,
  floorFieldForReason,
  floorSchema,
  pointsStartFieldForReason,
  pointsStartSchema,
} from './evaluation-settings';
import { expectRoutable, issues } from '../../test/schema-issues';

const TODAY = '2026-09-28';

it('takes a Prag minim of a whole number of points, at least 1', () => {
  for (const floor of ['', '0', '-3', '2.5', 'abc', '2147483648'])
    expect(issues(floorSchema.safeParse({ floor })), floor).toEqual([
      'floor: invalid_eligibility_floor',
    ]);
  expect(floorSchema.parse({ floor: ' 12 ' })).toEqual({ floor: 12 });
  expect(floorSchema.parse({ floor: '1' })).toEqual({ floor: 1 });
});

it('takes a Data limită de intrare that is a day, not after today', () => {
  const schema = cutoffSchema(TODAY);
  for (const date of ['', '2026-09-29', '28.09.2026'])
    expect(issues(schema.safeParse({ date })), date).toEqual([
      'date: invalid_membership_cutoff',
    ]);
  expect(schema.parse({ date: TODAY })).toEqual({ date: TODAY });
  expect(schema.parse({ date: '2026-03-31' })).toEqual({ date: '2026-03-31' });
});

it('takes a Data de început a punctajului that is a day, not after today', () => {
  const schema = pointsStartSchema(TODAY);
  for (const date of ['', '2026-09-29', 'mâine'])
    expect(issues(schema.safeParse({ date })), date).toEqual([
      'date: invalid_points_start_date',
    ]);
  expect(schema.parse({ date: TODAY })).toEqual({ date: TODAY });
});

it('sends every reason the server and the browser share to the field that shows it', () => {
  expectRoutable(floorSchema.safeParse({ floor: '0' }), floorFieldForReason);
  expectRoutable(
    cutoffSchema(TODAY).safeParse({ date: '' }),
    cutoffFieldForReason,
  );
  expectRoutable(
    pointsStartSchema(TODAY).safeParse({ date: '' }),
    pointsStartFieldForReason,
  );
  // An unchanged value is refused by the server, under the same field.
  expect(floorFieldForReason.nothing_to_update).toBe('floor');
  expect(cutoffFieldForReason.nothing_to_update).toBe('date');
  expect(pointsStartFieldForReason.nothing_to_update).toBe('date');
});
