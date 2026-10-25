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
import type { RankingRow } from '../../../queries/role-evaluations';

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
import { RankingSheet, RunRankingSheet } from './RankingSheet';

vi.setConfig({ testTimeout: 20_000 });

beforeEach(resetDb);

function rows(): RankingRow[] {
  return rankedRows().map((row) => ({
    memberId: row.member_id,
    role: row.role as RankingRow['role'],
    taskPoints: row.task_points,
    ranked: row.ranked,
    rank: row.rank,
    evaluatedCount: row.evaluated_count,
    rankedCount: row.ranked_count,
    shareSize: row.share_size,
    line: row.line,
    inside: row.inside,
    listable: row.listable,
  }));
}

it('lists every evaluated Member in the order given, with the rank or "sub prag minim"', () => {
  show(
    <RankingSheet
      open
      onOpenChange={() => {}}
      title="Clasamentul simulării"
      kind="voluntar_activ"
      rows={rows()}
    />,
  );

  const sheet = screen.getByRole('dialog');
  expect(
    within(sheet).getByRole('heading', { name: 'Clasamentul simulării' }),
  ).toBeVisible();
  // The line and the counts, as the Simulation card words them.
  expect(sheet).toHaveTextContent('Prag de promovare: 40 de puncte');
  expect(sheet).toHaveTextContent('4 clasați din 6 evaluați');

  const table = within(sheet).getByRole('table');
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Membru', 'Rol', 'Puncte', 'Loc', 'Atinge linia']);
  // Columns are not sortable: the order is the read's.
  expect(within(table).queryByRole('button', { name: /Sortează/ })).toBeNull();
  const body = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell'));
  // The Member's name opens their card, so the first cell carries it.
  expect(body.map(([name]) => name?.textContent)).toEqual([
    expect.stringContaining('Ion Vlad'),
    expect.stringContaining('Ana Pop'),
    expect.stringContaining('Dănuț'),
    expect.stringContaining('Eva Rus'),
    expect.stringContaining('Mia Toma'),
    expect.stringContaining('Radu Cozma'),
  ]);
  expect(
    body.map((cells) => cells.slice(1).map((cell) => cell.textContent)),
  ).toEqual([
    ['Voluntar', '55', '1', 'Da'],
    ['Voluntar', '40', '2', 'Da'],
    ['Voluntar Activ', '12', '3', 'Nu'],
    ['Voluntar cu Drept de Vot', '11', '4', 'Nu'],
    ['Voluntar Activ', '3', 'sub prag minim', 'Nu'],
    ['Recrut', '0', 'sub prag minim', 'Nu'],
  ]);
});

/** The same ranking with Ion (1st) and Mia (under the Floor) as voters. */
function agRows(): RankingRow[] {
  return rows().map((row) =>
    row.memberId === 'ion' || row.memberId === 'mia'
      ? { ...row, role: 'vot' }
      : row,
  );
}

it('lists only the voters on an Adunarea Generală sheet, each at their place among everyone ranked', () => {
  show(
    <RankingSheet
      open
      onOpenChange={() => {}}
      title="Clasamentul simulării"
      kind="adunarea_generala"
      rows={agRows()}
    />,
  );

  const sheet = screen.getByRole('dialog');
  // The line and the counts are still everyone's: they are what the line
  // was read from.
  expect(sheet).toHaveTextContent('Prag Adunarea Generală: 40 de puncte');
  expect(sheet).toHaveTextContent('4 clasați din 6 evaluați');
  expect(sheet).toHaveTextContent(
    'Sunt afișați doar Voluntarii cu Drept de Vot (3). Locul și linia sunt cele din clasamentul tuturor membrilor sub BCE.',
  );

  const table = within(sheet).getByRole('table');
  // Every row would say the same Role, so there is no Rol column.
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Membru', 'Puncte', 'Loc', 'Atinge linia']);
  const body = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell'));
  expect(body.map(([name]) => name?.textContent)).toEqual([
    expect.stringContaining('Ion Vlad'),
    expect.stringContaining('Eva Rus'),
    expect.stringContaining('Mia Toma'),
  ]);
  // The places skip the Members ranked 2nd and 3rd; a voter under the Floor
  // stays listed, since the run signals them.
  expect(
    body.map((cells) => cells.slice(1).map((cell) => cell.textContent)),
  ).toEqual([
    ['55', '1', 'Da'],
    ['11', '4', 'Nu'],
    ['3', 'sub prag minim', 'Nu'],
  ]);
  expect(sheet).not.toHaveTextContent('Ana Pop');
  expect(sheet).not.toHaveTextContent('Dănuț');
  expect(sheet).not.toHaveTextContent('Radu Cozma');
});

it('says no voter was evaluated when an Adunarea Generală ranking holds none', () => {
  show(
    <RankingSheet
      open
      onOpenChange={() => {}}
      title="Clasamentul simulării"
      kind="adunarea_generala"
      rows={rows().filter((row) => row.role !== 'vot')}
    />,
  );
  const sheet = screen.getByRole('dialog');
  expect(sheet).toHaveTextContent('4 clasați din 6 evaluați');
  expect(sheet).toHaveTextContent(
    'Sunt afișați doar Voluntarii cu Drept de Vot (0).',
  );
  expect(
    screen.getByText('Niciun Voluntar cu Drept de Vot nu a fost evaluat.'),
  ).toBeVisible();
});

it('says how many Members it holds when there are none', () => {
  show(
    <RankingSheet
      open
      onOpenChange={() => {}}
      title="Clasamentul simulării"
      kind="voluntar_activ"
      rows={[]}
    />,
  );
  expect(screen.getByText('Nimeni nu a fost evaluat.')).toBeVisible();
});

it('closes from the X', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  show(
    <RankingSheet
      open
      onOpenChange={close}
      title="Clasamentul simulării"
      kind="voluntar_activ"
      rows={rows()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Închide' }));
  // The sheet asks to close; the second argument is its event.
  expect(close.mock.calls[0]?.[0]).toBe(false);
});

it('reads the ranking of a finished run from the server and titles it with the run', async () => {
  db.rankings.set(RUN_VA.id, rankedRows());
  show(<RunRankingSheet run={RUN_VA} onClose={() => {}} />);

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
  expect(sheet).toHaveTextContent('Ion Vlad');
  // The summary states the line the run recorded (42), as its History row
  // does; the rows below are recomputed from today's ledger (line 40).
  expect(sheet).toHaveTextContent('Prag de promovare: 42 de puncte');
  expect(sheet).not.toHaveTextContent('Prag de promovare: 40 de puncte');
});

it('lists only the voters of a finished Adunarea Generală run', async () => {
  db.rankings.set(
    RUN_AG.id,
    rankedRows().map((row) =>
      row.member_id === 'ion' ? { ...row, role: 'vot' } : row,
    ),
  );
  show(<RunRankingSheet run={RUN_AG} onClose={() => {}} />);

  const sheet = await screen.findByRole('dialog');
  const table = await within(sheet).findByRole('table');
  const names = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
  expect(names).toEqual([
    expect.stringContaining('Ion Vlad'),
    expect.stringContaining('Eva Rus'),
  ]);
  expect(sheet).toHaveTextContent(
    'Sunt afișați doar Voluntarii cu Drept de Vot (2).',
  );
});

it('says a run from before Portofoliu Interne has no ranking any more, and asks nothing', async () => {
  show(<RunRankingSheet run={RUN_OLD} onClose={() => {}} />);

  const sheet = await screen.findByRole('dialog');
  expect(sheet).toHaveTextContent(
    'Clasamentul evaluărilor de dinainte de Portofoliu Interne nu mai este disponibil.',
  );
  expect(within(sheet).queryByRole('table')).toBeNull();
  expect(db.rpc).not.toHaveBeenCalledWith(
    'role_evaluation_ranking',
    expect.anything(),
  );
});

it('stays closed while no run is chosen', () => {
  show(<RunRankingSheet run={null} onClose={() => {}} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('offers a retry when the ranking cannot be read', async () => {
  db.refuse.set('role_evaluation_ranking', {
    code: '500',
    message: 'boom',
  });
  show(<RunRankingSheet run={RUN_VA} onClose={() => {}} />);
  const sheet = await screen.findByRole('dialog');
  expect(
    await within(sheet).findByText('Nu am putut încărca clasamentul.'),
  ).toBeVisible();
  expect(
    within(sheet).getByRole('button', { name: 'Reîncarcă clasamentul' }),
  ).toBeVisible();
});
