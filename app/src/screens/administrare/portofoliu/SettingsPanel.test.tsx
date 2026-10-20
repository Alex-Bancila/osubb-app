import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { pickDate } from '../../../test/date-picker';
import {
  db,
  freezeToday,
  resetDb,
  RUN_VA,
  show,
} from '../../../test/portofoliu-fake';
import { useEvaluationSettingCommand } from '../../../queries/evaluation-settings';
import {
  usePromotionThresholds,
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
import { ReceiptTurnScope } from '../../tracker/ReceiptTurnScope';
import { SettingsPanel } from './SettingsPanel';

vi.setConfig({ testTimeout: 30_000 });

/** The panel as the page mounts it. */
function Host() {
  const evaluations = useRoleEvaluations();
  const thresholds = usePromotionThresholds();
  const command = useRoleEvaluationCommand();
  const setting = useEvaluationSettingCommand();
  if (!evaluations.data || !thresholds.data) return null;
  return (
    <ReceiptTurnScope>
      <SettingsPanel
        evaluations={evaluations.data}
        thresholds={thresholds.data}
        disabled={command.isPending || setting.isPending}
        onRun={(next) => command.mutateAsync(next)}
        onSetting={(next) => setting.mutateAsync(next)}
      />
    </ReceiptTurnScope>
  );
}

beforeEach(() => {
  freezeToday();
  resetDb();
});
afterEach(() => {
  vi.useRealTimers();
});

const settings = async () => {
  const section = (
    await screen.findByRole('heading', { name: 'Setări', level: 2 })
  ).closest('section') as HTMLElement;
  // Rows follow once the settings and the thresholds are read.
  await within(section).findByText('Prag minim');
  return section;
};

/** A row by its label, which is how a member finds it. */
const row = (panel: HTMLElement, label: string) => {
  const found = within(panel)
    .getAllByRole('listitem')
    .find(
      (item) =>
        item.querySelector('[data-slot="sub-heading"]')?.textContent === label,
    );
  if (!found) throw new Error(`No row ${label}`);
  return found;
};

const save = (user: ReturnType<typeof userEvent.setup>, within_: HTMLElement) =>
  user.click(within(within_).getByRole('button', { name: 'Salvează' }));

it('lists the five settings and, under Praguri în vigoare, the two thresholds', async () => {
  db.settings.points_start_date = null;
  const { container } = show(<Host />);
  const panel = await settings();

  const labels = within(panel)
    .getAllByRole('listitem')
    .map(
      (item) => item.querySelector('[data-slot="sub-heading"]')?.textContent,
    );
  expect(labels).toEqual([
    'Prag minim',
    'Data limită de intrare',
    'Data de început a punctajului',
    'Procent Voluntar Activ',
    'Procent Adunarea Generală',
    'Prag de promovare',
    'Prag Adunarea Generală',
  ]);
  expect(row(panel, 'Prag minim')).toHaveTextContent('10 puncte');
  expect(row(panel, 'Data limită de intrare')).toHaveTextContent('31.03.2026');
  expect(row(panel, 'Data de început a punctajului')).toHaveTextContent(
    'Nesetat',
  );
  expect(row(panel, 'Procent Voluntar Activ')).toHaveTextContent('35 %');
  expect(row(panel, 'Procent Adunarea Generală')).toHaveTextContent('25 %');
  expect(row(panel, 'Prag de promovare')).toHaveTextContent('30 de puncte');
  expect(row(panel, 'Prag Adunarea Generală')).toHaveTextContent('Nesetat');
  // The thresholds sit under their own sub-heading.
  expect(
    within(panel).getByRole('heading', { name: 'Praguri în vigoare' }),
  ).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('edits each setting on Salvează and logs it', async () => {
  db.runs = [RUN_VA];
  const user = userEvent.setup();
  show(<Host />);
  const panel = await settings();

  // Prag minim: a whole number, at least 1, checked before the server is asked.
  await user.click(
    within(panel).getByRole('button', { name: 'Editează Prag minim' }),
  );
  const floor = within(panel).getByLabelText('Valoare nouă pentru Prag minim');
  expect(floor).toHaveFocus();
  expect(floor).toHaveValue('10');
  await user.clear(floor);
  await user.type(floor, '0');
  await save(user, row(panel, 'Prag minim'));
  expect(floor).toHaveAccessibleDescription(
    /Pragul minim este un număr întreg de cel puțin 1\./,
  );
  expect(db.rpc).not.toHaveBeenCalledWith(
    'set_eligibility_floor',
    expect.anything(),
  );
  await user.clear(floor);
  await user.type(floor, '12');
  await save(user, row(panel, 'Prag minim'));
  expect(db.rpc).toHaveBeenCalledWith('set_eligibility_floor', {
    p_points: 12,
  });
  expect(
    await within(panel).findByText('Prag minim a fost salvat.'),
  ).toBeVisible();
  await waitFor(() =>
    expect(row(panel, 'Prag minim')).toHaveTextContent('12 puncte'),
  );
  expect(row(panel, 'Prag minim')).toHaveTextContent('schimbat de');
  expect(row(panel, 'Prag minim')).toHaveTextContent('Bianca Coman');
  // Back from the editor, focus returns to the pencil that opened it.
  expect(
    within(panel).getByRole('button', { name: 'Editează Prag minim' }),
  ).toHaveFocus();

  // Data limită de intrare: a day, not after today.
  await user.click(
    within(panel).getByRole('button', {
      name: 'Editează Data limită de intrare',
    }),
  );
  await pickDate(
    user,
    within(panel).getByLabelText('Valoare nouă pentru Data limită de intrare'),
    '2026-03-15',
  );
  await save(user, row(panel, 'Data limită de intrare'));
  expect(db.rpc).toHaveBeenCalledWith('set_membership_cutoff', {
    p_date: '2026-03-15',
  });
  await waitFor(() =>
    expect(row(panel, 'Data limită de intrare')).toHaveTextContent(
      '15.03.2026',
    ),
  );

  // Data de început a punctajului.
  await user.click(
    within(panel).getByRole('button', {
      name: 'Editează Data de început a punctajului',
    }),
  );
  await pickDate(
    user,
    within(panel).getByLabelText(
      'Valoare nouă pentru Data de început a punctajului',
    ),
    '2026-09-01',
  );
  await save(user, row(panel, 'Data de început a punctajului'));
  expect(db.rpc).toHaveBeenCalledWith('set_points_start_date', {
    p_date: '2026-09-01',
  });
  await waitFor(() =>
    expect(row(panel, 'Data de început a punctajului')).toHaveTextContent(
      '01.09.2026',
    ),
  );

  // The two shares, each its own row.
  await user.click(
    within(panel).getByRole('button', {
      name: 'Editează Procent Adunarea Generală',
    }),
  );
  const share = within(panel).getByLabelText(
    'Valoare nouă pentru Procent Adunarea Generală',
  );
  expect(share).toHaveValue(25);
  await user.clear(share);
  await user.type(share, '101');
  await save(user, row(panel, 'Procent Adunarea Generală'));
  expect(share).toHaveAccessibleDescription(
    /Procentul trebuie să fie între 1 și 100\./,
  );
  await user.clear(share);
  await user.type(share, '30');
  await save(user, row(panel, 'Procent Adunarea Generală'));
  expect(db.rpc).toHaveBeenCalledWith('set_evaluation_percent', {
    p_kind: 'adunarea_generala',
    p_percent: 30,
  });
  await waitFor(() =>
    expect(row(panel, 'Procent Adunarea Generală')).toHaveTextContent('30 %'),
  );
  await user.click(
    within(panel).getByRole('button', {
      name: 'Editează Procent Voluntar Activ',
    }),
  );
  const activ = within(panel).getByLabelText(
    'Valoare nouă pentru Procent Voluntar Activ',
  );
  await user.clear(activ);
  await user.type(activ, '40');
  await save(user, row(panel, 'Procent Voluntar Activ'));
  expect(db.rpc).toHaveBeenCalledWith('set_evaluation_percent', {
    p_kind: 'voluntar_activ',
    p_percent: 40,
  });
  await waitFor(() =>
    expect(row(panel, 'Procent Voluntar Activ')).toHaveTextContent('40 %'),
  );

  // One receipt at a time: the share's replaces the setting's.
  expect(
    within(panel).getByText('Procent Voluntar Activ a fost salvat.'),
  ).toBeVisible();
  expect(within(panel).queryByText('Prag minim a fost salvat.')).toBeNull();

  // Every change is in the log, each by this Member.
  expect(
    db.changes.map(({ field, source, changed_by }) => [
      field,
      source,
      changed_by,
    ]),
  ).toEqual([
    ['floor', 'manual', 'bc'],
    ['cutoff', 'manual', 'bc'],
    ['points_start', 'manual', 'bc'],
    ['percent', 'manual', 'bc'],
    ['percent', 'manual', 'bc'],
  ]);
});

it('names where each last change came from: a Member, a run, a migration', async () => {
  db.runs = [RUN_VA];
  db.changes = [
    {
      id: 1,
      kind: null,
      field: 'floor',
      from_value: null,
      to_value: 10,
      source: 'manual',
      changed_by: 'dan',
      role_evaluation_id: null,
      changed_at: '2026-06-01T08:00:00Z',
    },
    {
      id: 2,
      kind: null,
      field: 'cutoff',
      from_value: null,
      to_value: null,
      from_date: null,
      to_date: '2026-03-31',
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
      to_value: 25,
      source: 'migration',
      changed_by: null,
      role_evaluation_id: null,
      changed_at: '2026-10-18T00:00:00Z',
    },
  ];
  show(<Host />);
  const panel = await settings();

  await waitFor(() =>
    expect(row(panel, 'Prag minim')).toHaveTextContent(/schimbat de.*Dănuț/),
  );
  expect(row(panel, 'Data limită de intrare')).toHaveTextContent(
    'schimbat de evaluarea „Semestrul I”',
  );
  expect(row(panel, 'Procent Adunarea Generală')).toHaveTextContent(
    'schimbat prin migrare',
  );
  // No change in the log, nothing said.
  expect(row(panel, 'Data de început a punctajului')).not.toHaveTextContent(
    'schimbat',
  );
});

it("shows a refusal under the row's field", async () => {
  const user = userEvent.setup();
  show(<Host />);
  const panel = await settings();

  // The server's own reason for a Floor, under the Floor's field.
  db.refuse.set('set_eligibility_floor', {
    code: 'PT400',
    message: 'invalid_eligibility_floor',
  });
  await user.click(
    within(panel).getByRole('button', { name: 'Editează Prag minim' }),
  );
  const floor = within(panel).getByLabelText('Valoare nouă pentru Prag minim');
  await user.clear(floor);
  await user.type(floor, '12');
  await save(user, row(panel, 'Prag minim'));
  await waitFor(() =>
    expect(floor).toHaveAccessibleDescription(
      /Pragul minim este un număr întreg de cel puțin 1\./,
    ),
  );

  db.refuse.set('set_points_start_date', {
    code: 'PT400',
    message: 'invalid_points_start_date',
  });
  await user.click(
    within(panel).getByRole('button', {
      name: 'Editează Data de început a punctajului',
    }),
  );
  await pickDate(
    user,
    within(panel).getByLabelText(
      'Valoare nouă pentru Data de început a punctajului',
    ),
    '2026-09-01',
  );
  await save(user, row(panel, 'Data de început a punctajului'));
  expect(
    await within(row(panel, 'Data de început a punctajului')).findByText(
      'Data de început a punctajului este o zi de cel târziu azi.',
    ),
  ).toBeVisible();

  db.refuse.set('set_membership_cutoff', {
    code: 'PT400',
    message: 'invalid_membership_cutoff',
  });
  await user.click(
    within(panel).getByRole('button', {
      name: 'Editează Data limită de intrare',
    }),
  );
  await pickDate(
    user,
    within(panel).getByLabelText('Valoare nouă pentru Data limită de intrare'),
    '2026-03-15',
  );
  await save(user, row(panel, 'Data limită de intrare'));
  expect(
    await within(row(panel, 'Data limită de intrare')).findByText(
      'Data limită de intrare este o zi de cel târziu azi.',
    ),
  ).toBeVisible();

  // A share: the server's refusal lands in its row too.
  db.refuse.set('set_evaluation_percent', {
    code: '42501',
    message: 'evaluation_percent_manage_forbidden',
  });
  await user.click(
    within(panel).getByRole('button', {
      name: 'Editează Procent Adunarea Generală',
    }),
  );
  const share = within(panel).getByLabelText(
    'Valoare nouă pentru Procent Adunarea Generală',
  );
  await user.clear(share);
  await user.type(share, '30');
  await save(user, row(panel, 'Procent Adunarea Generală'));
  expect(
    await within(row(panel, 'Procent Adunarea Generală')).findByText(
      'Doar BC și Moderatorul pot schimba procentele.',
    ),
  ).toBeVisible();
});

it('still edits the two Promotion Thresholds by hand', async () => {
  db.runs = [RUN_VA];
  db.changes = [
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
  ];
  db.thresholds = db.thresholds.map((current) =>
    current.kind === 'voluntar_activ' ? { ...current, threshold: 42 } : current,
  );
  const user = userEvent.setup();
  show(<Host />);
  const panel = await settings();

  // Where the value in force came from.
  await waitFor(() =>
    expect(row(panel, 'Prag de promovare')).toHaveTextContent(
      'calculat de evaluarea „Semestrul I”',
    ),
  );

  await user.click(
    within(panel).getByRole('button', { name: 'Editează Prag de promovare' }),
  );
  const input = within(panel).getByLabelText(
    'Valoare nouă pentru Prag de promovare',
  );
  expect(input).toHaveValue(42);
  await user.clear(input);
  await user.type(input, '0');
  await save(user, row(panel, 'Prag de promovare'));
  expect(input).toHaveAccessibleDescription(
    /Pragul este un număr întreg de cel puțin 1\./,
  );
  await user.clear(input);
  await user.type(input, '35');
  await save(user, row(panel, 'Prag de promovare'));
  expect(db.rpc).toHaveBeenCalledWith('set_promotion_threshold', {
    p_kind: 'voluntar_activ',
    p_threshold: 35,
  });
  await waitFor(() =>
    expect(row(panel, 'Prag de promovare')).toHaveTextContent('35 de puncte'),
  );
  expect(row(panel, 'Prag de promovare')).toHaveTextContent('introdus de');

  // The other kind's, unset until BC enters one.
  await user.click(
    within(panel).getByRole('button', {
      name: 'Editează Prag Adunarea Generală',
    }),
  );
  await user.type(
    within(panel).getByLabelText('Valoare nouă pentru Prag Adunarea Generală'),
    '12',
  );
  await save(user, row(panel, 'Prag Adunarea Generală'));
  expect(db.rpc).toHaveBeenCalledWith('set_promotion_threshold', {
    p_kind: 'adunarea_generala',
    p_threshold: 12,
  });
});

it('names each editor’s field for the setting it changes', async () => {
  const user = userEvent.setup();
  show(<Host />);
  const panel = await settings();

  await user.click(
    within(panel).getByRole('button', { name: 'Editează Prag minim' }),
  );
  expect(
    within(panel).getByRole('textbox', {
      name: 'Valoare nouă pentru Prag minim',
    }),
  ).toBeVisible();
  await user.click(
    within(panel).getByRole('button', {
      name: 'Editează Data limită de intrare',
    }),
  );
  expect(
    within(panel).getByRole('button', {
      name: /Valoare nouă pentru Data limită de intrare/,
    }),
  ).toBeVisible();
});

it('says what the Data de început a punctajului changes, and what still reads older points', async () => {
  const user = userEvent.setup();
  show(<Host />);
  const panel = await settings();
  await user.click(
    within(panel).getByRole('button', {
      name: 'Despre Data de început a punctajului',
    }),
  );
  const hint = await screen.findByText(/nu se mai numără în totaluri/);
  expect(hint).toHaveTextContent(
    'nu se mai numără în totaluri (punctajul personal, campaniile, Cupa departamentelor); Clasamentul și Tracker membru le arată doar cu un „De la” mai vechi.',
  );
  expect(hint).not.toHaveTextContent('niciun total');
});

// The run's form no longer carries the Prag minim or the Data limită de
// intrare: this panel is where they are set, and a run uses the ones in force.
it('says in its hint that a run uses the Prag minim and the Data limită de intrare set here', async () => {
  const user = userEvent.setup();
  show(<Host />);
  const panel = await settings();
  await user.click(
    within(panel).getByRole('button', { name: 'Despre setări' }),
  );
  const hint = await screen.findByText(/Valorile după care citește/);
  expect(hint).toHaveTextContent(
    'Valorile după care citește o evaluare: Prag minim, Data limită de intrare, Procent, și data de la care se numără punctele în orice total. Pragul minim și data limită de intrare se schimbă doar aici, iar o evaluare le folosește pe cele în vigoare; procentul din formular îl pune în vigoare odată finalizată.',
  );
  expect(hint).not.toHaveTextContent('din formular și');
});
