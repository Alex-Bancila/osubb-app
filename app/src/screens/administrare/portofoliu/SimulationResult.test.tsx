import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  db,
  rankedRows,
  resetDb,
  show,
  type Ranked,
} from '../../../test/portofoliu-fake';

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
import { SimulationResult } from './SimulationResult';

vi.setConfig({ testTimeout: 20_000 });

beforeEach(resetDb);

/** The rows as the page hands them over: the app's camelCase shape. */
function rows(raw: Ranked[] = rankedRows()) {
  return raw.map((row) => ({
    memberId: row.member_id,
    role: row.role as 'voluntar',
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

it('shows the line, the counts, the Candidates and the Signals of a Voluntar Activ Simulation', async () => {
  show(
    <SimulationResult kind="voluntar_activ" floor={10} rows={rows()} />,
  );

  expect(screen.getByText('Prag de promovare: 40 de puncte')).toBeVisible();
  expect(screen.getByText('4 clasați din 6 evaluați')).toBeVisible();

  const candidates = screen.getByRole('list', {
    name: 'Candidați la promovare',
  });
  expect(within(candidates).getAllByRole('listitem')).toHaveLength(1);
  expect(candidates).toHaveTextContent('Ion Vlad');
  expect(candidates).toHaveTextContent('55 de puncte');

  const signals = screen.getByRole('list', {
    name: 'Semnale de retenție din simulare',
  });
  const items = within(signals).getAllByRole('listitem');
  // Lowest points first; Voluntar Activ and Drept de Vot only, never a
  // Recrut or a Voluntar.
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining('Mia Toma'),
    expect.stringContaining('Eva Rus'),
    expect.stringContaining('Dănuț'),
  ]);
  expect(items[0]).toHaveTextContent('Voluntar Activ');
  expect(items[0]).toHaveTextContent('sub pragul minim (3 din 10 puncte)');
  expect(items[1]).toHaveTextContent('Voluntar cu Drept de Vot');
  expect(items[1]).toHaveTextContent(
    'sub pragul de promovare (11 din 40 de puncte)',
  );
  expect(items[2]).toHaveTextContent(
    'sub pragul de promovare (12 din 40 de puncte)',
  );
  // What the rows cannot show.
  expect(
    screen.getByText(
      'Semnalele „nu mai este student UBB” se ridică automat la schimbarea universității și apar în Semnale de retenție.',
    ),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Vezi clasamentul' }),
  ).toBeVisible();
});

it('says nobody reaches the Prag minim when nobody was ranked', () => {
  const nobody = rankedRows()
    .slice(4)
    .map((row) => ({ ...row, ranked_count: 0, line: null }));
  show(<SimulationResult kind="voluntar_activ" floor={10} rows={rows(nobody)} />);

  expect(screen.getByText('Nimeni nu atinge pragul minim.')).toBeVisible();
  expect(screen.getByText('0 clasați din 6 evaluați')).toBeVisible();
  expect(
    screen.queryByRole('list', { name: 'Candidați la promovare' }),
  ).toBeNull();
  expect(screen.getByText('Niciun candidat la promovare.')).toBeVisible();
  // The holder among them is a Signal under the Floor.
  expect(
    screen.getByRole('list', { name: 'Semnale de retenție din simulare' }),
  ).toHaveTextContent('sub pragul minim (3 din 10 puncte)');
});

it('says so when the Simulation finds no Signal, and counts one as one', () => {
  const one: Ranked[] = [
    {
      member_id: 'ion',
      role: 'voluntar',
      task_points: 55,
      ranked: true,
      rank: 1,
      evaluated_count: 1,
      ranked_count: 1,
      share_size: 1,
      line: 55,
      inside: true,
      listable: true,
    },
  ];
  show(<SimulationResult kind="voluntar_activ" floor={10} rows={rows(one)} />);

  expect(screen.getByText('1 clasat din 1 evaluat')).toBeVisible();
  expect(screen.getByText('Niciun semnal de retenție în simulare.')).toBeVisible();
});

it('lists no Candidates for the Adunarea Generală, and the open Universitate Signals with its Signals', async () => {
  db.signals = [
    {
      id: 1,
      kind: 'adunarea_generala',
      member_id: 'ana',
      role_at_listing: 'vot',
      reason: 'not_ubb_student',
      task_points: null,
      threshold_used: null,
      role_evaluation_id: null,
      created_at: '2026-10-02T08:00:00Z',
      closed_at: null,
    },
    // Not this kind's, and one that is closed: neither is listed.
    {
      id: 2,
      kind: 'voluntar_activ',
      member_id: 'ion',
      role_at_listing: 'activ',
      reason: 'below_line',
      task_points: 4,
      threshold_used: 30,
      role_evaluation_id: 1,
      created_at: '2026-07-01T09:00:00Z',
      closed_at: null,
    },
    {
      id: 3,
      kind: 'adunarea_generala',
      member_id: 'mia',
      role_at_listing: 'vot',
      reason: 'not_ubb_student',
      task_points: null,
      threshold_used: null,
      role_evaluation_id: null,
      created_at: '2026-10-01T08:00:00Z',
      closed_at: '2026-10-03T08:00:00Z',
    },
  ];
  show(
    <SimulationResult kind="adunarea_generala" floor={10} rows={rows()} />,
  );

  expect(screen.getByText('Prag Adunarea Generală: 40 de puncte')).toBeVisible();
  expect(
    screen.queryByRole('list', { name: 'Candidați la promovare' }),
  ).toBeNull();
  expect(
    screen.getByText('Adunarea Generală nu are candidați la promovare.'),
  ).toBeVisible();

  const signals = await screen.findByRole('list', {
    name: 'Semnale de retenție din simulare',
  });
  await waitFor(() => expect(signals).toHaveTextContent('Ana Pop'));
  expect(signals).toHaveTextContent('nu mai este student UBB');
  // The voter below the line is there too; the other kind's and the closed
  // Signal are not.
  expect(signals).toHaveTextContent('Eva Rus');
  expect(signals).not.toHaveTextContent('Ion Vlad');
  expect(signals).not.toHaveTextContent('Mia Toma');
});

it('opens the whole ranking in a sheet from Vezi clasamentul', async () => {
  const user = userEvent.setup();
  show(
    <SimulationResult kind="voluntar_activ" floor={10} rows={rows()} />,
  );

  await user.click(screen.getByRole('button', { name: 'Vezi clasamentul' }));
  const sheet = await screen.findByRole('dialog');
  expect(
    within(sheet).getByRole('heading', { name: 'Clasamentul simulării' }),
  ).toBeVisible();
  // Every evaluated Member, in the order the read returns them.
  const table = within(sheet).getByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(1 + 6);
});
