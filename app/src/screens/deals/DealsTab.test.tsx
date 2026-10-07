import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);

import DealsTab from './DealsTab';

function deal(overrides: Partial<RawDealRow>): RawDealRow {
  return {
    id: 1,
    title: 'Deal',
    body: 'Detalii.',
    group_id: 1,
    published_at: '2026-10-07T10:00:00Z',
    deadline: null,
    created_by: 'author',
    kind: 'deal',
    code: null,
    links: [],
    announcement_reads: [],
    deal_code_reveals: [],
    ...overrides,
  };
}

const ROWS = [
  deal({
    id: 1,
    title: 'Reducere la cafenea',
    published_at: '2026-10-05T10:00:00Z',
    code: 'CAFE10',
    links: [{ label: 'Meniu', url: 'https://cafe.example.ro' }],
  }),
  deal({
    id: 2,
    title: 'Bilete la festival',
    published_at: '2026-10-06T10:00:00Z',
  }),
  // Past its Termen: the server sends it to the team only, and the tab
  // never shows it.
  deal({
    id: 3,
    title: 'Ofertă expirată',
    deadline: '2026-01-01T00:00:00Z',
  }),
];

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <DealsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetSupabaseMock();
  viewer.caps = {};
  supabaseMock.order.mockResolvedValue({ data: ROWS, error: null });
  supabaseMock.upsert.mockResolvedValue({ error: null });
});

describe('Anunțuri › OSUBB Deals (R45)', () => {
  it('lists the active Deals newest first, never an expired one', async () => {
    renderAt('/anunturi/deals');
    const list = await screen.findByRole('list', { name: 'Deal-uri OSUBB' });
    const titles = within(list)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(['Bilete la festival', 'Reducere la cafenea']);
    expect(screen.queryByText('Ofertă expirată')).toBeNull();
    expect(supabaseMock.eq).toHaveBeenCalledWith('kind', 'deal');
  });

  it('gives a Deal with a code its hidden stub, and one without none', async () => {
    renderAt('/anunturi/deals');
    const cafe = await screen.findByRole('article', {
      name: 'Reducere la cafenea',
    });
    expect(
      within(cafe).getByRole('button', { name: /Arată codul OSUBB/ }),
    ).toBeVisible();
    const festival = screen.getByRole('article', {
      name: 'Bilete la festival',
    });
    expect(
      within(festival).queryByRole('button', { name: /Arată codul OSUBB/ }),
    ).toBeNull();
  });

  it('opens ?deal=<id> once the list is in, marks it read and shows its links as "Deschide:"', async () => {
    renderAt('/anunturi/deals?deal=1');
    const sheet = await screen.findByRole('dialog', {
      name: 'Reducere la cafenea',
    });
    expect(
      within(sheet).getByRole('link', {
        name: 'Deschide: Meniu (se deschide într-o filă nouă)',
      }),
    ).toHaveAttribute('href', 'https://cafe.example.ro');
    await waitFor(() =>
      expect(supabaseMock.upsert).toHaveBeenCalledWith(
        { announcement_id: 1, member_id: 'me' },
        expect.anything(),
      ),
    );
    // A member does not see the reveal count.
    expect(within(sheet).queryByText(/Codul a fost deschis/)).toBeNull();
  });

  it('counts a Deal read once its code is revealed from the card', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValue({ data: 'CAFE10', error: null });
    renderAt('/anunturi/deals');
    const cafe = await screen.findByRole('article', {
      name: 'Reducere la cafenea',
    });
    await user.click(
      within(cafe).getByRole('button', { name: /Arată codul OSUBB/ }),
    );
    expect(await within(cafe).findByText('CAFE10')).toBeVisible();
    await waitFor(() =>
      expect(supabaseMock.upsert).toHaveBeenCalledWith(
        { announcement_id: 1, member_id: 'me' },
        expect.anything(),
      ),
    );
    // Revealing is not opening: no sheet.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says an expired or deleted Deal is unavailable', async () => {
    renderAt('/anunturi/deals?deal=3');
    expect(
      await screen.findByRole('dialog', { name: 'Deal indisponibil' }),
    ).toBeVisible();
    expect(
      screen.getByText('Acest deal a expirat sau nu mai există.'),
    ).toBeVisible();
  });

  it('says there is nothing yet without looking like a failure', async () => {
    supabaseMock.order.mockResolvedValue({ data: [ROWS[2]], error: null });
    renderAt('/anunturi/deals');
    expect(await screen.findByText(/Niciun deal activ acum/)).toBeVisible();
  });
});
