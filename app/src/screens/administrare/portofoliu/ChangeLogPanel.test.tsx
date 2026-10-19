import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { db, resetDb, RUN_VA, show } from '../../../test/portofoliu-fake';
import { useRoleEvaluations } from '../../../queries/role-evaluations';

vi.mock('../../../lib/supabase', async () =>
  (await import('../../../test/portofoliu-fake')).supabaseMock(),
);
vi.mock('../../../lib/auth', async () =>
  (await import('../../../test/portofoliu-fake')).authMock(),
);
vi.mock('../../../queries/member-identities', async () =>
  (await import('../../../test/portofoliu-fake')).identitiesMock(),
);
vi.mock(
  '../../../queries/member-card',
  () => import('../../../test/member-card-mock'),
);
import { ChangeLogPanel } from './ChangeLogPanel';

vi.setConfig({ testTimeout: 20_000 });

function Host() {
  const evaluations = useRoleEvaluations();
  if (!evaluations.data) return null;
  return <ChangeLogPanel evaluations={evaluations.data} />;
}

beforeEach(resetDb);

/** The log, a panel of its own under the page. */
const changeLog = async () => {
  const panel = (
    await screen.findByRole('heading', {
      name: 'Istoricul modificărilor',
      level: 2,
    })
  ).closest('section') as HTMLElement;
  return within(panel).findByRole('list', { name: 'Istoricul modificărilor' });
};

const rowsOf = async () =>
  within(await changeLog())
    .getAllByRole('listitem')
    .map((row) => row.textContent);

it('lists every change of a threshold with its author or run, the word of its field beside the kind', async () => {
  db.runs = [RUN_VA];
  db.changes = [
    {
      id: 1,
      kind: 'voluntar_activ',
      from_value: null,
      to_value: 30,
      source: 'manual',
      changed_by: 'dan',
      role_evaluation_id: null,
      changed_at: '2026-06-01T08:00:00Z',
    },
    {
      id: 2,
      kind: 'voluntar_activ',
      from_value: 30,
      to_value: 42,
      source: 'role_evaluation',
      changed_by: null,
      role_evaluation_id: 1,
      changed_at: '2026-07-01T09:00:00Z',
    },
    {
      id: 3,
      kind: 'adunarea_generala',
      field: 'percent',
      from_value: 20,
      to_value: 35,
      source: 'manual',
      changed_by: 'bc',
      role_evaluation_id: null,
      changed_at: '2026-09-28T11:30:00Z',
    },
  ];
  show(<Host />);

  expect(await rowsOf()).toEqual([
    '28.09.2026 · Adunarea Generală · procent20 % → 35 %·BCBianca Coman',
    '01.07.2026 · Voluntar Activ · prag30 → 42·evaluarea „Semestrul I”',
    '01.06.2026 · Voluntar Activ · pragnesetat → 30·DIDănuț',
  ]);
});

it('lists the three evaluation settings in their own words', async () => {
  db.runs = [RUN_VA];
  db.changes = [
    {
      id: 3,
      kind: null,
      field: 'points_start',
      from_value: null,
      to_value: null,
      from_date: '2026-09-01',
      to_date: '2026-10-01',
      source: 'manual',
      changed_by: 'dan',
      role_evaluation_id: null,
      changed_at: '2026-10-18T08:00:00Z',
    },
    {
      id: 2,
      kind: null,
      field: 'cutoff',
      from_value: null,
      to_value: null,
      from_date: null,
      to_date: '2026-03-01',
      source: 'manual',
      changed_by: 'dan',
      role_evaluation_id: null,
      changed_at: '2026-10-17T08:00:00Z',
    },
    {
      id: 1,
      kind: null,
      field: 'floor',
      from_value: null,
      to_value: 12,
      source: 'manual',
      changed_by: 'dan',
      role_evaluation_id: null,
      changed_at: '2026-10-16T08:00:00Z',
    },
  ];
  show(<Host />);

  // A date change reads as the days, a missing value as a dash, and a
  // setting names itself instead of a kind.
  expect(await rowsOf()).toEqual([
    '18.10.2026 · Data de început a punctajului01.09.2026 → 01.10.2026·DIDănuț',
    '17.10.2026 · Data limită de intrare— → 01.03.2026·DIDănuț',
    '16.10.2026 · Prag minimnesetat → 12·DIDănuț',
  ]);
});

it('says "migrare" for what a migration changed and names the run for what a run changed', async () => {
  db.runs = [RUN_VA];
  db.changes = [
    {
      id: 2,
      kind: 'voluntar_activ',
      field: 'percent',
      from_value: 20,
      to_value: 35,
      source: 'migration',
      changed_by: null,
      role_evaluation_id: null,
      changed_at: '2026-10-18T00:00:00Z',
    },
    {
      id: 1,
      kind: null,
      field: 'floor',
      from_value: 10,
      to_value: 12,
      source: 'role_evaluation',
      changed_by: null,
      role_evaluation_id: 1,
      changed_at: '2026-07-01T09:00:00Z',
    },
  ];
  show(<Host />);

  expect(await rowsOf()).toEqual([
    '18.10.2026 · Voluntar Activ · procent20 % → 35 %·migrare',
    '01.07.2026 · Prag minim10 → 12·evaluarea „Semestrul I”',
  ]);
});

it('keeps the history of the Promotion Rules readable in its old words', async () => {
  db.changes = [
    {
      id: 2,
      kind: null,
      field: 'enabled',
      promotion_rule_id: 1,
      from_value: 1,
      to_value: 0,
      source: 'manual',
      changed_by: 'bc',
      role_evaluation_id: null,
      changed_at: '2026-06-03T08:00:00Z',
    },
    {
      id: 1,
      kind: null,
      field: 'tenure',
      promotion_rule_id: 1,
      from_value: 6,
      to_value: 3,
      source: 'manual',
      changed_by: 'bc',
      role_evaluation_id: null,
      changed_at: '2026-06-02T08:00:00Z',
    },
  ];
  show(<Host />);

  expect(await rowsOf()).toEqual([
    '03.06.2026 · Regulă de promovare · regulă pornităpornită → oprită·BCBianca Coman',
    '02.06.2026 · Regulă de promovare · vechime6 luni → 3 luni·BCBianca Coman',
  ]);
});
