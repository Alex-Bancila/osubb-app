import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminGroup } from '../../queries/groups-admin';

/*
 * Administrare → Setări (#825): the two organization settings, moved out of
 * the Perioade de evaluare screen. A small fake of the database behind the
 * panel: the tables it reads through `from()` and the functions it calls
 * through `rpc()`. Each RPC records its
 * payload, and a test can make one refuse with a server reason.
 */
type Period = {
  id: number;
  name: string;
  opened_at: string;
  closed_at: string | null;
  closing_threshold: number | null;
};
const db = vi.hoisted(() => ({
  periods: [] as Period[],
  rule: { id: 2, initial_threshold: 30 } as {
    id: number;
    initial_threshold: number;
  } | null,
  settings: new Map<string, string | null>(),
  ranking: [] as {
    member_id: string;
    role: string;
    task_points: number;
    rank: number;
    cohort_size: number;
    share_size: number;
    inside: boolean;
  }[],
  refuse: new Map<string, string>(),
  rpc: vi.fn(),
  groups: vi.fn(),
}));

function tableRows(table: string): unknown {
  if (table === 'evaluation_periods')
    return [...db.periods].sort((a, b) => b.id - a.id);
  if (table === 'org_settings')
    return [...db.settings].map(([key, value]) => ({ key, value }));
  if (table === 'promotion_rules') return db.rule;
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
  const inForce = () =>
    [...db.periods]
      .filter((p) => p.closed_at !== null && p.closing_threshold !== null)
      .sort((a, b) => b.id - a.id)[0]?.closing_threshold ??
    db.rule?.initial_threshold ??
    null;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    db.rpc(name, args);
    const reason = db.refuse.get(name);
    if (reason)
      return { data: null, error: { code: 'PT400', message: reason } };
    switch (name) {
      case 'promotion_threshold_in_force':
        return { data: inForce(), error: null };
      case 'retention_ranking':
        return { data: db.ranking, error: null };
      case 'open_evaluation_period': {
        const id = db.periods.length + 1;
        db.periods.push({
          id,
          name: String(args.p_name),
          opened_at: '2026-09-25T09:00:00Z',
          closed_at: null,
          closing_threshold: null,
        });
        return { data: id, error: null };
      }
      case 'close_evaluation_period': {
        const period = db.periods.find((p) => p.id === args.p_period_id);
        if (period) {
          period.closed_at = '2026-09-25T10:00:00Z';
          period.closing_threshold = 12;
        }
        return { data: null, error: null };
      }
      case 'set_promotion_rule':
        if (db.rule)
          db.rule.initial_threshold = args.p_initial_threshold as number;
        return { data: null, error: null };
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
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: () => ({
    data: new Map([
      [
        'ana',
        {
          memberId: 'ana',
          nickname: null,
          fullName: 'Ana Pop',
          avatarColor: null,
        },
      ],
      [
        'dan',
        {
          memberId: 'dan',
          nickname: 'Dănuț',
          fullName: 'Dan Ionescu',
          avatarColor: null,
        },
      ],
    ]),
  }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
import AdminSettingsTab from './AdminSettingsTab';

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
  db.periods = [];
  db.rule = { id: 2, initial_threshold: 30 };
  db.settings = new Map<string, string | null>([
    ['adherence_form_url', null],
    ['adunarea_generala_group_id', null],
    ['vote_retention_percent', '25'],
  ]);
  db.ranking = [];
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

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/administrare/setari']}>
        <AdminSettingsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rpcCalls = (name: string) =>
  db.rpc.mock.calls.filter(([called]) => called === name).map(([, a]) => a);

it('sets the two settings side by side, as panels', async () => {
  const { container } = show();
  expect(
    await screen.findByRole('region', { name: 'Formular de adeziune' }),
  ).toBeVisible();
  expect(
    screen.getByRole('region', { name: 'Adunarea Generală' }),
  ).toBeVisible();
  expect((await axe.run(container)).violations).toEqual([]);
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
