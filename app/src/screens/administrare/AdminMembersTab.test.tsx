import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AppointableMember } from '../../queries/groups-admin';

const api = vi.hoisted(() => ({ capabilities: vi.fn(), members: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: api.capabilities,
}));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useAppointableMembers: api.members,
}));
vi.mock('./CsvImportPanel', () => ({
  CsvImportPanel: () => <h2>Import CSV</h2>,
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

function show() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/administrare/membri']}>
        <Routes>
          <Route path="/administrare/membri" element={<AdminMembersTab />} />
          <Route path="/administrare/membri/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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

it('shows the CSV import only to whoever may provision Members', () => {
  const view = show();
  expect(screen.getByRole('heading', { name: 'Import CSV' })).toBeVisible();
  view.unmount();

  api.capabilities.mockReturnValue({
    data: { manageRoles: true, provisionMembers: false },
  });
  show();
  expect(screen.queryByRole('heading', { name: 'Import CSV' })).toBeNull();
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
