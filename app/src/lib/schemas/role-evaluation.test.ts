import { expect, it } from 'vitest';
import {
  percentSchema,
  rejectionSchema,
  runSchema,
  thresholdSchema,
} from './role-evaluation';

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
  floor: ' 10 ',
  percent: '35',
  cutoff: '2026-03-01',
};

it('takes a Role Evaluation as run_role_evaluation checks it (#826, R58)', () => {
  expect(run.parse(valid)).toEqual({
    kind: 'voluntar_activ',
    from: '2026-02-01',
    to: '2026-06-30',
    name: 'Semestrul II',
    floor: 10,
    percent: 35,
    cutoff: '2026-03-01',
  });
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

it('takes a Prag minim of a whole number, at least 1 (R58)', () => {
  for (const floor of ['', '0', '-3', '2.5', 'abc', '2147483648'])
    expect(issues(run.safeParse({ ...valid, floor })), floor).toEqual([
      'floor:invalid_eligibility_floor',
    ]);
  expect(run.parse({ ...valid, floor: '1' }).floor).toBe(1);
});

it('takes a Procent from 1 to 100 (R58)', () => {
  for (const percent of ['', '0', '-3', '2.5', 'abc', '101', '0100'])
    expect(issues(run.safeParse({ ...valid, percent })), percent).toEqual([
      'percent:invalid_percent',
    ]);
  expect(run.parse({ ...valid, percent: '1' }).percent).toBe(1);
  expect(run.parse({ ...valid, percent: '100' }).percent).toBe(100);
});

it('needs a Data limită de intrare, not after today, for Voluntar Activ only (R58)', () => {
  expect(issues(run.safeParse({ ...valid, cutoff: '' }))).toEqual([
    'cutoff:membership_cutoff_not_set',
  ]);
  expect(issues(run.safeParse({ ...valid, cutoff: '2026-09-29' }))).toEqual([
    'cutoff:invalid_membership_cutoff',
  ]);
  expect(run.parse({ ...valid, cutoff: '2026-09-28' }).cutoff).toBe(
    '2026-09-28',
  );
  // The Adunarea Generală has no cutoff: whatever the field holds, the run
  // carries none.
  for (const cutoff of ['', '2026-03-01', '2027-01-01'])
    expect(
      run.parse({ ...valid, kind: 'adunarea_generala', cutoff }).cutoff,
    ).toBeNull();
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

it('takes a whole share from 1 to 100 % (#866)', () => {
  for (const percent of ['', '0', '-3', '2.5', 'abc', '101', '0100'])
    expect(issues(percentSchema.safeParse({ percent })), percent).toEqual([
      'percent:invalid_percent',
    ]);
  expect(percentSchema.parse({ percent: ' 35 ' })).toEqual({ percent: 35 });
  expect(percentSchema.parse({ percent: '1' })).toEqual({ percent: 1 });
  expect(percentSchema.parse({ percent: '100' })).toEqual({ percent: 100 });
});

it('requires a rejection reason of at most 500 characters', () => {
  expect(issues(rejectionSchema.safeParse({ reason: '  ' }))).toEqual([
    'reason:invalid_rejection_reason',
  ]);
  expect(
    issues(rejectionSchema.safeParse({ reason: 'r'.repeat(501) })),
  ).toEqual(['reason:candidate_rejection_reason_too_long']);
  expect(
    rejectionSchema.parse({ reason: ' Puncte din alt semestru ' }),
  ).toEqual({ reason: 'Puncte din alt semestru' });
});
