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
} from '../../../test/portofoliu-fake';
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

function Host() {
  const evaluations = useRoleEvaluations();
  if (!evaluations.data) return null;
  return <HistoryPanel evaluations={evaluations.data} />;
}

beforeEach(resetDb);

const panel = async () =>
  (
    await screen.findByRole('heading', {
      name: 'Istoricul evaluărilor',
      level: 2,
    })
  ).closest('section') as HTMLElement;

it('lists runs newest first with their values, and opens the ranking of a run', async () => {
  db.runs = [RUN_VA, RUN_AG];
  db.rankings.set(RUN_VA.id, rankedRows());
  const user = userEvent.setup();
  show(<Host />);
  const history = await panel();

  const table = within(history).getByRole('table');
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual([
    'Nume',
    'Tip',
    'Interval',
    'Prag minim',
    'Procent',
    'Data limită de intrare',
    'Rulată de',
    'Data',
    'Prag de promovare înainte',
    'Prag de promovare calculat',
    'Clasați / evaluați',
    'Clasament',
  ]);
  const body = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell'));
  // Newest run first; the Member who ran it opens their card, the rest is text.
  expect(body.map((cells) => cells[0]?.textContent)).toEqual([
    'AG toamnă',
    'Semestrul I',
  ]);
  expect(
    body.map((cells) =>
      cells.slice(1, 6).map((cell) => cell.textContent),
    ),
  ).toEqual([
    ['Adunarea Generală', '01.07.2026–20.09.2026', '10', '25 %', '—'],
    ['Voluntar Activ', '01.02.2026–30.06.2026', '10', '35 %', '31.03.2026'],
  ]);
  expect(body[0]?.[6]).toHaveTextContent('Dănuț');
  expect(body[1]?.[6]).toHaveTextContent('Bianca Coman');
  expect(
    body.map((cells) => cells.slice(7, 11).map((cell) => cell.textContent)),
  ).toEqual([
    // A run that ranked nobody has no line of its own.
    ['21.09.2026', '10', '—', '0 / 5'],
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
});

it('shows a dash for a first run, which had no line in force before it', async () => {
  db.runs = [{ ...RUN_VA, threshold_used: null }];
  show(<Host />);
  const history = await panel();
  const cells = within(
    within(history).getAllByRole('row')[1] as HTMLElement,
  ).getAllByRole('cell');
  expect(cells[8]?.textContent).toBe('—');
  expect(cells[9]?.textContent).toBe('42');
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
  expect(cells.slice(3, 6).map((cell) => cell.textContent)).toEqual([
    '—',
    '—',
    '—',
  ]);
  expect(cells[10]?.textContent).toBe('—');

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

it('says no run has been finalised yet', async () => {
  show(<Host />);
  const history = await panel();
  expect(
    await within(history).findByText('Nicio evaluare încă.'),
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
    show(<Host />);
    const history = await panel();
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 96rem)');
    expect(within(history).queryByRole('table')).toBeNull();
    const rows = within(
      within(history).getByRole('list', { name: 'Istoricul evaluărilor' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('AG toamnă');
    expect(rows[0]).toHaveTextContent('Adunarea Generală · 01.07.2026–20.09.2026');
    expect(rows[0]).toHaveTextContent('Prag minim 10');
    expect(rows[0]).toHaveTextContent('Procent 25 %');
    expect(rows[1]).toHaveTextContent('Semestrul I');
    expect(rows[1]).toHaveTextContent('Data limită de intrare 31.03.2026');
    expect(rows[1]).toHaveTextContent('înainte 30');
    expect(rows[1]).toHaveTextContent('calculat 42');
    expect(rows[1]).toHaveTextContent('8 / 12');

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
