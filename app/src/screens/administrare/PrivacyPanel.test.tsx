import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import * as axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  version: '1.1',
  rows: [] as {
    member_id: string;
    notice_version: string | null;
    acknowledged_at: string | null;
  }[],
  rpc: vi.fn(),
}));
vi.mock('../../lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { value: api.version }, error: null }),
  };
  return { supabase: { from: () => chain, rpc: api.rpc } };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'bc-1' } } }),
}));
const identities = vi.hoisted(() => vi.fn());
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: identities,
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
import { formatMemberCount } from '../../lib/format';
import { PrivacyPanel } from './PrivacyPanel';

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PrivacyPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.version = '1.1';
  api.rows = [
    {
      member_id: 'ana',
      notice_version: '1.1',
      acknowledged_at: '2026-09-26T09:00:00Z',
    },
    { member_id: 'bogdan', notice_version: null, acknowledged_at: null },
    {
      member_id: 'carmen',
      notice_version: '1.0',
      acknowledged_at: '2026-09-20T09:00:00Z',
    },
  ];
  api.rpc.mockImplementation(async () => ({ data: api.rows, error: null }));
  identities.mockReturnValue({
    isPending: false,
    isError: false,
    data: new Map([
      [
        'bogdan',
        { memberId: 'bogdan', nickname: null, fullName: 'Bogdan Ionescu' },
      ],
      [
        'carmen',
        { memberId: 'carmen', nickname: 'Ada', fullName: 'Carmen Dan' },
      ],
    ]),
  });
});

it('lists the Members without the current version, with a count', async () => {
  const { container } = show();
  expect(
    await screen.findByText('2 membri fără confirmarea versiunii curente'),
  ).toBeVisible();
  expect(api.rpc).toHaveBeenCalledWith('privacy_acknowledgement_status');

  const items = within(screen.getByRole('list')).getAllByRole('listitem');
  const bogdan = items[1] as HTMLElement;
  // Sorted by the name shown: Carmen's Nickname "Ada" comes before Bogdan
  // (each row starts with the avatar's initials).
  expect(items.map((item) => item.textContent)).toEqual([
    'CDAdaCarmen Danultima confirmare: v1.0 · 20 septembrie 2026Pagina membrului',
    'BIBogdan IonescuneconfirmatăPagina membrului',
  ]);
  // The name opens the Member Card; the page link sits beside it.
  expect(
    within(bogdan).getByRole('button', {
      name: 'Profilul membrului Bogdan Ionescu',
    }),
  ).toBeVisible();
  expect(
    within(bogdan).getByRole('link', { name: 'Pagina membrului' }),
  ).toHaveAttribute('href', '/administrare/membri/bogdan');
  expect(identities).toHaveBeenLastCalledWith(['bogdan', 'carmen']);
  // Ana acknowledged 1.1, the current version: not on the list.
  expect(screen.queryByText('Ana Pop')).toBeNull();
  expect(screen.getByText(/\(v1\.1\)/)).toBeVisible();

  const results = await axe.run(container);
  expect(results.violations).toEqual([]);
});

it('says so when every active Member acknowledged the current version', async () => {
  api.rows = [
    {
      member_id: 'ana',
      notice_version: '1.1',
      acknowledged_at: '2026-09-26T09:00:00Z',
    },
  ];
  show();
  expect(
    await screen.findByText(
      'Toți membrii activi au confirmat versiunea curentă.',
    ),
  ).toBeVisible();
  expect(screen.queryByRole('list')).toBeNull();
});

it('reports a refused or failed read instead of an empty list', async () => {
  api.rpc.mockImplementation(async () => ({
    data: null,
    error: { code: '42501', message: 'privacy_acknowledgements_forbidden' },
  }));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu am putut încărca confirmările.',
  );
});

it('counts Members with the Romanian plural', () => {
  expect(formatMemberCount(1)).toBe('1 membru');
  expect(formatMemberCount(2)).toBe('2 membri');
  expect(formatMemberCount(20)).toBe('20 de membri');
  expect(formatMemberCount(101)).toBe('101 membri');
});
