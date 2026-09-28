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
import { GroupSettingsTab } from './GroupSettingsTab';

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
  expect(labelField()).toHaveValue('Înscrie-te');
  expect(urlField()).toHaveValue(FORM_URL);
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('saves the pair together, trimmed, as p_application_form_label / _url', async () => {
  const user = userEvent.setup();
  show();
  await user.type(labelField(), '  Completează formularul ');
  await user.type(urlField(), ` ${FORM_URL} `);
  await save();
  expect(run).toHaveBeenCalledWith(
    {
      kind: 'settings',
      groupId: 2,
      name: 'Logistică',
      managerTitle: null,
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

it('clears the pair together when both fields are emptied', async () => {
  const user = userEvent.setup();
  show({
    application_form_label: 'Înscrie-te',
    application_form_url: FORM_URL,
  });
  await user.clear(labelField());
  await user.clear(urlField());
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

it('asks for both halves, on blur and on save, under the half left empty', async () => {
  const user = userEvent.setup();
  show();
  await user.type(labelField(), 'Înscrie-te');
  await user.click(urlField());
  await user.tab();
  expect(urlField()).toHaveAccessibleDescription(
    'Completează și eticheta, și adresa.',
  );
  await save();
  expect(run).not.toHaveBeenCalled();
  expect(urlField()).toHaveAccessibleDescription(
    'Completează și eticheta, și adresa.',
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
  await user.type(urlField(), FORM_URL);
  await user.type(labelField(), 'e'.repeat(61));
  await user.tab();
  expect(labelField()).toHaveAccessibleDescription(
    'Eticheta are cel mult 60 de caractere.',
  );
  await save();
  expect(run).not.toHaveBeenCalled();
  await user.clear(labelField());
  await user.type(labelField(), 'e'.repeat(60));
  await save();
  expect(run).toHaveBeenCalledTimes(1);
});

it('asks for an http(s) address of at most 2048 characters', async () => {
  const user = userEvent.setup();
  show();
  await user.type(labelField(), 'Înscrie-te');
  await user.type(urlField(), 'forms.example.org/logistica');
  await user.tab();
  expect(urlField()).toHaveAccessibleDescription(
    'Adresa trebuie să înceapă cu http:// sau https://.',
  );
  await user.clear(urlField());
  // Pasted, not typed: 2049 keystrokes would be slow for no gain.
  await user.click(urlField());
  await user.paste(`https://${'a'.repeat(2041)}`);
  await user.tab();
  expect(urlField()).toHaveAccessibleDescription(
    'Adresa are cel mult 2048 de caractere.',
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
    await user.type(labelField(), 'Înscrie-te');
    await user.type(urlField(), FORM_URL);
    await save();
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      field === 'label' ? labelField() : urlField(),
    ).toHaveAccessibleDescription(copy);
  },
);

it('offers every Minimum Level picker by Role name, the six rungs only, in ladder order (R29b)', () => {
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
  const texts = (field: HTMLElement) =>
    Array.from((field as HTMLSelectElement).options).map(
      (option) => option.text,
    );
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
  for (const picker of pickers) expect(texts(picker)).toEqual(six);
  expect(
    texts(screen.getByLabelText('Nivelul de la care se poate cere înscrierea')),
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
  await user.selectOptions(screen.getByLabelText('Nivel minim'), '3');
  expect(
    screen.getByText(
      /iese din grup la nivelul minim Voluntar cu Drept de Vot:/,
    ),
  ).toBeVisible();
});

it('keeps a stored Moderator level readable but never offers it as a choice (R29b)', () => {
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
    const select = picker as HTMLSelectElement;
    expect(select.value).toBe('9');
    const stored = Array.from(select.options).find((o) => o.value === '9');
    expect(stored?.text).toBe('Moderator');
    expect(stored?.disabled).toBe(true);
    expect(
      Array.from(select.options)
        .filter((o) => !o.disabled)
        .map((o) => o.text),
    ).toEqual([
      'Recrut',
      'Voluntar',
      'Voluntar Activ',
      'Voluntar cu Drept de Vot',
      'BCE',
      'BC',
    ]);
  }
});

it('keeps a stored Moderator Application Level readable but never offers it (R29b)', () => {
  show({ application_level: 9 });
  const select = screen.getByLabelText(
    'Nivelul de la care se poate cere înscrierea',
  ) as HTMLSelectElement;
  expect(select.value).toBe('9');
  const stored = Array.from(select.options).find((o) => o.value === '9');
  expect(stored?.text).toBe('Moderator');
  expect(stored?.disabled).toBe(true);
  expect(
    Array.from(select.options)
      .filter((o) => !o.disabled)
      .map((o) => o.text),
  ).toEqual([
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
      status: 'activ',
      roleLabel: 'Voluntar',
    },
  ]);
  await user.selectOptions(screen.getByLabelText('Nivel minim'), '3');
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
  // Every select is the kit's (#842), none native-styled.
  for (const select of document.querySelectorAll('select'))
    expect(select).toHaveAttribute('data-slot', 'native-select');
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
