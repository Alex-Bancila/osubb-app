import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
import { MemoryRouter, Route, Routes } from 'react-router';
import { BackLink } from '../../components/layout';
import { RolePanel } from './RolePanel';

function renderPanel(url = '/administrare/roluri') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <RolePanel />
    </MemoryRouter>,
  );
}

/** Picks a Member in the searchable picker (#842: members are a Combobox). */
async function pick(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'Membru' }));
  await user.click(
    await screen.findByRole('option', { name: new RegExp(name) }),
  );
}

/** The Member the picker shows as chosen. */
function picked() {
  return screen.getByRole('combobox', { name: 'Membru' });
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
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
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
  state.mutate
    .mockReset()
    .mockResolvedValue({ id: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d' });
});

it('offers a BC only what it can save: no BC or Moderator holders, ranks up to BCE (B57)', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByRole('combobox', { name: 'Membru' }));
  const options = await screen.findAllByRole('option');
  // Herself (BC) and the other BC holder are not offered.
  expect(options.map((option) => option.textContent)).toEqual([
    expect.stringContaining('Ana Pop'),
  ]);
  await user.click(options[0] as HTMLElement);
  const select = screen.getByLabelText('Rol organizațional');
  expect(
    within(select)
      .getAllByRole('option')
      .map((option) => option.getAttribute('value')),
  ).toEqual(['recrut', 'voluntar', 'activ', 'vot', 'bce']);
  expect(
    within(select).queryByRole('option', { name: 'Responsabil' }),
  ).toBeNull();
  // Current values live in the page header, not in the panel (B60).
  expect(screen.queryByText(/Rol actual|Status actual/)).toBeNull();
});

it('shows a BC no fields for a BC or Moderator target it cannot change', () => {
  render(
    <MemoryRouter>
      <RolePanel selectedMemberId="protected" />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Numai un Moderator/)).toBeVisible();
  expect(screen.queryByLabelText('Rol organizațional')).toBeNull();
  expect(screen.queryByLabelText('Status')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

it("shows no fields on the viewer's own page", () => {
  render(
    <MemoryRouter>
      <RolePanel selectedMemberId="bc" />
    </MemoryRouter>,
  );
  expect(
    screen.getByText('Nu îți poți schimba propriul rol sau status.'),
  ).toBeVisible();
  expect(screen.queryByLabelText('Rol organizațional')).toBeNull();
});

it('puts the two field groups, the reason and the two save buttons in one style (AD2)', async () => {
  const user = userEvent.setup();
  renderPanel();
  await pick(user, 'Ana Pop');
  // Sub-heads on the kit, never a 22 px h3 inside a 19 px section (X10).
  for (const name of ['Rol organizațional', 'Status'])
    expect(screen.getByRole('heading', { level: 3, name })).toHaveAttribute(
      'data-slot',
      'sub-heading',
    );
  // The shared select (#842), no bordered sub-boxes.
  expect(screen.getByLabelText('Rol organizațional')).toHaveAttribute(
    'data-slot',
    'native-select',
  );
  expect(document.querySelector('.rounded-lg.border.p-4')).toBeNull();
  const role = screen.getByRole('button', { name: 'Salvează rolul' });
  const status = screen.getByRole('button', { name: 'Salvează statusul' });
  expect(role.className).toBe(status.className);
  expect(role).toHaveClass('sm:w-auto');
  expect(screen.getByLabelText('Motiv (opțional)').parentElement).toHaveClass(
    'sm:col-span-2',
  );
});

it('shows explicit archived and automatic Groups before a demotion and sends the audited Role command', async () => {
  const user = userEvent.setup();
  const { container } = renderPanel();
  await pick(user, 'Ana Pop');
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
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    role: 'vot',
    reason: 'Confirmat la vot',
  });
});

it('names a Drept de Vot withdrawal only when the new reference rank is lower', async () => {
  state.members.mockReturnValue({
    data: people.map((person) =>
      person.memberId === '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'
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
  await pick(user, 'Ana Pop');
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
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    role: 'voluntar',
    reason: null,
  });
});

it('deactivates through the atomic Status command and explains the token window', async () => {
  const user = userEvent.setup();
  renderPanel();
  await pick(user, 'Ana Pop');
  await user.selectOptions(screen.getByLabelText('Status'), 'inactiv');
  expect(screen.getByText(/cel mult o oră/)).toBeVisible();
  // It asks first (F-11): the dialog repeats the warning, nothing is sent.
  await user.click(screen.getByRole('button', { name: 'Dezactivează' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/cel mult o oră/)).toBeVisible();
  expect(state.mutate).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Renunță' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(state.mutate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Dezactivează' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Dezactivează membrul',
    }),
  );
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'status',
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    status: 'inactiv',
    reason: null,
  });
});

it('offers all three reference statuses', async () => {
  const user = userEvent.setup();
  renderPanel();
  await pick(user, 'Ana Pop');
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
      person.memberId === '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'
        ? { ...person, status: 'alumni' }
        : person,
    ),
    isPending: false,
    isError: false,
  });
  const user = userEvent.setup();
  renderPanel();
  await pick(user, 'Ana Pop');
  expect(screen.getByLabelText('Status')).toHaveValue('alumni');
});

it('sends the atomic Status command with alumni and the reason', async () => {
  const user = userEvent.setup();
  renderPanel();
  await pick(user, 'Ana Pop');
  await user.selectOptions(screen.getByLabelText('Status'), 'alumni');
  await user.type(screen.getByLabelText('Motiv (opțional)'), 'Absolvent');
  await user.click(screen.getByRole('button', { name: 'Salvează statusul' }));
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'status',
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
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
  await pick(user, 'BC Țintă');
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
  // Without a live Moderator row the picker offers no BC target at all…
  await user.click(screen.getByRole('combobox', { name: 'Membru' }));
  expect(screen.queryByRole('option', { name: /BC Țintă/ })).toBeNull();
  cleanup();
  // …and a BC target named directly gets no fields.
  render(
    <MemoryRouter>
      <RolePanel selectedMemberId="protected" />
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText('Rol organizațional')).toBeNull();
  expect(screen.queryByLabelText('Status')).toBeNull();
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
  await pick(user, 'Ana Pop');
  expect(screen.queryByLabelText('Rol organizațional')).toBeNull();
  expect(screen.getByText('Nu poți modifica acest membru acum.')).toBeVisible();
});

it('keeps the target and reason on a refused command', async () => {
  state.mutate.mockRejectedValueOnce({ message: 'member_manage_forbidden' });
  const user = userEvent.setup();
  renderPanel();
  await pick(user, 'Ana Pop');
  await user.selectOptions(screen.getByLabelText('Status'), 'inactiv');
  await user.type(screen.getByLabelText('Motiv (opțional)'), 'Verificare');
  await user.click(screen.getByRole('button', { name: 'Dezactivează' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Dezactivează membrul',
    }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu mai ai permisiunea',
  );
  expect(picked()).toHaveTextContent('Ana Pop');
  expect(screen.getByLabelText('Motiv (opțional)')).toHaveValue('Verificare');
});

it('opens on the Member a Retention Signal links to (?membru=, #702)', () => {
  renderPanel(
    '/administrare/roluri?membru=7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
  );
  expect(picked()).toHaveTextContent('Ana Pop');
  expect(screen.getByLabelText('Rol organizațional')).toHaveValue('bce');
});

it('ignores a ?membru= that is not a Member id and queries nothing for it', () => {
  renderPanel('/administrare/roluri?membru=target%27%20or%201%3D1');
  expect(picked()).toHaveTextContent('Alege un membru');
  expect(state.groupIds).not.toHaveBeenCalledWith("target' or 1=1");
  expect(state.groupIds).toHaveBeenLastCalledWith(null);
});

it('preselects Voluntar Activ and the reason a Promotion Candidate arrives with (?rol=, ?motiv=, #827)', async () => {
  const candidate = '0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9';
  state.members.mockReturnValue({
    data: [
      ...people,
      {
        memberId: candidate,
        name: 'Vlad Candidat',
        roleId: 'voluntar',
        roleLabel: 'Voluntar',
        level: 1,
        status: 'activ',
        avatarColor: null,
      },
    ],
    isPending: false,
    isError: false,
  });
  const user = userEvent.setup();
  renderPanel(
    `/administrare/roluri?membru=${candidate}&rol=activ&motiv=${encodeURIComponent('Evaluarea de rol „Semestrul I”')}`,
  );
  expect(picked()).toHaveTextContent('Vlad Candidat');
  expect(screen.getByLabelText('Rol organizațional')).toHaveValue('activ');
  expect(screen.getByLabelText('Motiv (opțional)')).toHaveValue(
    'Evaluarea de rol „Semestrul I”',
  );
  // It only prefills: BC still saves.
  expect(state.mutate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Salvează rolul' }));
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'role',
    memberId: candidate,
    role: 'activ',
    reason: 'Evaluarea de rol „Semestrul I”',
  });
});

it('ignores ?rol= and ?motiv= without a Member, and a malformed Role', () => {
  renderPanel('/administrare/roluri?rol=activ&motiv=Ceva');
  expect(picked()).toHaveTextContent('Alege un membru');
  expect(screen.queryByLabelText('Motiv (opțional)')).toBeNull();
  cleanup();
  renderPanel(
    '/administrare/roluri?membru=7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d&rol=%3Cbc%3E',
  );
  expect(screen.getByLabelText('Rol organizațional')).toHaveValue('bce');
});

it('links the chosen Member to their Administrare page (#103)', async () => {
  const user = userEvent.setup();
  renderPanel();
  await pick(user, 'Ana Pop');
  expect(
    screen.getByRole('link', { name: 'Vezi detaliile membrului' }),
  ).toHaveAttribute(
    'href',
    '/administrare/membri/7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
  );
});

it('sends the member page back to Roluri, on the same Member (D4)', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/administrare/roluri']}>
      <Routes>
        <Route path="/administrare/roluri" element={<RolePanel />} />
        <Route
          path="/administrare/membri/:id"
          element={<BackLink to="/administrare/membri" label="Implicit" />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await pick(user, 'Ana Pop');
  await user.click(
    screen.getByRole('link', { name: 'Vezi detaliile membrului' }),
  );
  expect(
    screen.getByRole('link', { name: 'Înapoi la Roluri' }),
  ).toHaveAttribute(
    'href',
    '/administrare/roluri?membru=7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
  );
});

it('edits only the given Member on their own page, without the picker (#103)', () => {
  render(
    <MemoryRouter>
      <RolePanel selectedMemberId="7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d" />
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText('Membru')).toBeNull();
  expect(
    screen.queryByRole('link', { name: 'Vezi detaliile membrului' }),
  ).toBeNull();
  expect(screen.getByLabelText('Rol organizațional')).toHaveValue('bce');
});
