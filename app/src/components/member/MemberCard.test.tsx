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
  university: null,
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

/** The one line under the name: Role chip, full name, "Membru din". */
function meta(dialog: HTMLElement) {
  return dialog.querySelector('[data-slot="member-card-meta"]') as HTMLElement;
}

it('shows the Nickname, then one line of Role, full name and a short join date, then the Groups', async () => {
  const dialog = await openCard();
  expect(hook).toHaveBeenCalledWith('m-1');
  expect(within(meta(dialog)).getByText('Ana Pop')).toBeVisible();
  expect(within(meta(dialog)).getByText('Voluntar Activ')).toHaveClass(
    'role-badge',
  );
  expect(meta(dialog)).toHaveTextContent('Membru din 12 mar. 2024');
  // No Universitate on the card: the line is as it was before R58.
  expect(meta(dialog)).not.toHaveTextContent('·');
  expect(dialog).not.toHaveTextContent('martie');
  // The line describes the sheet, whose title is the Member.
  expect(dialog).toHaveAccessibleDescription(
    'Voluntar Activ Ana Pop Membru din 12 mar. 2024',
  );
  // Every Group is listed below, so no "first Group + n" chip repeats one.
  expect(within(dialog).queryByText(/^\+\d/)).toBeNull();
  expect(within(dialog).getAllByText('Educațional')).toHaveLength(1);
  const groups = within(dialog).getByRole('region', { name: 'Grupuri' });
  expect(within(groups).getAllByRole('listitem')).toHaveLength(3);
  expect(groups).toHaveTextContent('Mentorat · Educațional');
  expect(groups).toHaveTextContent('Coordonator');
  expect(groups).toHaveTextContent('Responsabil logistică');
  // Small headings in sentence case: no uppercase micro-label.
  const heading = within(groups).getByRole('heading', { name: 'Grupuri' });
  expect(heading).toHaveAttribute('data-variant', 'label');
  expect(heading).not.toHaveClass('uppercase');
  expect((await axe.run(dialog)).violations).toEqual([]);
});

it('is a sheet: from the bottom on a phone, a right-hand panel from sm, closed from its header', async () => {
  const dialog = await openCard();
  expect(dialog).toHaveAttribute('data-slot', 'member-card');
  expect(dialog).toHaveAttribute('data-side', 'bottom');
  expect(dialog).toHaveClass('sm:max-w-md', 'rounded-t-2xl');
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Închide' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  ).toHaveFocus();
});

it('names a board member by their Board Title, with the Role beside it (#963)', async () => {
  answer({ roleLabel: 'Președinte', rankLabel: 'BC' });
  const dialog = await openCard();
  expect(within(meta(dialog)).getByText('Președinte')).toHaveClass(
    'role-badge',
  );
  expect(within(meta(dialog)).getByText('BC')).not.toHaveClass('role-badge');
  expect(dialog).toHaveAccessibleDescription(
    'Președinte BC Ana Pop Membru din 12 mar. 2024',
  );
});

it('says the Role once when there is no Board Title (#963)', async () => {
  answer({ roleLabel: 'BC', rankLabel: 'BC' });
  const dialog = await openCard();
  expect(within(meta(dialog)).getAllByText('BC')).toHaveLength(1);
  expect(dialog).toHaveAccessibleDescription(
    'BC Ana Pop Membru din 12 mar. 2024',
  );
});

it('marks a Private Group in the Groups list, and no public one (#757)', async () => {
  const dialog = await openCard();
  const groups = within(dialog).getByRole('region', { name: 'Grupuri' });
  const items = within(groups).getAllByRole('listitem');
  expect(within(items[2] as HTMLElement).getByText('Privat')).toBeVisible();
  expect(within(items[0] as HTMLElement).queryByText('Privat')).toBeNull();
  expect(within(items[1] as HTMLElement).queryByText('Privat')).toBeNull();
  // Nothing else in the card carries a lock.
  expect(within(dialog).getAllByText('Privat')).toHaveLength(1);
  expect((await axe.run(dialog)).violations).toEqual([]);
});

it('omits the join line when the date was never recorded, and draws no Group summary chip', async () => {
  answer({ joinedAt: null, primaryGroup: null, otherMemberships: 0 });
  const dialog = await openCard();
  expect(dialog).not.toHaveTextContent('Membru din');
  expect(within(dialog).queryByText(/^\+\d/)).toBeNull();
  expect(meta(dialog)).toHaveTextContent(/^Voluntar Activ Ana Pop$/);
});

it('appends the Universitate to the join line when the Member has one (R58)', async () => {
  answer({ university: 'Universitatea Babeș-Bolyai' });
  const dialog = await openCard();
  expect(meta(dialog)).toHaveTextContent(
    'Membru din 12 mar. 2024 · Universitatea Babeș-Bolyai',
  );
  expect(dialog).toHaveAccessibleDescription(
    'Voluntar Activ Ana Pop Membru din 12 mar. 2024 · Universitatea Babeș-Bolyai',
  );
});

it('names the Universitate alone when the join date was never recorded (R58)', async () => {
  answer({ joinedAt: null, university: 'Universitatea Sapientia' });
  const dialog = await openCard();
  expect(dialog).not.toHaveTextContent('Membru din');
  expect(meta(dialog)).toHaveTextContent(
    /^Voluntar Activ Ana Pop Universitatea Sapientia$/,
  );
  // The line is never the empty-card fallback while it says something.
  expect(dialog).not.toHaveTextContent('Profil de membru');
});

it('shows contact only when member_contacts returned a row', async () => {
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
  const email = within(contact).getByRole('link', { name: 'ana@osubb.ro' });
  expect(email).toHaveAttribute('href', 'mailto:ana@osubb.ro');
  const phone = within(contact).getByRole('link', { name: '+40700000000' });
  expect(phone).toHaveAttribute('href', 'tel:+40700000000');
  // Facts as icon + value rows in the text colour, each a 44 px target.
  for (const fact of [email, phone]) {
    expect(fact).toHaveClass('text-foreground', 'min-h-11');
    expect(fact.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  }
});

it('offers no links without the capabilities', async () => {
  const dialog = await openCard();
  expect(within(dialog).queryByRole('link')).toBeNull();
});

it('links to the tracker for leadership viewers and to Administrare for manageRoles', async () => {
  capabilities.seeLeadership = true;
  let dialog = await openCard();
  const tracker = within(dialog).getByRole('link', { name: 'Vezi trackerul' });
  expect(tracker).toHaveAttribute('href', '/tracker/membru/m-1');
  // The one link offered is the filled one, pinned at the sheet's foot.
  expect(tracker).toHaveClass('bg-primary');
  expect(tracker.closest('[data-slot="sheet-footer"]')).toHaveAttribute(
    'data-pinned',
    'true',
  );
  expect(tracker.querySelector('svg')).not.toBeNull();
  expect(within(dialog).queryByRole('link', { name: 'Editează' })).toBeNull();

  await closeCard();
  capabilities.seeLeadership = false;
  capabilities.manageRoles = true;
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ani' }),
  );
  dialog = await screen.findByRole('dialog', { name: 'Ani' });
  const edit = within(dialog).getByRole('link', { name: 'Editează' });
  expect(edit).toHaveAttribute('href', '/administrare/membri/m-1');
  expect(edit).toHaveClass('bg-primary');
  expect(
    within(dialog).queryByRole('link', { name: 'Vezi trackerul' }),
  ).toBeNull();
});

it('fills one button only: the tracker is the primary, the member page outline before it', async () => {
  capabilities.seeLeadership = true;
  capabilities.manageRoles = true;
  const dialog = await openCard();
  const links = within(
    within(dialog).getByRole('navigation', { name: 'Acțiuni pentru membru' }),
  ).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual([
    'Editează',
    'Vezi trackerul',
  ]);
  expect(links[0]).not.toHaveClass('bg-primary');
  expect(links[1]).toHaveClass('bg-primary');
  expect((await axe.run(dialog)).violations).toEqual([]);
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

it('shows a long Group name and Group Role whole: they wrap, nothing is cut (N3)', async () => {
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
  const name = within(dialog).getByText(
    'Balul Bobocilor · Evenimente și proiecte culturale',
  );
  const role = within(dialog).getByText(
    'Responsabil logistică, sponsorizări și voluntari',
  );
  expect(name).toHaveClass('wrap-anywhere');
  expect(name).not.toHaveClass('truncate');
  expect(role).toHaveClass('whitespace-normal', 'max-w-full');
  expect(role).not.toHaveClass('truncate');
  expect(dialog.querySelector('.truncate')).toBeNull();
  // The role drops under the name where the two do not fit on one row.
  expect(role.closest('li')).toHaveClass('flex-wrap', 'min-w-0');
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
