import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { MemberCardData } from '@/queries/member-card';

const hook = vi.hoisted(() => vi.fn());
vi.mock('@/queries/member-card', () => ({ useMemberCard: hook }));
const capabilities = vi.hoisted(() => ({
  manageRoles: false,
  seeLeadership: false,
  administer: false,
}));
vi.mock('@/lib/capabilities', () => ({
  useCapability: (name: 'manageRoles' | 'seeLeadership' | 'administer') => ({
    data: capabilities[name],
  }),
}));
// The viewer's live Group Roles (my_groups()), for "Pagina membrului".
const myGroups = vi.hoisted(() => ({
  data: [] as { id: number; group_role: string }[],
}));
vi.mock('@/queries/my-groups', () => ({
  useMyGroupRoles: () => ({ data: myGroups.data }),
}));

import { MemberName } from './MemberName';

// A colleague in Groups the viewer is not in: member_card() still answers.
const card: MemberCardData = {
  memberId: 'm-1',
  nickname: 'Ani',
  fullName: 'Ana Pop',
  roleLabel: 'Voluntar Activ',
  rankLabel: 'Voluntar Activ',
  joinedAt: '2024-03-12',
  avatarColor: '#284C93',
  primaryGroup: {
    id: 1,
    name: 'Educațional',
    color: '#284C93',
    isPrivate: false,
  },
  otherMemberships: 2,
  groups: [
    {
      id: 1,
      name: 'Educațional',
      label: 'Educațional',
      color: '#284C93',
      roleLabel: 'Membru',
      isPrivate: false,
    },
    {
      id: 7,
      name: 'Mentorat',
      label: 'Mentorat · Educațional',
      color: null,
      roleLabel: 'Coordonator',
      isPrivate: false,
    },
    {
      id: 9,
      name: 'Balul Bobocilor',
      label: 'Balul Bobocilor',
      color: '#7500A0',
      roleLabel: 'Responsabil logistică',
      // A Private Group (#757): the viewer sees it, so it is marked.
      isPrivate: true,
    },
  ],
  contact: null,
};

function answer(data: Partial<MemberCardData> = {}) {
  hook.mockReturnValue({
    data: { ...card, ...data },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
}

async function openCard() {
  render(
    <MemoryRouter>
      <MemberName memberId="m-1" nickname="Ani" fullName="Ana Pop" />
    </MemoryRouter>,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  );
  return screen.findByRole('dialog', { name: 'Ani' });
}

async function closeCard() {
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

beforeEach(() => {
  hook.mockReset();
  capabilities.manageRoles = false;
  capabilities.seeLeadership = false;
  capabilities.administer = false;
  myGroups.data = [];
  answer();
});

it('shows the Nickname, full name, Role, join date, first Department + n and the Groups', async () => {
  const dialog = await openCard();
  expect(hook).toHaveBeenCalledWith('m-1');
  expect(within(dialog).getByText('Ana Pop')).toBeVisible();
  expect(dialog).toHaveTextContent(
    'Voluntar Activ · Membru din 12 martie 2024',
  );
  expect(within(dialog).getByText('+2')).toHaveAccessibleName(
    'și încă 2 grupuri',
  );
  const groups = within(dialog).getByRole('region', { name: 'Grupuri' });
  expect(within(groups).getAllByRole('listitem')).toHaveLength(3);
  expect(groups).toHaveTextContent('Mentorat · Educațional');
  expect(groups).toHaveTextContent('Coordonator');
  expect(groups).toHaveTextContent('Responsabil logistică');
  expect((await axe.run(dialog)).violations).toEqual([]);
});

it('names a board member by their Board Title, with the Role beside it (#963)', async () => {
  answer({ roleLabel: 'Președinte', rankLabel: 'BC' });
  const dialog = await openCard();
  expect(dialog).toHaveTextContent(
    'Președinte · BC · Membru din 12 martie 2024',
  );
});

it('says the Role once when there is no Board Title (#963)', async () => {
  answer({ roleLabel: 'BC', rankLabel: 'BC' });
  const dialog = await openCard();
  expect(dialog).toHaveTextContent('BC · Membru din 12 martie 2024');
  expect(dialog).not.toHaveTextContent('BC · BC');
});

it('marks a Private Group in the Groups list, and no public one (#757)', async () => {
  const dialog = await openCard();
  const groups = within(dialog).getByRole('region', { name: 'Grupuri' });
  const items = within(groups).getAllByRole('listitem');
  expect(within(items[2] as HTMLElement).getByText('Privat')).toBeVisible();
  expect(within(items[0] as HTMLElement).queryByText('Privat')).toBeNull();
  expect(within(items[1] as HTMLElement).queryByText('Privat')).toBeNull();
  // The public primary chip carries no lock either.
  expect(within(dialog).getAllByText('Privat')).toHaveLength(1);
  expect((await axe.run(dialog)).violations).toEqual([]);
});

it('omits the join line when the date was never recorded, and the chip without a Group', async () => {
  answer({ joinedAt: null, primaryGroup: null, otherMemberships: 0 });
  const dialog = await openCard();
  expect(dialog).not.toHaveTextContent('Membru din');
  expect(within(dialog).queryByText(/^\+\d/)).toBeNull();
});

it('shows contact only when profiles_contact returned a row', async () => {
  const dialog = await openCard();
  expect(within(dialog).queryByText('Contact')).toBeNull();
  expect(within(dialog).queryByRole('link', { name: /@/ })).toBeNull();

  await closeCard();
  answer({ contact: { email: 'ana@osubb.ro', phone: '+40700000000' } });
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  );
  const withContact = await screen.findByRole('dialog', { name: 'Ani' });
  const contact = within(withContact).getByRole('region', { name: 'Contact' });
  expect(
    within(contact).getByRole('link', { name: 'ana@osubb.ro' }),
  ).toHaveAttribute('href', 'mailto:ana@osubb.ro');
  expect(
    within(contact).getByRole('link', { name: '+40700000000' }),
  ).toHaveAttribute('href', 'tel:+40700000000');
});

it('offers no links without the capabilities', async () => {
  const dialog = await openCard();
  expect(within(dialog).queryByRole('link')).toBeNull();
});

it('links to the tracker for leadership viewers and to Administrare for manageRoles', async () => {
  capabilities.seeLeadership = true;
  let dialog = await openCard();
  expect(
    within(dialog).getByRole('link', { name: 'Vezi trackerul' }),
  ).toHaveAttribute('href', '/tracker/membru/m-1');
  expect(within(dialog).queryByRole('link', { name: 'Editează' })).toBeNull();

  await closeCard();
  capabilities.seeLeadership = false;
  capabilities.manageRoles = true;
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  );
  dialog = await screen.findByRole('dialog', { name: 'Ani' });
  expect(
    within(dialog).getByRole('link', { name: 'Editează' }),
  ).toHaveAttribute('href', '/administrare/membri/m-1');
  expect(
    within(dialog).queryByRole('link', { name: 'Vezi trackerul' }),
  ).toBeNull();
});

it('never renders points or rank', async () => {
  // Even a row that somehow carried them cannot leak them into the card.
  answer({ points: 42, rank: 1 } as Partial<MemberCardData>);
  const dialog = await openCard();
  expect(dialog).not.toHaveTextContent(/puncte|42|locul/i);
});

it('traps focus inside and closes on Escape, handing focus back', async () => {
  capabilities.seeLeadership = true;
  const dialog = await openCard();
  const trigger = screen.getByRole('button', {
    name: 'Profilul membrului Ani',
    hidden: true,
  });
  // Focus moves into the card, and the page behind it is taken out of reach:
  // Base UI hides it from assistive technology and the Tab order (modal).
  await waitFor(() =>
    expect(dialog).toContainElement(document.activeElement as HTMLElement),
  );
  expect(dialog).toHaveAttribute('role', 'dialog');
  expect(trigger.closest('[aria-hidden="true"], [inert]')).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger).toHaveFocus();
});

it('shows the known name while loading, and a retry on failure', async () => {
  const refetch = vi.fn();
  hook.mockReturnValue({ isPending: true, isError: false, refetch });
  const dialog = await openCard();
  expect(within(dialog).getByRole('status')).toHaveTextContent(
    'Se încarcă profilul',
  );
  expect(within(dialog).getByText('Ana Pop')).toBeVisible();

  await closeCard();
  hook.mockReturnValue({ isPending: false, isError: true, refetch });
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Reîncarcă profilul' }),
  );
  expect(refetch).toHaveBeenCalledOnce();
});

it('offers "Pagina membrului" to a Group Responsible of a Group the member is in, and to no one else (D19)', async () => {
  // A Responsible of Balul Bobocilor (9), where Ana holds a position.
  capabilities.administer = true;
  myGroups.data = [
    { id: 9, group_role: 'responsible' },
    { id: 4, group_role: 'manager' },
  ];
  let dialog = await openCard();
  expect(
    within(dialog).getByRole('link', { name: 'Pagina membrului' }),
  ).toHaveAttribute('href', '/administrare/membri/m-1');
  expect(within(dialog).queryByRole('link', { name: 'Editează' })).toBeNull();

  // A plain member of Ana's Group leads nothing there: no link.
  await closeCard();
  myGroups.data = [
    { id: 1, group_role: 'member' },
    { id: 4, group_role: 'manager' },
  ];
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  );
  dialog = await screen.findByRole('dialog', { name: 'Ani' });
  expect(
    within(dialog).queryByRole('link', { name: 'Pagina membrului' }),
  ).toBeNull();

  // Without `administer` the Group Role alone opens nothing.
  await closeCard();
  capabilities.administer = false;
  myGroups.data = [{ id: 9, group_role: 'responsible' }];
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  );
  dialog = await screen.findByRole('dialog', { name: 'Ani' });
  expect(within(dialog).queryByRole('link')).toBeNull();
});

it('shows "Editează", not both, to manageRoles', async () => {
  capabilities.administer = true;
  capabilities.manageRoles = true;
  myGroups.data = [{ id: 9, group_role: 'manager' }];
  const dialog = await openCard();
  expect(within(dialog).getByRole('link', { name: 'Editează' })).toBeVisible();
  expect(
    within(dialog).queryByRole('link', { name: 'Pagina membrului' }),
  ).toBeNull();
});

it('hands the page it opens a way back here (D10)', async () => {
  const seen: unknown[] = [];
  function Probe() {
    seen.push(useLocation().state);
    return <p>Trackerul membrului</p>;
  }
  capabilities.seeLeadership = true;
  render(
    <MemoryRouter initialEntries={['/voluntari?grup=8']}>
      <Routes>
        <Route
          path="/voluntari"
          element={
            <MemberName memberId="m-1" nickname="Ani" fullName="Ana Pop" />
          }
        />
        <Route path="/tracker/membru/:id" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Ani' });
  await userEvent.click(
    within(dialog).getByRole('link', { name: 'Vezi trackerul' }),
  );
  expect(await screen.findByText('Trackerul membrului')).toBeVisible();
  expect(seen.at(-1)).toEqual({
    from: { to: '/voluntari?grup=8', label: 'Înapoi' },
  });
});

it('keeps a long Group Role inside the card: one shrinkable column, a truncated chip (N3)', async () => {
  answer({
    groups: [
      {
        id: 9,
        name: 'Balul Bobocilor',
        label: 'Balul Bobocilor · Evenimente și proiecte culturale',
        color: '#7500A0',
        roleLabel: 'Responsabil logistică, sponsorizări și voluntari',
        isPrivate: false,
      },
    ],
  });
  const dialog = await openCard();
  expect(dialog).toHaveClass('grid-cols-[minmax(0,1fr)]');
  const role = within(dialog).getByText(
    'Responsabil logistică, sponsorizări și voluntari',
  );
  expect(role).toHaveClass('truncate');
  expect(role.parentElement).toHaveClass('min-w-0', 'max-w-1/2');
  expect(role.parentElement).toHaveAttribute(
    'title',
    'Responsabil logistică, sponsorizări și voluntari',
  );
});

it('does not link to the page already open, so its back link never points at itself', async () => {
  capabilities.seeLeadership = true;
  capabilities.manageRoles = true;
  render(
    <MemoryRouter initialEntries={['/tracker/membru/m-1']}>
      <MemberName memberId="m-1" nickname="Ani" fullName="Ana Pop" />
    </MemoryRouter>,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Ani' });
  expect(
    within(dialog).queryByRole('link', { name: 'Vezi trackerul' }),
  ).toBeNull();
  expect(within(dialog).getByRole('link', { name: 'Editează' })).toBeVisible();
});
