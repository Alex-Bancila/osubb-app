import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as axe from 'axe-core';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminGroup } from '../../queries/groups-admin';
import type { MyGroup } from '../../queries/my-groups';

const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  groups: vi.fn(),
  myGroups: vi.fn(),
  members: vi.fn(),
  mutate: vi.fn(),
  roles: vi.fn(),
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
vi.mock('../../queries/reference', () => ({ useRoles: api.roles }));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useAdminGroups: api.groups,
  useMyGroupRoles: api.myGroups,
  useAppointableMembers: api.members,
  useGroupCommand: () => ({ mutateAsync: api.mutate, isPending: false }),
}));
// The Cereri de aderare tab's rule has its own suite (applications-tab).
vi.mock('./applications-tab', () => ({ useApplicationsTabShown: () => true }));
import AdminGroupsTab from './AdminGroupsTab';
import AdministrareLayout from './AdministrareLayout';

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

/** The tab inside the Administrare layout, whose header carries its action. */
function show() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/administrare/grupuri']}>
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
});

it('shows BC the whole tree, collapsed, and expands one Group at a time', async () => {
  const user = userEvent.setup();
  const { container } = show();
  expect(screen.getByRole('link', { name: 'Educațional' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Balul Bobocilor' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Logistică' })).toBeNull();

  await user.click(
    screen.getByRole('button', { name: 'Extinde subgrupurile Educațional' }),
  );
  expect(screen.getByRole('link', { name: 'Logistică' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/2',
  );
  // Category, Minimum Level and member count ride along with each row.
  expect(screen.getAllByText('Departament').length).toBeGreaterThan(0);
  expect(screen.getByText('Proiect')).toBeVisible();

  await user.click(
    screen.getByRole('button', { name: 'Restrânge subgrupurile Educațional' }),
  );
  expect(screen.queryByRole('link', { name: 'Logistică' })).toBeNull();

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
  show();

  expect(screen.getByRole('region', { name: 'Grupurile mele' })).toBeVisible();
  expect(screen.getByText('Grupurile în care ai o funcție.')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'OSUBB' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Logistică' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/2',
  );
  expect(screen.getByRole('link', { name: 'Foto' })).toBeVisible();
  // The Child Group reached only through an ancestor says so (ruling R14).
  expect(screen.getByText('din grupul de deasupra')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Creează Grup' })).toBeNull();
});

it('offers "Creează Grup" only with the capability, and creates through the command', async () => {
  capabilities({ createTopLevelGroups: false });
  const denied = show();
  expect(screen.queryByRole('button', { name: 'Creează Grup' })).toBeNull();
  denied.unmount();

  const user = userEvent.setup();
  capabilities({ createTopLevelGroups: true });
  show();
  // The action sits in the page header, beside the title.
  const header = screen
    .getByRole('heading', { level: 1, name: 'Administrare' })
    .closest('header') as HTMLElement;
  await user.click(
    within(header).getByRole('button', { name: 'Creează Grup' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Grup nou' });
  await user.type(within(dialog).getByLabelText('Numele grupului'), 'Interne');
  await user.selectOptions(
    within(dialog).getByLabelText('Categorie'),
    'department',
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
    .getByRole('link', { name: 'Logistică' })
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
    .closest('tr');
  expect(within(project as HTMLElement).getByText('BC')).toBeVisible();
  expect(within(project as HTMLElement).queryByText('6')).toBeNull();
});

it("shows a Manager's own Groups' Minimum Level by Role name (R29b)", () => {
  capabilities({ createTopLevelGroups: false });
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

it('shows only the columns whose values differ, and an archived Group by a badge (B48)', () => {
  api.groups.mockReturnValue({
    data: [
      group(1, 'Educațional', [1], null),
      group(3, 'Balul Bobocilor', [3], null, {
        category: 'department',
        status: 'archived',
      }),
    ],
    isPending: false,
    isError: false,
  });
  show();
  const headers = screen
    .getAllByRole('columnheader')
    .map((header) => header.textContent);
  // One category, one Minimum Level, one size: none is a column. No Stare.
  expect(headers).toEqual(['Grup']);
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
