import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AppointableMember } from '../../queries/groups-admin';

const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  members: vi.fn(),
  uninvited: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: api.capabilities,
}));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useAppointableMembers: api.members,
}));
vi.mock('../../queries/volunteer-import', async (original) => ({
  ...(await original<object>()),
  useUninvitedMembers: api.uninvited,
}));
vi.mock('./UninvitedGrid', () => ({
  UninvitedGrid: () => <p>Grila „De invitat”</p>,
}));
vi.mock('./CsvImportDialog', () => ({
  CsvImportDialog: ({ onShowUninvited }: { onShowUninvited?: () => void }) => (
    <button type="button" className="w-full" onClick={onShowUninvited}>
      Import CSV
    </button>
  ),
}));
vi.mock('./InviteMemberDialog', () => ({
  InviteMemberDialog: ({
    onInvited,
  }: {
    onInvited: (member: object) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onInvited({ userId: 'ana', email: 'ana@osubb.ro', name: 'Ana Pop' })
      }
    >
      Invită membru
    </button>
  ),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
import AdminMembersTab from './AdminMembersTab';

function member(
  memberId: string,
  name: string,
  extra: Partial<AppointableMember> = {},
): AppointableMember {
  return {
    memberId,
    name,
    nickname: null,
    avatarColor: null,
    status: 'activ',
    roleId: 'voluntar',
    roleLabel: 'Voluntar',
    level: 1,
    ...extra,
  };
}

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function Search() {
  const { search } = useLocation();
  return <p data-testid="search">{search}</p>;
}

function show(entry = '/administrare/membri') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/administrare/membri"
            element={
              <>
                <AdminMembersTab />
                <Search />
              </>
            }
          />
          <Route path="/administrare/membri/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.uninvited.mockReturnValue({ data: [] });
  api.capabilities.mockReturnValue({
    data: { manageRoles: true, provisionMembers: true },
  });
  api.members.mockReturnValue({
    isPending: false,
    isError: false,
    data: [
      member('ana', 'Ana Pop'),
      member('stefan', 'Ștefan Moldovan', {
        nickname: 'Ștefi',
        roleLabel: 'BCE',
        status: 'inactiv',
      }),
    ],
  });
});

it('lists every Member with Rol and Status, the row opening their page', async () => {
  const user = userEvent.setup();
  const { container } = show();
  const panel = screen.getByRole('region', { name: 'Membri' });
  expect(
    within(panel).getByRole('button', { name: 'Profilul membrului Ștefi' }),
  ).toBeVisible();
  const row = within(panel)
    .getByRole('button', { name: 'Profilul membrului Ștefi' })
    .closest('tr') as HTMLElement;
  expect(row).toHaveTextContent('BCE');
  expect(row).toHaveTextContent('Inactiv');
  // One visible affordance per row: no "Pagina membrului" column (B62); the
  // keyboard gets a link that shows only when focused.
  const keyboard = within(row).getByRole('link', {
    name: 'Deschide pagina membrului Ștefi',
  });
  expect(keyboard).toHaveAttribute('href', '/administrare/membri/stefan');
  expect(keyboard).toHaveClass('sr-only', 'focus-visible:not-sr-only');
  expect(within(panel).getAllByRole('link')).toHaveLength(2);
  expect(
    within(panel).queryByRole('columnheader', { name: /Pagina membrului/ }),
  ).toBeNull();
  expect((await axe.run(container)).violations).toEqual([]);

  // A click anywhere on the row opens the page too.
  await user.click(within(row).getByText('Inactiv'));
  expect(screen.getByTestId('where')).toHaveTextContent(
    '/administrare/membri/stefan',
  );
});

it('names a board member by their Board Title in Rol, still sorted by rank (#963)', async () => {
  const user = userEvent.setup();
  api.members.mockReturnValue({
    isPending: false,
    isError: false,
    data: [
      member('cristina', 'Cristina Șerban', {
        roleId: 'bc',
        roleLabel: 'Președinte',
        level: 6,
      }),
      member('ana', 'Ana Pop'),
      member('alex', 'Alex Băncilă', {
        roleId: 'bce',
        roleLabel: 'Coordonator IT',
        level: 5,
      }),
    ],
  });
  show();
  const panel = screen.getByRole('region', { name: 'Membri' });
  const row = within(panel)
    .getByRole('button', { name: 'Profilul membrului Cristina Șerban' })
    .closest('tr') as HTMLElement;
  expect(row).toHaveTextContent('Președinte');
  await user.click(
    screen.getByRole('button', { name: 'Sortează Rol crescător' }),
  );
  // By rank — Voluntar, BCE, BC — never by the title's alphabet.
  expect(
    within(panel)
      .getAllByRole('button', { name: /^Profilul membrului / })
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual([
    'Profilul membrului Ana Pop',
    'Profilul membrului Alex Băncilă',
    'Profilul membrului Cristina Șerban',
  ]);
});

it('shows Status only when a Member who is not active is listed (B62)', () => {
  api.members.mockReturnValue({
    isPending: false,
    isError: false,
    data: [member('ana', 'Ana Pop'), member('ion', 'Ion Rus')],
  });
  show();
  expect(
    screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent?.trim()),
  ).toEqual([
    expect.stringContaining('Membru'),
    expect.stringContaining('Rol'),
  ]);
});

it('folds Rol under the name on a phone and keeps the search full width (AD1)', () => {
  show();
  const [name, role, status] = screen.getAllByRole('columnheader');
  expect(name).toHaveClass('min-w-40');
  expect(role).toHaveClass('max-sm:hidden');
  expect(status).toHaveClass('max-sm:hidden');
  const row = screen
    .getByRole('button', { name: 'Profilul membrului Ștefi' })
    .closest('td') as HTMLElement;
  // Rol, and a status other than Activ, fold under the name on a phone.
  expect(within(row).getByText('BCE · Inactiv')).toHaveClass('sm:hidden');
  expect(screen.getByLabelText('Caută un membru')).toHaveClass('w-full');
});

it('finds a Member by name, blind to case and diacritics, and says when none matches', async () => {
  const user = userEvent.setup();
  show();
  const search = screen.getByLabelText('Caută un membru');
  await user.type(search, 'stefan');
  expect(screen.queryByRole('button', { name: /Ana Pop/ })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Profilul membrului Ștefi' }),
  ).toBeVisible();
  await user.clear(search);
  await user.type(search, 'zzz');
  expect(screen.getByText('Niciun membru găsit.')).toBeVisible();
});

/* #949: the two ways a Member comes in sit together, as a matched pair, in
   the Membri header — not the CSV import in a panel of its own. */
it('pairs "Invită membru" with "Import CSV" in the Membri header, for whoever may provision', () => {
  const view = show();
  const panel = screen.getByRole('region', { name: 'Membri' });
  const pair = within(panel).getByRole('group', { name: 'Adaugă membri' });
  expect(pair).toHaveClass('grid', 'grid-cols-2');
  expect(
    within(pair)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Invită membru', 'Import CSV']);
  expect(pair.closest('[data-slot=section-header]')).not.toBeNull();
  expect(screen.getAllByRole('region')).toHaveLength(1);
  view.unmount();

  api.capabilities.mockReturnValue({
    data: { manageRoles: true, provisionMembers: false },
  });
  show();
  expect(screen.queryByRole('group', { name: 'Adaugă membri' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Import CSV' })).toBeNull();
});

/* Audit D-13: Rol sorts by rank, not alphabetically (BC, BCE, Moderator…). */
it('sorts Rol by the Role level, then by name, both ways', async () => {
  const user = userEvent.setup();
  api.members.mockReturnValue({
    isPending: false,
    isError: false,
    data: [
      member('bc', 'Bogdan BC', { roleLabel: 'BC', level: 6 }),
      member('bce', 'Bianca BCE', { roleLabel: 'BCE', level: 5 }),
      member('rec', 'Radu Recrut', { roleLabel: 'Recrut', level: 0 }),
      member('vb', 'Vlad Voluntar', { roleLabel: 'Voluntar', level: 1 }),
      member('va', 'Ana Voluntar', { roleLabel: 'Voluntar', level: 1 }),
    ],
  });
  show();
  const names = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent);

  await user.click(
    screen.getByRole('button', { name: 'Sortează Rol crescător' }),
  );
  expect(names()).toEqual(['Recrut', 'Voluntar', 'Voluntar', 'BCE', 'BC']);
  expect(screen.getAllByRole('row')[2]).toHaveTextContent('Ana Voluntar');

  await user.click(
    screen.getByRole('button', { name: 'Sortează Rol descrescător' }),
  );
  expect(names()).toEqual(['BC', 'BCE', 'Voluntar', 'Voluntar', 'Recrut']);
});

/* #931: "Invită membru" sits on the Membri panel for whoever may provision. */
it('offers "Invită membru" only to whoever may provision Members', () => {
  const view = show();
  const panel = screen.getByRole('region', { name: 'Membri' });
  expect(
    within(panel).getByRole('button', { name: 'Invită membru' }),
  ).toBeVisible();
  view.unmount();

  api.capabilities.mockReturnValue({
    data: { manageRoles: true, provisionMembers: false },
  });
  show();
  expect(screen.queryByRole('button', { name: 'Invită membru' })).toBeNull();
});

it('confirms a sent invitation and marks the new Member in the list', async () => {
  const user = userEvent.setup();
  show();
  expect(screen.queryByText('Invitație trimisă')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Invită membru' }));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Invitația a fost trimisă la ana@osubb.ro. Membrul apare în listă cu „Invitație trimisă”; intră în aplicație când deschide linkul din email.',
  );
  const row = screen
    .getByRole('button', { name: /Ana Pop/ })
    .closest('tr') as HTMLElement;
  expect(within(row).getByText('Invitație trimisă')).toBeVisible();
  const other = screen
    .getByRole('button', { name: 'Profilul membrului Ștefi' })
    .closest('tr') as HTMLElement;
  expect(within(other).queryByText('Invitație trimisă')).toBeNull();
});

it('switches to "De invitat" and back, the view kept in the URL (#992)', async () => {
  const user = userEvent.setup();
  api.uninvited.mockReturnValue({
    data: [{ memberId: 'x' }, { memberId: 'y' }],
  });
  show();
  const panel = screen.getByRole('region', { name: 'Membri' });
  const views = within(panel).getByRole('group', { name: 'Vizualizare' });
  expect(within(views).getByRole('button', { name: 'Toți' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await user.click(
    within(views).getByRole('button', { name: 'De invitat (2)' }),
  );
  expect(screen.getByText('Grila „De invitat”')).toBeVisible();
  expect(screen.getByTestId('search')).toHaveTextContent('?vedere=de-invitat');
  // The Members list is not rendered under the grid.
  expect(within(panel).queryByLabelText('Caută un membru')).toBeNull();

  await user.click(within(views).getByRole('button', { name: 'Toți' }));
  expect(screen.getByTestId('search')).toBeEmptyDOMElement();
  expect(within(panel).getByLabelText('Caută un membru')).toBeVisible();
  // Kept mounted but hidden, so a sending run keeps its progress.
  expect(screen.getByText('Grila „De invitat”')).not.toBeVisible();
});

it('opens on "De invitat" from the URL, and the import leads there', async () => {
  const user = userEvent.setup();
  show('/administrare/membri?vedere=de-invitat');
  expect(screen.getByText('Grila „De invitat”')).toBeVisible();
  await user.click(
    within(screen.getByRole('group', { name: 'Vizualizare' })).getByRole(
      'button',
      { name: 'Toți' },
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Import CSV' }));
  expect(screen.getByText('Grila „De invitat”')).toBeVisible();
});

it('never offers "De invitat" to a viewer who may not provision, whatever the URL says', () => {
  api.capabilities.mockReturnValue({
    data: { manageRoles: true, provisionMembers: false },
  });
  show('/administrare/membri?vedere=de-invitat');
  expect(screen.queryByRole('group', { name: 'Vizualizare' })).toBeNull();
  expect(screen.queryByText('Grila „De invitat”')).toBeNull();
  // The read is not even asked for.
  expect(api.uninvited).toHaveBeenCalledWith(false);
});
