import { screen, waitFor, within } from '@testing-library/react';
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
    expect(within(run).getByLabelText('Prag minim')).not.toHaveValue(''),
  );
  return run;
}

const simulatedCall = () =>
  db.rpc.mock.calls.find(([name]) => name === 'simulate_role_evaluation');
const runCall = () =>
  db.rpc.mock.calls.find(([name]) => name === 'run_role_evaluation');

it('simulates, shows the line and the lists, and finalises only after a confirmation that names the consequences', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  const { container } = show(<Host />);
  const run = await ready();

  // The form, prefilled from the settings in force; De la is the day after
  // the kind's last range, Până la is today. The app's picker, no browser field.
  const from = within(run).getByLabelText('De la');
  expect(from).toHaveAttribute('data-slot', 'date-picker');
  expect(from).toHaveAttribute('data-value', '2026-07-01');
  expect(within(run).getByLabelText('Până la')).toHaveAttribute(
    'data-value',
    '2026-09-28',
  );
  expect(run.querySelector('input[type="date"]')).toBeNull();
  expect(within(run).getByLabelText('Prag minim')).toHaveValue('10');
  expect(within(run).getByLabelText('Procent')).toHaveValue(35);
  expect(within(run).getByLabelText('Data limită de intrare')).toHaveAttribute(
    'data-value',
    '2026-03-31',
  );
  // Nothing is saved by looking.
  expect(runCall()).toBeUndefined();

  // A name is not needed to simulate.
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  expect(
    await within(run).findByText('Simulare, nimic nu a fost salvat.'),
  ).toBeVisible();
  expect(simulatedCall()?.[1]).toEqual({
    p_kind: 'voluntar_activ',
    p_from: '2026-07-01',
    p_to: '2026-09-28',
    p_floor: 10,
    p_percent: 35,
    p_cutoff: '2026-03-31',
  });
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
  // The form is gone while the result is up.
  expect(within(run).queryByRole('button', { name: 'Simulează' })).toBeNull();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);

  // Finalizează opens a confirmation first; nothing is written before it.
  await user.type(within(run).getByLabelText('Nume'), '  Semestrul II  ');
  await user.click(within(run).getByRole('button', { name: 'Finalizează' }));
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('heading', {
      name: 'Finalizezi evaluarea „Semestrul II”?',
    }),
  ).toBeVisible();
  expect(dialog).toHaveTextContent(
    'Clasăm punctele de task primite între 01.07.2026 și 28.09.2026 de toți membrii sub BCE care au cel puțin 10 puncte. Pragul de promovare devine punctele ultimului membru din primii 35%: 40 de puncte. Voluntarii intrați până la 31.03.2026 care îl ating devin candidați la promovare; Voluntarii Activi și Voluntarii cu Drept de Vot sub el, sau sub pragul minim, devin semnale de retenție. Nimeni nu este promovat sau retrogradat automat.',
  );
  expect(runCall()).toBeUndefined();

  await user.click(within(dialog).getByRole('button', { name: 'Finalizează' }));
  await waitFor(() => expect(runCall()).toBeDefined());
  expect(
    await within(run).findByText(
      'Evaluarea „Semestrul II” a rulat: 2 candidați la promovare, 1 semnal de retenție.',
    ),
  ).toBeVisible();
  // Back to the form, which starts the next run: the run ended today, so De
  // la waits for a date instead of an inverted default (F-21).
  expect(within(run).getByLabelText('De la')).toHaveAttribute('data-value', '');
  expect(within(run).getByLabelText('Nume')).toHaveValue('');
});

it('finalises with the values the Simulation used', async () => {
  db.runs = [RUN_VA];
  db.simulation = rankedRows();
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();

  const floor = within(run).getByLabelText('Prag minim');
  await user.clear(floor);
  await user.type(floor, '12');
  const percent = within(run).getByLabelText('Procent');
  await user.clear(percent);
  await user.type(percent, '40');
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await within(run).findByRole('button', { name: 'Finalizează' });
  await user.type(within(run).getByLabelText('Nume'), 'Semestrul II');
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
    p_floor: 12,
    p_percent: 40,
    p_cutoff: '2026-03-31',
  });
  expect(runCall()?.[1]).toEqual({
    ...(simulatedCall()?.[1] as object),
    p_name: 'Semestrul II',
  });
  // The values the run used are now the settings in force: the form
  // starts the next one from them.
  await waitFor(() =>
    expect(within(run).getByLabelText('Prag minim')).toHaveValue('12'),
  );
  expect(within(run).getByLabelText('Procent')).toHaveValue(40);
});

it('keeps the typed values on Modifică valorile', async () => {
  db.simulation = rankedRows();
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();

  await pickDate(user, within(run).getByLabelText('De la'), '2026-07-15');
  await user.type(within(run).getByLabelText('Nume'), 'Semestrul II');
  const floor = within(run).getByLabelText('Prag minim');
  await user.clear(floor);
  await user.type(floor, '12');
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
  expect(within(run).getByLabelText('Nume')).toHaveValue('Semestrul II');
  expect(within(run).getByLabelText('Prag minim')).toHaveValue('12');
  expect(within(run).getByLabelText('Procent')).toHaveValue(40);
  expect(within(run).getByLabelText('Data limită de intrare')).toHaveAttribute(
    'data-value',
    '2026-03-31',
  );
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

it('validates the other fields before simulating, nothing is sent', async () => {
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();

  const floor = within(run).getByLabelText('Prag minim');
  await user.clear(floor);
  await user.type(floor, '0');
  const percent = within(run).getByLabelText('Procent');
  await user.clear(percent);
  await user.type(percent, '101');
  await user.click(within(run).getByRole('button', { name: 'Simulează' }));

  expect(floor).toHaveAccessibleDescription(
    'Pragul minim este un număr întreg de cel puțin 1.',
  );
  expect(percent).toHaveAccessibleDescription(
    'Procentul trebuie să fie între 1 și 100.',
  );
  expect(simulatedCall()).toBeUndefined();
  // The name is not one of them.
  expect(within(run).getByLabelText('Nume')).not.toHaveAccessibleDescription(
    /./,
  );
});

it('is disabled until Prag minim is set, and for Voluntar Activ until Data limită de intrare is set', async () => {
  // Nothing is set yet: the Floor is the first thing missing.
  db.settings.eligibility_floor = null;
  db.settings.membership_cutoff = null;
  const user = userEvent.setup();
  const first = show(<Host />);
  let run = await panel();
  let button = await within(run).findByRole('button', { name: 'Simulează' });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(
    'Setează pragul minim înainte de a rula o evaluare.',
  );
  first.unmount();

  // The Floor set: Voluntar Activ still needs its Data limită de intrare.
  db.settings.eligibility_floor = 10;
  show(<Host />);
  run = await ready();
  button = within(run).getByRole('button', { name: 'Simulează' });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(
    'Setează data limită de intrare înainte de a rula evaluarea Voluntar Activ.',
  );

  // The Adunarea Generală has no cutoff: only the Floor was needed.
  await user.click(
    screen.getByRole('button', { name: 'Alege Adunarea Generală' }),
  );
  expect(within(run).queryByLabelText('Data limită de intrare')).toBeNull();
  expect(within(run).getByRole('button', { name: 'Simulează' })).toBeEnabled();
  expect(within(run).getByLabelText('Procent')).toHaveValue(25);
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
  expect(simulatedCall()?.[1]).toEqual({
    p_kind: 'adunarea_generala',
    p_from: '2026-07-01',
    p_to: '2026-09-28',
    p_floor: 10,
    p_percent: 25,
  });
  expect(run).toHaveTextContent('Prag Adunarea Generală: 40 de puncte');
  expect(
    within(run).queryByRole('list', { name: 'Candidați la promovare' }),
  ).toBeNull();
  expect(run).toHaveTextContent(
    'Adunarea Generală nu are candidați la promovare.',
  );
});

it('places a server refusal under its field', async () => {
  db.refuse.set('simulate_role_evaluation', {
    code: 'PT400',
    message: 'invalid_eligibility_floor',
  });
  const user = userEvent.setup();
  show(<Host />);
  const run = await ready();
  await pickDate(user, within(run).getByLabelText('De la'), '2026-09-01');

  await user.click(within(run).getByRole('button', { name: 'Simulează' }));
  await waitFor(() =>
    expect(
      within(run).getByLabelText('Prag minim'),
    ).toHaveAccessibleDescription(
      'Pragul minim este un număr întreg de cel puțin 1.',
    ),
  );
  // Still the form: nothing to finalise.
  expect(within(run).queryByRole('button', { name: 'Finalizează' })).toBeNull();
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
  await user.type(await within(run).findByLabelText('Nume'), 'Semestrul II');
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
});
