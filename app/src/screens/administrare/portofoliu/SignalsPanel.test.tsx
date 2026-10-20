import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { db, resetDb, show, type Signal } from '../../../test/portofoliu-fake';

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
import { SignalsPanel } from './SignalsPanel';

vi.setConfig({ testTimeout: 20_000 });

beforeEach(resetDb);

const panel = async () =>
  (
    await screen.findByRole('heading', {
      name: 'Semnale de retenție',
      level: 2,
    })
  ).closest('section') as HTMLElement;

const signal = (extra: Partial<Signal> & { id: number }): Signal => ({
  kind: 'voluntar_activ',
  member_id: 'ana',
  role_at_listing: 'activ',
  reason: 'below_line',
  task_points: 12,
  threshold_used: 40,
  role_evaluation_id: 1,
  created_at: '2026-07-01T09:00:00Z',
  closed_at: null,
  ...extra,
});

it('lists the open Retention Signals with their reason and a link to Roluri', async () => {
  db.signals = [
    // Newest kind first, as the read orders them.
    signal({
      id: 3,
      kind: 'adunarea_generala',
      member_id: 'eva',
      role_at_listing: 'vot',
      reason: 'not_ubb_student',
      task_points: null,
      threshold_used: null,
      role_evaluation_id: null,
      created_at: '2026-10-02T08:30:00Z',
    }),
    signal({ id: 1 }),
    // A Member below the Floor: the Signal stores the run's Prag minim, the
    // figure it was judged by, so no run needs reading for it.
    signal({
      id: 2,
      member_id: 'dan',
      role_at_listing: 'vot',
      reason: 'below_floor',
      task_points: 3,
      threshold_used: 10,
    }),
    // Closed: no longer listed.
    signal({ id: 4, member_id: 'mia', closed_at: '2026-07-02T09:00:00Z' }),
  ];
  const user = userEvent.setup();
  show(<SignalsPanel />);
  const signals = await panel();

  // One group per kind, in the order the read gives.
  const groups = await within(signals).findAllByRole('list');
  expect(groups.map((list) => list.getAttribute('aria-label'))).toEqual([
    'Semnale de retenție: Adunarea Generală',
    'Semnale de retenție: Voluntar Activ',
  ]);
  const [ag, va] = groups as [HTMLElement, HTMLElement];

  const voter = within(ag).getAllByRole('listitem')[0] as HTMLElement;
  expect(voter).toHaveTextContent('Eva Rus');
  expect(voter).toHaveTextContent('Voluntar cu Drept de Vot');
  expect(voter).toHaveTextContent('nu mai este student UBB');
  expect(voter).toHaveTextContent('02.10.2026');

  const rows = within(va).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Ana Pop');
  expect(rows[0]).toHaveTextContent('Voluntar Activ');
  expect(rows[0]).toHaveTextContent(
    'sub pragul de promovare (12 din 40 de puncte)',
  );
  expect(rows[0]).toHaveTextContent('01.07.2026');
  expect(rows[1]).toHaveTextContent('Dănuț');
  expect(rows[1]).toHaveTextContent('sub pragul minim (3 din 10 puncte)');
  expect(signals).not.toHaveTextContent('Mia Toma');

  const link = within(rows[0] as HTMLElement).getByRole('link', {
    name: 'Editează rolul: Ana Pop',
  });
  expect(link).toHaveAttribute('href', '/administrare/roluri?membru=ana');
  await user.click(link);
  expect(screen.getByTestId('where')).toHaveTextContent(
    '/administrare/roluri?membru=ana',
  );
});

// The Adunarea Generală has no promotion: its line has its own name, the one
// the Notification of the same Signal uses.
it('names the Adunarea Generală line for a voter below it, not the promotion one', async () => {
  db.signals = [
    signal({
      id: 1,
      kind: 'adunarea_generala',
      member_id: 'eva',
      role_at_listing: 'vot',
      reason: 'below_line',
      task_points: 12,
      threshold_used: 40,
      role_evaluation_id: 2,
    }),
    signal({ id: 2, member_id: 'ana' }),
  ];
  show(<SignalsPanel />);
  const signals = await panel();
  const ag = await within(signals).findByRole('list', {
    name: 'Semnale de retenție: Adunarea Generală',
  });
  expect(ag).toHaveTextContent(
    'sub pragul Adunării Generale (12 din 40 de puncte)',
  );
  expect(ag).not.toHaveTextContent('pragul de promovare');
  expect(
    within(signals).getByRole('list', {
      name: 'Semnale de retenție: Voluntar Activ',
    }),
  ).toHaveTextContent('sub pragul de promovare (12 din 40 de puncte)');
});

// The hint names both lines a holder can fall under, never a bare "prag".
it('says in its hint that a holder falls under the line of their own evaluation or the Floor', async () => {
  db.signals = [signal({ id: 1 })];
  const user = userEvent.setup();
  show(<SignalsPanel />);
  const signals = await panel();
  await user.click(
    within(signals).getByRole('button', {
      name: 'Despre semnalele de retenție',
    }),
  );
  const hint = await screen.findByText(/Deținători ai rolului găsiți/);
  expect(hint).toHaveTextContent(
    'Deținători ai rolului găsiți de o evaluare sub linia evaluării sale (pragul de promovare sau pragul Adunării Generale) sau sub pragul minim, și votanți care nu mai sunt studenți UBB. Retragerea unui rol este decizia BC, din panoul de roluri.',
  );
});

it('says so when none is open', async () => {
  db.signals = [signal({ id: 1, closed_at: '2026-07-02T09:00:00Z' })];
  show(<SignalsPanel />);
  const signals = await panel();

  expect(
    await within(signals).findByText('Niciun semnal de retenție deschis.'),
  ).toBeVisible();
  expect(within(signals).queryByRole('list')).toBeNull();
});
