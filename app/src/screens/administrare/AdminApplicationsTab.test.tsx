import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

// #1012 (R37): opening a thing reads its Notifications. The hook is observed
// here; its own behaviour is covered in queries/notifications-read.test.tsx.
const readNotificationsAbout = vi.hoisted(() => vi.fn());
vi.mock('../../queries/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/notifications')>()),
  useReadNotificationsAbout: readNotificationsAbout,
}));
import type { ManagedGroupApplication } from '../../queries/group-applications';

const api = vi.hoisted(() => ({
  applications: vi.fn(),
  mutate: vi.fn(),
  myGroups: vi.fn(),
  groups: vi.fn(),
  decidesEverywhere: { value: false },
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: (
    select?: (capabilities: { createTopLevelGroups: boolean }) => unknown,
  ) => {
    const capabilities = {
      createTopLevelGroups: api.decidesEverywhere.value,
    };
    return { data: select ? select(capabilities) : capabilities };
  },
}));
vi.mock('../../queries/group-applications', async (original) => ({
  ...(await original<object>()),
  useManagedGroupApplications: api.applications,
  useApplicationCommand: () => ({
    mutateAsync: api.mutate,
    isPending: false,
  }),
}));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useMyGroupRoles: api.myGroups,
  useAdminGroups: api.groups,
}));
vi.mock('../../queries/reference', () => ({
  // The viewer's own roster rows: the positions held here, not above.
  useMyGroups: () => ({
    membershipRows: [
      { group_id: 2, group_role: 'responsible', position_title: null },
      { group_id: 1, group_role: 'manager', position_title: null },
    ],
  }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
import AdminApplicationsTab from './AdminApplicationsTab';

/** 1 Diverse ⊃ 3 Echipa IT (inherited); 2 Logistică; 5 Foto (not led). */
const GROUPS = [
  { id: 1, name: 'Diverse', color: '#5C5C61', path: [1], parent_id: null },
  { id: 2, name: 'Logistică', color: '#F2A700', path: [2], parent_id: null },
  { id: 3, name: 'Echipa IT', color: null, path: [1, 3], parent_id: 1 },
  { id: 5, name: 'Foto', color: '#7500A0', path: [5], parent_id: null },
].map((group) => ({ ...group, manager_title: null, status: 'active' }));

function mine(id: number, group_role: string, explicit: boolean) {
  const group = GROUPS.find((row) => row.id === id);
  return { ...group, group_role, explicit, automatic: false };
}

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

function show(path = '/administrare/cereri') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AdminApplicationsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function queue(data: ManagedGroupApplication[]) {
  api.applications.mockReturnValue({ isPending: false, isError: false, data });
}

beforeEach(() => {
  api.mutate.mockReset();
  api.mutate.mockResolvedValue({ id: 1, status: 'accepted' });
  api.decidesEverywhere.value = false;
  // A leader: Manager of Diverse (so of Echipa IT below it, inherited) and
  // Responsabil of Logistică.
  api.myGroups.mockReturnValue({
    isPending: false,
    isError: false,
    data: [
      mine(1, 'manager', true),
      mine(3, 'manager', false),
      mine(2, 'responsible', true),
    ],
  });
  api.groups.mockReturnValue({
    isPending: false,
    isError: false,
    data: GROUPS,
  });
});

it('heads each Group’s Applications with the Group, not a small line in every row', async () => {
  queue([
    application(1, 'Ana Pop', 'Logistică', 2),
    application(2, 'Dan Ionescu', 'Echipa IT', 3),
  ]);
  const { container } = show();
  const logistica = screen.getByRole('region', { name: 'Logistică' });
  expect(
    within(logistica).getByRole('heading', { level: 2, name: 'Logistică' }),
  ).toBeVisible();
  // The colour mark sits in the heading, at the Group's colour.
  expect(logistica.querySelector('[data-slot=group-swatch]')).toHaveStyle({
    backgroundColor: '#F2A700',
  });
  expect(
    within(logistica).getByRole('link', { name: /Deschide grupul/ }),
  ).toHaveAttribute(
    'href',
    // Straight to the Group's Cereri tab (navigation D6).
    '/administrare/grupuri/2?tab=cereri',
  );
  const [ana] = within(
    within(logistica).getByRole('list', {
      name: 'Cereri de aderare · Logistică',
    }),
  ).getAllByRole('listitem') as [HTMLElement];
  expect(
    within(ana).getByRole('button', { name: 'Profilul membrului Ana Pop' }),
  ).toBeVisible();
  expect(ana).toHaveTextContent('Vreau să ajut la evenimente.');
  // The row does not repeat the Group.
  expect(within(ana).queryByText(/Logistică/)).toBeNull();
  // A subgroup names its parent after its own name.
  expect(
    screen.getByRole('heading', { level: 2, name: 'Echipa IT · Diverse' }),
  ).toBeVisible();
  expect((await axe.run(container)).violations).toEqual([]);
});

it('lists every Group the leader leads — inherited ones and those with 0 requests too', () => {
  queue([application(1, 'Ana Pop', 'Logistică', 2)]);
  show();
  const nav = screen.getByRole('navigation', { name: 'Grupurile tale' });
  const links = within(nav).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual([
    'Toate11 cerere',
    'DiverseCoordonator00 cereri',
    'Echipa IT · DiverseCoordonator · din grupul de deasupra00 cereri',
    'LogisticăResponsabil11 cerere',
  ]);
  expect(links[0]).toHaveAttribute('aria-current', 'page');
  expect(links[3]).toHaveAttribute('href', '/administrare/cereri?grup=2');
});

it('shows one Group’s Applications under ?grup=, and says when it has none', () => {
  queue([
    application(1, 'Ana Pop', 'Logistică', 2),
    application(2, 'Dan Ionescu', 'Echipa IT', 3),
  ]);
  const { unmount } = show('/administrare/cereri?grup=3');
  expect(
    screen.getByRole('link', { name: /^Echipa IT/, current: 'page' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Profilul membrului Dan Ionescu' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Profilul membrului Ana Pop' }),
  ).toBeNull();
  // #1012 (R37): only the Applications on screen are read.
  expect(readNotificationsAbout).toHaveBeenLastCalledWith([
    'group_application:2',
  ]);
  unmount();

  show('/administrare/cereri?grup=1');
  expect(readNotificationsAbout).toHaveBeenLastCalledWith([]);
  expect(
    screen.getByRole('heading', { level: 2, name: 'Diverse' }),
  ).toBeVisible();
  expect(
    screen.getByText('Nicio cerere în așteptare pentru acest grup.'),
  ).toBeVisible();
});

it('ignores a ?grup= outside the list and shows every section', () => {
  queue([application(1, 'Ana Pop', 'Logistică', 2)]);
  show('/administrare/cereri?grup=99');
  expect(screen.getByRole('link', { name: /^Toate/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(
    screen.getByRole('button', { name: 'Profilul membrului Ana Pop' }),
  ).toBeVisible();
});

it('lets BC and the Moderator see every Group with a pending Application', () => {
  api.decidesEverywhere.value = true;
  api.myGroups.mockReturnValue({ isPending: false, isError: false, data: [] });
  queue([
    application(1, 'Ana Pop', 'Logistică', 2),
    application(2, 'Dan Ionescu', 'Foto', 5),
  ]);
  show();
  const nav = screen.getByRole('navigation', { name: 'Grupuri' });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['Toate22 cereri', 'Logistică11 cerere', 'Foto11 cerere']);
  expect(screen.getByRole('heading', { level: 2, name: 'Foto' })).toBeVisible();
  expect(
    screen.getByRole('heading', { level: 2, name: 'Logistică' }),
  ).toBeVisible();
});

it('drops the list for a single Group and puts the role and count under its name', () => {
  api.myGroups.mockReturnValue({
    isPending: false,
    isError: false,
    data: [mine(2, 'responsible', true)],
  });
  queue([application(1, 'Ana Pop', 'Logistică', 2)]);
  show();
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.getByRole('region', { name: 'Logistică' })).toHaveTextContent(
    'Responsabil · 1 cerere',
  );
});

it.each([
  ['Acceptă', true],
  ['Respinge', false],
])(
  'decides an Application with %s through the shared command',
  async (label, accept) => {
    const user = userEvent.setup();
    queue([application(1, 'Ana Pop', 'Logistică', 2)]);
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
  queue([]);
  show();
  expect(
    screen.getByText('Nicio cerere de aderare în așteptare.'),
  ).toBeVisible();
});

it('offers a retry when the queue cannot be read', () => {
  api.applications.mockReturnValue({
    isPending: false,
    isError: true,
    data: undefined,
    refetch: vi.fn(),
  });
  show();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Nu am putut încărca cererile.',
  );
});
