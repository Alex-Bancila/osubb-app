import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pickDate } from '../../../test/date-picker';
import {
  db,
  freezeToday,
  rankedRows,
  resetDb,
  RUN_VA,
  show,
} from '../../../test/portofoliu-fake';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import { keys } from '../../../queries/keys';
import {
  useRoleEvaluationCommand,
  useRoleEvaluations,
} from '../../../queries/role-evaluations';

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
import { RunPanel } from './RunPanel';

vi.setConfig({ testTimeout: 20_000 });

/** The panel as the page mounts it: runs and the command from the queries. */
function Host() {
  const [kind, setKind] = useState<RoleEvaluationKind>('voluntar_activ');
  const evaluations = useRoleEvaluations();
  const command = useRoleEvaluationCommand();
  if (!evaluations.data) return null;
  return (
    <>
      <button type="button" onClick={() => setKind('adunarea_generala')}>
        Alege Adunarea Generală
      </button>
      <RunPanel
        kind={kind}
        evaluations={evaluations.data}
        disabled={command.isPending}
        onRun={(next) => command.mutateAsync(next)}
      />
    </>
  );
}

beforeEach(() => {
  freezeToday();
  resetDb();
});
afterEach(() => {
  vi.useRealTimers();
});

const panel = async () =>
  (
    await screen.findByRole('heading', {
      name: 'Rulează o evaluare',
      level: 2,
    })
  ).closest('section') as HTMLElement;

/** The panel once its settings have prefilled the form. */
async function ready() {
  const run = await panel();
  await waitFor(() =>
    expect(within(run).getByLabelText('Procent')).not.toHaveValue(null),
  );
  return run;
}

const simulatedCall = () =>
  db.rpc.mock.calls.find(([name]) => name === 'simulate_role_evaluation');
const lastSimulatedCall = () =>
  db.rpc.mock.calls
    .filter(([name]) => name === 'simulate_role_evaluation')
    .at(-1);
const runCall = () =>
  db.rpc.mock.calls.find(([name]) => name === 'run_role_evaluation');

const SETTINGS_LINK = '/administrare/portofoliu-interne?vedere=setari';
const CHANGED_AFTER_SIMULATION =
  'Pragul minim sau data limită de intrare s-au schimbat după simulare. Simulează din nou.';

/** Another BC member changes a setting while the page is up. */
async function settingsChanged(view: ReturnType<typeof show>) {
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: keys.evaluation.all });
  });
}

it('simulates, shows the line and the lists, and finalises only after a confirmation that names the consequences', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  const { container } = show(<Host />);
  const run = await ready();

  // The form: De la is the day after the kind's last range, Până la is today,
  // Procent is the kind's share in force. The app's picker, no browser field.
  const from = within(run).getByLabelText('De la');
  expect(from).toHaveAttribute('data-slot', 'date-picker');
  expect(from).toHaveAttribute('data-value', '2026-07-01');
  expect(within(run).getByLabelText('Până la')).toHaveAttribute(
    'data-value',
    '2026-09-28',
  );
  expect(run.querySelector('input[type="date"]')).toBeNull();
  expect(within(run).getByLabelText('Procent')).toHaveValue(35);
  // The Prag minim and the Data limită de intrare are set in Setări only.
  expect(within(run).queryByLabelText('Prag minim')).toBeNull();
  expect(within(run).queryByLabelText('Data limită de intrare')).toBeNull();
  // Nothing is saved by looking.
  expect(runCall()).toBeUndefined();

  // A name is not needed to simulate.
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  expect(
    await within(run).findByText('Simulare, nimic nu a fost salvat.'),
  ).toBeVisible();
  // The Floor and the cutoff are the settings in force.
  expect(simulatedCall()?.[1]).toEqual({
    p_kind: 'voluntar_activ',
    p_from: '2026-07-01',
    p_to: '2026-09-28',
    p_floor: 10,
    p_percent: 35,
    p_cutoff: '2026-03-31',
  });
  // The card still names, read-only, what the Simulation used.
  expect(run).toHaveTextContent(
    'Voluntar Activ · 01.07.2026–28.09.2026 · Prag minim 10 puncte · Procent 35 % · Data limită de intrare 31.03.2026',
  );
  // The result: the line, the counts, the lists.
  expect(run).toHaveTextContent('Prag de promovare: 40 de puncte');
  expect(run).toHaveTextContent('4 clasați din 6 evaluați');
  const candidates = within(run).getByRole('list', {
    name: 'Candidați la promovare',
  });
  expect(
    within(candidates)
      .getAllByRole('listitem')
      .map((row) => row.textContent),
  ).toEqual([expect.stringContaining('Ion Vlad')]);
  const signals = within(run).getByRole('list', {
    name: 'Semnale de retenție din simulare',
  });
  expect(
    within(signals)
      .getAllByRole('listitem')
      .map((row) => row.textContent),
  ).toEqual([
    expect.stringContaining('Mia Toma'),
    expect.stringContaining('Eva Rus'),
    expect.stringContaining('Dănuț'),
  ]);
  expect(run).toHaveTextContent('sub pragul minim (3 din 10 puncte)');
  expect(run).toHaveTextContent(
    'sub pragul de promovare (12 din 40 de puncte)',
  );
  // The form is gone while the result is up, and nothing says it is stale.
  expect(within(run).queryByRole('button', { name: 'Simulează' })).toBeNull();
  expect(run).not.toHaveTextContent(CHANGED_AFTER_SIMULATION);
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);

  // Finalizează opens a confirmation first; nothing is written before it.
  await user.type(within(run).getByLabelText('Nume'), '  Toamna 2026  ');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('heading', {
      name: 'Finalizezi evaluarea „Toamna 2026”?',
    }),
  ).toBeVisible();
  expect(dialog).toHaveTextContent(
    'Clasăm punctele de task primite între 01.07.2026 și 28.09.2026 de toți membrii sub BCE care au cel puțin 10 puncte. Pragul de promovare devine punctele ultimului membru din primii 35 %: 40 de puncte. Voluntarii intrați până la 31.03.2026 care îl ating devin candidați la promovare; Voluntarii Activi și Voluntarii cu Drept de Vot sub el, sau sub pragul minim, devin semnale de retenție. Nimeni nu este promovat sau retrogradat automat.',
  );
  expect(runCall()).toBeUndefined();

  await user.click(within(dialog).getByRole('button', { name: 'Finalizează' }));
  await waitFor(() => expect(runCall()).toBeDefined());
  expect(
    await within(run).findByText(
      'Evaluarea „Toamna 2026” a rulat: 2 candidați la promovare, 1 semnal de retenție.',
    ),
  ).toBeVisible();
  // Back to the form, which starts the next run: the run ended today, so De
  // la waits for a date instead of an inverted default (F-21).
  expect(within(run).getByLabelText('De la')).toHaveAttribute('data-value', '');
  expect(within(run).getByLabelText('Nume')).toHaveValue('');
});

it('simulates and runs with the Prag minim and the Data limită de intrare in force, and writes neither back', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  db.settings.eligibility_floor = 12;
  db.settings.membership_cutoff = '2026-05-01';
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();

  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await user.type(await within(run).findByLabelText('Nume'), 'Toamna 2026');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Finalizează',
    }),
  );
  await waitFor(() => expect(runCall()).toBeDefined());

  expect(simulatedCall()?.[1]).toMatchObject({
    p_floor: 12,
    p_cutoff: '2026-05-01',
  });
  expect(runCall()?.[1]).toEqual({
    ...(simulatedCall()?.[1] as object),
    p_name: 'Toamna 2026',
  });
  // The run's write-through of the two is a no-op: they were the ones in force.
  await within(run).findByText(/a rulat/);
  expect(db.settings.eligibility_floor).toBe(12);
  expect(db.settings.membership_cutoff).toBe('2026-05-01');
  expect(
    db.changes.filter((change) => change.field && change.field !== 'threshold'),
  ).toEqual([]);
});

it('finalises with the values the Simulation used', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();

  const percent = within(run).getByLabelText('Procent');
  await user.clear(percent);
  await user.type(percent, '40');
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await within(run).findByRole('button', { name: 'Finalizează' });
  await user.type(within(run).getByLabelText('Nume'), 'Toamna 2026');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Finalizează',
    }),
  );
  await waitFor(() => expect(runCall()).toBeDefined());

  // The seven arguments of the Simulation, and the name.
  expect(simulatedCall()?.[1]).toEqual({
    p_kind: 'voluntar_activ',
    p_from: '2026-07-01',
    p_to: '2026-09-28',
    p_floor: 10,
    p_percent: 40,
    p_cutoff: '2026-03-31',
  });
  expect(runCall()?.[1]).toEqual({
    ...(simulatedCall()?.[1] as object),
    p_name: 'Toamna 2026',
  });
  // The share the run used is now the one in force: the form starts the next
  // run from it.
  await waitFor(() =>
    expect(within(run).getByLabelText('Procent')).toHaveValue(40),
  );
});

it('keeps the typed values on Modifică valorile', async () => {
  db.simulation = rankedRows();
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();

  await pickDate(user, within(run).getByLabelText('De la'), '2026-07-15');
  await user.type(within(run).getByLabelText('Nume'), 'Toamna 2026');
  const percent = within(run).getByLabelText('Procent');
  await user.clear(percent);
  await user.type(percent, '40');
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await user.click(
    await within(run).findByRole('button', { name: 'Modifică valorile' }),
  );

  expect(within(run).getByLabelText('De la')).toHaveAttribute(
    'data-value',
    '2026-07-15',
  );
  expect(within(run).getByLabelText('Până la')).toHaveAttribute(
    'data-value',
    '2026-09-28',
  );
  expect(within(run).getByLabelText('Nume')).toHaveValue('Toamna 2026');
  expect(within(run).getByLabelText('Procent')).toHaveValue(40);
  // Nothing was written by simulating.
  expect(runCall()).toBeUndefined();
});

it('simulates without a name, but Finalizează asks for it before the confirmation opens', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();

  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  expect(simulatedCall()).toBeDefined();

  await user.click(
    await within(run).findByRole('button', { name: 'Finalizează' }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(run).getByLabelText('Nume')).toHaveAccessibleDescription(
    'Scrie numele evaluării.',
  );
  await user.type(within(run).getByLabelText('Nume'), 'ab');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(run).getByLabelText('Nume')).toHaveAccessibleDescription(
    'Numele are cel puțin 3 caractere.',
  );
  expect(runCall()).toBeUndefined();

  await user.type(within(run).getByLabelText('Nume'), 'c');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
});

it('validates its own fields before simulating, nothing is sent', async () => {
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();

  const percent = within(run).getByLabelText('Procent');
  await user.clear(percent);
  await user.type(percent, '101');
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));

  expect(percent).toHaveAccessibleDescription(
    'Procentul trebuie să fie între 1 și 100.',
  );
  expect(simulatedCall()).toBeUndefined();
  // The name is not one of them.
  expect(within(run).getByLabelText('Nume')).not.toHaveAccessibleDescription(
    /./,
  );
});

it.each([
  [
    'voluntar_activ',
    { floor: null, cutoff: null },
    'Setează pragul minim înainte de a rula o evaluare.',
  ],
  [
    'voluntar_activ',
    { floor: 10, cutoff: null },
    'Setează data limită de intrare înainte de a rula evaluarea Voluntar Activ.',
  ],
  [
    'adunarea_generala',
    { floor: null, cutoff: '2026-03-31' },
    'Setează pragul minim înainte de a rula o evaluare.',
  ],
  [
    // The Adunarea Generală has no cutoff: it asks for the Floor alone.
    'adunarea_generala',
    { floor: null, cutoff: null },
    'Setează pragul minim înainte de a rula o evaluare.',
  ],
] as const)(
  'is disabled for %s while a setting it needs is unset: %j, and leads to Setări',
  async (kind, unset, copy) => {
    db.settings.eligibility_floor = unset.floor;
    db.settings.membership_cutoff = unset.cutoff;
    const user = userEvent.setup();
    show(<Host />);
    const run = await panel();
    if (kind === 'adunarea_generala')
      await user.click(
        await screen.findByRole('button', { name: 'Alege Adunarea Generală' }),
      );
    const button = await within(run).findByRole('button', {
      name: 'Simulează',
    });
    expect(button).toBeDisabled();
    // The reason, as the button's description, and a way to the setting.
    expect(button).toHaveAccessibleDescription(copy);
    expect(within(run).getByText(copy)).toBeVisible();
    const link = within(run).getByRole('link', { name: 'Deschide Setări' });
    expect(link).toHaveAttribute('href', SETTINGS_LINK);
    expect(simulatedCall()).toBeUndefined();
  },
);

it('is enabled, with no way to Setări, once what its kind needs is set', async () => {
  // Voluntar Activ needs both; the Adunarea Generală only the Floor.
  db.settings.membership_cutoff = null;
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();
  expect(within(run).getByRole('button', { name: 'Simulează' })).toBeDisabled();
  expect(
    within(run).getByRole('link', { name: 'Deschide Setări' }),
  ).toBeVisible();

  await user.click(
    screen.getByRole('button', { name: 'Alege Adunarea Generală' }),
  );
  expect(within(run).getByRole('button', { name: 'Simulează' })).toBeEnabled();
  expect(within(run).getByLabelText('Procent')).toHaveValue(25);
  expect(
    within(run).queryByRole('link', { name: 'Deschide Setări' }),
  ).toBeNull();
  expect(simulatedCall()).toBeUndefined();
});

it('sends no cutoff for the Adunarea Generală, and lists no candidates', async () => {
  db.simulation = rankedRows();
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();
  await user.click(
    screen.getByRole('button', { name: 'Alege Adunarea Generală' }),
  );
  await pickDate(user, within(run).getByLabelText('De la'), '2026-07-01');
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await within(run).findByRole('button', { name: 'Finalizează' });
  // The Floor is the setting in force; the cutoff, though set, is not sent.
  expect(simulatedCall()?.[1]).toEqual({
    p_kind: 'adunarea_generala',
    p_from: '2026-07-01',
    p_to: '2026-09-28',
    p_floor: 10,
    p_percent: 25,
  });
  expect(run).toHaveTextContent('Prag Adunarea Generală: 40 de puncte');
  expect(run).not.toHaveTextContent('Data limită de intrare');
  expect(
    within(run).queryByRole('list', { name: 'Candidați la promovare' }),
  ).toBeNull();
  expect(run).toHaveTextContent(
    'Adunarea Generală nu are candidați la promovare.',
  );
});

it('places a server refusal about a field under that field', async () => {
  db.refuse.set('simulate_role_evaluation', {
    code: 'PT400',
    message: 'invalid_percent',
  });
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();
  await pickDate(user, within(run).getByLabelText('De la'), '2026-09-01');

  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await waitFor(() =>
    expect(within(run).getByLabelText('Procent')).toHaveAccessibleDescription(
      'Procentul trebuie să fie între 1 și 100.',
    ),
  );
  // Still the form: nothing to finalise, and nothing to fix in Setări.
  expect(within(run).queryByRole('button', { name: 'Finalizează' })).toBeNull();
  expect(
    within(run).queryByRole('link', { name: 'Deschide Setări' }),
  ).toBeNull();
});

it.each([
  [
    'invalid_eligibility_floor',
    'Pragul minim este un număr întreg de cel puțin 1.',
  ],
  [
    'invalid_membership_cutoff',
    'Data limită de intrare este o zi de cel târziu azi.',
  ],
  [
    'membership_cutoff_not_set',
    'Setează data limită de intrare înainte de a rula evaluarea Voluntar Activ.',
  ],
])(
  'shows a server refusal on a setting (%s) as the form’s error, with the way to Setări',
  async (reason, message) => {
    db.refuse.set('simulate_role_evaluation', {
      code: 'PT400',
      message: reason,
    });
    const user = userEvent.setup();
    show(<Host />);
    const run = await ready();
    await pickDate(user, within(run).getByLabelText('De la'), '2026-09-01');

    await user.click(within(run).getByRole('button', { name: 'Simulează' }));
    const error = await within(run).findByText(message);
    expect(error.closest('[role="alert"]')).not.toBeNull();
    expect(
      within(run).getByRole('link', { name: 'Deschide Setări' }),
    ).toHaveAttribute('href', SETTINGS_LINK);
    // No field carries it: there is none for a setting here.
    expect(
      within(run).getByLabelText('Procent'),
    ).not.toHaveAccessibleDescription(/./);
    expect(
      within(run).queryByRole('button', { name: 'Finalizează' }),
    ).toBeNull();

    // The next Simulation starts clean.
    db.refuse.clear();
    db.simulation = rankedRows();
    await user.click(within(run).getByRole('button', { name: 'Simulează' }));
    await within(run).findByRole('button', { name: 'Finalizează' });
    expect(within(run).queryByText(message)).toBeNull();
    expect(
      within(run).queryByRole('link', { name: 'Deschide Setări' }),
    ).toBeNull();
  },
);

it('shows the refusal of a finalised run on a setting beside the result, with the way to Setări', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  db.refuse.set('run_role_evaluation', {
    code: 'PT400',
    message: 'invalid_eligibility_floor',
  });
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await user.type(await within(run).findByLabelText('Nume'), 'Toamna 2026');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Finalizează',
    }),
  );
  expect(
    await within(run).findByText(
      'Pragul minim este un număr întreg de cel puțin 1.',
    ),
  ).toBeVisible();
  expect(
    within(run).getByRole('link', { name: 'Deschide Setări' }),
  ).toHaveAttribute('href', SETTINGS_LINK);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('places the refusal of a finalised run under the name', async () => {
  db.simulation = rankedRows();
  db.refuse.set('run_role_evaluation', {
    code: 'PT400',
    message: 'name_too_long',
  });
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();
  await pickDate(user, within(run).getByLabelText('De la'), '2026-09-01');
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await user.type(await within(run).findByLabelText('Nume'), 'Toamna 2026');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Finalizează',
    }),
  );
  await waitFor(() =>
    expect(within(run).getByLabelText('Nume')).toHaveAccessibleDescription(
      'Numele are cel mult 120 de caractere.',
    ),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    within(run).queryByRole('link', { name: 'Deschide Setări' }),
  ).toBeNull();
});

it('finalises the simulated values even if a share changes meanwhile', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  const view = show(<Host />);
  const run = await ready();
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await within(run).findByRole('button', { name: 'Finalizează' });
  const simulatedWith = simulatedCall()?.[1] as object;
  expect(simulatedWith).toMatchObject({
    p_floor: 10,
    p_percent: 35,
    p_cutoff: '2026-03-31',
  });

  // Another BC member changes the share while the result is up.
  db.settings.activ_percent = 40;
  await settingsChanged(view);

  // The card still reads what was simulated, and so does the confirmation.
  // Only the Prag minim and the Data limită de intrare make it stale.
  expect(run).toHaveTextContent('Prag minim 10 puncte · Procent 35 %');
  expect(run).toHaveTextContent('Data limită de intrare 31.03.2026');
  expect(run).not.toHaveTextContent(CHANGED_AFTER_SIMULATION);
  await user.type(within(run).getByLabelText('Nume'), 'Toamna 2026');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('care au cel puțin 10 puncte');
  expect(dialog).toHaveTextContent('primii 35 %');
  expect(dialog).toHaveTextContent('Voluntarii intrați până la 31.03.2026');
  await user.click(within(dialog).getByRole('button', { name: 'Finalizează' }));
  await waitFor(() => expect(runCall()).toBeDefined());

  // The Simulation's arguments and the name; none of the new share.
  expect(runCall()?.[1]).toEqual({ ...simulatedWith, p_name: 'Toamna 2026' });
});

it.each([
  ['the Prag minim', () => (db.settings.eligibility_floor = 15)],
  [
    'the Data limită de intrare',
    () => (db.settings.membership_cutoff = '2026-05-01'),
  ],
])(
  'will not finalise a Simulation once %s in force has changed, and says so',
  async (_name, change) => {
    db.runs = [RUN_VA];
    db.simulation = rankedRows();
    const user = userEvent.setup();
    const view = show(<Host />);
    const run = await ready();
    await user.click(within(run).getByRole('button', { name: 'Simulează' }));
    const finalize = await within(run).findByRole('button', {
      name: 'Finalizează',
    });
    expect(finalize).toBeEnabled();

    // A live update, or another BC member.
    change();
    await settingsChanged(view);
    expect(
      await within(run).findByText(CHANGED_AFTER_SIMULATION),
    ).toBeVisible();
    expect(finalize).toBeDisabled();
    // The card still reads what was simulated.
    expect(run).toHaveTextContent('Prag minim 10 puncte');
    expect(run).toHaveTextContent('Data limită de intrare 31.03.2026');
    // Nothing finalises behind the disabled button.
    await user.type(within(run).getByLabelText('Nume'), 'Toamna 2026');
    await user.click(finalize);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(runCall()).toBeUndefined();

    // Modifică valorile still works, and the next Simulation reads the values
    // now in force.
    await user.click(
      within(run).getByRole('button', { name: 'Modifică valorile' }),
    );
    expect(within(run).queryByText(CHANGED_AFTER_SIMULATION)).toBeNull();
    await user.click(within(run).getByRole('button', { name: 'Simulează' }));
    await within(run).findByRole('button', { name: 'Finalizează' });
    expect(lastSimulatedCall()?.[1]).toMatchObject({
      p_floor: db.settings.eligibility_floor,
      p_cutoff: db.settings.membership_cutoff,
    });
    expect(lastSimulatedCall()?.[1]).not.toEqual(simulatedCall()?.[1]);
    expect(within(run).queryByText(CHANGED_AFTER_SIMULATION)).toBeNull();
    expect(
      within(run).getByRole('button', { name: 'Finalizează' }),
    ).toBeEnabled();
  },
);

it('closes an open confirmation when the Prag minim changes under it, and writes nothing', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  const view = show(<Host />);
  const run = await ready();
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await user.type(await within(run).findByLabelText('Nume'), 'Toamna 2026');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  await screen.findByRole('dialog');

  db.settings.eligibility_floor = 15;
  await settingsChanged(view);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await within(run).findByText(CHANGED_AFTER_SIMULATION)).toBeVisible();
  expect(runCall()).toBeUndefined();
});

it('stales an Adunarea Generală Simulation by the Prag minim only, never by the cutoff it does not use', async () => {
  db.simulation = rankedRows();
  const user = userEvent.setup();
  const view = show(<Host />);
  const run = await ready();
  await user.click(
    screen.getByRole('button', { name: 'Alege Adunarea Generală' }),
  );
  await pickDate(user, within(run).getByLabelText('De la'), '2026-07-01');
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await within(run).findByRole('button', { name: 'Finalizează' });

  // The cutoff is Voluntar Activ's: this kind does not care.
  db.settings.membership_cutoff = '2026-05-01';
  await settingsChanged(view);
  expect(run).not.toHaveTextContent(CHANGED_AFTER_SIMULATION);
  expect(
    within(run).getByRole('button', { name: 'Finalizează' }),
  ).toBeEnabled();

  // The Prag minim is shared.
  db.settings.eligibility_floor = 15;
  await settingsChanged(view);
  expect(await within(run).findByText(CHANGED_AFTER_SIMULATION)).toBeVisible();
  expect(
    within(run).getByRole('button', { name: 'Finalizează' }),
  ).toBeDisabled();
});

it('records no line when the Simulation ranked nobody, and the confirmation says so', async () => {
  db.runs = [RUN_VA];
  // Every row is under the Prag minim: nobody is ranked, so there is no line.
  db.simulation = rankedRows()
    .slice(4)
    .map((row) => ({ ...row, ranked_count: 0, line: null }));
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  expect(
    await within(run).findByText('Nimeni nu atinge pragul minim.'),
  ).toBeVisible();
  await user.type(within(run).getByLabelText('Nume'), 'Toamna 2026');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(
    'Nimeni nu atinge pragul minim: evaluarea se înregistrează fără un nou Prag de promovare, iar toți deținătorii devin semnale de retenție.',
  );
  expect(dialog).not.toHaveTextContent('devine punctele ultimului membru');
  expect(runCall()).toBeUndefined();
});

it('names the Nume field Nume, whatever the placeholder says', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();
  const field = within(run).getByRole('textbox', { name: 'Nume' });
  expect(field).toHaveAttribute('placeholder', 'Toamna 2026');
  // The same field once the Simulation is up.
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  expect(
    await within(run).findByRole('textbox', { name: 'Nume' }),
  ).toBeVisible();
});

it('moves focus with the view: to the result, to the first field, to the receipt', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();
  // One live region for the whole panel, there before anything is said.
  const status = run.querySelector('[role="status"]');
  expect(status).not.toBeNull();
  expect(status).toBeEmptyDOMElement();

  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  const line = await within(run).findByText('Prag de promovare: 40 de puncte');
  await waitFor(() => expect(line).toHaveFocus());

  await user.click(
    within(run).getByRole('button', { name: 'Modifică valorile' }),
  );
  await waitFor(() =>
    expect(within(run).getByLabelText('De la')).toHaveFocus(),
  );

  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await user.type(await within(run).findByLabelText('Nume'), 'Toamna 2026');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Finalizează',
    }),
  );
  const receipt = await within(run).findByText(
    'Evaluarea „Toamna 2026” a rulat: 2 candidați la promovare, 1 semnal de retenție.',
  );
  await waitFor(() => expect(receipt).toHaveFocus());
  // The same live region said it: it was not mounted with its text in it.
  expect(run.querySelector('[role="status"]')).toBe(status);
  expect(status).toContainElement(receipt);
});
