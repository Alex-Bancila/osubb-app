import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';
import type {
  AdminGroup,
  AppointableMember,
  RosterEntry,
} from '../../queries/groups-admin';
import type { MyGroup } from '../../queries/my-groups';

const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  groups: vi.fn(),
  myGroups: vi.fn(),
  roster: vi.fn(),
  members: vi.fn(),
  mutate: vi.fn(),
  roles: vi.fn(),
  level: { value: 6 },
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: api.capabilities,
}));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    claims: { member_level: api.level.value },
    session: { user: { id: 'me' } },
  }),
}));
vi.mock('../../queries/reference', () => ({ useRoles: api.roles }));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useAdminGroups: api.groups,
  useMyGroupRoles: api.myGroups,
  useGroupRoster: api.roster,
  useAppointableMembers: api.members,
  useGroupCommand: () => ({ mutateAsync: api.mutate, isPending: false }),
}));
vi.mock('../campaigns/CampaignsPanel', () => ({
  CampaignsPanel: ({ group: owner }: { group: { name: string } }) => (
    <p>Campaniile grupului {owner.name}</p>
  ),
}));
import GroupScreen from './GroupScreen';

vi.setConfig({ testTimeout: 20_000 });

function group(
  id: number,
  name: string,
  path: number[],
  parentId: number | null,
  extra: Partial<AdminGroup> = {},
): AdminGroup {
  return {
    id,
    name,
    short: null,
    color: null,
    category: 'team',
    path,
    parent_id: parentId,
    min_level: 0,
    status: 'active',
    is_organization: false,
    manager_title: null,
    automatic_membership: false,
    accepts_applications: false,
    application_level: null,
    competes_in_cup: false,
    counts_toward_parent_cup: true,
    shared_work_visibility: false,
    is_private: false,
    application_form_label: null,
    application_form_url: null,
    memberCount: 3,
    ...extra,
  };
}

const tree = [
  group(1, 'Educațional', [1], null, {
    category: 'department',
    min_level: 0,
    manager_title: 'BCE',
  }),
  group(2, 'Logistică', [1, 2], 1, { min_level: 1 }),
  group(5, 'Foto', [1, 2, 5], 2, { min_level: 1 }),
];

const roster: RosterEntry[] = [
  {
    memberId: 'a',
    name: 'Ana Pop',
    avatarColor: null,
    groupRole: 'member',
    positionTitle: null,
    status: 'inactiv',
    roleLabel: 'Voluntar',
    level: 1,
  },
  {
    memberId: 'b',
    name: 'Bogdan Ion',
    avatarColor: null,
    groupRole: 'manager',
    positionTitle: null,
    status: 'activ',
    roleLabel: 'BCE',
    level: 5,
  },
];

const members: AppointableMember[] = [
  {
    memberId: 'c',
    name: 'Carmen Radu',
    avatarColor: null,
    status: 'activ',
    roleId: 'voluntar',
    roleLabel: 'Voluntar',
    level: 1,
  },
];

function myGroup(id: number, role: string): MyGroup {
  return {
    id,
    name: `G${id}`,
    short: '',
    color: '',
    category: 'team',
    path: [id],
    min_level: 0,
    status: 'active',
    is_organization: false,
    group_role: role,
    explicit: true,
    automatic: false,
  };
}

function capabilities(createTopLevelGroups: boolean) {
  api.capabilities.mockReturnValue({
    data: {
      managesAnyGroup: true,
      manageTasks: true,
      seeDirectory: false,
      seeLeadership: false,
      manageRoles: false,
      provisionMembers: false,
      createTopLevelGroups,
      administer: true,
    },
  });
}

beforeEach(() => {
  api.mutate.mockReset();
  api.mutate.mockResolvedValue({ id: 1 });
  api.level.value = 6;
  api.groups.mockReturnValue({ data: tree, isPending: false, isError: false });
  api.myGroups.mockReturnValue({ data: [], isPending: false, isError: false });
  api.roster.mockReturnValue({ data: roster, isPending: false });
  api.members.mockReturnValue({ data: members });
  api.roles.mockReturnValue({
    data: new Map([
      ['recrut', { name: 'Recrut', level: 0 }],
      ['voluntar', { name: 'Voluntar', level: 1 }],
      ['activ', { name: 'Voluntar Activ', level: 2 }],
      ['vot', { name: 'Voluntar cu Drept de Vot', level: 3 }],
      ['bce', { name: 'BCE', level: 5 }],
      ['bc', { name: 'BC', level: 6 }],
    ]),
  });
  capabilities(true);
});

function show(id = 2) {
  return render(
    <MemoryRouter initialEntries={[`/administrare/grupuri/${id}`]}>
      <Routes>
        <Route
          path="/administrare/grupuri/:groupId"
          element={<GroupScreen />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

it('heads the Group with its place in the tree and offers the five built tabs', async () => {
  const { container } = show();
  expect(screen.getByRole('heading', { name: 'Logistică' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Educațional' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/1',
  );
  for (const name of [
    'Setări',
    'Roster',
    'Roluri',
    'Grupuri copil',
    'Campanii',
  ])
    expect(tab(name)).toBeVisible();
  // Applications are #589's; the tab is a placeholder until then.
  await userEvent.click(tab('Cereri'));
  expect(screen.getByText(/Cererile de înscriere apar aici/)).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('shows a Manager the operational settings and BC the structural ones', async () => {
  // A Child Group's Manager: operational only.
  capabilities(false);
  api.myGroups.mockReturnValue({ data: [myGroup(2, 'manager')] });
  const manager = show();
  expect(screen.getByLabelText('Numele grupului')).toBeVisible();
  expect(
    screen.getByRole('heading', { name: 'Setările grupului' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: 'Structura grupului' }),
  ).toBeNull();
  manager.unmount();

  capabilities(true);
  api.myGroups.mockReturnValue({ data: [] });
  show();
  expect(
    await screen.findByRole('heading', { name: 'Structura grupului' }),
  ).toBeVisible();
  expect(screen.getByLabelText('Categorie')).toBeVisible();
});

it("bounds a Child Group's Minimum Level by its parent below and the caller above", () => {
  // Logistică sits under Educațional (Minimum 0); its own Manager is a BCE.
  capabilities(false);
  api.level.value = 5;
  api.myGroups.mockReturnValue({ data: [myGroup(2, 'manager')] });
  show();
  const field = screen.getByLabelText('Nivel minim');
  const offered = within(field)
    .getAllByRole('option')
    .map((option) => (option as HTMLOptionElement).value);
  // 0..5 from the parent's Minimum Level up to the Manager's own Level; never
  // 6 — group_min_level_above_actor would refuse it.
  expect(offered).toEqual(['0', '1', '2', '3', '5']);
});

it('names who leaves before it raises the Minimum Level, and only then confirms', async () => {
  const user = userEvent.setup();
  show();
  await user.selectOptions(screen.getByLabelText('Nivel minim'), '3');
  await user.click(
    screen.getByRole('button', { name: 'Vezi cine iese din grup' }),
  );
  // Ana Pop is level 1: she is named before anything is sent.
  const leaving = screen.getByRole('list', {
    name: 'Membri care ies din grup',
  });
  expect(within(leaving).getByText(/Ana Pop/)).toBeVisible();
  expect(api.mutate).not.toHaveBeenCalled();

  await user.click(
    screen.getByRole('button', { name: 'Confirmă și salvează' }),
  );
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'settings',
    groupId: 2,
    name: 'Logistică',
    managerTitle: null,
    acceptsApplications: false,
    applicationLevel: null,
    sharedWorkVisibility: false,
    minLevel: 3,
    applicationFormLabel: null,
    applicationFormUrl: null,
    confirmRemovals: true,
  });
});

it('re-asks when the server says the form was stale', async () => {
  const user = userEvent.setup();
  api.mutate.mockRejectedValue(
    new CommandError(
      { code: 'PT409', message: 'group_has_members_below_level' },
      'fallback',
    ),
  );
  show();
  await user.selectOptions(screen.getByLabelText('Nivel minim'), '3');
  await user.click(
    screen.getByRole('button', { name: 'Vezi cine iese din grup' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirmă și salvează' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Confirmă scoaterea',
  );
  // The confirmation is withdrawn, so the next click asks again rather than
  // resending the flag the server just refused.
  expect(
    await screen.findByRole('button', { name: 'Vezi cine iese din grup' }),
  ).toBeVisible();
});

it('sends the Minimum Level for "Ca nivelul minim al grupului", following a Minimum Level change made in the same save (#731)', async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    screen.getByRole('checkbox', { name: /Primește cereri de înscriere/ }),
  );
  expect(
    screen.getByLabelText('Nivelul de la care se poate cere înscrierea'),
  ).toHaveValue('');
  // Lowering the Minimum Level never removes anyone, so this saves directly.
  await user.selectOptions(screen.getByLabelText('Nivel minim'), '0');
  await user.click(screen.getByRole('button', { name: 'Salvează setările' }));
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'settings',
    groupId: 2,
    name: 'Logistică',
    managerTitle: null,
    acceptsApplications: true,
    applicationLevel: 0,
    sharedWorkVisibility: false,
    minLevel: 0,
    applicationFormLabel: null,
    applicationFormUrl: null,
    confirmRemovals: false,
  });
});

it('keeps an explicit Application Level as chosen', async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    screen.getByRole('checkbox', { name: /Primește cereri de înscriere/ }),
  );
  await user.selectOptions(
    screen.getByLabelText('Nivelul de la care se poate cere înscrierea'),
    '5',
  );
  await user.click(screen.getByRole('button', { name: 'Salvează setările' }));
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'settings',
    groupId: 2,
    name: 'Logistică',
    managerTitle: null,
    acceptsApplications: true,
    applicationLevel: 5,
    sharedWorkVisibility: false,
    minLevel: 1,
    applicationFormLabel: null,
    applicationFormUrl: null,
    confirmRemovals: false,
  });
});

it('sends a stored application form link back, so saving the settings never clears it (#697)', async () => {
  const user = userEvent.setup();
  api.groups.mockReturnValue({
    data: tree.map((row) =>
      row.id === 2
        ? {
            ...row,
            application_form_label: 'Formular de înscriere',
            application_form_url: 'https://forms.example.org/logistica',
          }
        : row,
    ),
    isPending: false,
    isError: false,
  });
  show();
  // Lowering the Minimum Level never removes anyone, so this saves directly.
  await user.selectOptions(screen.getByLabelText('Nivel minim'), '0');
  await user.click(screen.getByRole('button', { name: 'Salvează setările' }));
  expect(api.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'settings',
      groupId: 2,
      minLevel: 0,
      applicationFormLabel: 'Formular de înscriere',
      applicationFormUrl: 'https://forms.example.org/logistica',
    }),
  );
});

it('archives through the command and explains unfinished work in the Group', async () => {
  const user = userEvent.setup();
  api.mutate.mockRejectedValue(
    new CommandError({ code: 'PT409', message: 'group_has_open_work' }, 'nope'),
  );
  show();
  await user.click(screen.getByRole('button', { name: 'Arhivează grupul' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Arhivează Logistică',
  });
  await user.click(within(dialog).getByRole('button', { name: 'Arhivează' }));
  expect(api.mutate).toHaveBeenCalledWith({ kind: 'archive', groupId: 2 });
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Grupul are lucru neterminat.',
  );
  expect(
    within(dialog).getByRole('link', { name: 'Vezi taskurile neterminate' }),
  ).toBeVisible();
});

it('lists the roster with each Member Status and appoints through add_group_member', async () => {
  const user = userEvent.setup();
  show();
  await user.click(tab('Roster'));
  const table = screen.getByRole('table');
  expect(within(table).getByText('Inactiv')).toBeVisible();
  expect(within(table).getByText('Activ')).toBeVisible();
  // A Manager's roster row is not removed here: the position ends first.
  expect(within(table).getByText('Retrage întâi funcția')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Adaugă un membru' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Adaugă un membru în Logistică',
  });
  await user.click(within(dialog).getByRole('combobox', { name: 'Membru' }));
  await user.click(await screen.findByRole('option', { name: /Carmen Radu/ }));
  expect(
    (
      await axe.run(dialog as HTMLElement, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  await user.click(within(dialog).getByRole('button', { name: 'Adaugă' }));
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'addMember',
    groupId: 2,
    memberId: 'c',
  });
});

it('removes an ordinary Member through remove_group_member, from a pop-up', async () => {
  const user = userEvent.setup();
  show();
  await user.click(tab('Roster'));
  await user.click(
    screen.getByRole('button', { name: 'Scoate pe Ana Pop din grup' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Scoate pe Ana Pop',
  });
  await user.click(
    within(dialog).getByRole('button', { name: 'Scoate din grup' }),
  );
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'removeMember',
    groupId: 2,
    memberId: 'a',
  });
});

it('appoints a Manager one level up and a Responsible under a display name', async () => {
  const user = userEvent.setup();
  show();
  await user.click(tab('Roluri'));
  await user.click(
    screen.getByRole('button', { name: 'Numește un coordonator' }),
  );
  let dialog = await screen.findByRole('dialog', {
    name: 'Coordonator pentru Logistică',
  });
  await user.click(within(dialog).getByRole('combobox', { name: 'Membru' }));
  await user.click(await screen.findByRole('option', { name: /Carmen Radu/ }));
  await user.click(within(dialog).getByRole('button', { name: 'Numește' }));
  expect(api.mutate).toHaveBeenLastCalledWith({
    kind: 'setRole',
    groupId: 2,
    memberId: 'c',
    groupRole: 'manager',
    positionTitle: null,
  });

  await user.click(
    screen.getByRole('button', { name: 'Numește un responsabil' }),
  );
  dialog = await screen.findByRole('dialog', {
    name: 'Responsabil în Logistică',
  });
  await user.click(within(dialog).getByRole('combobox', { name: 'Membru' }));
  await user.click(await screen.findByRole('option', { name: /Carmen Radu/ }));
  await user.type(
    within(dialog).getByLabelText('Numele funcției'),
    'Responsabil Logistică',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Numește' }));
  expect(api.mutate).toHaveBeenLastCalledWith({
    kind: 'setRole',
    groupId: 2,
    memberId: 'c',
    groupRole: 'responsible',
    positionTitle: 'Responsabil Logistică',
  });
});

it("never offers a Child Group's Manager the appointment that belongs one level up", async () => {
  capabilities(false);
  api.myGroups.mockReturnValue({ data: [myGroup(2, 'manager')] });
  const user = userEvent.setup();
  show();
  await user.click(tab('Roluri'));
  expect(
    screen.queryByRole('button', { name: 'Numește un coordonator' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Numește un responsabil' }),
  ).toBeVisible();
});

it('creates a Child Group under this Group and archives one, in pop-ups', async () => {
  const user = userEvent.setup();
  show();
  await user.click(tab('Grupuri copil'));
  expect(screen.getByRole('link', { name: 'Foto' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/5',
  );

  await user.click(screen.getByRole('button', { name: 'Subgrup nou' }));
  const create = await screen.findByRole('dialog', {
    name: 'Subgrup al Logistică',
  });
  // The parent is fixed at creation — there is no picker and no "Mută grupul".
  expect(within(create).queryByLabelText('Grup părinte')).toBeNull();
  await user.type(within(create).getByLabelText('Numele grupului'), 'Sunet');
  await user.click(within(create).getByRole('button', { name: 'Creează' }));
  expect(api.mutate).toHaveBeenLastCalledWith({
    kind: 'create',
    name: 'Sunet',
    category: 'team',
    parentId: 2,
    minLevel: null,
    managerId: null,
    color: null,
    short: null,
  });

  await user.click(screen.getByRole('button', { name: 'Arhivează Foto' }));
  const archive = await screen.findByRole('dialog', { name: 'Arhivează Foto' });
  await user.click(within(archive).getByRole('button', { name: 'Arhivează' }));
  expect(api.mutate).toHaveBeenLastCalledWith({ kind: 'archive', groupId: 5 });
});

it('reuses the Campaign panel rather than building a second one', async () => {
  const user = userEvent.setup();
  show();
  await user.click(tab('Campanii'));
  expect(screen.getByText('Campaniile grupului Logistică')).toBeVisible();
});

it('says plainly when the Group is not one the caller may read', () => {
  show(404);
  expect(screen.getByRole('alert')).toHaveTextContent('Nu ai acces');
});
