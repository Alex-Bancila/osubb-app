import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  db,
  freezeToday,
  rankedRows,
  resetDb,
  RUN_AG,
  RUN_VA,
  show,
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
// #1012 (R37): opening the list reads its Notifications; observed elsewhere.
vi.mock('../../../queries/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../queries/notifications')>()),
  useReadNotificationsAbout: vi.fn(),
}));
import PortofoliuInterneScreen from './PortofoliuInterneScreen';

vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  freezeToday();
  resetDb();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The page's panels, by their titles, in order. */
const shownPanels = () =>
  [...document.querySelectorAll('[data-slot="panel"] h2')].map(
    (heading) => heading.textContent,
  );

const settled = async () => {
  await screen.findByRole('heading', { name: 'Setări', level: 2 });
  await waitFor(() =>
    expect(screen.getByLabelText('Prag minim')).not.toHaveValue(''),
  );
};

it('shows Run and Setări before the first run, and the lists once something exists', async () => {
  const first = show(<PortofoliuInterneScreen />);
  await settled();
  // Tip is one choice of two for the page; the tenure view is gone.
  const kinds = screen.getByRole('radiogroup', { name: 'Tip' });
  expect(
    within(kinds)
      .getAllByRole('radio')
      .map((radio) => radio.textContent),
  ).toEqual(['Voluntar Activ', 'Adunarea Generală']);
  expect(
    within(kinds).getByRole('radio', { name: 'Voluntar Activ' }),
  ).toBeChecked();
  // No empty candidates, signals, history or log blocks.
  await waitFor(() =>
    expect(shownPanels()).toEqual(['Rulează o evaluare', 'Setări']),
  );
  // The two boxes of the first row start on one line (X9).
  expect(document.querySelector('[data-slot="page-grid"]')).toHaveAttribute(
    'data-align-headers',
    'true',
  );
  expect(
    (
      await axe.run(first.container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  expect(db.rpc).not.toHaveBeenCalledWith(
    'role_evaluation_ranking',
    expect.anything(),
  );
  first.unmount();

  // A Candidate listed between runs is something, even with no run yet.
  db.candidates = [
    {
      id: 7,
      member_id: 'ana',
      task_points: 48,
      tenure_since: '2026-03-15',
      role_evaluation_id: null,
      threshold_used: 30,
      created_at: '2026-10-02T08:30:00Z',
      decision: null,
    },
  ];
  const second = show(<PortofoliuInterneScreen />);
  await screen.findByRole('heading', {
    name: 'Candidați la promovare',
    level: 2,
  });
  expect(shownPanels()).toEqual([
    'Rulează o evaluare',
    'Setări',
    'Candidați la promovare',
  ]);
  second.unmount();

  // A run, a log entry: the history, the signals and the log follow.
  db.candidates = [];
  db.runs = [RUN_VA, RUN_AG];
  db.changes = [
    {
      id: 1,
      kind: 'voluntar_activ',
      from_value: 30,
      to_value: 42,
      source: 'role_evaluation',
      changed_by: null,
      role_evaluation_id: 1,
      changed_at: '2026-07-01T09:00:00Z',
    },
  ];
  show(<PortofoliuInterneScreen />);
  await screen.findByRole('heading', {
    name: 'Istoricul modificărilor',
    level: 2,
  });
  expect(shownPanels()).toEqual([
    'Rulează o evaluare',
    'Setări',
    'Candidați la promovare',
    'Semnale de retenție',
    'Istoricul evaluărilor',
    'Istoricul modificărilor',
  ]);
});

it('shows the Retention Signals once one is open, with no run behind it', async () => {
  db.signals = [
    {
      id: 1,
      kind: 'adunarea_generala',
      member_id: 'eva',
      role_at_listing: 'vot',
      reason: 'not_ubb_student',
      task_points: null,
      threshold_used: null,
      role_evaluation_id: null,
      created_at: '2026-10-02T08:30:00Z',
      closed_at: null,
    },
  ];
  show(<PortofoliuInterneScreen />);
  await screen.findByRole('heading', {
    name: 'Semnale de retenție',
    level: 2,
  });
  expect(shownPanels()).toEqual([
    'Rulează o evaluare',
    'Setări',
    'Semnale de retenție',
  ]);
});

it('switches the run form between the two kinds, and nothing else', async () => {
  const user = userEvent.setup();
  show(<PortofoliuInterneScreen />);
  await settled();
  const run = (
    await screen.findByRole('heading', { name: 'Rulează o evaluare' })
  ).closest('section') as HTMLElement;
  expect(within(run).getByLabelText('Procent')).toHaveValue(35);
  expect(within(run).getByLabelText('Data limită de intrare')).toBeVisible();

  await user.click(
    within(screen.getByRole('radiogroup', { name: 'Tip' })).getByRole('radio', {
      name: 'Adunarea Generală',
    }),
  );
  expect(within(run).getByLabelText('Procent')).toHaveValue(25);
  expect(within(run).queryByLabelText('Data limită de intrare')).toBeNull();
  // The settings show both kinds' numbers whichever is chosen.
  const settings = (
    await screen.findByRole('heading', { name: 'Setări', level: 2 })
  ).closest('section') as HTMLElement;
  expect(settings).toHaveTextContent('Procent Voluntar Activ');
  expect(settings).toHaveTextContent('Procent Adunarea Generală');
});

it('runs a whole evaluation through the commands of R58 and calls none of the retired ones', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  show(<PortofoliuInterneScreen />);
  await settled();
  const run = (
    await screen.findByRole('heading', { name: 'Rulează o evaluare' })
  ).closest('section') as HTMLElement;

  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await user.type(await within(run).findByLabelText('Nume'), 'Toamna 2026');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Finalizează',
    }),
  );
  await within(run).findByText(
    'Evaluarea „Toamna 2026” a rulat: 2 candidați la promovare, 1 semnal de retenție.',
  );

  const calls = db.rpc.mock.calls;
  const called = calls.map(([name]) => name);
  for (const retired of [
    'update_promotion_rule',
    'apply_promotions',
    'open_evaluation_period',
    'close_evaluation_period',
    'set_promotion_rule',
    'retention_ranking',
    'evaluation_period_ranking',
    'promotion_threshold_in_force',
  ])
    expect(called).not.toContain(retired);
  // The run takes the seven arguments, never the old four.
  const runArgs = calls.find(([name]) => name === 'run_role_evaluation')?.[1];
  expect(Object.keys(runArgs).sort()).toEqual([
    'p_cutoff',
    'p_floor',
    'p_from',
    'p_kind',
    'p_name',
    'p_percent',
    'p_to',
  ]);
});
