import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  db,
  rankedRows,
  resetDb,
  RUN_AG,
  RUN_OLD,
  RUN_VA,
  show,
  type Run,
} from '../../../test/portofoliu-fake';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
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
import { HistoryPanel } from './HistoryPanel';

vi.setConfig({ testTimeout: 20_000 });

function Host({ kind = 'voluntar_activ' }: { kind?: RoleEvaluationKind }) {
  const evaluations = useRoleEvaluations();
  if (!evaluations.data) return null;
  return <HistoryPanel kind={kind} evaluations={evaluations.data} />;
}

/** A later Voluntar Activ run, to see the order. */
const RUN_VA_LATER: Run = {
  ...RUN_VA,
  id: 4,
  name: 'Semestrul II',
  period_from: '2026-07-01',
  period_to: '2026-08-31',
  run_at: '2026-09-01T09:00:00Z',
  threshold_used: 42,
  threshold_computed: 45,
  ranked_count: 9,
  evaluated_count: 14,
};

beforeEach(resetDb);

const panel = async () =>
  (
    await screen.findByRole('heading', {
      name: 'Istoricul evaluărilor',
      level: 2,
    })
  ).closest('section') as HTMLElement;

it('lists the runs of its kind newest first with their values, and opens the ranking of a run', async () => {
  db.runs = [RUN_VA, RUN_AG, RUN_VA_LATER];
  db.rankings.set(RUN_VA.id, rankedRows());
  const user = userEvent.setup();
  show(<Host />);
  const history = await panel();

  const table = within(history).getByRole('table');
  // The kind is the page's section, not a column.
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual([
    'Nume',
    'Interval',
    'Prag minim',
    'Procent',
    'Data limită de intrare',
    'Rulată de',
    'Data',
    'Linia înainte',
    'Linia calculată',
    'Clasați / evaluați',
    'Clasament',
  ]);
  const body = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell'));
  // Newest run first, and only Voluntar Activ's; the Member who ran it opens
  // their card, the rest is text.
  expect(body.map((cells) => cells[0]?.textContent)).toEqual([
    'Semestrul II',
    'Semestrul I',
  ]);
  expect(history).not.toHaveTextContent('AG toamnă');
  expect(
    body.map((cells) => cells.slice(1, 5).map((cell) => cell.textContent)),
  ).toEqual([
    ['01.07.2026–31.08.2026', '10', '35 %', '31.03.2026'],
    ['01.02.2026–30.06.2026', '10', '35 %', '31.03.2026'],
  ]);
  expect(body[0]?.[5]).toHaveTextContent('Bianca Coman');
  expect(
    body.map((cells) => cells.slice(6, 10).map((cell) => cell.textContent)),
  ).toEqual([
    ['01.09.2026', '42', '45', '9 / 14'],
    ['01.07.2026', '30', '42', '8 / 12'],
  ]);

  await user.click(
    within(table).getByRole('button', {
      name: 'Clasamentul evaluării „Semestrul I”',
    }),
  );
  const sheet = await screen.findByRole('dialog');
  expect(
    within(sheet).getByRole('heading', {
      name: 'Clasamentul evaluării „Semestrul I”',
    }),
  ).toBeVisible();
  expect(await within(sheet).findByRole('table')).toBeVisible();
  expect(db.rpc).toHaveBeenCalledWith('role_evaluation_ranking', {
    p_role_evaluation_id: 1,
  });
  // Nobody else's ranking was read.
  expect(db.rpc).not.toHaveBeenCalledWith('role_evaluation_ranking', {
    p_role_evaluation_id: 2,
  });
  expect(db.rpc).not.toHaveBeenCalledWith('role_evaluation_ranking', {
    p_role_evaluation_id: 4,
  });
});

it('lists the runs of the Adunarea Generală and none of Voluntar Activ', async () => {
  db.runs = [RUN_VA, RUN_AG, RUN_VA_LATER];
  show(<Host kind="adunarea_generala" />);
  const history = await panel();

  const table = within(history).getByRole('table');
  // The Adunarea Generală has no Data limită de intrare: no column of dashes.
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual([
    'Nume',
    'Interval',
    'Prag minim',
    'Procent',
    'Rulată de',
    'Data',
    'Linia înainte',
    'Linia calculată',
    'Clasați / evaluați',
    'Clasament',
  ]);
  const body = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell'));
  expect(body.map((cells) => cells[0]?.textContent)).toEqual(['AG toamnă']);
  expect(body[0]?.slice(1, 4).map((cell) => cell.textContent)).toEqual([
    '01.07.2026–20.09.2026',
    '10',
    '25 %',
  ]);
  expect(body[0]?.[4]).toHaveTextContent('Dănuț');
  // A run that ranked nobody has no line of its own.
  expect(body[0]?.slice(5, 9).map((cell) => cell.textContent)).toEqual([
    '21.09.2026',
    '10',
    '—',
    '0 / 5',
  ]);
  expect(history).not.toHaveTextContent('Semestrul');
});

it('shows a dash for a first run, which had no line in force before it', async () => {
  db.runs = [{ ...RUN_VA, threshold_used: null }];
  show(<Host />);
  const history = await panel();
  const cells = within(
    within(history).getAllByRole('row')[1] as HTMLElement,
  ).getAllByRole('cell');
  expect(cells[7]?.textContent).toBe('—');
  expect(cells[8]?.textContent).toBe('42');
});

it('explains a pre-R58 run has no ranking', async () => {
  db.runs = [RUN_OLD];
  const user = userEvent.setup();
  show(<Host />);
  const history = await panel();

  // Its own values were never recorded: dashes, not zeros.
  const cells = within(
    within(history).getAllByRole('row')[1] as HTMLElement,
  ).getAllByRole('cell');
  expect(cells.slice(2, 5).map((cell) => cell.textContent)).toEqual([
    '—',
    '—',
    '—',
  ]);
  expect(cells[9]?.textContent).toBe('—');

  await user.click(
    within(history).getByRole('button', {
      name: 'Clasamentul evaluării „Vechi”',
    }),
  );
  const sheet = await screen.findByRole('dialog');
  expect(sheet).toHaveTextContent(
    'Clasamentul evaluărilor de dinainte de Portofoliu Interne nu mai este disponibil.',
  );
  expect(db.rpc).not.toHaveBeenCalledWith(
    'role_evaluation_ranking',
    expect.anything(),
  );
});

it('says no run has been finalised yet, or none of its kind', async () => {
  const first = show(<Host />);
  const history = await panel();
  expect(
    await within(history).findByText('Nicio evaluare încă.'),
  ).toBeVisible();
  first.unmount();

  db.runs = [RUN_AG];
  show(<Host />);
  expect(
    await within(await panel()).findByText('Nicio evaluare încă.'),
  ).toBeVisible();
});

it('lists the runs as rows under the width the table’s columns fit, so nothing scrolls sideways', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  try {
    db.runs = [RUN_VA, RUN_AG];
    const user = userEvent.setup();
    const va = show(<Host />);
    let history = await panel();
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 96rem)');
    expect(within(history).queryByRole('table')).toBeNull();
    let rows = within(
      within(history).getByRole('list', { name: 'Istoricul evaluărilor' }),
    ).getAllByRole('listitem');
    // Only the kind's runs, and no kind to name: the section says it.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Semestrul I');
    expect(rows[0]).toHaveTextContent('01.02.2026–30.06.2026');
    expect(rows[0]).not.toHaveTextContent('Voluntar Activ');
    expect(rows[0]).toHaveTextContent('Prag minim 10');
    expect(rows[0]).toHaveTextContent('Procent 35 %');
    expect(rows[0]).toHaveTextContent('Data limită de intrare 31.03.2026');
    expect(rows[0]).toHaveTextContent('Prag de promovare înainte 30');
    expect(rows[0]).toHaveTextContent('calculat 42');
    expect(rows[0]).toHaveTextContent('8 / 12');
    expect(history).not.toHaveTextContent('AG toamnă');
    va.unmount();

    show(<Host kind="adunarea_generala" />);
    history = await panel();
    rows = within(
      within(history).getByRole('list', { name: 'Istoricul evaluărilor' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('AG toamnă');
    expect(rows[0]).toHaveTextContent('01.07.2026–20.09.2026');
    expect(rows[0]).toHaveTextContent('Prag minim 10');
    expect(rows[0]).toHaveTextContent('Procent 25 %');
    expect(rows[0]).toHaveTextContent('Prag Adunarea Generală înainte 10');
    expect(rows[0]).toHaveTextContent('calculat —');
    // No cutoff to name: the Adunarea Generală has none.
    expect(rows[0]).not.toHaveTextContent('Data limită de intrare');
    expect(history).not.toHaveTextContent('Semestrul I');

    db.rankings.set(RUN_AG.id, rankedRows());
    await user.click(
      within(rows[0] as HTMLElement).getByRole('button', {
        name: 'Clasamentul evaluării „AG toamnă”',
      }),
    );
    expect(await screen.findByRole('dialog')).toBeVisible();
  } finally {
    vi.unstubAllGlobals();
  }
});
