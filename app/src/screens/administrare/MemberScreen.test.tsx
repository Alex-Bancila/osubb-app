import { render, screen, waitFor, within } from '@testing-library/react';
import { swipe } from '../../test/swipe';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { BackLink } from '../../components/layout';
import { pickDate } from '../../test/date-picker';
import { UNIVERSITIES } from '../../lib/universities';
import { chooseOption, optionNames } from '../../test/select';
const state = vi.hoisted(() => ({
  member: vi.fn(),
  capabilities: vi.fn(),
  groups: vi.fn(),
  mine: vi.fn(),
  mutate: vi.fn(),
  joined: vi.fn(),
  university: vi.fn(),
  privacy: vi.fn(),
  auth: vi.fn(),
}));
vi.mock('../../queries/admin-member', () => ({
  useAdminMember: state.member,
  useUpdateMemberIdentity: () => ({
    mutateAsync: state.mutate,
    isPending: false,
  }),
  useUpdateMemberJoinedAt: () => ({
    mutateAsync: state.joined,
    isPending: false,
  }),
  useUpdateMemberUniversity: () => ({
    mutateAsync: state.university,
    isPending: false,
  }),
}));
// The shared timeline has its own tests; here only what the page hands it.
vi.mock('../profile/RoleTimeline', () => ({
  MemberRoleTimeline: (props: {
    memberId: string;
    role: string;
    joinedAt: string | null;
  }) => (
    <p>
      Timeline {props.memberId} {props.role} {props.joinedAt ?? 'fără dată'}
    </p>
  ),
}));
vi.mock('../../lib/auth', () => ({ useAuth: state.auth }));
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
// A stand-in command with a receipt, taking its turn like the real panel.
vi.mock('./RolePanel', async () => {
  const { useState } = await import('react');
  const { useReceiptTurn } = await import('../tracker/receipt-turn');
  return {
    RolePanel: ({ selectedMemberId }: { selectedMemberId: string }) => {
      const turn = useReceiptTurn();
      const [message, setMessage] = useState('');
      return (
        <>
          <p>Editor rol {selectedMemberId}</p>
          <button
            type="button"
            onClick={() => {
              setMessage('Rolul a fost schimbat.');
              turn.claim();
            }}
          >
            Schimbă rolul
          </button>
          {message && turn.current && <p role="status">{message}</p>}
        </>
      );
    },
  };
});
vi.mock('./ReinvitePanel', () => ({
  ReinvitePanel: ({ memberId }: { memberId: string }) => (
    <p>Retrimitere {memberId}</p>
  ),
}));
import MemberScreen from './MemberScreen';

const ready = { isPending: false, isError: false };

type Tab = 'cont' | 'grupuri' | 'roluri' | 'puncte';

/** The page, optionally arriving from somewhere and on one of its tabs. */
function show(from?: unknown, tab?: Tab) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/administrare/membri/7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
          search: tab ? `?tab=${tab}` : '',
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

type User = ReturnType<typeof userEvent.setup>;

const openTab = (user: User, name: string) =>
  user.click(screen.getByRole('tab', { name }));

/** The identity header's one line under the name. */
const meta = () =>
  document.querySelector('[data-slot="member-meta"]') as HTMLElement;

/** A fact of the Cont tab: the row its label sits in. */
const fact = (label: string) =>
  screen.getByText(label).closest('li') as HTMLElement;

/** Opens the Nume și poreclă sheet from the Cont panel's pencil. */
async function openNames(user: User) {
  await user.click(
    screen.getByRole('button', { name: 'Editează numele și porecla' }),
  );
  return screen.findByRole('dialog', { name: 'Nume și poreclă' });
}

function member(patch: object = {}) {
  return {
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    nickname: 'Nana',
    fullName: 'Ana Pop',
    roleLabel: 'Voluntar',
    rankLabel: 'Voluntar',
    role: 'voluntar',
    joinedAt: '2025-01-01',
    university: null,
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
  // The viewer is a BC, not the Member on the page.
  state.auth.mockReturnValue({
    session: { user: { id: '0b0c0000-0000-4000-8000-000000000006' } },
  });
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
  state.joined.mockReset().mockResolvedValue(undefined);
  state.university.mockReset().mockResolvedValue(undefined);
});

it('draws the page as Profil is: the identity as its header, then tabs kept in the URL', async () => {
  const user = userEvent.setup();
  const { container } = show();
  expect(screen.getByRole('heading', { level: 1, name: 'Nana' })).toBeVisible();
  // No eyebrow, on the page or over a panel: the back link already says
  // where the page belongs.
  expect(document.querySelector('[data-slot="page-eyebrow"]')).toBeNull();
  expect(document.querySelector('[data-slot="section-eyebrow"]')).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Înapoi la Administrare' }),
  ).toHaveAttribute('href', '/administrare/membri');
  // The avatar, then one line: role chip, status, since when.
  const identity = document.querySelector(
    '[data-slot="member-identity"]',
  ) as HTMLElement;
  expect(within(identity).getByText('AP')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  expect(meta().querySelector('[data-slot="member-role"]')).toHaveClass(
    'role-badge',
  );
  expect(meta()).toHaveTextContent('VoluntarActivMembru din 1 ianuarie 2025');
  // Facts are rows of a list, not a definition grid with small labels.
  expect(container.querySelector('dl')).toBeNull();

  const tabs = within(
    screen.getByRole('tablist', { name: 'Secțiunile membrului' }),
  ).getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    'Cont',
    'Grupuri',
    'Roluri',
    'Puncte',
  ]);
  for (const tab of tabs) expect(tab.querySelector('svg')).not.toBeNull();
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  // Cont: the names, and the invitation to resend.
  expect(fact('Nume complet')).toHaveTextContent('Ana Pop');
  expect(fact('Poreclă')).toHaveTextContent('Nana');
  expect(
    screen.getByText('Retrimitere 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
  ).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);

  // Grupuri: a row per Group, opened by the row, its Group Role a chip.
  await openTab(user, 'Grupuri');
  expect(screen.getByRole('tab', { name: 'Grupuri' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const groups = screen.getByRole('region', { name: 'Grupuri' });
  const rows = within(groups).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    'ComunicareDirector comunicare',
    'Evenimente · ComunicareResponsabil logistică',
    // A plain membership names no Group Role (B60).
    'Proiecte',
  ]);
  expect(
    within(rows[0] as HTMLElement).getByText('Director comunicare'),
  ).toHaveAttribute('data-slot', 'badge');
  const link = screen.getByRole('link', { name: 'Evenimente · Comunicare' });
  expect(link).toHaveAttribute('href', '/administrare/grupuri/2');
  // In the text colour, and the whole row is its target.
  expect(link).toHaveClass('text-foreground', 'after:absolute');
  expect(screen.getByRole('link', { name: 'Proiecte' })).toBeVisible();

  // Roluri: the Role editor and the timeline; Puncte: the ledger.
  await openTab(user, 'Roluri');
  expect(
    screen.getByText('Editor rol 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
  ).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Istoric roluri' })).toBeVisible();
  await openTab(user, 'Puncte');
  expect(screen.getByRole('heading', { name: 'Istoric puncte' })).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('opens the tab named in the URL, and Cont for one it does not have', () => {
  const view = show(undefined, 'puncte');
  expect(screen.getByRole('tab', { name: 'Puncte' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('heading', { name: 'Istoric puncte' })).toBeVisible();
  view.unmount();

  // A Group Manager has no Roluri tab: the link falls back to Cont.
  state.capabilities.mockReturnValue({
    ...ready,
    data: { manageRoles: false },
  });
  state.mine.mockReturnValue({
    ...ready,
    data: [{ id: 1, group_role: 'manager' }],
  });
  show(undefined, 'roluri');
  expect(screen.queryByRole('tab', { name: 'Roluri' })).toBeNull();
  expect(screen.getByRole('tab', { name: 'Cont' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
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
    show(undefined, 'grupuri');
    expect(screen.getByRole('link', { name: 'Comunicare' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Evenimente · Comunicare' }),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Proiecte' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Editează numele și porecla' }),
    ).toBeNull();
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
  const view = show(undefined, 'grupuri');
  expect(
    screen.getByText('Nu există grupuri în aria ta de administrare.'),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Editează numele și porecla' }),
  ).toBeNull();
  expect(
    screen.queryByText('Editor rol 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
  ).toBeNull();
  view.unmount();
  show(undefined, 'puncte');
  expect(
    screen.getByText('Nu există înregistrări pe care le poți vedea.'),
  ).toBeVisible();
});

it('edits the names in a sheet: trimmed, a Nickname refusal under its field, the receipt on the page', async () => {
  const user = userEvent.setup();
  state.mutate.mockRejectedValueOnce({
    code: '23514',
    message: 'nickname_taken',
  });
  show();
  // The form is not on the page until its pencil opens it.
  expect(screen.queryByLabelText('Poreclă (opțional)')).toBeNull();
  const sheet = await openNames(user);
  expect(sheet).toHaveAttribute('data-slot', 'form-sheet');
  const nickname = within(sheet).getByLabelText('Poreclă (opțional)');
  expect(nickname).toHaveValue('Nana');
  // One filled button on the sheet: Renunță is not.
  expect(
    within(sheet).getByRole('button', { name: 'Salvează numele' }),
  ).toHaveClass('bg-primary');
  expect(
    within(sheet).getByRole('button', { name: 'Renunță' }),
  ).not.toHaveClass('bg-primary');
  await user.clear(nickname);
  await user.type(nickname, '  Anuța ');
  await user.click(
    within(sheet).getByRole('button', { name: 'Salvează numele' }),
  );
  expect(state.mutate).toHaveBeenCalledWith({
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    nickname: 'Anuța',
    fullName: 'Ana Pop',
  });
  expect(
    await within(sheet).findByText(
      'Porecla este deja folosită de alt membru. Alege alta.',
    ),
  ).toBeVisible();
  expect(nickname).toHaveAttribute('aria-invalid', 'true');
  // A refusal keeps the sheet open, with what was typed.
  expect(nickname).toHaveValue('  Anuța ');

  await user.click(
    within(sheet).getByRole('button', { name: 'Salvează numele' }),
  );
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Numele a fost actualizat.',
  );
  // Saved, the sheet closes and focus goes back to its pencil.
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Nume și poreclă' }),
    ).toBeNull(),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Editează numele și porecla' }),
    ).toHaveFocus(),
  );
});

it('Renunță closes the names sheet without saving', async () => {
  const user = userEvent.setup();
  show();
  const sheet = await openNames(user);
  await user.type(within(sheet).getByLabelText('Nume complet'), ' Maria');
  await user.click(within(sheet).getByRole('button', { name: 'Renunță' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Nume și poreclă' }),
    ).toBeNull(),
  );
  expect(state.mutate).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
  // Opened again, the sheet starts from the stored names.
  expect(
    within(await openNames(user)).getByLabelText('Nume complet'),
  ).toHaveValue('Ana Pop');
});

it('shows one receipt at a time: a second command replaces the first (F-11)', async () => {
  const user = userEvent.setup();
  state.mutate.mockResolvedValue(undefined);
  show();
  const sheet = await openNames(user);
  await user.click(
    within(sheet).getByRole('button', { name: 'Salvează numele' }),
  );
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Numele a fost actualizat.',
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Nume și poreclă' }),
    ).toBeNull(),
  );
  // The other tabs stay mounted, so the turn passes across them.
  await openTab(user, 'Roluri');
  await user.click(screen.getByRole('button', { name: 'Schimbă rolul' }));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Rolul a fost schimbat.',
  );
  await openTab(user, 'Cont');
  expect(screen.queryByText('Numele a fost actualizat.')).toBeNull();
});

it('leaves out "Membru din" for an imported Member with no date yet (F-28)', () => {
  state.capabilities.mockReturnValue({
    ...ready,
    data: { manageRoles: false },
  });
  state.member.mockReturnValue({ ...ready, data: member({ joinedAt: null }) });
  show();
  expect(screen.queryByText(/Membru din/)).toBeNull();
  expect(screen.queryByText('Data intrării')).toBeNull();
  expect(screen.queryByText('—')).toBeNull();
  expect(meta()).toHaveTextContent(/^VoluntarActiv$/);
});

it('names a board member by their Board Title, the Role muted beside it (#963)', () => {
  state.member.mockReturnValue({
    ...ready,
    data: member({ role: 'bc', roleLabel: 'Președinte', rankLabel: 'BC' }),
  });
  show();
  expect(within(meta()).getByText('Președinte')).toHaveClass('role-badge');
  // The rank follows the chip, in the line's muted colour.
  expect(within(meta()).getByText('BC')).toHaveAttribute(
    'data-slot',
    'member-rank',
  );
  expect(meta()).toHaveClass('text-muted-foreground');
});

it('says the Role alone when there is no Board Title (#963)', () => {
  show();
  expect(within(meta()).getByText('Voluntar')).toHaveClass('role-badge');
  expect(meta().querySelector('[data-slot="member-rank"]')).toBeNull();
});

it('puts the contact details the server answered on the header line and in Cont', () => {
  state.member.mockReturnValue({
    ...ready,
    data: member({
      contact: { email: 'ana@example.org', phone: '0712345678' },
    }),
  });
  show();
  expect(meta()).toHaveTextContent('ana@example.org');
  expect(fact('E-mail')).toHaveTextContent('ana@example.org');
  expect(fact('Telefon')).toHaveTextContent('0712345678');
});

it('clears the Nickname to none and refuses a blank full name before sending', async () => {
  const user = userEvent.setup();
  show();
  const sheet = await openNames(user);
  await user.clear(within(sheet).getByLabelText('Poreclă (opțional)'));
  await user.clear(within(sheet).getByLabelText('Nume complet'));
  await user.click(
    within(sheet).getByRole('button', { name: 'Salvează numele' }),
  );
  expect(within(sheet).getByText('Scrie numele complet.')).toBeVisible();
  expect(state.mutate).not.toHaveBeenCalled();

  await user.type(
    within(sheet).getByLabelText('Nume complet'),
    'Ana Maria Pop',
  );
  await user.click(
    within(sheet).getByRole('button', { name: 'Salvează numele' }),
  );
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
          id: 3,
          delta: -4,
          reason: 'task_reversal',
          created_at: '2026-09-22T10:00:00Z',
          task_id: null,
          task_title: null,
          // #1017: the Task was deleted for good; its title stays on the row.
          deleted_task_title: 'Afiș șters',
        },
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
  show(undefined, 'puncte');
  expect(screen.getByText('+5 puncte')).toBeVisible();
  expect(screen.getByText('−3 puncte')).toBeVisible();
  expect(screen.getByText(/Sancțiune/)).toBeVisible();
  expect(screen.getByText(/Task șters: Afiș șters/)).toBeVisible();
  expect(screen.queryByRole('link', { name: /Afiș șters/ })).toBeNull();
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
  // A Group's Membri, Roluri or Confidențialitate link says where it was.
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
  await openTab(user, 'Grupuri');
  await user.click(screen.getByRole('link', { name: 'Comunicare' }));
  // Back on the tab the Group was opened from.
  expect(
    screen.getByRole('link', { name: 'Înapoi la membru' }),
  ).toHaveAttribute(
    'href',
    '/administrare/membri/7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d?tab=grupuri',
  );
});

it('sets each fact as a row: a muted label, its value at the end (AD2)', () => {
  const { unmount } = show();
  const label = screen.getByText('Nume complet');
  expect(label).toHaveClass('text-sm', 'text-muted-foreground');
  expect(label.nextElementSibling).toHaveClass('text-right', 'font-medium');
  expect(label.closest('li')).toHaveClass('min-h-11', 'justify-between');
  // An unset Nickname says so quietly rather than leaving a gap (the
  // Universitate is set here, so it is the only unset fact).
  unmount();
  state.member.mockReturnValue({
    ...ready,
    data: member({ nickname: null, university: 'Universitatea Sapientia' }),
  });
  show();
  expect(screen.getByText('Necompletată')).toHaveClass('text-muted-foreground');
});

it('keeps the back link’s origin when a tab is chosen (D4)', async () => {
  const user = userEvent.setup();
  show({
    from: { to: '/administrare/grupuri/4?tab=roster', label: 'Înapoi la grup' },
  });
  await openTab(user, 'Puncte');
  expect(screen.getByRole('link', { name: 'Înapoi la grup' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/4?tab=roster',
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
  const sheet = await openNames(user);
  const nickname = within(sheet).getByLabelText('Poreclă (opțional)');
  await user.clear(nickname);
  await user.type(nickname, '  Anuța ');
  await user.click(
    within(sheet).getByRole('button', { name: 'Salvează numele' }),
  );
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
  expect(fact('Poreclă')).toHaveTextContent('Anuța');
  expect(
    within(await openNames(user)).getByLabelText('Poreclă (opțional)'),
  ).toHaveValue('Anuța');
});

it('shows a Member who is not BC the join date read-only, as "Membru din" (#932)', () => {
  state.capabilities.mockReturnValue({
    ...ready,
    data: { manageRoles: false },
  });
  show();
  expect(meta()).toHaveTextContent('Membru din 1 ianuarie 2025');
  expect(screen.queryByText('Data intrării')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Editează data intrării' }),
  ).toBeNull();
  // role_history_read answers another Member's rows to level 6 only: with
  // no Role editor either, there is no Roluri tab at all.
  expect(screen.queryByRole('tab', { name: 'Roluri' })).toBeNull();
  expect(screen.queryByText('Istoric roluri')).toBeNull();
  expect(screen.queryByText(/^Timeline /)).toBeNull();
});

it('lets BC set a join date that was never recorded (#932)', async () => {
  const user = userEvent.setup();
  state.member.mockReturnValue({ ...ready, data: member({ joinedAt: null }) });
  show();
  expect(fact('Data intrării')).toHaveTextContent('Nesetată');
  // What an unset date costs stays on the page.
  expect(
    within(fact('Data intrării')).getByText(
      'Fără ea, membrul nu poate deveni candidat la promovare.',
    ),
  ).toBeVisible();
  // One pencil, not a text button.
  const edit = screen.getByRole('button', { name: 'Editează data intrării' });
  expect(edit).toHaveTextContent('');
  expect(edit.querySelector('svg')).not.toBeNull();
  await user.click(edit);
  // The app's picker, not the browser's date field; its hint behind an "i".
  const input = screen.getByRole('button', { name: 'Data intrării' });
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute('data-slot', 'date-picker');
  expect(document.querySelector('input[type="date"]')).toBeNull();
  expect(input).toHaveAccessibleDescription(
    'Vechimea pentru promovări se numără de la această dată.',
  );
  expect(
    screen.getByRole('button', { name: 'Despre data intrării' }),
  ).toBeVisible();
  // Nothing chosen yet: nothing to save.
  expect(screen.getByRole('button', { name: 'Salvează' })).toBeDisabled();
  await pickDate(user, input, '2024-10-01');
  expect(input).toHaveTextContent('mar., 1 oct. 2024');
  await user.click(screen.getByRole('button', { name: 'Salvează' }));
  expect(state.joined).toHaveBeenCalledWith({
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    joinedAt: '2024-10-01',
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Data intrării a fost salvată.',
  );
  // Back from the editor, focus returns to the button that opened it.
  expect(
    screen.getByRole('button', { name: 'Editează data intrării' }),
  ).toHaveFocus();
});

it('offers no join date in the future (#932)', async () => {
  const user = userEvent.setup();
  show();
  expect(fact('Data intrării')).toHaveTextContent('1 ianuarie 2025');
  await user.click(
    screen.getByRole('button', { name: 'Editează data intrării' }),
  );
  const input = screen.getByRole('button', { name: 'Data intrării' });
  expect(input).toHaveAttribute('data-value', '2025-01-01');
  // The picker ends today: a future day cannot be chosen at all (the schema
  // still refuses one, should a value arrive another way).
  await user.click(input);
  expect(await screen.findByRole('button', { name: 'Mâine' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Azi' })).toBeEnabled();
  expect(state.joined).not.toHaveBeenCalled();
});

it('puts a refused join-date write in the editor and keeps it open (#932)', async () => {
  const user = userEvent.setup();
  state.joined.mockRejectedValue(new Error('permission denied'));
  show();
  await user.click(
    screen.getByRole('button', { name: 'Editează data intrării' }),
  );
  const input = screen.getByRole('button', { name: 'Data intrării' });
  await pickDate(user, input, '2024-03-15');
  await user.click(screen.getByRole('button', { name: 'Salvează' }));
  expect(
    screen.getByText(
      'Nu am putut salva data intrării. Verifică permisiunile și reîncearcă.',
    ),
  ).toBeVisible();
  expect(input).toBeVisible();
  // Changing the date drops the refusal about the old one.
  await pickDate(user, input, '2024-03-16');
  expect(
    screen.queryByText(
      'Nu am putut salva data intrării. Verifică permisiunile și reîncearcă.',
    ),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Renunță' }));
  expect(
    screen.getByRole('button', { name: 'Editează data intrării' }),
  ).toHaveFocus();
  expect(fact('Data intrării')).toHaveTextContent('1 ianuarie 2025');
});

it('BC edits Universitate from a list, with Altă universitate as free text (R58)', async () => {
  const user = userEvent.setup();
  show();
  // Never recorded: said quietly, in italics, as the phone is on Profil.
  expect(fact('Universitate')).toHaveTextContent('Necompletată');
  expect(within(fact('Universitate')).getByText('Necompletată')).toHaveClass(
    'italic',
  );
  // One pencil, not a text button.
  const edit = screen.getByRole('button', { name: 'Editează universitatea' });
  expect(edit).toHaveTextContent('');
  expect(edit.querySelector('svg')).not.toBeNull();
  await user.click(edit);
  const field = screen.getByRole('combobox', { name: 'Universitate' });
  expect(field).toHaveFocus();
  expect(field).toHaveAttribute('data-slot', 'select');
  expect(await optionNames(user, field)).toEqual([
    ...UNIVERSITIES,
    'Altă universitate',
  ]);
  // Nothing chosen yet: nothing to save, and no free text.
  expect(screen.getByRole('button', { name: 'Salvează' })).toBeDisabled();
  expect(screen.queryByLabelText('Numele universității')).toBeNull();
  await chooseOption(user, field, 'Altă universitate');
  await user.type(
    screen.getByLabelText('Numele universității'),
    '  Universitatea din București ',
  );
  await user.click(screen.getByRole('button', { name: 'Salvează' }));
  expect(state.university).toHaveBeenCalledWith({
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    university: 'Universitatea din București',
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Universitatea a fost salvată.',
  );
  // Back from the editor, focus returns to the button that opened it.
  expect(
    screen.getByRole('button', { name: 'Editează universitatea' }),
  ).toHaveFocus();
});

it('saves a university chosen from the list as the list names it (R58)', async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    screen.getByRole('button', { name: 'Editează universitatea' }),
  );
  await chooseOption(
    user,
    screen.getByRole('combobox', { name: 'Universitate' }),
    'Universitatea Babeș-Bolyai',
  );
  // A list entry needs no typed name.
  expect(screen.queryByLabelText('Numele universității')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Salvează' }));
  expect(state.university).toHaveBeenCalledWith({
    memberId: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    university: 'Universitatea Babeș-Bolyai',
  });
});

it('opens a stored Universitate on its list entry, or on Altă universitate with the name typed (R58)', async () => {
  const user = userEvent.setup();
  state.member.mockReturnValue({
    ...ready,
    data: member({ university: 'Universitatea Sapientia' }),
  });
  const { unmount } = show();
  expect(fact('Universitate')).toHaveTextContent('Universitatea Sapientia');
  await user.click(
    screen.getByRole('button', { name: 'Editează universitatea' }),
  );
  expect(
    screen.getByRole('combobox', { name: 'Universitate' }),
  ).toHaveTextContent('Universitatea Sapientia');
  // Unchanged: nothing to save.
  expect(screen.getByRole('button', { name: 'Salvează' })).toBeDisabled();
  unmount();

  state.member.mockReturnValue({
    ...ready,
    data: member({ university: 'Universitatea din București' }),
  });
  show();
  await user.click(
    screen.getByRole('button', { name: 'Editează universitatea' }),
  );
  expect(
    screen.getByRole('combobox', { name: 'Universitate' }),
  ).toHaveTextContent('Altă universitate');
  expect(screen.getByLabelText('Numele universității')).toHaveValue(
    'Universitatea din București',
  );
  await user.click(screen.getByRole('button', { name: 'Renunță' }));
  expect(fact('Universitate')).toHaveTextContent('Universitatea din București');
});

it('refuses a typed university under 2 characters under its field, and puts a refused write in the editor (R58)', async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    screen.getByRole('button', { name: 'Editează universitatea' }),
  );
  await chooseOption(
    user,
    screen.getByRole('combobox', { name: 'Universitate' }),
    'Altă universitate',
  );
  const name = screen.getByLabelText('Numele universității');
  await user.type(name, 'A');
  await user.click(screen.getByRole('button', { name: 'Salvează' }));
  expect(
    screen.getByText('Universitatea are între 2 și 120 de caractere.'),
  ).toBeVisible();
  expect(name).toHaveFocus();
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(state.university).not.toHaveBeenCalled();

  state.university.mockRejectedValue(new Error('permission denied'));
  await user.type(name, 'bc');
  // The message was about "A": typing a valid name hides it before any blur
  // or submit.
  expect(
    screen.queryByText('Universitatea are între 2 și 120 de caractere.'),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Salvează' }));
  expect(
    screen.getByText(
      'Nu am putut salva universitatea. Verifică permisiunile și reîncearcă.',
    ),
  ).toBeVisible();
  expect(name).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Renunță' }));
  expect(
    screen.getByRole('button', { name: 'Editează universitatea' }),
  ).toHaveFocus();
  expect(fact('Universitate')).toHaveTextContent('Necompletată');
});

it('offers Universitate to no Member who is not BC or the Moderator (R58)', () => {
  state.capabilities.mockReturnValue({
    ...ready,
    data: { manageRoles: false },
  });
  show();
  expect(screen.queryByText('Universitate')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Editează universitatea' }),
  ).toBeNull();
});

it("shows BC the Member's Istoric roluri, from their Role and join date (#932)", () => {
  show(undefined, 'roluri');
  expect(screen.getByRole('heading', { name: 'Istoric roluri' })).toBeVisible();
  expect(
    screen.getByText(
      'Timeline 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d voluntar 2025-01-01',
    ),
  ).toBeVisible();
});

it("offers BC every edit on the Moderator's page, as on anyone's (#944, R31)", () => {
  state.member.mockReturnValue({
    ...ready,
    data: member({ role: 'moderator', roleLabel: 'Moderator' }),
  });
  show();
  expect(
    screen.getByRole('button', { name: 'Editează data intrării' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Editează numele și porecla' }),
  ).toBeVisible();
  expect(
    screen.getByText('Retrimitere 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
  ).toBeVisible();
  // On the Roluri tab, mounted with the page.
  expect(
    screen.getByText('Editor rol 7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d'),
  ).toBeInTheDocument();
});

it('offers BC their own names and join date but no Role panel (#944)', () => {
  // set_member_role and set_member_status refuse the actor as the target.
  state.auth.mockReturnValue({
    session: { user: { id: '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d' } },
  });
  state.member.mockReturnValue({
    ...ready,
    data: member({ role: 'bc', roleLabel: 'BC' }),
  });
  show();
  expect(
    screen.getByRole('button', { name: 'Editează data intrării' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Editează numele și porecla' }),
  ).toBeVisible();
  expect(screen.queryByText(/^Editor rol /)).toBeNull();
  // Istoric roluri is still theirs to read.
  expect(screen.getByRole('tab', { name: 'Roluri' })).toBeVisible();
});

it('offers a viewer below BC no edit at all (#944)', () => {
  state.capabilities.mockReturnValue({
    ...ready,
    data: { manageRoles: false },
  });
  show();
  expect(
    screen.queryByRole('button', { name: 'Editează data intrării' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Editează numele și porecla' }),
  ).toBeNull();
  expect(screen.queryByText(/^Retrimitere /)).toBeNull();
  expect(screen.queryByText(/^Editor rol /)).toBeNull();
});

it('moves between tabs with a finger swipe over the panel (2026-10-11)', async () => {
  show();
  swipe(await screen.findByRole('tabpanel'), 'left');
  expect(screen.getByRole('tab', { name: 'Grupuri' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
