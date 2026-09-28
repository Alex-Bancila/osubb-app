import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminGroup } from '../../queries/groups-admin';

/*
 * A small fake of the database behind the panel: the tables it reads through
 * `from()` and the functions it calls through `rpc()`. Each RPC records its
 * payload, and a test can make one refuse with a server reason.
 */
type RoleEvaluation = {
  id: number;
  kind: string;
  name: string;
  period_from: string;
  period_to: string;
  run_at: string;
  threshold_used: number;
  threshold_computed: number | null;
};
const db = vi.hoisted(() => ({
  evaluations: [] as RoleEvaluation[],
  settings: new Map<string, string | null>(),
  refuse: new Map<string, string>(),
  rpc: vi.fn(),
  groups: vi.fn(),
}));

function tableRows(table: string): unknown {
  if (table === 'role_evaluations')
    return [...db.evaluations].sort((a, b) => b.id - a.id);
  if (table === 'org_settings')
    return [...db.settings].map(([key, value]) => ({ key, value }));
  throw new Error(`unexpected table ${table}`);
}

vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      maybeSingle: () =>
        Promise.resolve({ data: tableRows(table), error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: tableRows(table), error: null }),
    };
    return builder;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    db.rpc(name, args);
    const reason = db.refuse.get(name);
    if (reason)
      return { data: null, error: { code: 'PT400', message: reason } };
    switch (name) {
      case 'set_org_setting': {
        const value = String(args.p_value).trim();
        db.settings.set(String(args.p_key), value === '' ? null : value);
        return { data: null, error: null };
      }
      default:
        throw new Error(`unexpected rpc ${name}`);
    }
  };
  return { supabase: { from, rpc } };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'bc' } },
    claims: { member_level: 6 },
  }),
}));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useAdminGroups: db.groups,
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
import PeriodsScreen from './PeriodsScreen';

vi.setConfig({ testTimeout: 15_000 });

function group(id: number, name: string, extra: Partial<AdminGroup> = {}) {
  return {
    id,
    name,
    status: 'active',
    is_private: false,
    ...extra,
  } as AdminGroup;
}

beforeEach(() => {
  db.evaluations = [];
  db.settings = new Map<string, string | null>([
    ['adherence_form_url', null],
    ['adunarea_generala_group_id', null],
    ['vote_retention_percent', '25'],
  ]);
  db.refuse = new Map();
  db.rpc.mockReset();
  db.groups.mockReturnValue({
    data: [
      group(1, 'OSUBB'),
      group(5, 'Adunarea Generală'),
      group(6, 'Consiliu privat', { is_private: true }),
      group(7, 'Gala 2025', { status: 'archived' }),
    ],
    isPending: false,
    isError: false,
  });
});

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/administrare/evaluari']}>
        <Routes>
          <Route path="/administrare/evaluari" element={<PeriodsScreen />} />
          <Route path="/administrare/roluri" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = (name: string) =>
  screen.getByRole('heading', { name }).closest('section') as HTMLElement;

it('lists the Role Evaluations run so far, newest first, read-only (#826)', async () => {
  db.evaluations = [
    {
      id: 1,
      kind: 'voluntar_activ',
      name: 'Semestrul I',
      period_from: '2026-02-01',
      period_to: '2026-06-30',
      run_at: '2026-07-01T09:00:00Z',
      threshold_used: 30,
      threshold_computed: 42,
    },
    {
      id: 2,
      kind: 'adunarea_generala',
      name: 'AG toamnă',
      period_from: '2026-07-01',
      period_to: '2026-09-20',
      run_at: '2026-09-21T09:00:00Z',
      threshold_used: 10,
      threshold_computed: null,
    },
  ];
  const { container } = show();
  const list = await screen.findByRole('list', { name: 'Evaluări de rol' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    'AG toamnăAdunarea Generală · 1 iulie 2026 – 20 septembrie 2026 · prag folosit 10 · prag calculat —',
    'Semestrul IVoluntar Activ · 1 februarie 2026 – 30 iunie 2026 · prag folosit 30 · prag calculat 42',
  ]);
  expect(
    within(card('Istoricul evaluărilor de rol')).getByText(
      'Rularea evaluărilor de rol vine cu #827.',
    ),
  ).toBeVisible();
  // Nothing opens or closes a Period any more.
  expect(screen.queryByRole('button', { name: /perioad/i })).toBeNull();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('says when no Role Evaluation has run yet', async () => {
  show();
  expect(
    await within(
      await screen
        .findByRole('heading', { name: 'Istoricul evaluărilor de rol' })
        .then((heading) => heading.closest('section') as HTMLElement),
    ).findByText('Nicio evaluare de rol încă.'),
  ).toBeVisible();
});

it('holds only the evaluation cards: the settings moved to the Setări tab (#825)', async () => {
  show();
  await screen.findByRole('heading', { name: 'Istoricul evaluărilor de rol' });
  expect(
    screen.queryByRole('heading', { name: 'Formular de adeziune' }),
  ).toBeNull();
  expect(
    screen.queryByRole('heading', { name: 'Adunarea Generală' }),
  ).toBeNull();
  expect(
    screen.queryByRole('link', { name: 'Înapoi la Administrare' }),
  ).toBeNull();
});
