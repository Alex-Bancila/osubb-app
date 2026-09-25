import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  auth: vi.fn(),
  members: vi.fn(),
  roles: vi.fn(),
  groups: vi.fn(),
  groupIds: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: state.auth }));
vi.mock('../../queries/groups-admin', () => ({
  useAppointableMembers: state.members,
  useAdminGroups: state.groups,
}));
vi.mock('../../queries/reference', () => ({ useRoles: state.roles }));
vi.mock('../../queries/member-role-management', () => ({
  useMemberGroupIds: state.groupIds,
  useMemberChange: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
import { MemoryRouter } from 'react-router';
import { RolePanel } from './RolePanel';

function renderPanel(url = '/administrare') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <RolePanel />
    </MemoryRouter>,
  );
}

const roles = new Map([
  ['recrut', { name: 'Recrut', level: 0 }],
  ['voluntar', { name: 'Voluntar', level: 1 }],
  ['activ', { name: 'Voluntar Activ', level: 2 }],
  ['vot', { name: 'Voluntar cu Drept de Vot', level: 3 }],
  ['responsabil', { name: 'Responsabil', level: 4 }],
  ['bce', { name: 'BCE', level: 5 }],
  ['bc', { name: 'BC', level: 6 }],
  ['moderator', { name: 'Moderator', level: 9 }],
]);
const people = [
  {
    memberId: 'bc',
    name: 'BC Curent',
    roleId: 'bc',
    roleLabel: 'BC',
    level: 6,
    status: 'activ',
    avatarColor: null,
  },
  {
    memberId: 'target',
    name: 'Ana Pop',
    roleId: 'bce',
    roleLabel: 'BCE',
    level: 5,
    status: 'activ',
    avatarColor: null,
  },
  {
    memberId: 'protected',
    name: 'BC Țintă',
    roleId: 'bc',
    roleLabel: 'BC',
    level: 6,
    status: 'activ',
    avatarColor: null,
  },
];
const groups = [
  {
    id: 1,
    name: 'Explicit',
    status: 'active',
    min_level: 5,
    automatic_membership: false,
  },
  {
    id: 2,
    name: 'Arhivat explicit',
    status: 'archived',
    min_level: 5,
    automatic_membership: false,
  },
  {
    id: 3,
    name: 'Automat',
    status: 'active',
    min_level: 5,
    automatic_membership: true,
  },
];
beforeEach(() => {
  state.auth.mockReturnValue({ session: { user: { id: 'bc' } } });
  state.members.mockReturnValue({
    data: people,
    isPending: false,
    isError: false,
  });
  state.roles.mockReturnValue({
    data: roles,
    isPending: false,
    isError: false,
  });
  state.groups.mockReturnValue({
    data: groups,
    isPending: false,
    isError: false,
    isSuccess: true,
  });
  state.groupIds.mockReturnValue({
    data: new Set([1, 2]),
    isPending: false,
    isError: false,
    isSuccess: true,
  });
  state.mutate.mockReset().mockResolvedValue({ id: 'target' });
});

it('offers seven reference ranks, excludes responsabil, and blocks self and BC targets for a BC', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'target');
  const select = screen.getByLabelText('Rol organizațional');
  const options = within(select).getAllByRole('option');
  expect(options.map((option) => option.getAttribute('value'))).toEqual([
    'recrut',
    'voluntar',
    'activ',
    'vot',
    'bce',
    'bc',
    'moderator',
  ]);
  expect(
    within(select).queryByRole('option', { name: 'Responsabil' }),
  ).toBeNull();
  expect(within(select).getByRole('option', { name: 'BC' })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Membru'), 'bc');
  expect(screen.getByLabelText('Rol organizațional')).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Membru'), 'protected');
  expect(screen.getByLabelText('Status')).toBeDisabled();
  expect(screen.getByText(/Numai un Moderator/)).toBeVisible();
});

it('shows explicit archived and automatic Groups before a demotion and sends the audited Role command', async () => {
  const user = userEvent.setup();
  const { container } = renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'target');
  await user.selectOptions(screen.getByLabelText('Rol organizațional'), 'vot');
  expect(screen.getByText(/Confirmi Drept de Vot/)).toBeVisible();
  expect(screen.getByText('Explicit')).toBeVisible();
  expect(screen.getByText('Arhivat explicit')).toBeVisible();
  expect(screen.getByText('Automat')).toBeVisible();
  await user.type(
    screen.getByLabelText('Motiv (opțional)'),
    '  Confirmat la vot  ',
  );
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Salvează rolul' }));
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'role',
    memberId: 'target',
    role: 'vot',
    reason: 'Confirmat la vot',
  });
});

it('names a Drept de Vot withdrawal only when the new reference rank is lower', async () => {
  state.members.mockReturnValue({
    data: people.map((person) =>
      person.memberId === 'target'
        ? {
            ...person,
            roleId: 'vot',
            roleLabel: 'Voluntar cu Drept de Vot',
            level: 3,
          }
        : person,
    ),
    isPending: false,
    isError: false,
  });
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'target');
  await user.selectOptions(screen.getByLabelText('Rol organizațional'), 'bce');
  expect(screen.queryByText(/Retragi Drept de Vot/)).toBeNull();
  await user.selectOptions(
    screen.getByLabelText('Rol organizațional'),
    'voluntar',
  );
  expect(screen.getByText(/Retragi Drept de Vot/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Salvează rolul' }));
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'role',
    memberId: 'target',
    role: 'voluntar',
    reason: null,
  });
});

it('deactivates through the atomic Status command and explains the token window', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'target');
  await user.selectOptions(screen.getByLabelText('Status'), 'inactiv');
  expect(screen.getByText(/cel mult o oră/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Dezactivează' }));
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'status',
    memberId: 'target',
    status: 'inactiv',
    reason: null,
  });
});

it('offers all three reference statuses', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'target');
  const select = screen.getByLabelText('Status');
  const options = within(select).getAllByRole('option');
  expect(options.map((option) => option.getAttribute('value'))).toEqual([
    'activ',
    'inactiv',
    'alumni',
  ]);
  expect(options.map((option) => option.textContent)).toEqual([
    'Activ',
    'Inactiv',
    'Alumni',
  ]);
});

it('opens on the matching option for a Member already marked alumni', async () => {
  state.members.mockReturnValue({
    data: people.map((person) =>
      person.memberId === 'target' ? { ...person, status: 'alumni' } : person,
    ),
    isPending: false,
    isError: false,
  });
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'target');
  expect(screen.getByLabelText('Status')).toHaveValue('alumni');
  expect(screen.getByText('Status actual: Alumni')).toBeVisible();
});

it('sends the atomic Status command with alumni and the reason', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'target');
  await user.selectOptions(screen.getByLabelText('Status'), 'alumni');
  await user.type(screen.getByLabelText('Motiv (opțional)'), 'Absolvent');
  await user.click(screen.getByRole('button', { name: 'Salvează statusul' }));
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'status',
    memberId: 'target',
    status: 'alumni',
    reason: 'Absolvent',
  });
});

it('lets only the live Moderator edit a BC target', async () => {
  state.auth.mockReturnValue({ session: { user: { id: 'moderator' } } });
  state.members.mockReturnValue({
    data: [
      {
        memberId: 'moderator',
        name: 'Moderator',
        roleId: 'moderator',
        roleLabel: 'Moderator',
        level: 9,
        status: 'activ',
      },
      ...people,
    ],
    isPending: false,
    isError: false,
  });
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'protected');
  expect(screen.getByLabelText('Rol organizațional')).toBeEnabled();
  expect(
    within(screen.getByLabelText('Rol organizațional')).getByRole('option', {
      name: 'BC',
    }),
  ).toBeEnabled();
});

it('fails closed when live actor row is absent despite stale moderator claims', async () => {
  state.auth.mockReturnValue({
    session: { user: { id: 'missing' } },
    claims: { member_role: 'moderator' },
  });
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'protected');
  expect(screen.getByLabelText('Rol organizațional')).toBeDisabled();
  expect(screen.getByLabelText('Status')).toBeDisabled();
});

it('disables edits when the live actor is inactive', async () => {
  state.members.mockReturnValue({
    data: people.map((person) =>
      person.memberId === 'bc' ? { ...person, status: 'inactiv' } : person,
    ),
    isPending: false,
    isError: false,
  });
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'target');
  expect(screen.getByLabelText('Rol organizațional')).toBeDisabled();
});

it('keeps the target and reason on a refused command', async () => {
  state.mutate.mockRejectedValueOnce({ message: 'member_manage_forbidden' });
  const user = userEvent.setup();
  renderPanel();
  await user.selectOptions(screen.getByLabelText('Membru'), 'target');
  await user.selectOptions(screen.getByLabelText('Status'), 'inactiv');
  await user.type(screen.getByLabelText('Motiv (opțional)'), 'Verificare');
  await user.click(screen.getByRole('button', { name: 'Dezactivează' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu mai ai permisiunea',
  );
  expect(screen.getByLabelText('Membru')).toHaveValue('target');
  expect(screen.getByLabelText('Motiv (opțional)')).toHaveValue('Verificare');
});

it('opens on the Member a Retention Signal links to (?membru=, #702)', () => {
  renderPanel('/administrare?membru=target');
  expect(screen.getByLabelText('Membru')).toHaveValue('target');
  expect(screen.getByText('Rol actual: BCE')).toBeVisible();
});
