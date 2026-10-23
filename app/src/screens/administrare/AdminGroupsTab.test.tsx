import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as axe from 'axe-core';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';
import type { AdminGroup, AppointableMember } from '../../queries/groups-admin';
import type { MyGroup } from '../../queries/my-groups';

const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  groups: vi.fn(),
  myGroups: vi.fn(),
  members: vi.fn(),
  mutate: vi.fn(),
  roles: vi.fn(),
  rosterRows: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: api.capabilities,
}));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    claims: { member_level: 6 },
    session: { user: { id: 'me' } },
  }),
}));
vi.mock('../../queries/reference', () => ({
  useRoles: api.roles,
  useMyGroups: api.rosterRows,
}));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useAdminGroups: api.groups,
  useMyGroupRoles: api.myGroups,
  useAppointableMembers: api.members,
  useGroupCommand: () => ({ mutateAsync: api.mutate, isPending: false }),
}));
// The Cereri de aderare tab's rule has its own suite (applications-tab).
vi.mock('./applications-tab', () => ({
  useApplicationsTabShown: () => true,
  usePendingApplicationCount: () => 0,
  applicationCount: (count: number) => `${count} cereri`,
}));
import { chooseOption } from '../../test/select';
import AdminGroupsTab from './AdminGroupsTab';
import AdministrareLayout from './AdministrareLayout';
import { optionNames } from './select-test-options';

vi.setConfig({ testTimeout: 15_000 });

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
    category: id === 1 ? 'department' : 'team',
    path,
    parent_id: parentId,
    min_level: 0,
    status: 'active',
    is_organization: false,
    manager_title: null,
    responsible_title: null,
    automatic_membership: false,
    accepts_applications: false,
    application_level: null,
    competes_in_cup: false,
    counts_toward_parent_cup: true,
    shared_work_visibility: false,
    is_private: false,
    application_form_label: null,
    application_form_url: null,
    memberCount: 4,
    ...extra,
  };
}

const tree = [
  group(1, 'Educațional', [1], null),
  group(2, 'Logistică', [1, 2], 1),
  group(3, 'Balul Bobocilor', [3], null, { category: 'project' }),
];

function capabilities(granted: Record<string, boolean>) {
  api.capabilities.mockReturnValue({
    data: {
      managesAnyGroup: true,
      manageTasks: true,
      seeDirectory: false,
      seeLeadership: false,
      manageRoles: false,
      provisionMembers: false,
      createTopLevelGroups: false,
      administer: true,
      ...granted,
    },
  });
}

beforeEach(() => {
  api.mutate.mockReset();
  api.mutate.mockResolvedValue({ id: 9 });
  api.groups.mockReturnValue({ data: tree, isPending: false, isError: false });
  api.myGroups.mockReturnValue({ data: [], isPending: false, isError: false });
  api.members.mockReturnValue({ data: [] });
  api.rosterRows.mockReturnValue({
    membershipRows: [],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  api.roles.mockReturnValue({
    data: new Map([
      ['voluntar', { name: 'Voluntar', level: 1 }],
      ['vot', { name: 'Voluntar cu Drept de Vot', level: 3 }],
      ['bce', { name: 'BCE', level: 5 }],
    ]),
  });
  capabilities({ createTopLevelGroups: true });
});

function GroupPage() {
  const { groupId } = useParams();
  return <h1>Grupul {groupId}</h1>;
}

/** Where the router is, so a test reads the URL state (`?vedere=`). */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

/** The tab inside the Administrare layout, whose header carries its action. */
function show(
  entry:
    string | { pathname: string; state: unknown } = '/administrare/grupuri',
) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path="/administrare" element={<AdministrareLayout />}>
            <Route path="grupuri" element={<AdminGroupsTab />} />
          </Route>
          <Route
            path="/administrare/grupuri/:groupId"
            element={<GroupPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function myGroup(
  id: number,
  name: string,
  groupRole: string,
  extra: Partial<MyGroup> = {},
): MyGroup {
  return {
    id,
    name,
    short: '',
    color: '',
    category: 'team',
    path: [id],
    min_level: 1,
    status: 'active',
    is_organization: false,
    group_role: groupRole,
    explicit: true,
    automatic: false,
    ...extra,
  };
}

it('puts the whole tree in the Structura grupurilor panel for BC', () => {
  show();
  expect(
    screen.getByRole('region', { name: 'Structura grupurilor' }),
  ).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('3 grupuri');
  // The page already says Grupuri: the list has a name, not a heading.
  expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
    'Administrare',
  ]);
  expect(document.querySelector('[data-slot="section-eyebrow"]')).toBeNull();
  // Extinde tot is an icon on the controls' row, beside the count.
  const expand = screen.getByRole('button', { name: 'Extinde tot' });
  expect(expand).toHaveTextContent('');
  expect(expand.closest('[data-slot="groups-toolbar"]')).toContainElement(
    screen.getByRole('status'),
  );
  // No header row over one column of names on a phone: the whole row goes
  // off screen, not cell by cell.
  const header = screen.getByRole('columnheader', { name: 'Grup' });
  expect(header.closest('thead')).toHaveClass(
    'max-sm:not-focus-within:sr-only',
  );
  expect(header.className).not.toContain('is(th)');
});

it('shows BC the whole tree, collapsed, and expands one Group at a time', async () => {
  const user = userEvent.setup();
  const { container } = show();
  expect(screen.getByRole('link', { name: 'Educațional' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Balul Bobocilor' })).toBeVisible();
  expect(screen.queryByRole('link', { name: /^Logistică/ })).toBeNull();

  await user.click(
    screen.getByRole('button', { name: 'Extinde subgrupurile Educațional' }),
  );
  expect(
    screen.getByRole('link', { name: 'Logistică, subgrup al Educațional' }),
  ).toHaveAttribute('href', '/administrare/grupuri/2');
  // Category, Minimum Level and member count ride along with each row.
  expect(screen.getAllByText('Departament').length).toBeGreaterThan(0);
  expect(screen.getByText('Proiect')).toBeVisible();

  await user.click(
    screen.getByRole('button', { name: 'Restrânge subgrupurile Educațional' }),
  );
  expect(screen.queryByRole('link', { name: /^Logistică/ })).toBeNull();

  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('shows a Group Manager their own Groups instead, with the inherited role marked', () => {
  capabilities({ createTopLevelGroups: false });
  const mine: MyGroup[] = [
    {
      id: 2,
      name: 'Logistică',
      short: '',
      color: '',
      category: 'team',
      path: [1, 2],
      min_level: 1,
      status: 'active',
      is_organization: false,
      group_role: 'manager',
      explicit: true,
      automatic: false,
    },
    {
      id: 5,
      name: 'Foto',
      short: '',
      color: '',
      category: 'team',
      path: [1, 2, 5],
      min_level: 1,
      status: 'active',
      is_organization: false,
      group_role: 'manager',
      explicit: false,
      automatic: false,
    },
  ];
  api.myGroups.mockReturnValue({
    data: mine,
    isPending: false,
    isError: false,
  });
  api.myGroups.mockReturnValue({
    // A plain membership is no function: OSUBB is not listed (relevance B47).
    data: [...mine, myGroup(9, 'OSUBB', 'member', { automatic: true })],
    isPending: false,
    isError: false,
  });
  // Coordonator of Logistică on its own roster row; Foto has none.
  api.rosterRows.mockReturnValue({
    membershipRows: [
      { group_id: 2, group_role: 'manager', position_title: null },
    ],
    isPending: false,
    isError: false,
  });
  show();

  expect(screen.getByRole('region', { name: 'Grupurile mele' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'OSUBB' })).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Logistică, subgrup al Educațional' }),
  ).toHaveAttribute('href', '/administrare/grupuri/2');
  expect(
    screen.getByRole('link', { name: 'Foto, subgrup al Logistică' }),
  ).toBeVisible();
  // The Child Group reached only through an ancestor says so (ruling R14).
  expect(screen.getAllByText('moștenit')).toHaveLength(1);
  const foto = screen
    .getByRole('link', { name: /^Foto/ })
    .closest('tr') as HTMLElement;
  expect(within(foto).getByText('moștenit')).toBeVisible();
  // Educațional, led by someone else, stays as greyed context: no link, no
  // function (#921).
  expect(screen.queryByRole('link', { name: 'Educațional' })).toBeNull();
  const context = screen.getByText('Educațional').closest('tr') as HTMLElement;
  expect(context).toHaveClass('text-muted-foreground');
  expect(within(context).queryByText('Coordonator')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Creează Grup' })).toBeNull();
});

it('marks an inherited role even when the Manager is a plain member there too (F-17)', () => {
  capabilities({ createTopLevelGroups: false });
  api.myGroups.mockReturnValue({
    data: [
      myGroup(1, 'Educațional', 'manager'),
      // On the roster as a plain member, Coordonator from Educațional.
      myGroup(2, 'Logistică', 'manager', { path: [1, 2], explicit: true }),
    ],
    isPending: false,
    isError: false,
  });
  api.rosterRows.mockReturnValue({
    membershipRows: [
      { group_id: 1, group_role: 'manager', position_title: null },
      { group_id: 2, group_role: 'member', position_title: null },
    ],
  });
  show();
  const child = screen
    .getByRole('link', { name: /^Logistică/ })
    .closest('tr') as HTMLElement;
  const parent = screen
    .getByRole('link', { name: 'Educațional' })
    .closest('tr') as HTMLElement;
  expect(within(child).getByText('moștenit')).toBeVisible();
  expect(within(parent).queryByText('moștenit')).toBeNull();
});

it('offers "Creează Grup" only with the capability, and creates through the command', async () => {
  capabilities({ createTopLevelGroups: false });
  const denied = show();
  expect(screen.queryByRole('button', { name: 'Creează Grup' })).toBeNull();
  denied.unmount();

  const user = userEvent.setup();
  capabilities({ createTopLevelGroups: true });
  show();
  // The action is the page's plus button, not a button in the header.
  const header = screen
    .getByRole('heading', { level: 1, name: 'Administrare' })
    .closest('header') as HTMLElement;
  expect(within(header).queryByRole('button')).toBeNull();
  const plus = screen.getByRole('button', { name: 'Creează Grup' });
  expect(plus).toHaveAttribute('data-slot', 'fab');
  await user.click(plus);
  const dialog = await screen.findByRole('dialog', { name: 'Grup nou' });
  await user.type(within(dialog).getByLabelText('Numele grupului'), 'Interne');
  // A form sheet; three categories are one segmented choice, not a select.
  expect(dialog).toHaveAttribute('data-slot', 'form-sheet');
  expect(dialog).not.toHaveAccessibleDescription();
  const category = within(dialog).getByRole('radiogroup', {
    name: 'Categorie',
  });
  expect(
    within(category)
      .getAllByRole('radio')
      .map((radio) => radio.textContent),
  ).toEqual(['Departament', 'Echipă', 'Proiect']);
  expect(
    within(category).getByRole('radio', { name: 'Departament' }),
  ).toBeChecked();
  expect(
    within(dialog).getByRole('combobox', { name: 'Grup părinte (opțional)' }),
  ).toHaveAccessibleDescription(
    'Grupul părinte nu se mai poate schimba după creare.',
  );
  expect(
    (
      await axe.run(dialog as HTMLElement, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  await user.click(within(dialog).getByRole('button', { name: 'Creează' }));

  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'create',
    name: 'Interne',
    category: 'department',
    parentId: null,
    minLevel: null,
    managerId: null,
    color: null,
    short: null,
    isPrivate: false,
  });
  await waitFor(() =>
    expect(screen.getByText('Grupul a fost creat.')).toBeVisible(),
  );
});

function appointable(
  memberId: string,
  name: string,
  roleId: string,
  roleLabel: string,
  level: number,
  status = 'activ',
): AppointableMember {
  return {
    memberId,
    name,
    avatarColor: null,
    status,
    roleId,
    roleLabel,
    level,
  };
}

const APPOINTABLE = [
  { ...appointable('ana', 'Ana Pop', 'bce', 'BCE', 5), nickname: 'Ani' },
  appointable('bc', 'Cristina Șerban', 'bc', 'BC', 6),
  appointable('mod', 'Moderator OSUBB', 'moderator', 'Moderator', 9),
  appointable('rec', 'Radu Recrut', 'recrut', 'Recrut', 0),
  appointable(
    'old',
    'Oana Plecată',
    'vot',
    'Voluntar cu Drept de Vot',
    3,
    'inactiv',
  ),
];

it('names no direct Manager by default, and never offers the Moderator (#951)', async () => {
  const user = userEvent.setup();
  api.members.mockReturnValue({ data: APPOINTABLE });
  show();
  await user.click(screen.getByRole('button', { name: 'Creează Grup' }));
  const dialog = await screen.findByRole('dialog', { name: 'Grup nou' });
  // The category titles the position: Vicepreședinte for a Department (#957).
  const picker = within(dialog).getByRole('combobox', {
    name: 'Manager direct — Vicepreședinte (opțional)',
  });
  expect(picker).toHaveTextContent('Fără manager direct');
  // Said once, behind the "i" beside the label.
  expect(picker).toHaveAccessibleDescription(
    'Fără el, grupul este condus de BC și Moderator.',
  );
  expect(
    within(dialog).getByRole('button', { name: 'Despre managerul direct' }),
  ).toBeVisible();

  await user.click(picker);
  const options = within(await screen.findByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.textContent);
  expect(options).toEqual([
    'Fără manager direct',
    'APAna PopBCE',
    'CȘCristina ȘerbanBC',
    'RRRadu RecrutRecrut',
  ]);
  await user.keyboard('{Escape}');

  await user.type(within(dialog).getByLabelText('Numele grupului'), 'Interne');
  await user.click(within(dialog).getByRole('button', { name: 'Creează' }));
  expect(api.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'create', managerId: null }),
  );
  await waitFor(() =>
    expect(screen.getByText('Grupul a fost creat.')).toBeVisible(),
  );
});

it('appoints the chosen direct Manager with the Group and says so (#951)', async () => {
  const user = userEvent.setup();
  api.members.mockReturnValue({ data: APPOINTABLE });
  show();
  await user.click(screen.getByRole('button', { name: 'Creează Grup' }));
  const dialog = await screen.findByRole('dialog', { name: 'Grup nou' });
  await user.type(within(dialog).getByLabelText('Numele grupului'), 'Gala');
  await user.click(within(dialog).getByRole('radio', { name: 'Proiect' }));
  const picker = within(dialog).getByRole('combobox', {
    name: 'Manager direct — Coordonator Principal (opțional)',
  });
  await user.click(picker);
  await user.click(await screen.findByRole('option', { name: /Ana Pop/ }));
  expect(picker).toHaveTextContent('Ana Pop');

  // Taken back through the same list: the empty choice sends nobody.
  await user.click(picker);
  await user.click(
    await screen.findByRole('option', { name: 'Fără manager direct' }),
  );
  expect(picker).toHaveTextContent('Fără manager direct');
  await user.click(picker);
  await user.click(await screen.findByRole('option', { name: /Ana Pop/ }));

  await user.click(within(dialog).getByRole('button', { name: 'Creează' }));
  expect(api.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'create',
      name: 'Gala',
      category: 'project',
      managerId: 'ana',
    }),
  );
  // Named through MemberName, by Nickname, under the position's title.
  const receipt = await screen.findByText(/^Grupul a fost creat, cu/);
  expect(receipt).toHaveTextContent(
    'Grupul a fost creat, cu APAni ca Coordonator Principal.',
  );
  expect(
    within(receipt).getByRole('button', { name: 'Profilul membrului Ani' }),
  ).toBeVisible();
});

it('keeps a direct Manager dropped by the Minimum Level dropped when it is lowered again (#951)', async () => {
  const user = userEvent.setup();
  api.members.mockReturnValue({ data: APPOINTABLE });
  api.roles.mockReturnValue({ data: LADDER_WITH_MODERATOR });
  show();
  await user.click(screen.getByRole('button', { name: 'Creează Grup' }));
  const dialog = await screen.findByRole('dialog', { name: 'Grup nou' });
  await user.type(within(dialog).getByLabelText('Numele grupului'), 'Audit');
  const picker = within(dialog).getByRole('combobox', {
    name: 'Manager direct — Vicepreședinte (opțional)',
  });
  await user.click(picker);
  await user.click(await screen.findByRole('option', { name: /Radu Recrut/ }));
  const level = within(dialog).getByLabelText('Nivel minim');
  await chooseOption(user, level, 'BCE');
  // Back to the first option, the default: no Minimum Level of its own.
  await chooseOption(user, level, 'Recrut');
  expect(picker).toHaveTextContent('Fără manager direct');

  await user.click(within(dialog).getByRole('button', { name: 'Creează' }));
  expect(api.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ minLevel: null, managerId: null }),
  );
});

it('drops a direct Manager the raised Minimum Level rules out (#951)', async () => {
  const user = userEvent.setup();
  api.members.mockReturnValue({ data: APPOINTABLE });
  api.roles.mockReturnValue({ data: LADDER_WITH_MODERATOR });
  show();
  await user.click(screen.getByRole('button', { name: 'Creează Grup' }));
  const dialog = await screen.findByRole('dialog', { name: 'Grup nou' });
  await user.type(within(dialog).getByLabelText('Numele grupului'), 'Audit');
  const picker = within(dialog).getByRole('combobox', {
    name: 'Manager direct — Vicepreședinte (opțional)',
  });
  await user.click(picker);
  await user.click(await screen.findByRole('option', { name: /Radu Recrut/ }));
  await chooseOption(user, within(dialog).getByLabelText('Nivel minim'), 'BCE');
  expect(picker).toHaveTextContent('Fără manager direct');

  await user.click(within(dialog).getByRole('button', { name: 'Creează' }));
  expect(api.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ minLevel: 5, managerId: null }),
  );
});

it('creates a Private Group when BC ticks "Grup privat" (#757)', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Creează Grup' }));
  const dialog = await screen.findByRole('dialog', { name: 'Grup nou' });
  await user.type(within(dialog).getByLabelText('Numele grupului'), 'Audit');
  const privacy = within(dialog).getByRole('checkbox', {
    name: /Grup privat/,
  });
  expect(privacy).not.toBeChecked();
  expect(privacy).toBeEnabled();
  expect(dialog).toHaveTextContent(
    'Vizibil doar membrilor, coordonatorilor de pe traseu și BC. Fără cereri de înscriere; intrarea se face prin adăugare directă.',
  );
  await user.click(privacy);
  await user.click(within(dialog).getByRole('button', { name: 'Creează' }));

  expect(api.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'create',
      name: 'Audit',
      parentId: null,
      isPrivate: true,
    }),
  );
});

it('marks a Private Group in the tree with the Privat badge, and no public one (#757)', async () => {
  api.groups.mockReturnValue({
    data: [
      group(1, 'Educațional', [1], null),
      group(3, 'Balul Bobocilor', [3], null, {
        category: 'project',
        is_private: true,
      }),
    ],
    isPending: false,
    isError: false,
  });
  const { container } = show();
  const privateRow = screen
    .getByRole('link', { name: 'Balul Bobocilor' })
    .closest('tr') as HTMLElement;
  const publicRow = screen
    .getByRole('link', { name: 'Educațional' })
    .closest('tr') as HTMLElement;
  expect(within(privateRow).getByText('Privat')).toBeVisible();
  // A Group's state sits at the end of its row, after the name.
  expect(
    within(privateRow).getByText('Privat').closest('[data-slot="group-state"]'),
  ).toHaveClass('ms-auto');
  expect(within(publicRow).queryByText('Privat')).toBeNull();
  expect(screen.getAllByText('Privat')).toHaveLength(1);
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it("marks a Private Group in a Manager's own list too (#757)", () => {
  capabilities({ createTopLevelGroups: false });
  api.groups.mockReturnValue({
    data: [
      group(1, 'Educațional', [1], null),
      group(2, 'Logistică', [1, 2], 1, { is_private: true }),
    ],
    isPending: false,
    isError: false,
  });
  api.myGroups.mockReturnValue({
    data: [
      {
        id: 2,
        name: 'Logistică',
        short: '',
        color: '',
        category: 'team',
        path: [1, 2],
        min_level: 1,
        status: 'active',
        is_organization: false,
        group_role: 'manager',
        explicit: true,
        automatic: false,
      },
    ] satisfies MyGroup[],
    isPending: false,
    isError: false,
  });
  show();
  const row = screen
    .getByRole('link', { name: /^Logistică/ })
    .closest('tr') as HTMLElement;
  expect(within(row).getByText('Privat')).toBeVisible();
});

it('says so, once, when the tree cannot be read', () => {
  api.groups.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
  });
  show();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Nu am putut încărca grupurile.',
  );
});

const LADDER_WITH_MODERATOR = new Map([
  ['recrut', { name: 'Recrut', level: 0 }],
  ['voluntar', { name: 'Voluntar', level: 1 }],
  ['activ', { name: 'Voluntar Activ', level: 2 }],
  ['vot', { name: 'Voluntar cu Drept de Vot', level: 3 }],
  ['bce', { name: 'BCE', level: 5 }],
  ['bc', { name: 'BC', level: 6 }],
  ['moderator', { name: 'Moderator', level: 9 }],
]);

it('offers the Minimum Level of a new Group by Role name, the six rungs only (R29b)', async () => {
  const user = userEvent.setup();
  api.roles.mockReturnValue({ data: LADDER_WITH_MODERATOR });
  show();
  await user.click(screen.getByRole('button', { name: 'Creează Grup' }));
  const dialog = await screen.findByRole('dialog', { name: 'Grup nou' });
  const field = within(dialog).getByLabelText('Nivel minim');
  // The app's own drop-down, opening on the default.
  expect(field).toHaveAttribute('data-slot', 'select');
  expect(field).toHaveTextContent('Recrut');
  expect(await optionNames(user, field)).toEqual([
    'Recrut',
    'Voluntar',
    'Voluntar Activ',
    'Voluntar cu Drept de Vot',
    'BCE',
    'BC',
  ]);
});

it('shows each Minimum Level in the tree by its Role name, never the number (R29b)', () => {
  api.groups.mockReturnValue({
    data: [
      group(1, 'Educațional', [1], null, { min_level: 3 }),
      group(3, 'Balul Bobocilor', [3], null, { min_level: 6 }),
    ],
    isPending: false,
    isError: false,
  });
  show();
  const row = screen.getByRole('link', { name: 'Educațional' }).closest('tr');
  expect(row).not.toBeNull();
  expect(
    within(row as HTMLElement).getByText('Voluntar cu Drept de Vot'),
  ).toBeVisible();
  const project = screen
    .getByRole('link', { name: 'Balul Bobocilor' })
    .closest('tr') as HTMLElement;
  expect(within(project as HTMLElement).getByText('BC')).toBeVisible();
  expect(within(project as HTMLElement).queryByText('6')).toBeNull();
});

it("shows a Manager's own Groups' Minimum Level by Role name (R29b)", () => {
  capabilities({ createTopLevelGroups: false });
  // Nothing readable beyond `my_groups()`: the list still stands on it.
  api.groups.mockReturnValue({ data: [], isPending: false, isError: false });
  api.myGroups.mockReturnValue({
    data: [
      myGroup(2, 'Logistică', 'manager', { path: [1, 2], min_level: 2 }),
      myGroup(4, 'Tineret', 'responsible', { min_level: 0 }),
    ],
    isPending: false,
    isError: false,
  });
  show();
  const row = screen.getByRole('link', { name: 'Logistică' }).closest('tr');
  expect(within(row as HTMLElement).getByText('Voluntar Activ')).toBeVisible();
  expect(within(row as HTMLElement).queryByText('2')).toBeNull();
});

it('shows only the columns whose values differ, and an archived Group only in Arhivate (B48, R65)', () => {
  api.groups.mockReturnValue({
    data: [
      group(1, 'Educațional', [1], null),
      group(2, 'Logistică', [1, 2], 1, { category: 'department' }),
      group(3, 'Balul Bobocilor', [3], null, {
        category: 'project',
        status: 'archived',
      }),
    ],
    isPending: false,
    isError: false,
  });
  const view = show();
  const headers = screen
    .getAllByRole('columnheader')
    .map((header) => header.textContent);
  // One category, one Minimum Level, one size among the active Groups: none
  // is a column. No Stare: Toate holds no archived Group (R65).
  expect(headers).toEqual(['Grup']);
  expect(screen.queryByRole('link', { name: 'Balul Bobocilor' })).toBeNull();
  expect(screen.queryByText('Arhivat')).toBeNull();
  view.unmount();

  show('/administrare/grupuri?vedere=arhivate');
  const archived = screen
    .getByRole('link', { name: 'Balul Bobocilor' })
    .closest('tr') as HTMLElement;
  expect(within(archived).getByText('Arhivat')).toBeVisible();
  expect(screen.getAllByText('Arhivat')).toHaveLength(1);
});

it("hides a Manager's single-valued columns too, but always names their function", () => {
  capabilities({ createTopLevelGroups: false });
  api.myGroups.mockReturnValue({
    data: [myGroup(2, 'Logistică', 'responsible')],
    isPending: false,
    isError: false,
  });
  show();
  expect(
    screen.getAllByRole('columnheader').map((header) => header.textContent),
  ).toEqual(['Grup', 'Funcția ta']);
});

it('opens the Group from anywhere on its row, and the name is a 44 px target (AD6)', async () => {
  const user = userEvent.setup();
  show();
  const link = screen.getByRole('link', { name: 'Balul Bobocilor' });
  expect(link).toHaveClass('min-h-11');
  const row = link.closest('tr') as HTMLElement;
  await user.click(within(row).getAllByRole('cell').at(-1) as HTMLElement);
  expect(
    await screen.findByRole('heading', { name: 'Grupul 3' }),
  ).toBeVisible();
});

it('draws a subgroup as a subgroup: rail, ring, regular weight and its parent named (#921)', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Extinde tot' }));
  const parent = screen.getByRole('link', { name: 'Educațional' });
  const child = screen.getByRole('link', {
    name: 'Logistică, subgrup al Educațional',
  });
  expect(parent).toHaveClass('font-semibold');
  expect(child).toHaveClass('font-normal');
  expect(child).not.toHaveClass('font-semibold');

  const parentRow = parent.closest('tr') as HTMLElement;
  const childRow = child.closest('tr') as HTMLElement;
  // A full dot on top, a ring below; the elbow only into the child.
  const node = (row: HTMLElement) =>
    row.querySelector('[data-slot=group-node]') as HTMLElement;
  expect(node(parentRow)).not.toHaveClass('border-[1.5px]');
  expect(node(childRow)).toHaveClass('border-[1.5px]');
  expect(parentRow.querySelector('[data-slot=tree-elbow]')).toBeNull();
  expect(childRow.querySelector('[data-slot=tree-elbow]')).not.toBeNull();
  // The parent's rail leaves its node while its children show.
  expect(
    parentRow.querySelectorAll('[data-slot=tree-guide] > span'),
  ).toHaveLength(1);
  // The fold control keeps to a chevron's width (a 28 px gutter with the
  // node), on parents only; a 48 px row.
  const fold = within(parentRow).getByRole('button', {
    name: 'Restrânge subgrupurile Educațional',
  });
  expect(fold).toHaveClass('w-4', 'h-11');
  expect(childRow.querySelector('[data-slot=tree-fold]')).toBeNull();
  expect(parent.closest('td')).toHaveClass('[&:is(td)]:py-0.5');
  // The child's details step back with it.
  expect(childRow).toHaveClass('text-muted-foreground');
  expect(parentRow).not.toHaveClass('text-muted-foreground');
});

const LED_BY_BC: MyGroup[] = [
  myGroup(2, 'Logistică', 'responsible', { path: [1, 2] }),
  myGroup(9, 'OSUBB', 'member', { automatic: true }),
];

it('offers BC who leads a Group "Toate | Conduse de mine", and narrows the tree by URL (#921)', async () => {
  const user = userEvent.setup();
  api.myGroups.mockReturnValue({
    data: LED_BY_BC,
    isPending: false,
    isError: false,
  });
  api.rosterRows.mockReturnValue({
    membershipRows: [
      { group_id: 2, group_role: 'responsible', position_title: null },
    ],
    isPending: false,
    isError: false,
  });
  show();
  const toggle = screen.getByRole('group', { name: 'Grupuri afișate' });
  expect(within(toggle).getByRole('button', { name: 'Toate' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('link', { name: 'Balul Bobocilor' })).toBeVisible();

  await user.click(
    within(toggle).getByRole('button', { name: 'Conduse de mine' }),
  );
  expect(screen.getByTestId('location')).toHaveTextContent('?vedere=conduse');
  expect(screen.getByRole('region', { name: 'Grupurile mele' })).toBeVisible();
  // Only what BC leads, its parent kept as greyed context.
  expect(screen.queryByRole('link', { name: 'Balul Bobocilor' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'OSUBB' })).toBeNull();
  const led = screen
    .getByRole('link', { name: 'Logistică, subgrup al Educațional' })
    .closest('tr') as HTMLElement;
  expect(within(led).getByText('Responsabil')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Educațional' })).toBeNull();
  expect(screen.getByText('Educațional')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Toate' }));
  expect(screen.getByTestId('location')).toBeEmptyDOMElement();
  expect(screen.getByRole('link', { name: 'Balul Bobocilor' })).toBeVisible();
});

it('opens Conduse de mine from the link itself (#921)', () => {
  api.myGroups.mockReturnValue({
    data: LED_BY_BC,
    isPending: false,
    isError: false,
  });
  show('/administrare/grupuri?vedere=conduse');
  expect(
    screen.getByRole('button', { name: 'Conduse de mine' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('link', { name: 'Balul Bobocilor' })).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Logistică, subgrup al Educațional' }),
  ).toBeVisible();
});

it('names "Funcția ta" after the Group\'s name for the position (#962)', () => {
  api.groups.mockReturnValue({
    data: tree.map((row) =>
      row.id === 2
        ? {
            ...row,
            manager_title: 'Vicepreședinte',
            responsible_title: 'Coordonator',
          }
        : row,
    ),
    isPending: false,
    isError: false,
  });
  api.myGroups.mockReturnValue({
    data: LED_BY_BC,
    isPending: false,
    isError: false,
  });
  show('/administrare/grupuri?vedere=conduse');
  const led = screen
    .getByRole('link', { name: 'Logistică, subgrup al Educațional' })
    .closest('tr') as HTMLElement;
  expect(within(led).getByText('Coordonator')).toBeVisible();
  expect(within(led).queryByText('Responsabil')).toBeNull();
});

it('names "Funcția ta" by the viewer’s own title when the position is theirs (#962)', () => {
  api.groups.mockReturnValue({
    data: tree.map((row) =>
      row.id === 2 ? { ...row, responsible_title: 'Coordonator' } : row,
    ),
    isPending: false,
    isError: false,
  });
  api.myGroups.mockReturnValue({
    data: LED_BY_BC,
    isPending: false,
    isError: false,
  });
  api.rosterRows.mockReturnValue({
    membershipRows: [
      {
        group_id: 2,
        group_role: 'responsible',
        position_title: 'Responsabil IT',
      },
    ],
    isPending: false,
    isError: false,
  });
  show('/administrare/grupuri?vedere=conduse');
  const led = screen
    .getByRole('link', { name: 'Logistică, subgrup al Educațional' })
    .closest('tr') as HTMLElement;
  expect(within(led).getByText('Responsabil IT')).toBeVisible();
  expect(within(led).queryByText('Coordonator')).toBeNull();
});

it.each([
  ['Vicepreședinte Logistică', 'Vicepreședinte Logistică'],
  [null, 'Vicepreședinte'],
])(
  'names "Funcția ta" as a Coordonator by their own title (%s), else the Group\'s (#967)',
  (own, shown) => {
    api.groups.mockReturnValue({
      data: tree.map((row) =>
        row.id === 2
          ? {
              ...row,
              manager_title: 'Vicepreședinte',
              responsible_title: 'Coordonator',
            }
          : row,
      ),
      isPending: false,
      isError: false,
    });
    api.myGroups.mockReturnValue({
      data: [myGroup(2, 'Logistică', 'manager', { path: [1, 2] })],
      isPending: false,
      isError: false,
    });
    api.rosterRows.mockReturnValue({
      membershipRows: [
        { group_id: 2, group_role: 'manager', position_title: own },
      ],
      isPending: false,
      isError: false,
    });
    show('/administrare/grupuri?vedere=conduse');
    const led = screen
      .getByRole('link', { name: 'Logistică, subgrup al Educațional' })
      .closest('tr') as HTMLElement;
    expect(within(led).getByText(shown)).toBeVisible();
    expect(within(led).queryByText('Coordonator')).toBeNull();
  },
);

it('offers BC who leads no Group Toate | Arhivate only, and ignores the led key (#921, R65)', () => {
  api.myGroups.mockReturnValue({
    data: [myGroup(9, 'OSUBB', 'member', { automatic: true })],
    isPending: false,
    isError: false,
  });
  show('/administrare/grupuri?vedere=conduse');
  const toggle = screen.getByRole('group', { name: 'Grupuri afișate' });
  expect(
    within(toggle)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Toate', 'Arhivate']);
  expect(within(toggle).getByRole('button', { name: 'Toate' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    screen.getByRole('region', { name: 'Structura grupurilor' }),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Balul Bobocilor' })).toBeVisible();
});

it('opens a Manager on their led Groups, with Arhivate beside them and no Toate (#921, R65)', () => {
  capabilities({ createTopLevelGroups: false });
  api.myGroups.mockReturnValue({
    data: LED_BY_BC,
    isPending: false,
    isError: false,
  });
  show();
  const toggle = screen.getByRole('group', { name: 'Grupuri afișate' });
  expect(
    within(toggle)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Conduse de mine', 'Arhivate']);
  expect(
    within(toggle).getByRole('button', { name: 'Conduse de mine' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('region', { name: 'Grupurile mele' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Balul Bobocilor' })).toBeNull();
});

/* #1017: a Group deleted for good on its page lands here with a receipt,
   read once: the history entry loses it, so a reload does not repeat it. */
it('says a Group was deleted for good when its page sends the member back', async () => {
  show({
    pathname: '/administrare/grupuri',
    state: { receipt: 'Grupul Logistică a fost șters definitiv.' },
  });
  const receipt = await screen.findByText(
    'Grupul Logistică a fost șters definitiv.',
  );
  expect(receipt).toHaveAttribute('role', 'status');
  expect(receipt).toHaveFocus();
});

it('drops Departament from the categories once a parent Group is chosen (Alex, 2026-10-11)', async () => {
  const user = userEvent.setup();
  capabilities({ createTopLevelGroups: true });
  show();
  await user.click(screen.getByRole('button', { name: 'Creează Grup' }));
  const dialog = await screen.findByRole('dialog', { name: 'Grup nou' });
  const category = within(dialog).getByRole('radiogroup', {
    name: 'Categorie',
  });
  expect(
    within(category).getByRole('radio', { name: 'Departament' }),
  ).toBeChecked();
  await user.click(
    within(dialog).getByRole('combobox', { name: 'Grup părinte (opțional)' }),
  );
  const parents = (await screen.findAllByRole('option')).filter(
    (option) => !option.textContent?.startsWith('Fără'),
  );
  await user.click(parents[0] as HTMLElement);
  // A Subgrup is an Echipă or a Proiect; the choice moves off Departament.
  expect(
    within(category)
      .getAllByRole('radio')
      .map((radio) => radio.textContent),
  ).toEqual(['Echipă', 'Proiect']);
  expect(within(category).getByRole('radio', { name: 'Echipă' })).toBeChecked();
});

/* #1110 (ruling R65): Arhivate, the third view, and Dezarhivează. */
const WITH_ARCHIVED = [
  group(1, 'Educațional', [1], null),
  group(2, 'Logistică', [1, 2], 1, { status: 'archived' }),
  group(4, 'Transport', [1, 2, 4], 2, { status: 'archived' }),
  group(3, 'Balul Bobocilor', [3], null, { category: 'project' }),
];

function withArchived() {
  api.groups.mockReturnValue({
    data: WITH_ARCHIVED,
    isPending: false,
    isError: false,
  });
}

it('keeps archived Groups out of Toate and lists them in Arhivate, by URL (R65)', async () => {
  const user = userEvent.setup();
  withArchived();
  show();
  expect(screen.getByRole('status')).toHaveTextContent('2 grupuri');
  // Its only subgroups are archived, so Educațional has nothing to unfold.
  expect(
    screen.queryByRole('button', { name: 'Extinde subgrupurile Educațional' }),
  ).toBeNull();
  expect(screen.queryByRole('link', { name: /Logistică/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /Transport/ })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Arhivate' }));
  expect(screen.getByTestId('location')).toHaveTextContent('?vedere=arhivate');
  const list = screen.getByRole('region', { name: 'Grupuri arhivate' });
  expect(within(list).getByRole('status')).toHaveTextContent('2 grupuri');
  // The archived Groups as a tree, the active parent kept as greyed context.
  expect(
    within(list).getByRole('link', {
      name: 'Logistică, subgrup al Educațional',
    }),
  ).toBeVisible();
  expect(
    within(list).getByRole('link', { name: 'Transport, subgrup al Logistică' }),
  ).toBeVisible();
  expect(within(list).queryByRole('link', { name: 'Educațional' })).toBeNull();
  const context = within(list).getByText('Educațional').closest('tr');
  expect(context).toHaveClass('text-muted-foreground');
  expect(
    within(list).queryByRole('link', { name: 'Balul Bobocilor' }),
  ).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Toate' }));
  expect(screen.getByTestId('location')).toBeEmptyDOMElement();
});

it('says so when nothing is archived', () => {
  show('/administrare/grupuri?vedere=arhivate');
  expect(screen.getByRole('button', { name: 'Arhivate' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByText('Niciun grup arhivat.')).toBeVisible();
});

it('confirms Dezarhivează with the subgroups that return, then says it is done', async () => {
  const user = userEvent.setup();
  withArchived();
  show('/administrare/grupuri?vedere=arhivate');
  // A Child Group under an archived parent waits for it, and says why.
  const child = screen.getByRole('button', { name: 'Dezarhivează Transport' });
  expect(child).toBeDisabled();
  expect(child).toHaveAccessibleDescription(
    'Grupul părinte este arhivat; dezarhivează-l întâi pe el.',
  );

  await user.click(
    screen.getByRole('button', { name: 'Dezarhivează Logistică' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Dezarhivează Logistică',
  });
  expect(
    within(within(dialog).getByRole('list', { name: 'Subgrupuri care revin' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['Transport']);
  expect(
    within(dialog).getByText(
      'Evenimentele anulate la arhivare rămân anulate, iar cererile de înscriere respinse rămân respinse.',
    ),
  ).toBeVisible();
  expect(api.mutate).not.toHaveBeenCalled();

  // A refusal stays in the dialog, in Romanian.
  api.mutate.mockRejectedValueOnce(
    new CommandError(
      { code: 'PT409', message: 'group_parent_archived' },
      'fallback',
    ),
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Dezarhivează' }),
  );
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Grupul părinte este arhivat. Dezarhivează-l întâi pe el.',
  );

  await user.click(
    within(dialog).getByRole('button', { name: 'Dezarhivează' }),
  );
  expect(api.mutate).toHaveBeenLastCalledWith({
    kind: 'unarchive',
    groupId: 2,
  });
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(screen.getByText('Grupul a fost dezarhivat.')).toHaveAttribute(
    'role',
    'status',
  );
  // The confirmation never opened the Group: the row's link was not followed.
  expect(screen.queryByRole('heading', { name: /Grupul 2/ })).toBeNull();
});

it('offers Dezarhivează only to whoever may archive the Group (R65)', () => {
  capabilities({ createTopLevelGroups: false });
  withArchived();
  // A Responsible of Logistică leads it, so sees it in Arhivate, but may
  // not archive it, so has nothing to press.
  api.myGroups.mockReturnValue({
    data: [
      myGroup(2, 'Logistică', 'responsible', {
        path: [1, 2],
        status: 'archived',
      }),
      myGroup(4, 'Transport', 'responsible', {
        path: [1, 2, 4],
        status: 'archived',
        explicit: false,
      }),
    ],
    isPending: false,
    isError: false,
  });
  const responsible = show('/administrare/grupuri?vedere=arhivate');
  expect(
    screen.getByRole('link', { name: 'Logistică, subgrup al Educațional' }),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: /Dezarhivează/ })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Acțiuni' })).toBeNull();
  responsible.unmount();

  // Its Manager may.
  api.myGroups.mockReturnValue({
    data: [
      myGroup(2, 'Logistică', 'manager', { path: [1, 2], status: 'archived' }),
      myGroup(4, 'Transport', 'manager', {
        path: [1, 2, 4],
        status: 'archived',
        explicit: false,
      }),
    ],
    isPending: false,
    isError: false,
  });
  show('/administrare/grupuri?vedere=arhivate');
  expect(
    screen.getByRole('button', { name: 'Dezarhivează Logistică' }),
  ).toBeEnabled();
});

it('keeps archived Groups out of Conduse de mine (R65)', () => {
  capabilities({ createTopLevelGroups: false });
  withArchived();
  api.myGroups.mockReturnValue({
    data: [
      myGroup(1, 'Educațional', 'manager', { path: [1] }),
      myGroup(2, 'Logistică', 'manager', {
        path: [1, 2],
        status: 'archived',
        explicit: false,
      }),
    ],
    isPending: false,
    isError: false,
  });
  show();
  expect(screen.getByRole('link', { name: 'Educațional' })).toBeVisible();
  expect(screen.queryByRole('link', { name: /Logistică/ })).toBeNull();
});
