import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';
import type {
  AdminGroup,
  GroupAuthority,
  GroupCommand,
  RosterEntry,
} from '../../queries/groups-admin';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { chooseOption } from '../../test/select';
import { GroupSettingsTab } from './GroupSettingsTab';
import { optionNames, optionsOf } from './select-test-options';

/*
 * #698 (ruling R18): the Group's "Formular de înscriere" link in the settings
 * form — two fields saved and cleared together, checked on blur and on save
 * by the rules update_group applies, and the server's refusals shown under
 * the same fields.
 */

const FORM_URL = 'https://forms.example.org/logistica';

const run =
  vi.fn<
    (
      command: GroupCommand,
      onFailure?: (failure: unknown) => void,
    ) => Promise<boolean>
  >();

const authority: GroupAuthority = {
  manageWork: true,
  manageGroup: true,
  editStructure: false,
  appointManager: false,
  archive: false,
  editMinLevel: true,
};

function group(extra: Partial<AdminGroup> = {}): AdminGroup {
  return {
    id: 2,
    name: 'Logistică',
    short: null,
    color: null,
    category: 'team',
    path: [1, 2],
    parent_id: 1,
    min_level: 1,
    status: 'active',
    is_organization: false,
    is_private: false,
    manager_title: null,
    responsible_title: null,
    automatic_membership: false,
    accepts_applications: true,
    application_level: 1,
    competes_in_cup: false,
    counts_toward_parent_cup: true,
    shared_work_visibility: false,
    application_form_label: null,
    application_form_url: null,
    memberCount: 3,
    ...extra,
  };
}

function show(stored: Partial<AdminGroup> = {}) {
  return render(
    <MemoryRouter>
      <GroupSettingsTab
        group={group(stored)}
        parent={undefined}
        roster={[]}
        authority={authority}
        levels={[0, 1, 2, 3, 5, 6]}
        actorLevel={6}
        busy={false}
        error={null}
        lastReason={undefined}
        onRun={run}
      />
    </MemoryRouter>,
  );
}

const labelField = () => screen.getByLabelText('Eticheta butonului');
const urlField = () => screen.getByLabelText('Adresa formularului');
/** Behind the address field's "i", and always part of its description. */
const URL_HINT = 'Adresa începe cu http:// sau https://';
const formSwitch = () =>
  screen.getByRole('switch', { name: 'Formular de înscriere' });
const save = () =>
  userEvent.click(screen.getByRole('button', { name: 'Salvează setările' }));

beforeEach(() => {
  run.mockReset().mockResolvedValue(true);
});

it('shows the two fields in a "Formular de înscriere" fieldset, filled from the stored link', async () => {
  const { container } = show({
    application_form_label: 'Înscrie-te',
    application_form_url: FORM_URL,
  });
  expect(
    screen.getByRole('group', { name: 'Formular de înscriere' }),
  ).toBeVisible();
  expect(formSwitch()).toBeChecked();
  expect(labelField()).toHaveValue('Înscrie-te');
  expect(urlField()).toHaveValue(FORM_URL);
  // A form has both halves: neither is marked optional.
  expect(labelField()).toBeRequired();
  expect(urlField()).toBeRequired();
  // The address rule waits behind the "i", and still describes the field.
  expect(
    screen.getByText('Adresa începe cu http:// sau https://'),
  ).not.toBeVisible();
  expect(urlField()).toHaveAccessibleDescription(
    'Adresa începe cu http:// sau https://',
  );
  expect(
    screen.getByRole('button', { name: 'Despre adresa formularului' }),
  ).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('keeps the form off, its two fields away, for a Group with no stored link', async () => {
  show();
  expect(formSwitch()).not.toBeChecked();
  expect(screen.queryByLabelText('Eticheta butonului')).toBeNull();
  expect(screen.queryByLabelText('Adresa formularului')).toBeNull();
  expect(
    screen.queryByRole('group', { name: 'Formular de înscriere' }),
  ).toBeNull();
  // Off is "no form": the pair is saved as null, as before.
  await save();
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'settings',
      applicationFormLabel: null,
      applicationFormUrl: null,
    }),
    expect.any(Function),
  );
});

it('saves the pair together, trimmed, as p_application_form_label / _url', async () => {
  const user = userEvent.setup();
  show();
  await user.click(formSwitch());
  await user.type(labelField(), '  Completează formularul ');
  await user.type(urlField(), ` ${FORM_URL} `);
  await save();
  expect(run).toHaveBeenCalledWith(
    {
      kind: 'settings',
      groupId: 2,
      name: 'Logistică',
      managerTitle: null,
      responsibleTitle: null,
      acceptsApplications: true,
      applicationLevel: 1,
      sharedWorkVisibility: false,
      minLevel: 1,
      applicationFormLabel: 'Completează formularul',
      applicationFormUrl: FORM_URL,
      confirmRemovals: false,
    },
    expect.any(Function),
  );
});

/*
 * #962: the Group Responsible position's name, next to the Manager's —
 * "Coordonator" for a Department's BCE members.
 */
const responsibleField = () =>
  screen.getByLabelText('Cum se numesc responsabilii (opțional)');

it("names the Responsible position right after the Manager's, filled from the stored setting (#962)", () => {
  show({ manager_title: 'Vicepreședinte', responsible_title: 'Coordonator' });
  const manager = screen.getByLabelText(
    'Cum se numește coordonatorul (opțional)',
  );
  expect(manager).toHaveValue('Vicepreședinte');
  expect(responsibleField()).toHaveValue('Coordonator');
  expect(responsibleField()).toHaveAttribute('maxLength', '80');
  expect(responsibleField()).toHaveAttribute(
    'placeholder',
    'Coordonator, Responsabil de Proiect…',
  );
  expect(
    manager.compareDocumentPosition(responsibleField()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it('saves the Responsible position name trimmed, as responsibleTitle, and clears it when emptied (#962)', async () => {
  const user = userEvent.setup();
  show();
  await user.type(responsibleField(), '  Coordonator ');
  await save();
  expect(run).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: 'settings',
      managerTitle: null,
      responsibleTitle: 'Coordonator',
    }),
    expect.any(Function),
  );

  await user.clear(responsibleField());
  await save();
  expect(run).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'settings', responsibleTitle: null }),
    expect.any(Function),
  );
});

it("shows update_group's responsible_title_too_long under the Responsible field (#962)", async () => {
  run.mockImplementation(async (_command, onFailure) => {
    onFailure?.(
      new CommandError(
        { code: 'PT400', message: 'responsible_title_too_long' },
        'x',
      ),
    );
    return false;
  });
  show();
  await save();
  expect(run).toHaveBeenCalledTimes(1);
  expect(responsibleField()).toHaveAccessibleDescription(
    'Numele funcției are cel mult 80 de caractere.',
  );
});

it('clears the pair together when the form is turned off', async () => {
  const user = userEvent.setup();
  show({
    application_form_label: 'Înscrie-te',
    application_form_url: FORM_URL,
  });
  await user.click(formSwitch());
  expect(formSwitch()).not.toBeChecked();
  expect(screen.queryByLabelText('Eticheta butonului')).toBeNull();
  await save();
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'settings',
      applicationFormLabel: null,
      applicationFormUrl: null,
    }),
    expect.any(Function),
  );
  // Turned on again, the fields come back empty: off cleared them.
  await user.click(formSwitch());
  expect(labelField()).toHaveValue('');
  expect(urlField()).toHaveValue('');
});

it('asks for the pair when the form is on with both fields empty, and saves nothing', async () => {
  const user = userEvent.setup();
  show({
    application_form_label: 'Înscrie-te',
    application_form_url: FORM_URL,
  });
  await user.clear(labelField());
  await user.clear(urlField());
  await save();
  expect(run).not.toHaveBeenCalled();
  expect(urlField()).toHaveAccessibleDescription(
    `${URL_HINT} Completează și eticheta, și adresa.`,
  );
});

it('asks for both halves, on blur and on save, under the half left empty', async () => {
  const user = userEvent.setup();
  show();
  await user.click(formSwitch());
  await user.type(labelField(), 'Înscrie-te');
  await user.click(urlField());
  await user.tab();
  expect(urlField()).toHaveAccessibleDescription(
    `${URL_HINT} Completează și eticheta, și adresa.`,
  );
  await save();
  expect(run).not.toHaveBeenCalled();
  expect(urlField()).toHaveAccessibleDescription(
    `${URL_HINT} Completează și eticheta, și adresa.`,
  );

  // The other way round: an address with no label.
  await user.clear(labelField());
  await user.type(urlField(), FORM_URL);
  await save();
  expect(run).not.toHaveBeenCalled();
  expect(labelField()).toHaveAccessibleDescription(
    'Completează și eticheta, și adresa.',
  );
});

it('limits the label to 60 characters, checked on blur', async () => {
  const user = userEvent.setup();
  show();
  // Pasted, not typed: each keystroke re-renders the whole Setări form, and
  // ~150 of them ran into the 5 s timeout under a loaded suite.
  await user.click(formSwitch());
  await user.click(urlField());
  await user.paste(FORM_URL);
  await user.click(labelField());
  await user.paste('e'.repeat(61));
  await user.tab();
  expect(labelField()).toHaveAccessibleDescription(
    'Eticheta are cel mult 60 de caractere.',
  );
  await save();
  expect(run).not.toHaveBeenCalled();
  await user.clear(labelField());
  await user.paste('e'.repeat(60));
  await save();
  expect(run).toHaveBeenCalledTimes(1);
});

it('asks for an http(s) address of at most 2048 characters', async () => {
  const user = userEvent.setup();
  show();
  await user.click(formSwitch());
  await user.type(labelField(), 'Înscrie-te');
  await user.type(urlField(), 'forms.example.org/logistica');
  await user.tab();
  expect(urlField()).toHaveAccessibleDescription(
    `${URL_HINT} Adresa trebuie să înceapă cu http:// sau https://.`,
  );
  await user.clear(urlField());
  // Pasted, not typed: 2049 keystrokes would be slow for no gain.
  await user.click(urlField());
  await user.paste(`https://${'a'.repeat(2041)}`);
  await user.tab();
  expect(urlField()).toHaveAccessibleDescription(
    `${URL_HINT} Adresa are cel mult 2048 de caractere.`,
  );
  await save();
  expect(run).not.toHaveBeenCalled();
});

it.each([
  ['link_incomplete', 'url', 'Completează și eticheta, și adresa.'],
  ['link_label_too_long', 'label', 'Eticheta are cel mult 60 de caractere.'],
  [
    'link_url_invalid',
    'url',
    'Adresa trebuie să înceapă cu http:// sau https://.',
  ],
  ['link_url_too_long', 'url', 'Adresa are cel mult 2048 de caractere.'],
])(
  "shows update_group's %s under the %s field, in this form's words",
  async (reason, field, copy) => {
    const user = userEvent.setup();
    run.mockImplementation(async (_command, onFailure) => {
      onFailure?.(new CommandError({ code: 'PT400', message: reason }, 'x'));
      return false;
    });
    show();
    await user.click(formSwitch());
    await user.type(labelField(), 'Înscrie-te');
    await user.type(urlField(), FORM_URL);
    await save();
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      field === 'label' ? labelField() : urlField(),
    ).toHaveAccessibleDescription(
      field === 'label' ? copy : `${URL_HINT} ${copy}`,
    );
  },
);

it('offers every Minimum Level picker by Role name, the six rungs only, in ladder order (R29b)', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <GroupSettingsTab
        group={group({ parent_id: null, path: [2], min_level: 0 })}
        parent={undefined}
        roster={[]}
        authority={{ ...authority, editStructure: true }}
        levels={[9, 6, 5, 3, 2, 1, 0]}
        actorLevel={9}
        busy={false}
        error={null}
        lastReason={undefined}
        onRun={run}
      />
    </MemoryRouter>,
  );
  const texts = (field: HTMLElement) => optionNames(user, field);
  const six = [
    'Recrut',
    'Voluntar',
    'Voluntar Activ',
    'Voluntar cu Drept de Vot',
    'BCE',
    'BC',
  ];
  const pickers = screen.getAllByLabelText('Nivel minim');
  // One picker (relevance B52): a top-level Group's Minimum Level is its
  // structure, so it sits in Structura only.
  expect(pickers).toHaveLength(1);
  expect(
    within(
      screen.getByRole('form', { name: 'Structura grupului' }),
    ).getByLabelText('Nivel minim'),
  ).toBe(pickers[0]);
  // The app's own drop-down, never the browser's.
  for (const picker of pickers) {
    expect(picker).toHaveAttribute('data-slot', 'select');
    expect(await texts(picker)).toEqual(six);
  }
  expect(
    await texts(
      screen.getByLabelText('Nivelul de la care se poate cere înscrierea'),
    ),
  ).toEqual(['Ca nivelul minim al grupului', ...six]);
});

it('names the Minimum Level by Role in the removal preview (R29b)', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <GroupSettingsTab
        group={group({ min_level: 0 })}
        parent={undefined}
        roster={[
          {
            memberId: 'm1',
            name: 'Ana Pop',
            level: 1,
            avatarColor: null,
            groupRole: 'member',
            positionTitle: null,
            source: 'roster',
            roleId: null,
            status: 'activ',
            roleLabel: 'Voluntar',
          },
        ]}
        authority={authority}
        levels={[0, 1, 2, 3, 5, 6]}
        actorLevel={6}
        busy={false}
        error={null}
        lastReason={undefined}
        onRun={run}
      />
    </MemoryRouter>,
  );
  await chooseOption(
    user,
    screen.getByLabelText('Nivel minim'),
    'Voluntar cu Drept de Vot',
  );
  expect(
    screen.getByText(
      /iese din grup la nivelul minim Voluntar cu Drept de Vot:/,
    ),
  ).toBeVisible();
});

it('keeps a stored Moderator level readable but never offers it as a choice (R29b)', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <GroupSettingsTab
        group={group({ parent_id: null, path: [2], min_level: 9 })}
        parent={undefined}
        roster={[]}
        authority={{ ...authority, editStructure: true }}
        levels={[0, 1, 2, 3, 5, 6, 9]}
        actorLevel={9}
        busy={false}
        error={null}
        lastReason={undefined}
        onRun={run}
      />
    </MemoryRouter>,
  );
  for (const picker of screen.getAllByLabelText('Nivel minim')) {
    expect(picker.dataset.value).toBe('9');
    expect(picker).toHaveTextContent('Moderator');
    const options = await optionsOf(user, picker);
    expect(options.filter((o) => o.disabled)).toEqual([
      { text: 'Moderator', disabled: true },
    ]);
    expect(options.filter((o) => !o.disabled).map((o) => o.text)).toEqual([
      'Recrut',
      'Voluntar',
      'Voluntar Activ',
      'Voluntar cu Drept de Vot',
      'BCE',
      'BC',
    ]);
  }
});

it('keeps a stored Moderator Application Level readable but never offers it (R29b)', async () => {
  const user = userEvent.setup();
  show({ application_level: 9 });
  const select = screen.getByLabelText(
    'Nivelul de la care se poate cere înscrierea',
  );
  expect(select.dataset.value).toBe('9');
  expect(select).toHaveTextContent('Moderator');
  const options = await optionsOf(user, select);
  expect(options.filter((o) => o.disabled)).toEqual([
    { text: 'Moderator', disabled: true },
  ]);
  expect(options.filter((o) => !o.disabled).map((o) => o.text)).toEqual([
    'Ca nivelul minim al grupului',
    'Voluntar',
    'Voluntar Activ',
    'Voluntar cu Drept de Vot',
    'BCE',
    'BC',
  ]);
});

function root(extra: Partial<AdminGroup> = {}, roster: RosterEntry[] = []) {
  return render(
    <MemoryRouter>
      <GroupSettingsTab
        group={group({ parent_id: null, path: [2], min_level: 0, ...extra })}
        parent={undefined}
        roster={roster}
        authority={{ ...authority, editStructure: true, archive: true }}
        levels={[0, 1, 2, 3, 5, 6]}
        actorLevel={6}
        busy={false}
        error={null}
        lastReason={undefined}
        onRun={run}
      />
    </MemoryRouter>,
  );
}

it('shows the level and the form link only while the Group takes Applications (B54)', async () => {
  const user = userEvent.setup();
  show({
    accepts_applications: false,
    application_level: null,
    application_form_label: 'Înscrie-te',
    application_form_url: FORM_URL,
  });
  expect(screen.queryByLabelText('Eticheta butonului')).toBeNull();
  expect(
    screen.queryByLabelText('Nivelul de la care se poate cere înscrierea'),
  ).toBeNull();
  // Hidden is not cleared: a save sends the stored link back.
  await save();
  expect(run).toHaveBeenLastCalledWith(
    expect.objectContaining({
      acceptsApplications: false,
      applicationFormLabel: 'Înscrie-te',
      applicationFormUrl: FORM_URL,
    }),
    expect.any(Function),
  );

  await user.click(
    screen.getByRole('checkbox', { name: /Primește cereri de înscriere/ }),
  );
  expect(labelField()).toHaveValue('Înscrie-te');
  expect(
    screen.getByLabelText('Nivelul de la care se poate cere înscrierea'),
  ).toBeVisible();
});

it('offers "Grupul organizației" only on the Organization Group, read-only there (B53)', async () => {
  const user = userEvent.setup();
  const other = root();
  expect(
    screen.queryByRole('checkbox', { name: /^Grupul organizației/ }),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Salvează structura' }));
  expect(run).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'structure', isOrganization: false }),
    expect.any(Function),
  );
  other.unmount();

  root({ is_organization: true, name: 'OSUBB' });
  const organization = screen.getByRole('checkbox', {
    name: /^Grupul organizației/,
  });
  expect(organization).toBeChecked();
  expect(organization).toHaveAttribute('aria-disabled', 'true');
  await user.click(screen.getByRole('button', { name: 'Salvează structura' }));
  expect(run).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'structure', isOrganization: true }),
    expect.any(Function),
  );
});

it("names who leaves before a top-level Group's structure raises its Minimum Level", async () => {
  const user = userEvent.setup();
  root({}, [
    {
      memberId: 'm1',
      name: 'Ana Pop',
      level: 1,
      avatarColor: null,
      groupRole: 'member',
      positionTitle: null,
      source: 'roster',
      roleId: null,
      status: 'activ',
      roleLabel: 'Voluntar',
    },
  ]);
  await chooseOption(
    user,
    screen.getByLabelText('Nivel minim'),
    'Voluntar cu Drept de Vot',
  );
  await user.click(
    screen.getByRole('button', { name: 'Vezi cine iese din grup' }),
  );
  expect(run).not.toHaveBeenCalled();
  expect(
    within(
      screen.getByRole('list', { name: 'Membri care ies din grup' }),
    ).getByText(/Ana Pop/),
  ).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Confirmă și salvează' }),
  );
  expect(run).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: 'structure',
      minLevel: 3,
      confirmRemovals: true,
    }),
    expect.any(Function),
  );
  // The settings form sends the stored level back, never a second copy.
  await save();
  expect(run).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'settings', minLevel: 0 }),
    expect.any(Function),
  );
});

it('lays Setări, Structura and Arhivare out as panels with their own headers (AD3)', () => {
  root();
  for (const name of ['Setările grupului', 'Structura grupului', 'Arhivare'])
    expect(screen.getByRole('region', { name })).toBeVisible();
  // Every drop-down is the app's own, never the browser's.
  expect(document.querySelector('select')).toBeNull();
  const dropDowns = screen.getAllByRole('combobox');
  expect(dropDowns.length).toBeGreaterThan(0);
  for (const field of dropDowns)
    expect(field).toHaveAttribute('data-slot', 'select');
  // At most one primary action per panel.
  const primaries = (name: string) =>
    within(screen.getByRole('region', { name }))
      .getAllByRole('button')
      .filter((button) => button.classList.contains('bg-primary')).length;
  expect(primaries('Setările grupului')).toBe(1);
  expect(primaries('Structura grupului')).toBe(1);
  expect(primaries('Arhivare')).toBe(0);
});

it('renders nothing for a viewer who can change none of it', () => {
  const { container } = render(
    <MemoryRouter>
      <GroupSettingsTab
        group={group()}
        parent={undefined}
        roster={[]}
        authority={{
          manageWork: true,
          manageGroup: false,
          editStructure: false,
          appointManager: false,
          archive: false,
          editMinLevel: false,
        }}
        levels={[0, 1]}
        actorLevel={2}
        busy={false}
        error={null}
        lastReason={undefined}
        onRun={run}
      />
    </MemoryRouter>,
  );
  expect(container).toBeEmptyDOMElement();
});

/*
 * Alex (2026-10-11): "this checkmark should exist only for departments" --
 * the Department Cup box is a Department's; a top-level Team or Project gets
 * neither it nor the Child Group's parent-cup box.
 */
function showStructure(stored: Partial<AdminGroup>) {
  return render(
    <MemoryRouter>
      <GroupSettingsTab
        group={group(stored)}
        parent={undefined}
        roster={[]}
        authority={{ ...authority, editStructure: true }}
        levels={[0, 1, 2, 3, 5, 6]}
        actorLevel={6}
        busy={false}
        error={null}
        lastReason={undefined}
        onRun={run}
      />
    </MemoryRouter>,
  );
}

it('offers "Concurează în Cupa Departamentelor" to a top-level Department only', () => {
  const department = showStructure({
    category: 'department',
    parent_id: null,
    path: [2],
  });
  expect(
    screen.getByRole('checkbox', {
      name: 'Concurează în Cupa Departamentelor',
    }),
  ).toBeInTheDocument();
  department.unmount();

  const project = showStructure({
    category: 'project',
    parent_id: null,
    path: [2],
  });
  expect(
    screen.queryByRole('checkbox', { name: /Cupa Departamentelor/ }),
  ).toBeNull();
  expect(
    screen.queryByRole('checkbox', { name: /cupa grupului părinte/ }),
  ).toBeNull();
  project.unmount();

  // A Child Group keeps its own box: its points may count toward the parent's cup.
  showStructure({ category: 'team' });
  expect(
    screen.queryByRole('checkbox', { name: /Cupa Departamentelor/ }),
  ).toBeNull();
  expect(
    screen.getByRole('checkbox', {
      name: 'Punctele merg și la cupa grupului părinte',
    }),
  ).toBeInTheDocument();
});
