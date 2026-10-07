import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawDealRow } from '../../queries/deals';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

const viewer = vi.hoisted(() => ({ caps: {} as Record<string, boolean> }));
// The Administrare header's action slot, where "Deal nou" is portalled.
const slot = vi.hoisted(() => ({ el: null as HTMLElement | null }));

vi.mock('../../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../../test/supabase-mock')
  >('../../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: () => ({ data: viewer.caps }),
  useCapability: (name: string) => ({ data: viewer.caps[name] === true }),
}));
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: () => ({ data: undefined }),
}));
vi.mock('../../queries/my-groups', () => ({
  useMyGroupRoles: () => ({ data: [] }),
}));
vi.mock('../../queries/reference', () => ({
  useGroups: () => ({ data: new Map() }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
// The team has its own suite (DealsTeamPanel.test.tsx).
vi.mock('./DealsTeamPanel', () => ({ DealsTeamPanel: () => null }));
vi.mock('../administrare/administrare-tabs', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../administrare/administrare-tabs')
  >()),
  useAdministrareActionSlot: () => slot.el,
}));

import DealsAdminTab from './DealsAdminTab';

function deal(overrides: Partial<RawDealRow>): RawDealRow {
  return {
    id: 1,
    title: 'Deal',
    body: 'Detalii.',
    group_id: 1,
    published_at: '2026-10-07T10:00:00Z',
    deadline: null,
    created_by: 'someone',
    kind: 'deal',
    code: null,
    links: [],
    announcement_reads: [],
    deal_code_reveals: [],
    ...overrides,
  };
}

const ROWS = [
  deal({ id: 1, title: 'Al meu', created_by: 'me', code: 'MINE' }),
  deal({
    id: 2,
    title: 'Expirat de la Coordonator',
    created_by: 'coord',
    deadline: '2026-01-01T00:00:00Z',
    published_at: '2026-01-01T00:00:00Z',
  }),
];

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/administrare/deals']}>
        <DealsAdminTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = (name: string) => screen.findByRole('article', { name });

beforeEach(() => {
  slot.el?.remove();
  slot.el = document.body.appendChild(document.createElement('div'));
  resetSupabaseMock();
  supabaseMock.order.mockResolvedValue({ data: ROWS, error: null });
  supabaseMock.rpc.mockResolvedValue({ data: 3, error: null });
});

describe('Administrare › OSUBB Deals (R44)', () => {
  it('lists every Deal, expired ones marked, with the active/expired count', async () => {
    viewer.caps = { manageDeals: true, manageDealsTeam: true };
    renderTab();
    const expired = await card('Expirat de la Coordonator');
    expect(within(expired).getByText('Expirat')).toBeVisible();
    expect(screen.getByText('1 active · 1 expirate')).toBeVisible();
  });

  it('lets the holder and the Coordonator edit and delete every Deal', async () => {
    viewer.caps = { manageDeals: true, manageDealsTeam: true };
    renderTab();
    const other = await card('Expirat de la Coordonator');
    expect(
      within(other).getByRole('button', { name: /Editează/ }),
    ).toBeVisible();
    expect(within(other).getByRole('button', { name: /Șterge/ })).toBeVisible();
  });

  it('lets the Responsabil manage their own Deals only', async () => {
    viewer.caps = { manageDeals: true };
    renderTab();
    const mine = await card('Al meu');
    expect(
      within(mine).getByRole('button', { name: /Editează/ }),
    ).toBeVisible();
    expect(within(mine).getByRole('button', { name: /Șterge/ })).toBeVisible();
    const other = screen.getByRole('article', {
      name: 'Expirat de la Coordonator',
    });
    expect(
      within(other).queryByRole('button', { name: /Editează/ }),
    ).toBeNull();
    expect(within(other).queryByRole('button', { name: /Șterge/ })).toBeNull();
  });

  it('gives BC and the Moderator Șterge only, and no Deal nou', async () => {
    viewer.caps = { manageRoles: true };
    renderTab();
    const other = await card('Expirat de la Coordonator');
    expect(within(other).getByRole('button', { name: /Șterge/ })).toBeVisible();
    expect(
      within(other).queryByRole('button', { name: /Editează/ }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deal nou' })).toBeNull();
  });

  it('offers Deal nou to the team', async () => {
    viewer.caps = {
      manageDeals: true,
      manageDealsTeam: true,
      pickDealsCoordinator: true,
    };
    renderTab();
    await card('Al meu');
    expect(screen.getByRole('button', { name: 'Deal nou' })).toBeVisible();
  });

  it('gives the Moderator, who picks the team, no Deal nou and no Editează (R44 amended)', async () => {
    viewer.caps = {
      manageRoles: true,
      administer: true,
      administerBc: true,
      manageDealsTeam: true,
      pickDealsCoordinator: true,
    };
    renderTab();
    const other = await card('Expirat de la Coordonator');
    expect(within(other).getByRole('button', { name: /Șterge/ })).toBeVisible();
    expect(
      within(other).queryByRole('button', { name: /Editează/ }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deal nou' })).toBeNull();
  });

  it('shows the team how many members opened a code', async () => {
    viewer.caps = { manageDeals: true };
    renderTab();
    const mine = await card('Al meu');
    expect(
      await within(mine).findByText('Codul a fost deschis de 3 membri'),
    ).toBeVisible();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('deal_code_reveal_count', {
      p_announcement_id: 1,
    });
  });
});
