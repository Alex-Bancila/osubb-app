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

it('opens a Period behind a confirmation Dialog, validating the name, and reflects the server', async () => {
  const user = userEvent.setup();
  const { container } = show();
  const current = await screen.findByRole('heading', {
    name: 'Perioada curentă',
  });
  expect(
    within(current.closest('section') as HTMLElement).getByText(
      'Nicio perioadă deschisă',
    ),
  ).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Deschide o perioadă' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Deschide o perioadă',
  });
  const name = within(dialog).getByLabelText('Numele perioadei');
  await user.type(name, '  ab ');
  await user.click(
    within(dialog).getByRole('button', { name: 'Deschide perioada' }),
  );
  expect(
    within(dialog).getByText('Numele are cel puțin 3 caractere.'),
  ).toBeVisible();
  expect(rpcCalls('open_evaluation_period')).toEqual([]);

  // A refusal stays in the Dialog, translated.
  db.refuse.set('open_evaluation_period', 'period_already_open');
  await user.clear(name);
  await user.type(name, '  Toamna 2026 ');
  await user.click(
    within(dialog).getByRole('button', { name: 'Deschide perioada' }),
  );
  expect(
    await within(dialog).findByText(
      'O perioadă de evaluare este deja deschisă. Pagina a fost actualizată.',
    ),
  ).toBeVisible();

  db.refuse.clear();
  await user.click(
    within(dialog).getByRole('button', { name: 'Deschide perioada' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(rpcCalls('open_evaluation_period').at(-1)).toEqual({
    p_name: 'Toamna 2026',
  });
  expect(await screen.findByText('Toamna 2026')).toBeVisible();
  expect(screen.getByText('Deschisă din 25 septembrie 2026')).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('closes the open Period only after a Dialog that spells out the consequences', async () => {
  const user = userEvent.setup();
  db.periods = [
    {
      id: 4,
      name: 'Primăvara 2026',
      opened_at: '2026-03-01T08:00:00Z',
      closed_at: null,
      closing_threshold: null,
    },
  ];
  show();
  await user.click(
    await screen.findByRole('button', { name: 'Închide perioada' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Închizi perioada Primăvara 2026?',
  });
  expect(
    within(dialog).getByText(/pragul de promovare se fixează/),
  ).toBeVisible();
  expect(
    within(dialog).getByText(/promovările de închidere se aplică/),
  ).toBeVisible();
  expect(
    within(dialog).getByText(/semnalele de retenție se trimit/),
  ).toBeVisible();
  expect(rpcCalls('close_evaluation_period')).toEqual([]);

  // Renunță sends nothing.
  await user.click(within(dialog).getByRole('button', { name: 'Renunță' }));
  expect(rpcCalls('close_evaluation_period')).toEqual([]);

  await user.click(screen.getByRole('button', { name: 'Închide perioada' }));
  const again = await screen.findByRole('dialog');
  db.refuse.set('close_evaluation_period', 'period_manage_forbidden');
  await user.click(
    within(again).getByRole('button', { name: 'Închide perioada' }),
  );
  expect(
    await within(again).findByText(
      'Doar BC și Moderatorul pot deschide sau închide o perioadă de evaluare.',
    ),
  ).toBeVisible();

  db.refuse.clear();
  await user.click(
    within(again).getByRole('button', { name: 'Închide perioada' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(rpcCalls('close_evaluation_period').at(-1)).toEqual({
    p_period_id: 4,
  });
  // The Period, threshold and signal reads were refreshed from the server.
  expect(
    await within(card('Perioada curentă')).findByText(
      'Nicio perioadă deschisă',
    ),
  ).toBeVisible();
  expect(
    await within(card('Prag de promovare')).findByText(
      'din perioada Primăvara 2026',
    ),
  ).toBeVisible();
  expect(
    within(card('Prag de promovare')).getByText('12 puncte'),
  ).toBeVisible();
});

it('seeds the initial threshold before the first close, and shows its provenance', async () => {
  const user = userEvent.setup();
  show();
  const threshold = await screen.findByRole('heading', {
    name: 'Prag de promovare',
  });
  const section = threshold.closest('section') as HTMLElement;
  expect(await within(section).findByText('30 puncte')).toBeVisible();
  expect(within(section).getByText('prag inițial')).toBeVisible();

  const field = within(section).getByLabelText('Prag inițial');
  await user.clear(field);
  await user.type(field, '0');
  await user.click(within(section).getByRole('button', { name: 'Salvează' }));
  expect(
    within(section).getByText(
      'Pragul inițial este un număr întreg de cel puțin 1.',
    ),
  ).toBeVisible();
  expect(rpcCalls('set_promotion_rule')).toEqual([]);

  await user.clear(field);
  await user.type(field, '40');
  await user.click(within(section).getByRole('button', { name: 'Salvează' }));
  await waitFor(() =>
    expect(rpcCalls('set_promotion_rule').at(-1)).toEqual({
      p_rule_id: 2,
      p_initial_threshold: 40,
    }),
  );
  expect(await within(section).findByText('40 puncte')).toBeVisible();

  // The server's refusal after a close someone else made lands in the form.
  db.refuse.set('set_promotion_rule', 'promotion_threshold_already_stamped');
  await user.clear(within(section).getByLabelText('Prag inițial'));
  await user.type(within(section).getByLabelText('Prag inițial'), '45');
  await user.click(within(section).getByRole('button', { name: 'Salvează' }));
  expect(
    await within(section).findByText(
      'O perioadă s-a închis deja, așa că pragul vine acum din ultima închidere.',
    ),
  ).toBeVisible();
});

it('drops the field after the first close and names the Period the threshold came from', async () => {
  db.periods = [
    {
      id: 1,
      name: 'Toamna 2025',
      opened_at: '2025-10-01T08:00:00Z',
      closed_at: '2026-02-01T08:00:00Z',
      closing_threshold: 18,
    },
    // A later close that ranked nobody stamps nothing: the threshold carries over.
    {
      id: 2,
      name: 'Iarna 2026',
      opened_at: '2026-02-01T08:00:00Z',
      closed_at: '2026-03-01T08:00:00Z',
      closing_threshold: null,
    },
  ];
  show();
  const section = (
    await screen.findByRole('heading', { name: 'Prag de promovare' })
  ).closest('section') as HTMLElement;
  expect(await within(section).findByText('18 puncte')).toBeVisible();
  expect(within(section).getByText('din perioada Toamna 2025')).toBeVisible();
  expect(within(section).queryByLabelText('Prag inițial')).toBeNull();
  expect(
    within(section).getByText(/vine acum din ultima închidere/),
  ).toBeVisible();
});

it("lists the last close's Retention Signals, each linking into the Role panel", async () => {
  const user = userEvent.setup();
  db.periods = [
    {
      id: 1,
      name: 'Toamna 2025',
      opened_at: '2025-10-01T08:00:00Z',
      closed_at: '2026-02-01T08:00:00Z',
      closing_threshold: 18,
    },
    {
      id: 3,
      name: 'Primăvara 2026',
      opened_at: '2026-03-01T08:00:00Z',
      closed_at: '2026-06-01T08:00:00Z',
      closing_threshold: 20,
    },
  ];
  db.ranking = [
    {
      member_id: 'top',
      role: 'activ',
      task_points: 40,
      rank: 1,
      cohort_size: 3,
      share_size: 1,
      inside: true,
    },
    {
      member_id: 'ana',
      role: 'activ',
      task_points: 5,
      rank: 2,
      cohort_size: 3,
      share_size: 1,
      inside: false,
    },
    {
      member_id: 'dan',
      role: 'vot',
      task_points: 0,
      rank: 2,
      cohort_size: 2,
      share_size: 1,
      inside: false,
    },
  ];
  show();
  const list = await screen.findByRole('list', { name: 'Semnale de retenție' });
  expect(rpcCalls('retention_ranking')).toEqual([{ p_period_id: 3 }]);
  const rows = within(list).getAllByRole('listitem');
  const [ana, dan] = rows as [HTMLElement, HTMLElement];
  expect(rows).toHaveLength(2);
  expect(
    within(ana).getByRole('button', { name: 'Profilul membrului Ana Pop' }),
  ).toBeVisible();
  expect(ana).toHaveTextContent(
    'Voluntar Activ · 5 puncte · locul 2 din 3, în afara primilor 1',
  );
  expect(dan).toHaveTextContent('Voluntar cu Drept de Vot · 0 puncte');
  expect(
    within(dan).getByRole('link', { name: 'Editează rolul: Dănuț' }),
  ).toHaveAttribute('href', '/administrare?membru=dan');

  await user.click(
    within(ana).getByRole('link', { name: 'Editează rolul: Ana Pop' }),
  );
  expect(screen.getByTestId('where')).toHaveTextContent(
    '/administrare?membru=ana',
  );
});

it('says when the last close raised no signal, and when nothing has closed yet', async () => {
  db.periods = [
    {
      id: 1,
      name: 'Toamna 2025',
      opened_at: '2025-10-01T08:00:00Z',
      closed_at: '2026-02-01T08:00:00Z',
      closing_threshold: 18,
    },
  ];
  db.ranking = [
    {
      member_id: 'top',
      role: 'activ',
      task_points: 40,
      rank: 1,
      cohort_size: 1,
      share_size: 1,
      inside: true,
    },
  ];
  const view = show();
  expect(
    await screen.findByText('Niciun semnal la ultima închidere'),
  ).toBeVisible();
  view.unmount();

  db.periods = [];
  db.rpc.mockReset();
  show();
  expect(await screen.findByText('Nicio perioadă închisă încă')).toBeVisible();
  expect(rpcCalls('retention_ranking')).toEqual([]);
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
