import { expect, it } from 'vitest';
import {
  percentSchema,
  rejectionSchema,
  runFieldForReason,
  runSchema,
  simulationSchema,
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

// The Prag minim and the Data limită de intrare are settings (Setări), not
// fields of the form: a run takes the ones in force.
const inForce = { floor: 10, cutoff: '2026-03-01' };
const run = runSchema('2026-09-28', inForce);
const valid = {
  kind: 'voluntar_activ',
  from: '2026-02-01',
  to: '2026-06-30',
  name: '  Semestrul II  ',
  percent: '35',
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

// The Simulation writes nothing and records no run, so it has no name: the form
// keeps Nume, Simulează checks every other field, Finalizează the name too.
it('takes a Simulation as simulate_role_evaluation checks it: the run without its name', () => {
  const simulation = simulationSchema('2026-09-28', inForce);
  const { name: _name, ...values } = valid;
  expect(simulation.parse(values)).toEqual({
    kind: 'voluntar_activ',
    from: '2026-02-01',
    to: '2026-06-30',
    floor: 10,
    percent: 35,
    cutoff: '2026-03-01',
  });
  // A name, typed or not, is neither required nor checked, nor carried.
  expect(simulation.parse({ ...values, name: '' })).not.toHaveProperty('name');
  expect(simulation.safeParse({ ...values, name: 'ab' }).success).toBe(true);
  expect(
    simulation.parse({ ...values, name: 'Semestrul II' }),
  ).not.toHaveProperty('name');
  // Every other rule of the run holds.
  expect(issues(simulation.safeParse({ ...values, from: '' }))).toEqual([
    'from:date_required',
  ]);
  expect(issues(simulation.safeParse({ ...values, to: '2026-09-29' }))).toEqual(
    ['to:date_range_in_future'],
  );
  expect(issues(simulation.safeParse({ ...values, percent: '101' }))).toEqual([
    'percent:invalid_percent',
  ]);
  // And the run still asks for the name.
  expect(issues(run.safeParse({ ...values, name: '' }))).toEqual([
    'name:invalid_role_evaluation_name',
  ]);
});

it('needs both days, Până la not before De la and before today (#1131)', () => {
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
  // Today is not a complete day: a range ends yesterday at the latest
  // (#1131). One day, ending yesterday, is fine.
  expect(issues(run.safeParse({ ...valid, to: '2026-09-28' }))).toEqual([
    'to:date_range_in_future',
  ]);
  expect(
    run.safeParse({ ...valid, from: '2026-09-27', to: '2026-09-27' }).success,
  ).toBe(true);
});

it('takes a Procent from 1 to 100 (R58)', () => {
  for (const percent of ['', '0', '-3', '2.5', 'abc', '101', '0100'])
    expect(issues(run.safeParse({ ...valid, percent })), percent).toEqual([
      'percent:invalid_percent',
    ]);
  expect(run.parse({ ...valid, percent: '1' }).percent).toBe(1);
  expect(run.parse({ ...valid, percent: '100' }).percent).toBe(100);
});

it('takes the Prag minim and the Data limită de intrare from the settings in force, never from the form', () => {
  // Whatever a caller puts in the form's input under those names is ignored.
  const values = run.parse({
    ...valid,
    floor: '99',
    cutoff: '2020-01-01',
  } as typeof valid);
  expect(values.floor).toBe(10);
  expect(values.cutoff).toBe('2026-03-01');
  // The settings change, the values follow.
  const other = runSchema('2026-09-28', { floor: 12, cutoff: '2026-05-01' });
  expect(other.parse(valid)).toMatchObject({
    floor: 12,
    cutoff: '2026-05-01',
  });
});

it('refuses a run while the Prag minim is unset, and a Voluntar Activ run while the Data limită de intrare is', () => {
  const floorUnset = runSchema('2026-09-28', { floor: null, cutoff: null });
  expect(issues(floorUnset.safeParse(valid))).toEqual([
    'floor:eligibility_floor_not_set',
    'cutoff:membership_cutoff_not_set',
  ]);
  const cutoffUnset = runSchema('2026-09-28', { floor: 10, cutoff: null });
  expect(issues(cutoffUnset.safeParse(valid))).toEqual([
    'cutoff:membership_cutoff_not_set',
  ]);
  // The Adunarea Generală has no cutoff: only the Floor is needed, and the
  // run carries none whatever the settings hold.
  const ag = { ...valid, kind: 'adunarea_generala' };
  expect(cutoffUnset.parse(ag).cutoff).toBeNull();
  expect(run.parse(ag).cutoff).toBeNull();
  expect(issues(floorUnset.safeParse(ag))).toEqual([
    'floor:eligibility_floor_not_set',
  ]);
});

it('places the reasons of the fields on screen, and none of the settings', () => {
  expect(runFieldForReason).toEqual({
    invalid_role_evaluation_kind: 'kind',
    date_required: 'to',
    invalid_date_range: 'to',
    date_range_in_future: 'to',
    invalid_role_evaluation_name: 'name',
    name_too_short: 'name',
    name_too_long: 'name',
    invalid_percent: 'percent',
  });
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
