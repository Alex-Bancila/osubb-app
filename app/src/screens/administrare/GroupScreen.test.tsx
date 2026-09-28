import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { BackLink } from '../../components/layout';
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
  applications: vi.fn(),
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
// The real Cereri tab, over mocked reads: the tab's rows are what it shows.
vi.mock('../../queries/group-applications', () => ({
  useGroupApplications: api.applications,
  useApplicationCommand: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  api.applications.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
  });
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

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

/** The member page's back link, as the real page draws it. */
function MemberPage() {
  return <BackLink to="/administrare/membri" label="Înapoi la Administrare" />;
}

function show(id: number | string = 2, state?: unknown) {
  const at =
    typeof id === 'number'
      ? `/administrare/grupuri/${id}`
      : `/administrare/grupuri/${id}`;
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: at.split('?')[0],
          search: at.includes('?') ? `?${at.split('?')[1]}` : '',
          state,
        },
      ]}
    >
      <Routes>
        <Route
          path="/administrare/grupuri/:groupId"
          element={
            <>
              <GroupScreen />
              <Where />
            </>
          }
        />
        <Route path="/administrare/membri/:memberId" element={<MemberPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tabBar = () =>
  screen.getByRole('navigation', { name: 'Secțiunile grupului' });
const tab = (name: string) => within(tabBar()).getByRole('link', { name });
const tabNames = () =>
  within(tabBar())
    .getAllByRole('link')
    .map((link) => link.textContent);
const where = () => screen.getByTestId('where').textContent;

it.each(['2.0', '0x2', '2e0', '02', 'abc'])(
  'shows the not-found state for the malformed id %s and never queries it',
  (raw) => {
    render(
      <MemoryRouter initialEntries={[`/administrare/grupuri/${raw}`]}>
        <Routes>
          <Route
            path="/administrare/grupuri/:groupId"
            element={<GroupScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nu ai acces la acest grup sau grupul nu există.',
    );
    expect(
      screen.getByRole('link', { name: 'Înapoi la Administrare' }),
    ).toHaveAttribute('href', '/administrare/grupuri');
    expect(screen.queryByRole('heading', { name: 'Logistică' })).toBeNull();
    expect(api.roster).toHaveBeenLastCalledWith(null);
  },
);

it('heads the Group with its place in the tree and offers BC every tab it can use', async () => {
  const { container } = show();
  expect(screen.getByRole('heading', { name: 'Logistică' })).toBeVisible();
  // Back to the Grupuri tab the page sits under (#825).
  expect(
    screen.getByRole('link', { name: 'Înapoi la Administrare' }),
  ).toHaveAttribute('href', '/administrare/grupuri');
  expect(screen.getByRole('link', { name: 'Educațional' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/1',
  );
  // No Cereri: Logistică takes no Applications and has none pending.
  expect(tabNames()).toEqual([
    'Setări',
    'Roster',
    'Roluri',
    'Grupuri copil',
    'Campanii',
  ]);
  // The first tab opens, marked as the current one.
  expect(tab('Setări')).toHaveAttribute('aria-current', 'page');
  expect(
    screen.getByRole('region', { name: 'Setările grupului' }),
  ).toBeVisible();
  // The member count once, in the header, with the plural (B51).
  expect(screen.getByText(/· 3 membri$/)).toBeVisible();
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
  // …each named by its Role, never the number (R29b).
  expect(
    within(field)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([
    'Recrut',
    'Voluntar',
    'Voluntar Activ',
    'Voluntar cu Drept de Vot',
    'BCE',
  ]);
});

it("names the Group's Minimum Level by Role in its header (R29b)", () => {
  show();
  expect(screen.getByText(/^Nivel minim: Voluntar ·/)).toBeVisible();
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
  // Straight to that work: De gestionat, filtered to this Group (D9).
  expect(
    within(dialog).getByRole('link', { name: 'Vezi taskurile neterminate' }),
  ).toHaveAttribute('href', '/tracker?lista=gestionat&grup=1&subgrup=2');
});

it('lists the roster with each Member Status and appoints through add_group_member', async () => {
  const user = userEvent.setup();
  show();
  await user.click(tab('Roster'));
  const table = screen.getByRole('table');
  expect(within(table).getByText('Inactiv')).toBeVisible();
  expect(within(table).getByText('Activ')).toBeVisible();
  // Each name opens that Member's Administrare page (#103).
  expect(within(table).getByRole('link', { name: 'Ana Pop' })).toHaveAttribute(
    'href',
    '/administrare/membri/a',
  );
  // The count is the header's, never repeated above the roster (B51).
  expect(screen.getAllByText(/3 membri/)).toHaveLength(1);
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
    isPrivate: false,
  });

  await user.click(screen.getByRole('button', { name: 'Arhivează Foto' }));
  const archive = await screen.findByRole('dialog', { name: 'Arhivează Foto' });
  await user.click(within(archive).getByRole('button', { name: 'Arhivează' }));
  expect(api.mutate).toHaveBeenLastCalledWith({ kind: 'archive', groupId: 5 });
});

/* ---------------------------------------------- Private Groups (#757, R25) */

const privateTree = [
  tree[0] as AdminGroup,
  group(2, 'Logistică', [1, 2], 1, { min_level: 1, is_private: true }),
  group(5, 'Foto', [1, 2, 5], 2, { min_level: 1, is_private: true }),
];

it('marks a Private Group beside its name on the Group screen and in its Child list, never a public one', async () => {
  const user = userEvent.setup();
  const publicView = show(1);
  expect(screen.queryByText('Privat')).toBeNull();
  publicView.unmount();

  api.groups.mockReturnValue({
    data: privateTree,
    isPending: false,
    isError: false,
  });
  const { container } = show(2);
  const heading = screen.getByRole('heading', { name: 'Logistică' });
  expect(
    within(heading.parentElement as HTMLElement).getByText('Privat'),
  ).toBeVisible();
  await user.click(tab('Grupuri copil'));
  const children = screen.getByRole('list', { name: 'Subgrupuri' });
  expect(within(children).getByText('Privat')).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('creates a Child Group of a Private Group private, with the switch on and locked', async () => {
  const user = userEvent.setup();
  api.groups.mockReturnValue({
    data: privateTree,
    isPending: false,
    isError: false,
  });
  // A Group Manager, not BC: inheriting privacy needs no level-6 choice.
  capabilities(false);
  api.myGroups.mockReturnValue({ data: [myGroup(2, 'manager')] });
  show(2);
  await user.click(tab('Grupuri copil'));
  await user.click(screen.getByRole('button', { name: 'Subgrup nou' }));
  const create = await screen.findByRole('dialog', {
    name: 'Subgrup al Logistică',
  });
  const privacy = within(create).getByRole('checkbox', {
    name: /Grup privat/,
  });
  expect(privacy).toBeChecked();
  expect(privacy).toHaveAttribute('aria-disabled', 'true');
  expect(create).toHaveTextContent(
    'Logistică este privat, deci și grupul nou va fi privat.',
  );
  await user.type(within(create).getByLabelText('Numele grupului'), 'Sunet');
  await user.click(within(create).getByRole('button', { name: 'Creează' }));
  expect(api.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'create', parentId: 2, isPrivate: true }),
  );
});

it('offers a private Child under a public parent only to BC and the Moderator', async () => {
  const user = userEvent.setup();
  capabilities(false);
  api.myGroups.mockReturnValue({ data: [myGroup(2, 'manager')] });
  const manager = show(2);
  await user.click(tab('Grupuri copil'));
  await user.click(screen.getByRole('button', { name: 'Subgrup nou' }));
  const create = await screen.findByRole('dialog', {
    name: 'Subgrup al Logistică',
  });
  // create_group refuses a private Child under a public parent below level 6.
  expect(
    within(create).queryByRole('checkbox', { name: /Grup privat/ }),
  ).toBeNull();
  manager.unmount();

  capabilities(true);
  api.myGroups.mockReturnValue({ data: [] });
  show(2);
  await user.click(tab('Grupuri copil'));
  await user.click(screen.getByRole('button', { name: 'Subgrup nou' }));
  const bc = await screen.findByRole('dialog', {
    name: 'Subgrup al Logistică',
  });
  const privacy = within(bc).getByRole('checkbox', { name: /Grup privat/ });
  expect(privacy).not.toHaveAttribute('aria-disabled', 'true');
  await user.click(privacy);
  await user.type(within(bc).getByLabelText('Numele grupului'), 'Audit');
  await user.click(within(bc).getByRole('button', { name: 'Creează' }));
  expect(api.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'create', parentId: 2, isPrivate: true }),
  );
});

it('turns a Group private only after naming the subtree it hides', async () => {
  const user = userEvent.setup();
  show(2);
  const privacy = await screen.findByRole('checkbox', { name: /Grup privat/ });
  expect(privacy).not.toBeChecked();
  await user.click(privacy);

  const save = screen.getByRole('button', { name: 'Vezi ce devine privat' });
  await user.click(save);
  // Nothing is sent yet: the preview names every Group below first.
  expect(api.mutate).not.toHaveBeenCalled();
  const hidden = screen.getByRole('list', {
    name: 'Subgrupuri care devin private',
  });
  expect(within(hidden).getByText('Foto')).toBeVisible();
  expect(screen.getByText(/Cererile de înscriere se opresc/)).toBeVisible();

  await user.click(
    screen.getByRole('button', { name: 'Confirmă și salvează' }),
  );
  expect(api.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: 'structure',
      groupId: 2,
      isPrivate: true,
    }),
  );
});

it('makes a Private Group public again in one save, and says its Child Groups stay private', async () => {
  const user = userEvent.setup();
  api.groups.mockReturnValue({
    data: privateTree,
    isPending: false,
    isError: false,
  });
  show(2);
  const privacy = await screen.findByRole('checkbox', { name: /Grup privat/ });
  expect(privacy).toBeChecked();
  await user.click(privacy);
  expect(privacy).toHaveAccessibleName(/Subgrupurile rămân private/);
  await user.click(screen.getByRole('button', { name: 'Salvează structura' }));
  expect(api.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: 'structure',
      groupId: 2,
      isPrivate: false,
    }),
  );
});

it("locks a Private Group's Applications and a private parent's Child Group, with the reason", async () => {
  api.groups.mockReturnValue({
    data: privateTree,
    isPending: false,
    isError: false,
  });
  show(5);
  const applications = await screen.findByRole('checkbox', {
    name: /Primește cereri de înscriere/,
  });
  expect(applications).toHaveAttribute('aria-disabled', 'true');
  expect(applications).toHaveAccessibleName(
    /Un grup privat nu primește cereri de înscriere/,
  );
  const privacy = screen.getByRole('checkbox', { name: /Grup privat/ });
  expect(privacy).toBeChecked();
  expect(privacy).toHaveAttribute('aria-disabled', 'true');
  expect(privacy).toHaveAccessibleName(
    /rămâne privat cât timp grupul părinte e privat/,
  );
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

it('notes on the Cereri tab that a Group with a form link takes sign-ups by form, and still lists Applications (#698)', async () => {
  const user = userEvent.setup();
  const note =
    'Grupul primește înscrieri prin formular; adaugă membrii din Roster.';
  const first = show();
  // Neither taking Applications nor holding one: no Cereri tab at all (B49).
  expect(within(tabBar()).queryByRole('link', { name: 'Cereri' })).toBeNull();
  first.unmount();

  api.groups.mockReturnValue({
    data: tree.map((row) =>
      row.id === 2
        ? {
            ...row,
            accepts_applications: true,
            application_level: 1,
            application_form_label: 'Formular de înscriere',
            application_form_url: 'https://forms.example.org/logistica',
          }
        : row,
    ),
    isPending: false,
    isError: false,
  });
  api.applications.mockReturnValue({
    data: [
      {
        id: 7,
        group_id: 2,
        member_id: 'd',
        member: { memberId: 'd', fullName: 'Dana Ionescu' },
        status: 'pending',
        note: 'Am aplicat înainte de formular.',
        created_at: '2026-09-24T12:00:00Z',
        decided_at: null,
        decided_by: null,
        decision_note: null,
      },
    ],
    isPending: false,
    isError: false,
  });
  show();
  await user.click(tab('Cereri'));
  expect(screen.getByText(note)).toBeVisible();
  // A link set later does not hide the Applications already filed.
  expect(screen.getByRole('heading', { name: /Dana Ionescu/ })).toBeVisible();
  expect(screen.getByText('Am aplicat înainte de formular.')).toBeVisible();
});

it("resets the settings form to the Group it now shows, so one Group's form link is never saved onto another (#698)", async () => {
  const user = userEvent.setup();
  api.groups.mockReturnValue({
    // Both take Applications, so both show the form link's fields (B54).
    data: tree.map((row) =>
      row.id === 2
        ? {
            ...row,
            accepts_applications: true,
            application_level: 1,
            application_form_label: 'Formular Logistică',
            application_form_url: 'https://forms.example.org/logistica',
          }
        : row.id === 1
          ? { ...row, accepts_applications: true, application_level: 0 }
          : row,
    ),
    isPending: false,
    isError: false,
  });
  show();
  expect(screen.getByLabelText('Eticheta butonului')).toHaveValue(
    'Formular Logistică',
  );
  // The breadcrumb moves to the parent while the screen stays mounted.
  await user.click(screen.getByRole('link', { name: 'Educațional' }));
  expect(
    await screen.findByRole('heading', { name: 'Educațional' }),
  ).toBeVisible();
  expect(screen.getByLabelText('Numele grupului')).toHaveValue('Educațional');
  expect(screen.getByLabelText('Eticheta butonului')).toHaveValue('');
  expect(screen.getByLabelText('Adresa formularului')).toHaveValue('');
});

/* ------------------------------ Tabs by authority, in the URL (B49, D6) */

it("shows a Group's Responsible only the Roster and Campanii, opening on the Roster, with no refusal", () => {
  capabilities(false);
  api.myGroups.mockReturnValue({ data: [myGroup(2, 'responsible')] });
  show();
  // Logistică has a Child Group, so Grupuri copil stays, read-only.
  expect(tabNames()).toEqual(['Roster', 'Grupuri copil', 'Campanii']);
  expect(tab('Roster')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('table')).toBeVisible();
  expect(screen.queryByText(/nu îi poți schimba setările/)).toBeNull();
  expect(screen.queryByText(/schimbările îi revin/)).toBeNull();
});

it('tells a viewer with no Group Role once that the changes are not theirs', () => {
  capabilities(false);
  api.myGroups.mockReturnValue({ data: [myGroup(2, 'member')] });
  show();
  expect(tabNames()).toEqual(['Roster', 'Grupuri copil', 'Campanii']);
  expect(
    screen.getAllByText(
      /Poți vedea grupul|schimbările îi revin coordonatorului lui/,
    ),
  ).toHaveLength(1);
  // A plain Member has no action column.
  expect(screen.queryByRole('columnheader', { name: 'Acțiuni' })).toBeNull();
});

it("shows a Child Group's Manager Setări, Roluri and Grupuri copil", () => {
  capabilities(false);
  api.myGroups.mockReturnValue({ data: [myGroup(5, 'manager')] });
  show(5);
  // Foto has no Child Groups, but its Manager may create one.
  expect(tabNames()).toEqual([
    'Setări',
    'Roster',
    'Roluri',
    'Grupuri copil',
    'Campanii',
  ]);
});

it('hides Grupuri copil when there are none and the viewer may not create one', () => {
  capabilities(false);
  api.myGroups.mockReturnValue({ data: [myGroup(5, 'responsible')] });
  show(5);
  expect(tabNames()).toEqual(['Roster', 'Campanii']);
});

it('shows Cereri while an Application is pending, even with Applications off', () => {
  api.applications.mockReturnValue({
    data: [
      {
        id: 7,
        group_id: 2,
        member_id: 'd',
        member: { memberId: 'd', fullName: 'Dana Ionescu' },
        status: 'pending',
        note: null,
        created_at: '2026-09-24T12:00:00Z',
      },
    ],
    isPending: false,
    isError: false,
  });
  show();
  expect(tabNames()).toContain('Cereri');
});

it('opens the tab ?tab= names, and writes the tab to the URL on a switch', async () => {
  const user = userEvent.setup();
  show('2?tab=roluri');
  expect(tab('Roluri')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('region', { name: 'Responsabili' })).toBeVisible();

  await user.click(tab('Roster'));
  expect(where()).toBe('/administrare/grupuri/2?tab=roster');
  expect(tab('Roster')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('table')).toBeVisible();
  // Each tab is a link to its own address, so a reload keeps it.
  expect(tab('Campanii')).toHaveAttribute(
    'href',
    '/administrare/grupuri/2?tab=campanii',
  );
});

it('opens Cereri from ?tab=cereri when the Group takes Applications', () => {
  api.groups.mockReturnValue({
    data: tree.map((row) =>
      row.id === 2
        ? { ...row, accepts_applications: true, application_level: 1 }
        : row,
    ),
    isPending: false,
    isError: false,
  });
  show('2?tab=cereri');
  expect(tab('Cereri')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Nu sunt cereri în așteptare.')).toBeVisible();
});

it.each(['necunoscut', 'cereri'])(
  'ignores ?tab=%s when it is no tab the viewer can use, and opens the first',
  (value) => {
    show(`2?tab=${value}`);
    expect(tab('Setări')).toHaveAttribute('aria-current', 'page');
  },
);

it('keeps the Roster as the way back from a member page (D4)', async () => {
  const user = userEvent.setup();
  show('2?tab=roster');
  await user.click(screen.getByRole('link', { name: 'Ana Pop' }));
  const back = screen.getByRole('link', { name: 'Înapoi la grup' });
  expect(back).toHaveAttribute('href', '/administrare/grupuri/2?tab=roster');
  await user.click(back);
  expect(tab('Roster')).toHaveAttribute('aria-current', 'page');
});

it('goes back to the member page it was opened from, across tab changes', async () => {
  const user = userEvent.setup();
  show(2, {
    from: { to: '/administrare/membri/a', label: 'Înapoi la membru' },
  });
  expect(
    screen.getByRole('link', { name: 'Înapoi la membru' }),
  ).toHaveAttribute('href', '/administrare/membri/a');
  await user.click(tab('Roster'));
  expect(
    screen.getByRole('link', { name: 'Înapoi la membru' }),
  ).toHaveAttribute('href', '/administrare/membri/a');
});

it("hints 'Retrage întâi funcția' only where the viewer may withdraw that position (B50)", () => {
  // A Responsible cannot end the Manager's position.
  capabilities(false);
  api.myGroups.mockReturnValue({ data: [myGroup(2, 'responsible')] });
  show('2?tab=roster');
  expect(screen.queryByText('Retrage întâi funcția')).toBeNull();
  // …but may still take an ordinary Member out.
  expect(
    screen.getByRole('button', { name: 'Scoate pe Ana Pop din grup' }),
  ).toBeVisible();
});

it('links a top-level Group’s unfinished work without a Subgrup', async () => {
  const user = userEvent.setup();
  api.mutate.mockRejectedValue(
    new CommandError({ code: 'PT409', message: 'group_has_open_work' }, 'nope'),
  );
  show(1);
  await user.click(screen.getByRole('button', { name: 'Arhivează grupul' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Arhivează Educațional',
  });
  await user.click(within(dialog).getByRole('button', { name: 'Arhivează' }));
  expect(
    within(dialog).getByRole('link', { name: 'Vezi taskurile neterminate' }),
  ).toHaveAttribute('href', '/tracker?lista=gestionat&grup=1');
});

it('puts the Group tabs in one strip that keeps a single row at 375 px (X7)', () => {
  show();
  expect(tabBar().className).toContain('max-sm:overflow-x-auto');
  expect(tabBar().className).not.toContain('max-sm:flex-wrap');
});
