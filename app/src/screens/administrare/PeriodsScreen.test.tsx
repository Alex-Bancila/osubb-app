import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      <MemoryRouter initialEntries={['/administrare/perioade']}>
        <Routes>
          <Route path="/administrare/perioade" element={<PeriodsScreen />} />
          <Route path="/administrare" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = (name: string) =>
  screen.getByRole('heading', { name }).closest('section') as HTMLElement;
const rpcCalls = (name: string) =>
  db.rpc.mock.calls.filter(([called]) => called === name).map(([, a]) => a);

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

it('links the adherence form only when its address is http(s)', async () => {
  db.settings.set('adherence_form_url', 'https://forms.example.org/adeziune');
  const view = show();
  const link = await screen.findByRole('link', {
    name: 'https://forms.example.org/adeziune',
  });
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  view.unmount();

  // A value written outside the server's guard is shown, never linked.
  db.settings.set('adherence_form_url', 'javascript:alert(1)');
  show();
  const section = (
    await screen.findByRole('heading', { name: 'Formular de adeziune' })
  ).closest('section') as HTMLElement;
  expect(await within(section).findByText('javascript:alert(1)')).toBeVisible();
  expect(within(section).queryByRole('link')).toBeNull();
});

it('sets, refuses and clears the adherence-form address', async () => {
  const user = userEvent.setup();
  show();
  const section = (
    await screen.findByRole('heading', { name: 'Formular de adeziune' })
  ).closest('section') as HTMLElement;
  expect(within(section).getByText('Niciun formular setat')).toBeVisible();
  const field = within(section).getByLabelText('Adresa formularului');

  // ftp:// is refused in the browser, in the kit's words, under the field.
  await user.type(field, 'ftp://example.org/form');
  await user.click(within(section).getByRole('button', { name: 'Salvează' }));
  expect(
    within(section).getByText(
      'Adresa trebuie să înceapă cu http:// sau https://.',
    ),
  ).toBeVisible();
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(rpcCalls('set_org_setting')).toEqual([]);

  // … and the server's own refusal lands in the same place.
  db.refuse.set('set_org_setting', 'invalid_org_setting_value');
  await user.clear(field);
  await user.type(field, 'https://forms.example.org/adeziune');
  await user.click(within(section).getByRole('button', { name: 'Salvează' }));
  expect(
    await within(section).findByText(/Valoarea nu este acceptată/),
  ).toBeVisible();

  db.refuse.clear();
  await user.click(within(section).getByRole('button', { name: 'Salvează' }));
  await waitFor(() =>
    expect(rpcCalls('set_org_setting').at(-1)).toEqual({
      p_key: 'adherence_form_url',
      p_value: 'https://forms.example.org/adeziune',
    }),
  );
  expect(
    await within(section).findByRole('link', {
      name: 'https://forms.example.org/adeziune',
    }),
  ).toBeVisible();

  await user.clear(within(section).getByLabelText('Adresa formularului'));
  await user.click(within(section).getByRole('button', { name: 'Salvează' }));
  await waitFor(() =>
    expect(rpcCalls('set_org_setting').at(-1)).toEqual({
      p_key: 'adherence_form_url',
      p_value: '',
    }),
  );
  expect(
    await within(section).findByText('Niciun formular setat'),
  ).toBeVisible();
});

it('points the Adunarea Generală setting at an active, non-private Group', async () => {
  const user = userEvent.setup();
  show();
  const section = (
    await screen.findByRole('heading', { name: 'Adunarea Generală' })
  ).closest('section') as HTMLElement;
  expect(within(section).getByText('Niciun grup setat')).toBeVisible();
  const select = within(section).getByLabelText('Grupul Adunării Generale');
  expect(
    within(select)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Alege un grup', 'Adunarea Generală', 'OSUBB']);
  expect(
    within(section).getByRole('button', { name: 'Salvează' }),
  ).toBeDisabled();

  await user.selectOptions(select, '5');
  await user.click(within(section).getByRole('button', { name: 'Salvează' }));
  await waitFor(() =>
    expect(rpcCalls('set_org_setting').at(-1)).toEqual({
      p_key: 'adunarea_generala_group_id',
      p_value: '5',
    }),
  );
  expect(
    await within(section).findByText('Grupul Adunării Generale a fost salvat.'),
  ).toBeVisible();
  expect(
    within(section).getByText('Adunarea Generală', { selector: 'span' }),
  ).toBeVisible();
});
