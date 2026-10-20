import { act, screen, waitFor, within } from '@testing-library/react';
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
  type Signal,
} from '../../../test/portofoliu-fake';
import { pickDate } from '../../../test/date-picker';
import { Where } from '../../../test/where';
import { keys } from '../../../queries/keys';

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

const PAGE = '/administrare/portofoliu-interne';

/** The page with its address beside it, to read what choosing a section writes. */
const page = (search = '') =>
  show(
    <>
      <PortofoliuInterneScreen />
      <Where />
    </>,
    `${PAGE}${search}`,
  );

/** The page's panels, by their titles, in order. */
const shownPanels = () =>
  [...document.querySelectorAll('[data-slot="panel"] h2')].map(
    (heading) => heading.textContent,
  );

const sections = () => screen.getByRole('radiogroup', { name: 'Secțiune' });
const section = (name: string) =>
  within(sections()).getByRole('radio', { name });

/** The run form is up, its Procent prefilled. */
const settledRun = async () => {
  await screen.findByRole('heading', { name: 'Rulează o evaluare', level: 2 });
  await screen.findByLabelText('Procent');
};

const settledSettings = async () => {
  await screen.findByRole('heading', { name: 'Setări', level: 2 });
  await screen.findByText('Praguri în vigoare');
};

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

const aChange = {
  id: 1,
  kind: 'voluntar_activ',
  from_value: 30,
  to_value: 42,
  source: 'role_evaluation',
  changed_by: null,
  role_evaluation_id: 1,
  changed_at: '2026-07-01T09:00:00Z',
};

/** A row of Setări by its label, which is how a member finds it. */
const settingRow = (panel: HTMLElement, label: string) => {
  const found = within(panel)
    .getAllByRole('listitem')
    .find(
      (item) =>
        item.querySelector('[data-slot="sub-heading"]')?.textContent === label,
    );
  if (!found) throw new Error(`No row ${label}`);
  return found;
};

it('offers Voluntar Activ, Adunarea Generală and Setări, and shows each list once it has a row', async () => {
  const first = page();
  await settledRun();
  // One switch of three sections; the old Tip is gone.
  expect(screen.queryByRole('radiogroup', { name: 'Tip' })).toBeNull();
  expect(
    within(sections())
      .getAllByRole('radio')
      .map((radio) => radio.textContent),
  ).toEqual(['Voluntar Activ', 'Adunarea Generală', 'Setări']);
  expect(section('Voluntar Activ')).toBeChecked();
  // No empty candidates, signals or history blocks: the run form alone, in
  // one column.
  await waitFor(() => expect(shownPanels()).toEqual(['Rulează o evaluare']));
  expect(document.querySelector('[data-slot="page-grid"]')).toHaveAttribute(
    'data-columns',
    '1',
  );
  // Prag minim and Data limită de intrare are set in Setări, not here.
  expect(screen.queryByLabelText('Prag minim')).toBeNull();
  expect(screen.queryByLabelText('Data limită de intrare')).toBeNull();
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
  const second = page();
  await screen.findByRole('heading', {
    name: 'Candidați la promovare',
    level: 2,
  });
  expect(shownPanels()).toEqual([
    'Rulează o evaluare',
    'Candidați la promovare',
  ]);
  second.unmount();

  // A run of the kind: its history and its signals follow. The log of changes
  // belongs to Setări, not here.
  db.candidates = [];
  db.runs = [RUN_VA, RUN_AG];
  db.changes = [aChange];
  page();
  await screen.findByRole('heading', {
    name: 'Istoricul evaluărilor',
    level: 2,
  });
  expect(shownPanels()).toEqual([
    'Rulează o evaluare',
    'Candidați la promovare',
    'Semnale de retenție',
    'Istoricul evaluărilor',
  ]);
});

it('shows a kind its Retention Signals once it has one open, with no run behind it', async () => {
  db.signals = [
    signal({
      id: 1,
      kind: 'adunarea_generala',
      member_id: 'eva',
      role_at_listing: 'vot',
      reason: 'not_ubb_student',
      task_points: null,
      threshold_used: null,
      role_evaluation_id: null,
      created_at: '2026-10-02T08:30:00Z',
    }),
  ];
  // Voluntar Activ has none of its own: no panel for it.
  const first = page();
  await settledRun();
  await waitFor(() => expect(shownPanels()).toEqual(['Rulează o evaluare']));
  first.unmount();

  page('?vedere=adunarea-generala');
  await screen.findByRole('heading', { name: 'Semnale de retenție', level: 2 });
  expect(shownPanels()).toEqual(['Rulează o evaluare', 'Semnale de retenție']);
});

it('opens Setări at ?vedere=setari: the settings and the log of changes, no run form', async () => {
  db.runs = [RUN_VA];
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
  db.signals = [signal({ id: 1 })];

  // Nothing logged yet: the settings alone, in one column.
  const first = page('?vedere=setari');
  await settledSettings();
  expect(section('Setări')).toBeChecked();
  expect(shownPanels()).toEqual(['Setări']);
  expect(document.querySelector('[data-slot="page-grid"]')).toHaveAttribute(
    'data-columns',
    '1',
  );
  first.unmount();

  // A change in the log: the two sit side by side, headers aligned.
  db.changes = [aChange];
  page('?vedere=setari');
  await screen.findByRole('heading', {
    name: 'Istoricul modificărilor',
    level: 2,
  });
  expect(shownPanels()).toEqual(['Setări', 'Istoricul modificărilor']);
  const grid = document.querySelector('[data-slot="page-grid"]');
  expect(grid).toHaveAttribute('data-columns', '2');
  expect(grid).toHaveAttribute('data-align-headers', 'true');
  // No form, no lists of the kinds.
  expect(screen.queryByLabelText('Nume')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Simulează' })).toBeNull();
  // Every setting is edited here, Prag minim and Data limită de intrare too.
  const settings = screen
    .getByRole('heading', { name: 'Setări', level: 2 })
    .closest('section') as HTMLElement;
  await within(settings).findByText('Prag minim');
  expect(settingRow(settings, 'Prag minim')).toHaveTextContent('10 puncte');
  expect(settingRow(settings, 'Data limită de intrare')).toHaveTextContent(
    '31.03.2026',
  );
  expect(
    within(settingRow(settings, 'Prag minim')).getByRole('button', {
      name: /Editează/,
    }),
  ).toBeVisible();
});

it('opens a kind at ?vedere=adunarea-generala, with no Candidates panel', async () => {
  db.runs = [RUN_VA, RUN_AG];
  db.candidates = [
    {
      id: 7,
      member_id: 'ana',
      task_points: 48,
      tenure_since: '2026-03-15',
      role_evaluation_id: 1,
      threshold_used: 30,
      created_at: '2026-10-02T08:30:00Z',
      decision: null,
    },
  ];
  page('?vedere=adunarea-generala');
  await settledRun();
  await screen.findByRole('heading', {
    name: 'Istoricul evaluărilor',
    level: 2,
  });
  expect(section('Adunarea Generală')).toBeChecked();
  // Its own share and its own run; the Adunarea Generală has no Candidates.
  expect(screen.getByLabelText('Procent')).toHaveValue(25);
  expect(shownPanels()).toEqual([
    'Rulează o evaluare',
    'Semnale de retenție',
    'Istoricul evaluărilor',
  ]);
  expect(
    screen.queryByRole('heading', { name: 'Candidați la promovare' }),
  ).toBeNull();
});

it.each(['altceva', 'voluntar-activ', 'adunarea_generala', ''])(
  'reads an unknown vedere (%j) as Voluntar Activ',
  async (value) => {
    page(`?vedere=${value}`);
    await settledRun();
    expect(section('Voluntar Activ')).toBeChecked();
    expect(screen.getByLabelText('Procent')).toHaveValue(35);
    expect(
      screen.queryByRole('heading', { name: 'Setări', level: 2 }),
    ).toBeNull();
  },
);

it('writes the section into the address, replacing the entry, and removes it for Voluntar Activ', async () => {
  const user = userEvent.setup();
  page('?alt=1');
  await settledRun();
  const where = screen.getByTestId('where');
  expect(where).toHaveTextContent(`${PAGE}?alt=1`);

  await user.click(section('Adunarea Generală'));
  expect(where).toHaveTextContent(`${PAGE}?alt=1&vedere=adunarea-generala`);
  // Back must not walk through the choices: each one replaces the entry.
  expect(where).toHaveAttribute('data-navigation', 'REPLACE');
  expect(screen.getByLabelText('Procent')).toHaveValue(25);

  await user.click(section('Setări'));
  expect(where).toHaveTextContent(`${PAGE}?alt=1&vedere=setari`);
  await settledSettings();
  expect(section('Setări')).toBeChecked();
  expect(screen.queryByLabelText('Nume')).toBeNull();

  await user.click(section('Voluntar Activ'));
  expect(where).toHaveTextContent(`${PAGE}?alt=1`);
  expect(where).not.toHaveTextContent('vedere');
  await settledRun();
  expect(screen.getByLabelText('Procent')).toHaveValue(35);
});

it('shows a kind only its own Signals and runs, whatever the other has', async () => {
  db.runs = [RUN_VA, RUN_AG];
  db.signals = [
    signal({ id: 1 }),
    signal({
      id: 2,
      kind: 'adunarea_generala',
      member_id: 'eva',
      role_at_listing: 'vot',
      reason: 'not_ubb_student',
      task_points: null,
      threshold_used: null,
      role_evaluation_id: null,
      created_at: '2026-10-02T08:30:00Z',
    }),
  ];
  const user = userEvent.setup();
  page();
  await settledRun();

  // Voluntar Activ: Ana's Signal and Semestrul I, not Eva's and AG toamnă.
  const signalsOf = async (kind: string) =>
    within(
      (
        await screen.findByRole('heading', {
          name: 'Semnale de retenție',
          level: 2,
        })
      ).closest('section') as HTMLElement,
    ).findByRole('list', { name: `Semnale de retenție: ${kind}` });
  const history = async () =>
    (
      await screen.findByRole('heading', {
        name: 'Istoricul evaluărilor',
        level: 2,
      })
    ).closest('section') as HTMLElement;

  const va = await signalsOf('Voluntar Activ');
  expect(va).toHaveTextContent('Ana Pop');
  expect(va).not.toHaveTextContent('Eva Rus');
  let runs = await history();
  expect(runs).toHaveTextContent('Semestrul I');
  expect(runs).not.toHaveTextContent('AG toamnă');
  // One kind in view: no per-kind sub-heading, no Tip column.
  expect(
    document.querySelectorAll('[data-slot="panel"] [data-slot="sub-heading"]'),
  ).toHaveLength(0);
  expect(within(runs).queryByRole('columnheader', { name: 'Tip' })).toBeNull();

  await user.click(section('Adunarea Generală'));
  const ag = await signalsOf('Adunarea Generală');
  expect(ag).toHaveTextContent('Eva Rus');
  expect(ag).not.toHaveTextContent('Ana Pop');
  runs = await history();
  await waitFor(() => expect(runs).toHaveTextContent('AG toamnă'));
  expect(runs).not.toHaveTextContent('Semestrul I');
});

it('lists a kind’s panels once that kind has a row, not when only the other has', async () => {
  // Only Voluntar Activ has run: the Adunarea Generală shows its run form alone.
  db.runs = [RUN_VA];
  db.signals = [signal({ id: 1 })];
  const user = userEvent.setup();
  page();
  await screen.findByRole('heading', {
    name: 'Istoricul evaluărilor',
    level: 2,
  });
  expect(shownPanels()).toEqual([
    'Rulează o evaluare',
    'Candidați la promovare',
    'Semnale de retenție',
    'Istoricul evaluărilor',
  ]);
  await user.click(section('Adunarea Generală'));
  await waitFor(() => expect(shownPanels()).toEqual(['Rulează o evaluare']));
});

it('lists Candidați on Voluntar Activ once a Voluntar Activ run or a Candidate exists, never after an Adunarea Generală run alone', async () => {
  // The Adunarea Generală makes no Candidates: its run is no reason for an
  // empty box on the other kind's view.
  db.runs = [RUN_AG];
  const first = page();
  await settledRun();
  await waitFor(() => expect(shownPanels()).toEqual(['Rulează o evaluare']));
  first.unmount();

  // A Candidate listed between runs is something, with no run of its own.
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
  page();
  await screen.findByRole('heading', {
    name: 'Candidați la promovare',
    level: 2,
  });
  expect(shownPanels()).toEqual([
    'Rulează o evaluare',
    'Candidați la promovare',
  ]);
});

it('keeps each kind’s draft of the run form, apart from the other’s', async () => {
  const user = userEvent.setup();
  page();
  await settledRun();
  await user.type(screen.getByLabelText('Nume'), 'Toamna 2026');
  const percent = screen.getByLabelText('Procent');
  await user.clear(percent);
  await user.type(percent, '40');

  // The Adunarea Generală has a draft of its own: its share, no name yet.
  await user.click(section('Adunarea Generală'));
  expect(screen.getByLabelText('Nume')).toHaveValue('');
  expect(screen.getByLabelText('Procent')).toHaveValue(25);
  expect(screen.queryByLabelText('Data limită de intrare')).toBeNull();
  await user.type(screen.getByLabelText('Nume'), 'AG 2026');

  await user.click(section('Voluntar Activ'));
  expect(screen.getByLabelText('Nume')).toHaveValue('Toamna 2026');
  expect(screen.getByLabelText('Procent')).toHaveValue(40);
  await user.click(section('Adunarea Generală'));
  expect(screen.getByLabelText('Nume')).toHaveValue('AG 2026');
});

it('keeps the typed run form across a visit to Setări', async () => {
  db.runs = [RUN_VA];
  const user = userEvent.setup();
  page();
  await settledRun();
  await pickDate(user, screen.getByLabelText('De la'), '2026-07-15');
  await pickDate(user, screen.getByLabelText('Până la'), '2026-09-20');
  const percent = screen.getByLabelText('Procent');
  await user.clear(percent);
  await user.type(percent, '40');
  await user.type(screen.getByLabelText('Nume'), 'Toamna 2026');

  await user.click(section('Setări'));
  await settledSettings();
  expect(screen.queryByLabelText('Nume')).toBeNull();
  await user.click(section('Voluntar Activ'));
  await settledRun();

  expect(screen.getByLabelText('De la')).toHaveAttribute(
    'data-value',
    '2026-07-15',
  );
  expect(screen.getByLabelText('Până la')).toHaveAttribute(
    'data-value',
    '2026-09-20',
  );
  expect(screen.getByLabelText('Procent')).toHaveValue(40);
  expect(screen.getByLabelText('Nume')).toHaveValue('Toamna 2026');
});

it('keeps the typed run form when the gate’s link leads to Setări and back', async () => {
  db.settings.eligibility_floor = null;
  const user = userEvent.setup();
  const view = page();
  await settledRun();
  await user.type(screen.getByLabelText('Nume'), 'Toamna 2026');

  await user.click(screen.getByRole('link', { name: 'Deschide Setări' }));
  await settledSettings();
  // BC sets the Prag minim there, and goes back.
  db.settings.eligibility_floor = 10;
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: keys.evaluation.all });
  });
  await user.click(section('Voluntar Activ'));
  await settledRun();

  expect(screen.getByLabelText('Nume')).toHaveValue('Toamna 2026');
  expect(screen.getByRole('button', { name: 'Simulează' })).toBeEnabled();
});

it('keeps a shown Simulation across a visit to Setări, and stops it if the Prag minim changed there', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  const view = page();
  await settledRun();
  await user.click(screen.getByRole('button', { name: 'Simulează' }));
  await user.type(await screen.findByLabelText('Nume'), 'Toamna 2026');
  expect(
    await screen.findByText('Simulare, nimic nu a fost salvat.'),
  ).toBeVisible();

  // Nothing changed meanwhile: the Simulation is there as it was left.
  await user.click(section('Setări'));
  await settledSettings();
  await user.click(section('Voluntar Activ'));
  expect(
    await screen.findByText('Simulare, nimic nu a fost salvat.'),
  ).toBeVisible();
  expect(screen.getByLabelText('Nume')).toHaveValue('Toamna 2026');
  const finalize = screen.getByRole('button', { name: 'Finalizează' });
  expect(finalize).toBeEnabled();
  expect(
    db.rpc.mock.calls.filter(([name]) => name === 'simulate_role_evaluation'),
  ).toHaveLength(1);

  // The Prag minim changes in Setări: back on the card, the guard says so.
  await user.click(section('Setări'));
  await settledSettings();
  db.settings.eligibility_floor = 15;
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: keys.evaluation.all });
  });
  await user.click(section('Voluntar Activ'));
  expect(
    await screen.findByText(
      'Pragul minim sau data limită de intrare s-au schimbat după simulare. Simulează din nou.',
    ),
  ).toBeVisible();
  const stale = screen.getByRole('button', { name: 'Finalizează' });
  expect(stale).toBeDisabled();
  // The card still reads what was simulated.
  expect(screen.getByText(/Prag minim 10 puncte/)).toBeVisible();

  // Modifică valorile brings back what was typed, and simulates again.
  await user.click(screen.getByRole('button', { name: 'Modifică valorile' }));
  expect(screen.getByLabelText('Nume')).toHaveValue('Toamna 2026');
  await user.click(screen.getByRole('button', { name: 'Simulează' }));
  await screen.findByRole('button', { name: 'Finalizează' });
  expect(screen.getByRole('button', { name: 'Finalizează' })).toBeEnabled();
  expect(
    db.rpc.mock.calls
      .filter(([name]) => name === 'simulate_role_evaluation')
      .at(-1)?.[1],
  ).toMatchObject({ p_floor: 15 });
});

it('disables the switch while a command is pending', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  let release!: () => void;
  db.hold.set(
    'run_role_evaluation',
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const user = userEvent.setup();
  page();
  await settledRun();
  await user.type(screen.getByLabelText('Nume'), 'Toamna 2026');
  await user.click(screen.getByRole('button', { name: 'Simulează' }));
  await user.click(await screen.findByRole('button', { name: 'Finalizează' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Finalizează',
    }),
  );
  // The confirmation is open over the page, which is then inert: look through.
  const segment = (name: string) =>
    within(
      screen.getByRole('radiogroup', { name: 'Secțiune', hidden: true }),
    ).getByRole('radio', { name, hidden: true });
  await waitFor(() =>
    expect(segment('Setări')).toHaveAttribute('aria-disabled', 'true'),
  );
  expect(segment('Adunarea Generală')).toHaveAttribute('aria-disabled', 'true');
  await act(async () => release());
  await waitFor(() =>
    expect(section('Setări')).not.toHaveAttribute('aria-disabled'),
  );
  expect(section('Adunarea Generală')).not.toHaveAttribute('aria-disabled');
});

it('runs a whole evaluation through the commands of R58, with the settings in force, and calls none of the retired ones', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  page();
  await settledRun();
  const run = screen
    .getByRole('heading', { name: 'Rulează o evaluare' })
    .closest('section') as HTMLElement;

  // A Procent of its own, so the run changes a setting too.
  const percent = within(run).getByLabelText('Procent');
  await user.clear(percent);
  await user.type(percent, '40');
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

  // What the run wrote reaches Setări: the line it computed is now the Prag de
  // promovare in force, naming the run, and the log holds the threshold and
  // the share it changed -- newest first. The Prag minim and the Data limită
  // de intrare were the ones in force, so they are not in it.
  await user.click(section('Setări'));
  await settledSettings();
  const settings = screen
    .getByRole('heading', { name: 'Setări', level: 2 })
    .closest('section') as HTMLElement;
  const thresholdRow = settingRow(settings, 'Prag de promovare');
  await waitFor(() =>
    expect(thresholdRow).toHaveTextContent(
      'calculat de evaluarea „Toamna 2026”',
    ),
  );
  expect(thresholdRow).toHaveTextContent('25 de puncte');
  const log = await screen.findByRole('list', {
    name: 'Istoricul modificărilor',
  });
  await waitFor(() =>
    expect(
      within(log)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '28.09.2026 · Procent Voluntar Activ35 % → 40 %·evaluarea „Toamna 2026”',
      '28.09.2026 · Prag de promovare30 → 25·evaluarea „Toamna 2026”',
    ]),
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
  // The run takes the seven arguments, never the old four: the Prag minim and
  // the cutoff are the settings in force.
  const runArgs = calls.find(([name]) => name === 'run_role_evaluation')?.[1];
  expect(runArgs).toMatchObject({ p_floor: 10, p_cutoff: '2026-03-31' });
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

it('leads from the run form’s gate to Setări, where the missing setting is set', async () => {
  db.settings.eligibility_floor = null;
  const user = userEvent.setup();
  page();
  await settledRun();
  expect(screen.getByRole('button', { name: 'Simulează' })).toBeDisabled();
  await user.click(screen.getByRole('link', { name: 'Deschide Setări' }));
  expect(screen.getByTestId('where')).toHaveTextContent(
    `${PAGE}?vedere=setari`,
  );
  await settledSettings();
  expect(section('Setări')).toBeChecked();
  expect(screen.queryByLabelText('Nume')).toBeNull();
});
