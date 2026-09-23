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
vi.mock('../../queries/groups-admin', async () => ({
  ...(await vi.importActual('../../queries/groups-admin')),
  useAdminGroups: state.groups,
  useMyGroupRoles: state.mine,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/reference', () => ({
  useRoles: () => ({ data: new Map([['voluntar', { name: 'Voluntar' }]]) }),
}));
vi.mock('./RolePanel', () => ({
  RolePanel: ({ selectedMemberId }: { selectedMemberId: string }) => (
    <p>Editor rol {selectedMemberId}</p>
  ),
}));
import MemberScreen from './MemberScreen';
const memberships = [
  {
    group_id: 1,
    name: 'Comunicare',
    group_role: 'manager',
    position_title: null,
  },
  {
    group_id: 2,
    name: 'Evenimente',
    group_role: 'responsible',
    position_title: 'Responsabil logistică',
  },
];
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
beforeEach(() => {
  state.member.mockReturnValue({
    data: {
      card: {
        member_id: 'target',
        nickname: 'Nana',
        full_name: 'Ana Pop',
        role: 'voluntar',
        joined_at: '2025-01-01',
      },
      memberships,
      status: 'activ',
      contact: null,
      points: [],
    },
  });
  state.capabilities.mockReturnValue({ data: { manageRoles: true } });
  state.groups.mockReturnValue({
    data: [
      {
        id: 1,
        name: 'Comunicare',
        parent_id: null,
        path: [1],
        manager_title: 'Director comunicare',
      },
      {
        id: 2,
        name: 'Evenimente',
        parent_id: 1,
        path: [1, 2],
        manager_title: null,
      },
    ],
  });
  state.mine.mockReturnValue({ data: [] });
  state.mutate.mockResolvedValue(undefined);
});
it('BC sees nickname, full name, every Group role and identity/role editors', async () => {
  const { container } = show();
  expect(screen.getByRole('heading', { name: 'Nana' })).toBeVisible();
  expect(screen.getByText('Ana Pop')).toBeVisible();
  expect(screen.getByText('Rol în grup: Director comunicare')).toBeVisible();
  expect(screen.getByText('Rol în grup: Responsabil logistică')).toBeVisible();
  expect(screen.getByText('Editor rol target')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Salvează numele' })).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
it.each(['manager', 'responsible'])(
  'a Group %s sees their subtree but no identity or Role editor',
  (group_role) => {
    state.capabilities.mockReturnValue({ data: { manageRoles: false } });
    state.mine.mockReturnValue({ data: [{ id: 1, group_role }] });
    show();
    expect(screen.getByRole('link', { name: 'Comunicare' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Evenimente' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Salvează numele' }),
    ).toBeNull();
    expect(screen.queryByText('Editor rol target')).toBeNull();
    expect(
      screen.getByText('Nu există înregistrări pe care le poți vedea.'),
    ).toBeVisible();
  },
);
it('an ordinary Member gets no editors or fabricated points', () => {
  state.capabilities.mockReturnValue({ data: { manageRoles: false } });
  show();
  expect(screen.queryByLabelText('Nickname')).toBeNull();
  expect(screen.queryByText('Editor rol target')).toBeNull();
  expect(
    screen.getByText('Nu există înregistrări pe care le poți vedea.'),
  ).toBeVisible();
});
it('sends identity changes and translates nickname conflicts', async () => {
  const user = userEvent.setup();
  state.mutate.mockRejectedValueOnce({ message: 'nickname_taken' });
  show();
  await user.clear(screen.getByLabelText('Nickname'));
  await user.type(screen.getByLabelText('Nickname'), 'Anuța');
  await user.click(screen.getByRole('button', { name: 'Salvează numele' }));
  expect(state.mutate).toHaveBeenCalledWith({
    memberId: 'target',
    nickname: 'Anuța',
    fullName: 'Ana Pop',
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Acest nickname este deja folosit.',
  );
  await user.click(screen.getByRole('button', { name: 'Salvează numele' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Numele a fost actualizat.',
  );
});
it('renders only the returned ledger rows without deriving an unrestricted total', () => {
  const value = state.member();
  value.data.points = [
    { id: 1, delta: 5, created_at: '2026-09-20T10:00:00Z', task_id: 30 },
  ];
  show();
  expect(screen.getByText('+5 puncte')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Task #30' })).toHaveAttribute(
    'href',
    '/taskuri/30',
  );
});
