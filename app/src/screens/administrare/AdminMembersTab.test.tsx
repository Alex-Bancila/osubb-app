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

it('lists every Member with Rol and Status, each opening their page', async () => {
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
  expect(
    within(row).getByRole('link', { name: 'Pagina membrului: Ștefi' }),
  ).toHaveAttribute('href', '/administrare/membri/stefan');
  expect((await axe.run(container)).violations).toEqual([]);

  // A click anywhere on the row opens the page too.
  await user.click(within(row).getByText('BCE'));
  expect(screen.getByTestId('where')).toHaveTextContent(
    '/administrare/membri/stefan',
  );
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
