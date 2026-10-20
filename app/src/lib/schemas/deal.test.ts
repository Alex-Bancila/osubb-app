import { expect, it } from 'vitest';
import { expectRoutable, issues } from '../../test/schema-issues';
import { dealFieldForReason, dealSchema } from './deal';

const valid = {
  title: 'Reducere',
  body: 'Corp',
  deadline: null as string | null,
  links: [] as { label: string; url: string }[],
  code: null as string | null,
};
const check = (patch: Partial<typeof valid>) => {
  const result = dealSchema.safeParse({ ...valid, ...patch });
  expectRoutable(result, dealFieldForReason);
  return issues(result);
};

// R60: a Deal's body is Formatted Text, at most 2000 characters as the reader
// sees them and 4000 as stored -- private.require_formatted_text_length's rule.
it('measures the body as Formatted Text (R60)', () => {
  // 3600 stored (3599 trimmed), 1199 visible.
  expect(check({ body: '**a** '.repeat(600) })).toEqual([]);
  expect(dealSchema.parse({ ...valid, body: '**a** '.repeat(600) }).body).toBe(
    '**a** '.repeat(600).trim(),
  );
  expect(check({ body: 'a'.repeat(2001) })).toEqual(['body: body_too_long']);
  // 4005 stored, only 801 visible.
  expect(check({ body: '**a**'.repeat(801) })).toEqual(['body: body_too_long']);
  expect(check({ body: '   ' })).toEqual(['body: body_required']);
});
