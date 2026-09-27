import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ManagedGroupApplication } from '../../queries/group-applications';

const api = vi.hoisted(() => ({ applications: vi.fn(), mutate: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/group-applications', async (original) => ({
  ...(await original<object>()),
  useManagedGroupApplications: api.applications,
  useApplicationCommand: () => ({
    mutateAsync: api.mutate,
    isPending: false,
  }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
import AdminApplicationsTab from './AdminApplicationsTab';

function application(
  id: number,
  name: string,
  group: string,
  groupId: number,
): ManagedGroupApplication {
  return {
    id,
    group_id: groupId,
    member_id: `m-${id}`,
    status: 'pending',
    note: id === 1 ? 'Vreau să ajut la evenimente.' : null,
    created_at: '2026-09-20T10:00:00Z',
    decided_at: null,
    decided_by: null,
    decision_note: null,
    member: { memberId: `m-${id}`, fullName: name, nickname: null },
    group: { id: groupId, name: group },
  } as ManagedGroupApplication;
}

function show() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AdminApplicationsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.mutate.mockReset();
  api.mutate.mockResolvedValue({ id: 1, status: 'accepted' });
});

it('lists the pending Applications of every managed Group, each with its Group', async () => {
  api.applications.mockReturnValue({
    isPending: false,
    isError: false,
    data: [
      application(1, 'Ana Pop', 'Logistică', 2),
      application(2, 'Dan Ionescu', 'Foto', 5),
    ],
  });
  const { container } = show();
  const list = screen.getByRole('list', { name: 'Cereri de aderare' });
  const [ana, dan] = within(list).getAllByRole('listitem') as [
    HTMLElement,
    HTMLElement,
  ];
  expect(
    within(ana).getByRole('button', { name: 'Profilul membrului Ana Pop' }),
  ).toBeVisible();
  expect(within(ana).getByRole('link', { name: 'Logistică' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/2',
  );
  expect(ana).toHaveTextContent('Vreau să ajut la evenimente.');
  expect(within(dan).getByRole('link', { name: 'Foto' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/5',
  );
  expect((await axe.run(container)).violations).toEqual([]);
});

it.each([
  ['Acceptă', true],
  ['Respinge', false],
])(
  'decides an Application with %s through the shared command',
  async (label, accept) => {
    const user = userEvent.setup();
    api.applications.mockReturnValue({
      isPending: false,
      isError: false,
      data: [application(1, 'Ana Pop', 'Logistică', 2)],
    });
    show();
    await user.click(screen.getByRole('button', { name: label }));
    const dialog = await screen.findByRole('dialog', { name: label });
    await user.click(within(dialog).getByRole('button', { name: 'Confirmă' }));
    expect(api.mutate).toHaveBeenCalledWith({
      kind: 'decide',
      applicationId: 1,
      accept,
      note: '',
    });
    expect(
      await screen.findAllByText('Cererea a fost actualizată.'),
    ).not.toHaveLength(0);
  },
);

it('says so when nothing waits', () => {
  api.applications.mockReturnValue({
    isPending: false,
    isError: false,
    data: [],
  });
  show();
  expect(
    screen.getByText('Nicio cerere de aderare în așteptare.'),
  ).toBeVisible();
});

it('offers a retry when the queue cannot be read', () => {
  const refetch = vi.fn();
  api.applications.mockReturnValue({
    isPending: false,
    isError: true,
    data: undefined,
    refetch,
  });
  show();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Nu am putut încărca cererile.',
  );
});
