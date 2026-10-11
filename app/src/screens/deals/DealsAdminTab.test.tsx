import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { Fragment } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FabActions } from '../../components/layout';
import type { RawDealRow } from '../../queries/deals';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

const viewer = vi.hoisted(() => ({ caps: {} as Record<string, boolean> }));

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

/** In Administrare the tab sits in the layout's `FabActions`. */
function renderTab({ fab = false } = {}) {
  const Frame = fab ? FabActions : Fragment;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/administrare/deals']}>
        <Frame>
          <DealsAdminTab />
        </Frame>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = (name: string) => screen.findByRole('article', { name });

beforeEach(() => {
  resetSupabaseMock();
  supabaseMock.order.mockResolvedValue({ data: ROWS, error: null });
  supabaseMock.rpc.mockResolvedValue({ data: 3, error: null });
});

describe('Administrare › OSUBB Deals (R44)', () => {
  it('lists every Deal, expired ones marked, with the active/expired count', async () => {
    viewer.caps = { manageDeals: true, manageDealsTeam: true };
    renderTab();
    const expired = await card('Expirat de la Coordonator');
    // The Termen row is the expired mark; no badge repeats it.
    expect(within(expired).getByText(/Termen expirat/)).toBeVisible();
    expect(within(expired).queryByText('Expirat')).toBeNull();
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
    const alone = renderTab();
    await card('Al meu');
    expect(screen.getByRole('button', { name: 'Deal nou' })).toBeVisible();
    alone.unmount();

    // In Administrare it is the page's plus button, not a header button.
    renderTab({ fab: true });
    await card('Al meu');
    expect(screen.getByRole('button', { name: 'Deal nou' })).toHaveAttribute(
      'data-slot',
      'fab',
    );
  });

  it('gives the Moderator, with every Atribuție power, Deal nou, Editează and Șterge (R44 amended)', async () => {
    // The Moderator's live capability row: the holder's powers, not the holder.
    viewer.caps = {
      manageRoles: true,
      administer: true,
      administerBc: true,
      manageDeals: true,
      manageDealsTeam: true,
      pickDealsCoordinator: true,
    };
    renderTab();
    const other = await card('Expirat de la Coordonator');
    expect(
      within(other).getByRole('button', { name: /Editează/ }),
    ).toBeVisible();
    expect(within(other).getByRole('button', { name: /Șterge/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deal nou' })).toBeVisible();
    // Both sit in the card's footer row, not mid-card; the title opens it.
    const footer = other.querySelector<HTMLElement>(
      '[data-slot="card-footer"]',
    );
    expect(footer).not.toBeNull();
    if (!footer) return;
    expect(
      within(footer).getByRole('button', { name: /Editează/ }),
    ).toBeVisible();
    expect(
      within(footer).getByRole('button', { name: /Șterge/ }),
    ).toBeVisible();
    expect(
      within(other).getByRole('button', { name: /Citește deal-ul/ }),
    ).toBeVisible();
  });

  it('keeps a BC member who does not hold it to Șterge, with no Deal nou', async () => {
    viewer.caps = { manageRoles: true, administer: true };
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
