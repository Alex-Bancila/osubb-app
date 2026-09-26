import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
const state = vi.hoisted(() => ({
  member: vi.fn(),
  capabilities: vi.fn(),
  groups: vi.fn(),
  mine: vi.fn(),
  mutate: vi.fn(),
  privacy: vi.fn(),
}));
vi.mock('../../queries/admin-member', () => ({
  useAdminMember: state.member,
  useUpdateMemberIdentity: () => ({
    mutateAsync: state.mutate,
    isPending: false,
  }),
}));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: state.capabilities,
}));
vi.mock('../../queries/groups-admin', () => ({
  useAdminGroups: state.groups,
  useMyGroupRoles: state.mine,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/privacy', async (original) => ({
  ...(await original<object>()),
  useMemberAcknowledgement: state.privacy,
}));
vi.mock('./RolePanel', () => ({
  RolePanel: ({ selectedMemberId }: { selectedMemberId: string }) => (
    <p>Editor rol {selectedMemberId}</p>
  ),
}));
vi.mock('./ReinvitePanel', () => ({
  ReinvitePanel: ({ memberId }: { memberId: string }) => (
    <p>Retrimitere {memberId}</p>
  ),
}));
import MemberScreen from './MemberScreen';

const ready = { isPending: false, isError: false };

function show() {
  return render(
    <MemoryRouter initialEntries={['/administrare/membri/target']}>
      <Routes>
        <Route
          path="/administrare/membri/:memberId"
          element={<MemberScreen />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function member(patch: object = {}) {
  return {
    memberId: 'target',
    nickname: 'Nana',
    fullName: 'Ana Pop',
    roleLabel: 'Voluntar',
    joinedAt: '2025-01-01',
    avatarColor: null,
    primaryGroup: null,
    otherMemberships: 0,
    // As toMemberCardData labels them: Group Role display names resolved.
    groups: [
      {
        id: 1,
        name: 'Comunicare',
        label: 'Comunicare',
        color: null,
        roleLabel: 'Director comunicare',
        isPrivate: false,
      },
      {
        id: 2,
        name: 'Evenimente',
        label: 'Evenimente · Comunicare',
        color: null,
        roleLabel: 'Responsabil logistică',
        isPrivate: false,
      },
      {
        id: 3,
        name: 'Proiecte',
        label: 'Proiecte',
        color: null,
        roleLabel: 'Membru',
        isPrivate: false,
      },
    ],
    contact: null,
    status: 'activ',
    points: [],
    ...patch,
  };
}

beforeEach(() => {
  state.member.mockReturnValue({ ...ready, data: member() });
  state.capabilities.mockReturnValue({ ...ready, data: { manageRoles: true } });
  state.groups.mockReturnValue({
    ...ready,
    data: [
      { id: 1, parent_id: null, path: [1] },
      { id: 2, parent_id: 1, path: [1, 2] },
      { id: 3, parent_id: null, path: [3] },
    ],
  });
  state.mine.mockReturnValue({ ...ready, data: [] });
  state.privacy.mockReturnValue({ ...ready, data: null });
  state.mutate.mockReset().mockResolvedValue(undefined);
});

it('BC sees the Nickname over the full name, every Group Role and both editors', async () => {
  const { container } = show();
  expect(screen.getByRole('heading', { name: 'Nana' })).toBeVisible();
  expect(screen.getByText('Ana Pop')).toBeVisible();
  expect(screen.getByText('Rol în grup: Director comunicare')).toBeVisible();
  expect(screen.getByText('Rol în grup: Responsabil logistică')).toBeVisible();
  expect(screen.getByText('Rol în grup: Membru')).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Evenimente · Comunicare' }),
  ).toHaveAttribute('href', '/administrare/grupuri/2');
  expect(screen.getByText('Editor rol target')).toBeVisible();
  expect(screen.getByText('Retrimitere target')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Salvează numele' })).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('BC sees whether the Member acknowledged the Privacy Notice, and which version', () => {
  const view = show();
  expect(state.privacy).toHaveBeenLastCalledWith('target', true);
  expect(
    screen.getByText('Politica de confidențialitate').nextElementSibling,
  ).toHaveTextContent('neconfirmată');
  view.unmount();

  state.privacy.mockReturnValue({
    ...ready,
    data: {
      memberId: 'target',
      noticeVersion: '1.0',
      acknowledgedAt: '2026-09-26T08:30:00Z',
    },
  });
  show();
  expect(
    screen.getByText('Politica de confidențialitate').nextElementSibling,
  ).toHaveTextContent('v1.0 · 26 septembrie 2026');
});

it.each(['manager', 'responsible'])(
  'a Group %s sees only their subtree and no name or Role editor',
  (group_role) => {
    state.capabilities.mockReturnValue({
      ...ready,
      data: { manageRoles: false },
    });
    state.mine.mockReturnValue({ ...ready, data: [{ id: 1, group_role }] });
    show();
    expect(screen.getByRole('link', { name: 'Comunicare' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Evenimente · Comunicare' }),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Proiecte' })).toBeNull();
    expect(screen.queryByLabelText('Pseudonim')).toBeNull();
    expect(screen.queryByText('Editor rol target')).toBeNull();
    expect(screen.queryByText('Retrimitere target')).toBeNull();
    expect(screen.queryByText('Politica de confidențialitate')).toBeNull();
    expect(state.privacy).toHaveBeenLastCalledWith('target', false);
  },
);

it('an ordinary Member of a Group gets no subtree, no editors and no invented points', () => {
  state.capabilities.mockReturnValue({
    ...ready,
    data: { manageRoles: false },
  });
  state.mine.mockReturnValue({
    ...ready,
    data: [{ id: 1, group_role: 'member' }],
  });
  show();
  expect(
    screen.getByText('Nu există grupuri în aria ta de administrare.'),
  ).toBeVisible();
  expect(screen.queryByLabelText('Pseudonim')).toBeNull();
  expect(screen.queryByText('Editor rol target')).toBeNull();
  expect(
    screen.getByText('Nu există înregistrări pe care le poți vedea.'),
  ).toBeVisible();
});

it('sends the trimmed names and puts a Nickname refusal under its field', async () => {
  const user = userEvent.setup();
  state.mutate.mockRejectedValueOnce({
    code: '23514',
    message: 'nickname_taken',
  });
  show();
  const nickname = screen.getByLabelText('Pseudonim');
  await user.clear(nickname);
  await user.type(nickname, '  Anuța ');
  await user.click(screen.getByRole('button', { name: 'Salvează numele' }));
  expect(state.mutate).toHaveBeenCalledWith({
    memberId: 'target',
    nickname: 'Anuța',
    fullName: 'Ana Pop',
  });
  expect(
    await screen.findByText(
      'Pseudonimul este deja folosit de alt membru. Alege altul.',
    ),
  ).toBeVisible();
  expect(nickname).toHaveAttribute('aria-invalid', 'true');

  await user.click(screen.getByRole('button', { name: 'Salvează numele' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Numele a fost actualizat.',
  );
});

it('clears the Nickname to none and refuses a blank full name before sending', async () => {
  const user = userEvent.setup();
  show();
  await user.clear(screen.getByLabelText('Pseudonim'));
  await user.clear(screen.getByLabelText('Nume complet'));
  await user.click(screen.getByRole('button', { name: 'Salvează numele' }));
  expect(screen.getByText('Scrie numele complet.')).toBeVisible();
  expect(state.mutate).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText('Nume complet'), 'Ana Maria Pop');
  await user.click(screen.getByRole('button', { name: 'Salvează numele' }));
  expect(state.mutate).toHaveBeenCalledWith({
    memberId: 'target',
    nickname: null,
    fullName: 'Ana Maria Pop',
  });
});

it('lists only the returned ledger rows and links a Task through the Tracker', () => {
  state.member.mockReturnValue({
    ...ready,
    data: member({
      points: [
        {
          id: 2,
          delta: -3,
          reason: 'sanction',
          created_at: '2026-09-21T10:00:00Z',
          task_id: null,
        },
        {
          id: 1,
          delta: 5,
          reason: 'task',
          created_at: '2026-09-20T10:00:00Z',
          task_id: 30,
        },
      ],
    }),
  });
  show();
  expect(screen.getByText('+5 puncte')).toBeVisible();
  expect(screen.getByText('−3 puncte')).toBeVisible();
  expect(screen.getByText(/Sancțiune/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Task #30' })).toHaveAttribute(
    'href',
    '/tracker?task=30',
  );
});

it('says the Member is unavailable when the server returns no card', () => {
  state.member.mockReturnValue({ ...ready, data: null });
  show();
  expect(
    screen.getByRole('heading', { name: 'Membru indisponibil' }),
  ).toBeVisible();
});

it('keeps the confirmation and the stored names when the page refetches', async () => {
  const user = userEvent.setup();
  const view = show();
  const nickname = screen.getByLabelText('Pseudonim');
  await user.clear(nickname);
  await user.type(nickname, '  Anuța ');
  await user.click(screen.getByRole('button', { name: 'Salvează numele' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Numele a fost actualizat.',
  );
  // The invalidated query answers with the new Nickname.
  state.member.mockReturnValue({
    ...ready,
    data: member({ nickname: 'Anuța' }),
  });
  view.rerender(
    <MemoryRouter initialEntries={['/administrare/membri/target']}>
      <Routes>
        <Route
          path="/administrare/membri/:memberId"
          element={<MemberScreen />}
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Numele a fost actualizat.',
  );
  expect(screen.getByLabelText('Pseudonim')).toHaveValue('Anuța');
});
