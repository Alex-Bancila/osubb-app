import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { fieldForReason, reasonSchema } from './reason';

const check = (reason: string) => {
  const result = reasonSchema.safeParse({ reason });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it.each([
  [' \n ', ['reason: reason_required']],
  ['r', []],
  ['r'.repeat(1000), []],
  [`  ${'r'.repeat(1000)}  `, []],
  ['r'.repeat(1001), ['reason: reason_too_long']],
])('measures the reason %j trimmed, at the boundary', (reason, expected) => {
  expect(check(reason)).toEqual(expected);
});

it('sends the trimmed reason', () => {
  expect(reasonSchema.parse({ reason: '  Surse  ' })).toEqual({
    reason: 'Surse',
  });
});

it('maps both reason reasons to the reason', () => {
  expectMapComplete(
    fieldForReason,
    ['reason'],
    ['reason_required', 'reason_too_long'],
  );
});
