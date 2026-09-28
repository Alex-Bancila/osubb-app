import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { BackLink } from '../../components/layout';
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

function show(from?: unknown) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/administrare/membri/7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
          state: from,
        },
      ]}
    >
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
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
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
        groupRole: 'manager',
        isPrivate: false,
      },
      {
        id: 2,
        name: 'Evenimente',
        label: 'Evenimente · Comunicare',
        color: null,
        roleLabel: 'Responsabil logistică',
        groupRole: 'responsible',
        isPrivate: false,
      },
      {
        id: 3,
        name: 'Proiecte',
        label: 'Proiecte',
        color: null,
        roleLabel: 'Membru',
        groupRole: 'member',
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
  expect(screen.getByRole('heading', { level: 1, name: 'Nana' })).toBeVisible();
  expect(
    document.querySelector('[data-slot="page-eyebrow"]'),
  ).toHaveTextContent(/^Administrare$/);
  expect(
    screen.getByRole('link', { name: 'Înapoi la Administrare' }),
  ).toHaveAttribute('href', '/administrare/membri');
  expect(screen.getByText('Ana Pop')).toBeVisible();
  expect(screen.getByText('Rol în grup: Director comunicare')).toBeVisible();
  expect(screen.getByText('Rol în grup: Responsabil logistică')).toBeVisible();
  // A plain membership names no Group Role (B60).
  expect(screen.queryByText('Rol în grup: Membru')).toBeNull();
  expect(screen.getByRole('link', { name: 'Proiecte' })).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Evenimente · Comunicare' }),
  ).toHaveAttribute('href', '/administrare/grupuri/2');
  expect(
    screen.getByText('Editor rol 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
  ).toBeVisible();
  expect(
    screen.getByText('Retrimitere 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
  ).toBeVisible();
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
  expect(state.privacy).toHaveBeenLastCalledWith(
    '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    true,
  );
  expect(
    screen.getByText('Politica de confidențialitate').nextElementSibling,
  ).toHaveTextContent('neconfirmată');
  view.unmount();

  state.privacy.mockReturnValue({
    ...ready,
    data: {
      memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
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
    expect(
      screen.queryByText('Editor rol 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
    ).toBeNull();
    expect(
      screen.queryByText('Retrimitere 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
    ).toBeNull();
    expect(screen.queryByText('Politica de confidențialitate')).toBeNull();
    expect(state.privacy).toHaveBeenLastCalledWith(
      '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
      false,
    );
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
  expect(
    screen.queryByText('Editor rol 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
  ).toBeNull();
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
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
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
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
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
          task_title: 'Raport parteneriate',
        },
        {
          id: 0,
          delta: 2,
          reason: 'task',
          created_at: '2026-09-19T10:00:00Z',
          task_id: 31,
          // A Task the viewer cannot read: only its id stands in.
          task_title: null,
        },
      ],
    }),
  });
  show();
  expect(screen.getByText('+5 puncte')).toBeVisible();
  expect(screen.getByText('−3 puncte')).toBeVisible();
  expect(screen.getByText(/Sancțiune/)).toBeVisible();
  // The Task by its title (B61); the id only when it is unreadable.
  expect(
    screen.getByRole('link', { name: 'Raport parteneriate' }),
  ).toHaveAttribute('href', '/tracker?task=30');
  expect(screen.queryByRole('link', { name: 'Task #30' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Task #31' })).toHaveAttribute(
    'href',
    '/tracker?task=31',
  );
});

it('goes back where the member came from, then by capability (D4)', () => {
  // A Roster, Roluri or Confidențialitate link says where it was.
  const view = show({
    from: { to: '/administrare/grupuri/4?tab=roster', label: 'Înapoi la grup' },
  });
  expect(screen.getByRole('link', { name: 'Înapoi la grup' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/4?tab=roster',
  );
  view.unmount();

  // No origin: BC/Mod go to Membri…
  const bc = show();
  expect(
    screen.getByRole('link', { name: 'Înapoi la Administrare' }),
  ).toHaveAttribute('href', '/administrare/membri');
  bc.unmount();

  // …and a Group Manager, Responsible or BCE (administer only) to Grupuri,
  // never to a tab they cannot open.
  state.capabilities.mockReturnValue({
    ...ready,
    data: { manageRoles: false, provisionMembers: false, administer: true },
  });
  state.mine.mockReturnValue({
    ...ready,
    data: [{ id: 1, group_role: 'responsible' }],
  });
  show();
  expect(
    screen.getByRole('link', { name: 'Înapoi la Administrare' }),
  ).toHaveAttribute('href', '/administrare/grupuri');
});

it('sends a Group page opened from here back to this member (D4, A63)', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter
      initialEntries={[
        '/administrare/membri/7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
      ]}
    >
      <Routes>
        <Route
          path="/administrare/membri/:memberId"
          element={<MemberScreen />}
        />
        <Route
          path="/administrare/grupuri/:groupId"
          element={<BackLink to="/administrare/grupuri" label="Implicit" />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('link', { name: 'Comunicare' }));
  expect(screen.getByRole('link', { name: 'Înapoi la Nana' })).toHaveAttribute(
    'href',
    '/administrare/membri/7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
  );
});

it('sets the identity facts as a muted label over a larger value (AD2)', () => {
  show();
  const label = screen.getByText('Membru din');
  expect(label.tagName).toBe('DT');
  expect(label).toHaveClass('text-muted-foreground');
  expect(label.nextElementSibling).toHaveClass('text-[length:var(--fs-md)]');
  // No m-0 on the list: the page's flex gap spaces it (X2).
  expect(label.closest('dl')).not.toHaveClass('m-0');
  // "Salvează numele" is its own width from `sm` (X15).
  expect(screen.getByRole('button', { name: 'Salvează numele' })).toHaveClass(
    'w-full',
    'sm:w-auto',
    'sm:justify-self-start',
  );
});

it('says the Member is unavailable when the server returns no card', () => {
  state.member.mockReturnValue({ ...ready, data: null });
  show();
  expect(
    screen.getByRole('heading', { name: 'Membru indisponibil' }),
  ).toBeVisible();
  // Back to the Membri tab the page sits under (#825), for BC.
  expect(
    screen.getByRole('link', { name: 'Înapoi la Administrare' }),
  ).toHaveAttribute('href', '/administrare/membri');
});

it.each(['target', '7a3c1e2b', 'not-a-uuid-at-all-0000000000000000'])(
  'says the Member is unavailable for the malformed id %s and queries nothing',
  (raw) => {
    render(
      <MemoryRouter initialEntries={[`/administrare/membri/${raw}`]}>
        <Routes>
          <Route
            path="/administrare/membri/:memberId"
            element={<MemberScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: 'Membru indisponibil' }),
    ).toBeVisible();
    expect(state.member).toHaveBeenLastCalledWith(undefined);
    expect(state.privacy).not.toHaveBeenCalledWith(raw, expect.anything());
  },
);

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
    <MemoryRouter
      initialEntries={[
        '/administrare/membri/7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
      ]}
    >
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
