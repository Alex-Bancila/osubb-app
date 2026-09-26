import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as axe from 'axe-core';
import { MemoryRouter } from 'react-router';
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
vi.mock('./RolePanel', () => ({
  RolePanel: () => <section aria-label="Role panel" />,
}));
vi.mock('./PrivacyPanel', () => ({
  PrivacyPanel: () => <section aria-label="Privacy panel" />,
}));
import AdministrareScreen from './AdministrareScreen';

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

it('mounts the Role and Confidențialitate panels only from the live server capability', () => {
  capabilities({ manageRoles: false });
  const view = show();
  expect(screen.queryByRole('region', { name: 'Role panel' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Privacy panel' })).toBeNull();
  capabilities({ manageRoles: true });
  view.rerender(
    <MemoryRouter>
      <AdministrareScreen />
    </MemoryRouter>,
  );
  expect(screen.getByRole('region', { name: 'Role panel' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Privacy panel' })).toBeVisible();
});

function show() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdministrareScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('shows CSV provisioning only when the server capability allows it', () => {
  show();
  expect(screen.queryByRole('heading', { name: 'Import CSV' })).toBeNull();
  capabilities({ provisionMembers: true });
  show();
  expect(screen.getByRole('heading', { name: 'Import CSV' })).toBeVisible();
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
  show();

  expect(screen.getByRole('heading', { name: 'Grupurile mele' })).toBeVisible();
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
  await user.click(screen.getByRole('button', { name: 'Creează Grup' }));
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
