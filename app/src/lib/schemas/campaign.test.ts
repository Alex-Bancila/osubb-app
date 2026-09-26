import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { campaignSchema, fieldForReason } from './campaign';

const check = (name: string) => {
  const result = campaignSchema.safeParse({ name });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it.each([
  ['   ', ['name: invalid_campaign_name']],
  ['ab', ['name: name_too_short']],
  ['abc', []],
  ['n'.repeat(120), []],
  ['n'.repeat(121), ['name: name_too_long']],
])('measures the Campaign name %j at the boundary', (name, expected) => {
  expect(check(name)).toEqual(expected);
});

it('trims the name before measuring and saving it', () => {
  expect(campaignSchema.parse({ name: '  Balul  ' })).toEqual({
    name: 'Balul',
  });
  expect(check(`  ${'n'.repeat(120)}  `)).toEqual([]);
});

it('maps every reason a Campaign command raises to the name', () => {
  expectMapComplete(
    fieldForReason,
    ['name'],
    [
      'invalid_campaign_name',
      'name_too_short',
      'name_too_long',
      'campaign_name_taken',
    ],
  );
});
