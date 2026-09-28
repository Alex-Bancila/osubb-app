import { expect, it } from 'vitest';
import { rejectionSchema, runSchema, thresholdSchema } from './role-evaluation';

const issues = (result: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) =>
  result.success
    ? []
    : (result.error?.issues ?? []).map(
        (issue) => `${issue.path.join('.')}:${issue.message}`,
      );

const run = runSchema('2026-09-28');
const valid = {
  kind: 'voluntar_activ',
  from: '2026-02-01',
  to: '2026-06-30',
  name: '  Semestrul II  ',
};

it('takes a Role Evaluation as run_role_evaluation checks it (#826)', () => {
  expect(run.parse(valid)).toEqual({ ...valid, name: 'Semestrul II' });
  expect(issues(run.safeParse({ ...valid, kind: 'altceva' }))).toEqual([
    'kind:invalid_role_evaluation_kind',
  ]);
  expect(issues(run.safeParse({ ...valid, name: '   ' }))).toEqual([
    'name:invalid_role_evaluation_name',
  ]);
  expect(issues(run.safeParse({ ...valid, name: 'ab' }))).toEqual([
    'name:name_too_short',
  ]);
  expect(issues(run.safeParse({ ...valid, name: 'n'.repeat(121) }))).toEqual([
    'name:name_too_long',
  ]);
});

it('needs both days, Până la not before De la and not after today', () => {
  expect(issues(run.safeParse({ ...valid, from: '' }))).toEqual([
    'from:date_required',
  ]);
  expect(issues(run.safeParse({ ...valid, to: '' }))).toEqual([
    'to:date_required',
  ]);
  expect(issues(run.safeParse({ ...valid, to: '2026-01-31' }))).toEqual([
    'to:invalid_date_range',
  ]);
  expect(issues(run.safeParse({ ...valid, to: '2026-09-29' }))).toEqual([
    'to:date_range_in_future',
  ]);
  // One day, and a range ending today, are both fine.
  expect(
    run.safeParse({ ...valid, from: '2026-09-28', to: '2026-09-28' }).success,
  ).toBe(true);
});

it('takes a whole threshold of at least 1', () => {
  for (const threshold of ['', '0', '-3', '2.5', 'abc', '2147483648'])
    expect(issues(thresholdSchema.safeParse({ threshold })), threshold).toEqual(
      ['threshold:invalid_promotion_threshold'],
    );
  expect(thresholdSchema.parse({ threshold: ' 40 ' })).toEqual({
    threshold: 40,
  });
});

it('requires a rejection reason of at most 500 characters', () => {
  expect(issues(rejectionSchema.safeParse({ reason: '  ' }))).toEqual([
    'reason:invalid_rejection_reason',
  ]);
  expect(
    issues(rejectionSchema.safeParse({ reason: 'r'.repeat(501) })),
  ).toEqual(['reason:rejection_reason_too_long']);
  expect(
    rejectionSchema.parse({ reason: ' Puncte din alt semestru ' }),
  ).toEqual({ reason: 'Puncte din alt semestru' });
});
