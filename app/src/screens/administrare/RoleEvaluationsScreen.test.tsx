import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// #1012 (R37): opening a thing reads its Notifications. The hook is observed
// here; its own behaviour is covered in queries/notifications-read.test.tsx.
const readNotificationsAbout = vi.hoisted(() => vi.fn());
vi.mock('../../queries/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/notifications')>()),
  useReadNotificationsAbout: readNotificationsAbout,
}));

/*
 * A small fake of the database behind the tab (#827 over #826): the tables it
 * reads through `from()` and the functions it calls through `rpc()`. Each RPC
 * records its payload, and a test can make one refuse with a server reason.
 */
type Run = {
  id: number;
  kind: string;
  name: string;
  period_from: string;
  period_to: string;
  run_by: string;
  run_at: string;
  threshold_used: number;
  threshold_computed: number | null;
  ranked_count: number;
};
type Threshold = {
  kind: string;
  threshold: number | null;
  updated_at: string;
  updated_by: string | null;
};
type Change = {
  id: number;
  kind: string | null;
  field?: string;
  promotion_rule_id?: number | null;
  from_value: number | null;
  to_value: number;
  source: string;
  changed_by: string | null;
  role_evaluation_id: number | null;
  changed_at: string;
};
type Rule = {
  id: number;
  kind: string;
  from_role: string;
  to_role: string;
  min_tenure_months: number;
  enabled: boolean;
};
type Candidate = {
  id: number;
  member_id: string;
  task_points: number;
  tenure_since: string;
  role_evaluation_id: number | null;
  threshold_used: number;
  created_at: string;
  decision: string | null;
};
type Ranked = {
  member_id: string;
  role: string;
  task_points: number;
  rank: number;
  cohort_size: number;
  share_size: number;
  inside: boolean;
  tenure_since: string | null;
};
const db = vi.hoisted(() => ({
  runs: [] as Run[],
  thresholds: [] as Threshold[],
  changes: [] as Change[],
  rules: [] as Rule[],
  candidates: [] as Candidate[],
  rankings: new Map<string, Ranked[]>(),
  percents: new Map<string, number | null>(),
  refuse: new Map<string, { code: string; message: string }>(),
  rpc: vi.fn(),
}));

function tableRows(table: string): unknown {
  switch (table) {
    case 'role_evaluations':
      return [...db.runs].sort((a, b) => b.run_at.localeCompare(a.run_at));
    case 'promotion_thresholds':
      return db.thresholds;
    case 'promotion_threshold_changes':
      // As the table answers: a row without a field is a threshold change.
      return [...db.changes]
        .sort((a, b) => b.changed_at.localeCompare(a.changed_at) || b.id - a.id)
        .map((row) => ({
          field: 'threshold',
          promotion_rule_id: null,
          ...row,
        }));
    case 'promotion_rules':
      return db.rules;
    case 'promotion_candidates':
      return db.candidates
        .filter((row) => row.decision === null)
        .map((row) => {
          const run = db.runs.find((r) => r.id === row.role_evaluation_id);
          return {
            ...row,
            role_evaluation: run ? { name: run.name } : null,
          };
        });
    default:
      throw new Error(`unexpected table ${table}`);
  }
}

vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      is: () => builder,
      maybeSingle: () =>
        Promise.resolve({ data: tableRows(table), error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: tableRows(table), error: null }),
    };
    return builder;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    db.rpc(name, args);
    const refusal = db.refuse.get(name);
    if (refusal) return { data: null, error: refusal };
    switch (name) {
      case 'role_evaluation_ranking':
        return {
          data: db.rankings.get(`${args.p_kind}:${args.p_from}:${args.p_to}`),
          error: null,
        };
      case 'run_role_evaluation': {
        const id = db.runs.length + 10;
        db.runs.push({
          id,
          kind: String(args.p_kind),
          name: String(args.p_name),
          period_from: String(args.p_from),
          period_to: String(args.p_to),
          run_by: 'bc',
          run_at: '2026-09-28T10:00:00Z',
          threshold_used: 30,
          threshold_computed: 25,
          ranked_count: 4,
        });
        return {
          data: [
            { role_evaluation_id: id, candidates: 2, retention_signals: 1 },
          ],
          error: null,
        };
      }
      case 'set_promotion_threshold': {
        const row = db.thresholds.find((t) => t.kind === args.p_kind);
        db.changes.push({
          id: db.changes.length + 100,
          kind: String(args.p_kind),
          from_value: row?.threshold ?? null,
          to_value: Number(args.p_threshold),
          source: 'manual',
          changed_by: 'bc',
          role_evaluation_id: null,
          changed_at: '2026-09-28T11:00:00Z',
        });
        if (row) {
          row.threshold = Number(args.p_threshold);
          row.updated_by = 'bc';
        }
        return { data: row, error: null };
      }
      case 'evaluation_percents':
        return {
          data: ['voluntar_activ', 'adunarea_generala'].map((kind) => {
            const last = [...db.changes]
              .filter((c) => c.kind === kind && c.field === 'percent')
              .sort((a, b) => b.changed_at.localeCompare(a.changed_at))[0];
            return {
              kind,
              percent: db.percents.get(kind) ?? null,
              changed_at: last?.changed_at ?? null,
              changed_by: last?.changed_by ?? null,
            };
          }),
          error: null,
        };
      case 'set_evaluation_percent': {
        const change = {
          id: db.changes.length + 200,
          kind: String(args.p_kind),
          field: 'percent',
          from_value: db.percents.get(String(args.p_kind)) ?? null,
          to_value: Number(args.p_percent),
          source: 'manual',
          changed_by: 'bc',
          role_evaluation_id: null,
          changed_at: '2026-09-28T11:30:00Z',
        };
        db.changes.push(change);
        db.percents.set(String(args.p_kind), Number(args.p_percent));
        return { data: change, error: null };
      }
      case 'update_promotion_rule': {
        const rule = db.rules.find((r) => r.id === args.p_rule_id);
        if (!rule) return { data: null, error: null };
        const at = '2026-09-28T12:00:00Z';
        if (rule.min_tenure_months !== args.p_min_tenure_months)
          db.changes.push({
            id: db.changes.length + 300,
            kind: null,
            field: 'tenure',
            promotion_rule_id: rule.id,
            from_value: rule.min_tenure_months,
            to_value: Number(args.p_min_tenure_months),
            source: 'manual',
            changed_by: 'bc',
            role_evaluation_id: null,
            changed_at: at,
          });
        if (rule.enabled !== args.p_enabled)
          db.changes.push({
            id: db.changes.length + 300,
            kind: null,
            field: 'enabled',
            promotion_rule_id: rule.id,
            from_value: rule.enabled ? 1 : 0,
            to_value: args.p_enabled ? 1 : 0,
            source: 'manual',
            changed_by: 'bc',
            role_evaluation_id: null,
            changed_at: at,
          });
        rule.min_tenure_months = Number(args.p_min_tenure_months);
        rule.enabled = Boolean(args.p_enabled);
        return { data: rule, error: null };
      }
      case 'reject_promotion_candidate': {
        const row = db.candidates.find((c) => c.id === args.p_candidate_id);
        if (row) row.decision = 'rejected';
        return { data: row, error: null };
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
vi.mock('../../queries/member-identities', () => {
  const people: Record<string, [string | null, string]> = {
    bc: [null, 'Bianca Coman'],
    ana: [null, 'Ana Pop'],
    dan: ['Dănuț', 'Dan Ionescu'],
    ion: [null, 'Ion Vlad'],
  };
  return {
    useMemberIdentities: (ids: readonly string[]) => ({
      data: new Map(
        ids.map((id) => [
          id,
          {
            memberId: id,
            nickname: people[id]?.[0] ?? null,
            fullName: people[id]?.[1] ?? 'Membru OSUBB',
            avatarColor: null,
          },
        ]),
      ),
    }),
  };
});
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
import RoleEvaluationsScreen from './RoleEvaluationsScreen';

vi.setConfig({ testTimeout: 20_000 });

const RUN_VA: Run = {
  id: 1,
  kind: 'voluntar_activ',
  name: 'Semestrul I',
  period_from: '2026-02-01',
  period_to: '2026-06-30',
  run_by: 'bc',
  run_at: '2026-07-01T09:00:00Z',
  threshold_used: 30,
  threshold_computed: 42,
  ranked_count: 8,
};
const RUN_AG: Run = {
  id: 2,
  kind: 'adunarea_generala',
  name: 'AG toamnă',
  period_from: '2026-07-01',
  period_to: '2026-09-20',
  run_by: 'dan',
  run_at: '2026-09-21T09:00:00Z',
  threshold_used: 10,
  threshold_computed: null,
  ranked_count: 0,
};

beforeEach(() => {
  // Only Date is faked: today is 28 September 2026 in Bucharest.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T09:00:00.000Z'));
  db.runs = [];
  db.thresholds = [
    {
      kind: 'voluntar_activ',
      threshold: 30,
      updated_at: '2026-09-01T00:00:00Z',
      updated_by: null,
    },
    {
      kind: 'adunarea_generala',
      threshold: null,
      updated_at: '2026-09-01T00:00:00Z',
      updated_by: null,
    },
  ];
  db.changes = [];
  db.rules = [
    {
      id: 2,
      kind: 'top_percent',
      from_role: 'voluntar',
      to_role: 'activ',
      min_tenure_months: 6,
      enabled: true,
    },
    {
      id: 1,
      kind: 'time',
      from_role: 'recrut',
      to_role: 'voluntar',
      min_tenure_months: 6,
      enabled: true,
    },
  ];
  db.candidates = [];
  db.rankings = new Map();
  db.percents = new Map([
    ['voluntar_activ', 20],
    ['adunarea_generala', 25],
  ]);
  db.refuse = new Map();
  db.rpc.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
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
          <Route
            path="/administrare/evaluari"
            element={<RoleEvaluationsScreen />}
          />
          <Route path="/administrare/roluri" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const panel = async (name: string) =>
  (await screen.findByRole('heading', { name, level: 2 })).closest(
    'section',
  ) as HTMLElement;

it('runs a Voluntar Activ Role Evaluation after a confirmation that names its consequences', async () => {
  db.runs = [RUN_VA];
  const user = userEvent.setup();
  const { container } = show();
  const run = await panel('Rulează o evaluare de rol');
  // De la: the day after the kind's last range; Până la: today.
  expect(within(run).getByLabelText('De la')).toHaveValue('2026-07-01');
  expect(within(run).getByLabelText('Până la')).toHaveValue('2026-09-28');
  expect(
    within(run).getByRole('button', { name: 'Voluntar Activ' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await user.type(within(run).getByLabelText('Nume'), '  Semestrul II  ');
  await user.click(
    within(run).getByRole('button', { name: 'Rulează evaluarea' }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('heading', {
      name: 'Rulezi evaluarea „Semestrul II”?',
    }),
  ).toBeVisible();
  expect(dialog).toHaveTextContent(
    'Clasăm punctele de task primite între 01.07.2026 și 28.09.2026 de Voluntarii cu vechime și de Voluntarii Activi. Voluntarii cu cel puțin 30 de puncte devin candidați la promovare; nimeni nu este promovat automat. Voluntarii Activi sub 30 de puncte devin semnale de retenție. Pragul calculat acum, punctele ultimului Voluntar Activ din primii 20%, devine pragul în vigoare pentru următoarea evaluare, dacă este cel puțin 1. BC și Moderatorul primesc câte o notificare pentru fiecare candidat și semnal.',
  );
  expect(db.rpc).not.toHaveBeenCalledWith(
    'run_role_evaluation',
    expect.anything(),
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Rulează evaluarea' }),
  );
  expect(db.rpc).toHaveBeenCalledWith('run_role_evaluation', {
    p_kind: 'voluntar_activ',
    p_from: '2026-07-01',
    p_to: '2026-09-28',
    p_name: 'Semestrul II',
  });
  expect(
    await within(run).findByText(
      'Evaluarea „Semestrul II” a rulat: 2 candidați la promovare, 1 semnal de retenție.',
    ),
  ).toBeVisible();
  // The run ended today: the next range cannot start tomorrow and end
  // today, so De la waits for a date instead of an inverted default (F-21).
  expect(within(run).getByLabelText('De la')).toHaveValue('');
  expect(within(run).getByLabelText('Până la')).toHaveValue('2026-09-28');
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('disables the run while the kind’s threshold is unset, then names the Adunarea Generală consequences with y', async () => {
  const user = userEvent.setup();
  show();
  const run = await panel('Rulează o evaluare de rol');
  await user.click(
    within(run).getByRole('button', { name: 'Adunarea Generală' }),
  );
  const button = within(run).getByRole('button', {
    name: 'Rulează evaluarea',
  });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(
    'Setează întâi pragul Adunării Generale din cardul Praguri.',
  );

  const thresholds = await panel('Praguri');
  await user.click(
    within(thresholds).getByRole('button', {
      name: 'Editează: Pragul Adunării Generale',
    }),
  );
  await user.type(
    within(thresholds).getByLabelText('Pragul Adunării Generale'),
    '12',
  );
  await user.click(
    within(thresholds).getByRole('button', { name: 'Salvează' }),
  );
  await waitFor(() => expect(button).toBeEnabled());

  await user.type(within(run).getByLabelText('De la'), '2026-07-01');
  await user.type(within(run).getByLabelText('Nume'), 'AG toamnă');
  await user.click(button);
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(
    'Clasăm punctele de task primite între 01.07.2026 și 28.09.2026 de Voluntarii cu Drept de Vot. Cei sub 12 puncte devin semnale de retenție; niciun rol nu se retrage automat. Pragul calculat acum, punctele ultimului Voluntar cu Drept de Vot din primii 25%, devine pragul în vigoare pentru următoarea evaluare a Adunării Generale, dacă este cel puțin 1.',
  );
});

it('validates the run form before any confirmation, and places a server refusal under its field', async () => {
  const user = userEvent.setup();
  show();
  const run = await panel('Rulează o evaluare de rol');
  // No earlier run of this kind: De la starts empty.
  expect(within(run).getByLabelText('De la')).toHaveValue('');
  await user.click(
    within(run).getByRole('button', { name: 'Rulează evaluarea' }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(run).getByLabelText('De la')).toHaveAccessibleDescription(
    'Alege data.',
  );
  expect(within(run).getByLabelText('Nume')).toHaveAccessibleDescription(
    'Scrie numele evaluării.',
  );

  await user.type(within(run).getByLabelText('De la'), '2026-09-01');
  await user.type(within(run).getByLabelText('Nume'), 'ab');
  await user.click(
    within(run).getByRole('button', { name: 'Rulează evaluarea' }),
  );
  expect(within(run).getByLabelText('Nume')).toHaveAccessibleDescription(
    'Numele are cel puțin 3 caractere.',
  );
  expect(screen.queryByRole('dialog')).toBeNull();

  db.refuse.set('run_role_evaluation', {
    code: 'PT400',
    message: 'date_range_in_future',
  });
  await user.type(within(run).getByLabelText('Nume'), 'c');
  await user.click(
    within(run).getByRole('button', { name: 'Rulează evaluarea' }),
  );
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Rulează evaluarea',
    }),
  );
  await waitFor(() =>
    expect(within(run).getByLabelText('Până la')).toHaveAccessibleDescription(
      'Intervalul se poate termina cel târziu azi.',
    ),
  );
});

it('edits a threshold and lists every change with its author or run', async () => {
  db.runs = [RUN_VA];
  db.changes = [
    {
      id: 1,
      kind: 'voluntar_activ',
      from_value: null,
      to_value: 30,
      source: 'manual',
      changed_by: 'dan',
      role_evaluation_id: null,
      changed_at: '2026-06-01T08:00:00Z',
    },
    {
      id: 2,
      kind: 'voluntar_activ',
      from_value: 30,
      to_value: 42,
      source: 'role_evaluation',
      changed_by: null,
      role_evaluation_id: 1,
      changed_at: '2026-07-01T09:00:00Z',
    },
  ];
  db.thresholds = db.thresholds.map((row) =>
    row.kind === 'voluntar_activ' ? { ...row, threshold: 42 } : row,
  );
  const user = userEvent.setup();
  show();
  const thresholds = await panel('Praguri');
  const log = await within(thresholds).findByRole('list', {
    name: 'Istoricul modificărilor',
  });
  expect(
    within(log)
      .getAllByRole('listitem')
      .map((row) => row.textContent),
  ).toEqual([
    '01.07.2026 · Voluntar Activ30 → 42·evaluarea „Semestrul I”',
    '01.06.2026 · Voluntar Activnesetat → 30·DIDănuț',
  ]);
  expect(thresholds).toHaveTextContent('Pragul Voluntar Activ42 de puncte');
  expect(thresholds).toHaveTextContent('calculat de evaluarea „Semestrul I”');
  expect(thresholds).toHaveTextContent('Pragul Adunării GeneraleNesetat');

  await user.click(
    within(thresholds).getByRole('button', {
      name: 'Editează: Pragul Voluntar Activ',
    }),
  );
  const input = within(thresholds).getByLabelText('Pragul Voluntar Activ');
  expect(input).toHaveValue(42);
  await user.clear(input);
  await user.type(input, '0');
  await user.click(
    within(thresholds).getByRole('button', { name: 'Salvează' }),
  );
  expect(input).toHaveAccessibleDescription(
    /Pragul este un număr întreg de cel puțin 1\./,
  );
  expect(db.rpc).not.toHaveBeenCalledWith(
    'set_promotion_threshold',
    expect.anything(),
  );
  await user.clear(input);
  await user.type(input, '35');
  await user.click(
    within(thresholds).getByRole('button', { name: 'Salvează' }),
  );
  expect(db.rpc).toHaveBeenCalledWith('set_promotion_threshold', {
    p_kind: 'voluntar_activ',
    p_threshold: 35,
  });
  expect(
    await within(thresholds).findByText('Pragul Voluntar Activ a fost salvat.'),
  ).toBeVisible();
  await waitFor(() =>
    expect(
      within(
        within(thresholds).getByRole('list', {
          name: 'Istoricul modificărilor',
        }),
      ).getAllByRole('listitem')[0],
    ).toHaveTextContent('28.09.2026 · Voluntar Activ42 → 35·BCBianca Coman'),
  );
  expect(thresholds).toHaveTextContent('introdus deBCBianca Coman');

  // One receipt at a time (F-11): the share's replaces the threshold's.
  await user.click(
    within(thresholds).getByRole('button', {
      name: 'Editează: Procentul Voluntar Activ',
    }),
  );
  const share = within(thresholds).getByLabelText('Procentul Voluntar Activ');
  await user.clear(share);
  await user.type(share, '35');
  await user.click(
    within(thresholds).getByRole('button', { name: 'Salvează' }),
  );
  expect(
    await within(thresholds).findByText(
      'Procentul Voluntar Activ a fost salvat.',
    ),
  ).toBeVisible();
  expect(
    within(thresholds).queryByText('Pragul Voluntar Activ a fost salvat.'),
  ).toBeNull();
});

it('edits each kind’s share (#866): 1–100 in the browser, logged, and the next run’s confirmation names it', async () => {
  db.runs = [RUN_VA];
  const user = userEvent.setup();
  const { container } = show();
  const thresholds = await panel('Praguri');
  await waitFor(() => expect(thresholds).toHaveTextContent('Procent:20 %'));
  expect(thresholds).toHaveTextContent('Procent:25 %');

  await user.click(
    within(thresholds).getByRole('button', {
      name: 'Editează: Procentul Voluntar Activ',
    }),
  );
  const input = within(thresholds).getByLabelText('Procentul Voluntar Activ');
  expect(input).toHaveValue(20);
  for (const wrong of ['0', '101']) {
    await user.clear(input);
    await user.type(input, wrong);
    await user.click(
      within(thresholds).getByRole('button', { name: 'Salvează' }),
    );
    expect(input).toHaveAccessibleDescription(
      /Procentul trebuie să fie între 1 și 100./,
    );
  }
  expect(db.rpc).not.toHaveBeenCalledWith(
    'set_evaluation_percent',
    expect.anything(),
  );
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);

  await user.clear(input);
  await user.type(input, '35');
  await user.click(
    within(thresholds).getByRole('button', { name: 'Salvează' }),
  );
  expect(db.rpc).toHaveBeenCalledWith('set_evaluation_percent', {
    p_kind: 'voluntar_activ',
    p_percent: 35,
  });
  expect(
    await within(thresholds).findByText(
      'Procentul Voluntar Activ a fost salvat.',
    ),
  ).toBeVisible();
  await waitFor(() =>
    expect(thresholds).toHaveTextContent(
      'Procent:35 %·schimbat deBCBianca Coman',
    ),
  );
  const log = within(thresholds).getByRole('list', {
    name: 'Istoricul modificărilor',
  });
  expect(within(log).getAllByRole('listitem')[0]).toHaveTextContent(
    '28.09.2026 · Voluntar Activ · procent20 % → 35 %·BCBianca Coman',
  );
  // A share change is not where the threshold came from.
  expect(thresholds).not.toHaveTextContent('introdus de');

  // The confirmation reads the share now in force.
  const run = await panel('Rulează o evaluare de rol');
  await user.type(within(run).getByLabelText('Nume'), 'Semestrul II');
  await user.click(
    within(run).getByRole('button', { name: 'Rulează evaluarea' }),
  );
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'punctele ultimului Voluntar Activ din primii 35%',
  );
});

it('places a server refusal of a share under its field', async () => {
  db.refuse.set('set_evaluation_percent', {
    code: '42501',
    message: 'evaluation_percent_manage_forbidden',
  });
  const user = userEvent.setup();
  show();
  const thresholds = await panel('Praguri');
  await user.click(
    await within(thresholds).findByRole('button', {
      name: 'Editează: Procentul Adunării Generale',
    }),
  );
  const input = within(thresholds).getByLabelText(
    'Procentul Adunării Generale',
  );
  expect(input).toHaveValue(25);
  await user.clear(input);
  await user.type(input, '30');
  await user.click(
    within(thresholds).getByRole('button', { name: 'Salvează' }),
  );
  expect(
    await within(thresholds).findByText(
      'Doar BC și Moderatorul pot schimba procentele.',
    ),
  ).toBeVisible();
});

/** The Reguli de promovare section of Praguri (#935). */
async function rulesSection() {
  const thresholds = await panel('Praguri');
  return (
    await within(thresholds).findByRole('heading', {
      name: 'Reguli de promovare',
    })
  ).closest('section') as HTMLElement;
}

const ruleRow = (rules: HTMLElement, label: string) =>
  within(rules)
    .getByRole('heading', { name: label })
    .closest('li') as HTMLElement;

it('shows each Promotion Rule, the ladder in order, with its tenure, state and effect (#935)', async () => {
  db.rules = db.rules.map((rule) =>
    rule.kind === 'top_percent'
      ? { ...rule, min_tenure_months: 24, enabled: false }
      : rule,
  );
  show();
  const rules = await rulesSection();
  await within(rules).findByRole('heading', { name: 'Recrut → Voluntar' });
  expect(
    within(rules)
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent),
  ).toEqual(['Recrut → Voluntar', 'Voluntar → Voluntar Activ']);
  const time = ruleRow(rules, 'Recrut → Voluntar');
  expect(time).toHaveTextContent('6 luni');
  expect(time).toHaveTextContent('Pornită');
  expect(time).toHaveTextContent(
    'Zilnic, fiecare Recrut care a împlinit vechimea devine automat Voluntar.',
  );
  const top = ruleRow(rules, 'Voluntar → Voluntar Activ');
  expect(top).toHaveTextContent('24 de luni');
  expect(top).toHaveTextContent(
    'Oprită: nimeni nu mai devine candidat la promovare.',
  );
});

it('edits a Promotion Rule’s tenure and on/off with the #923 row pattern, logged with its author (#935)', async () => {
  const user = userEvent.setup();
  show();
  const rules = await rulesSection();
  await within(rules).findByRole('heading', { name: 'Recrut → Voluntar' });
  await user.click(
    within(rules).getByRole('button', {
      name: 'Editează regula Recrut → Voluntar',
    }),
  );
  const input = within(rules).getByLabelText('Vechime cerută');
  expect(input).toHaveValue(6);
  expect(input).toHaveFocus();
  // Nothing changed yet: nothing to save.
  const save = within(rules).getByRole('button', { name: 'Salvează' });
  expect(save).toBeDisabled();

  await user.clear(input);
  await user.type(input, '121');
  await user.click(save);
  expect(input).toHaveAccessibleDescription(
    /Vechimea este un număr întreg de luni, de la 0 la 120\./,
  );
  expect(db.rpc).not.toHaveBeenCalledWith(
    'update_promotion_rule',
    expect.anything(),
  );

  await user.clear(input);
  await user.type(input, '2');
  const toggle = within(rules).getByRole('switch', {
    name: 'Regula este pornită',
  });
  expect(toggle).toBeChecked();
  await user.click(toggle);
  expect(toggle).not.toBeChecked();
  await user.click(save);
  expect(db.rpc).toHaveBeenCalledWith('update_promotion_rule', {
    p_rule_id: 1,
    p_min_tenure_months: 2,
    p_enabled: false,
  });

  expect(
    await within(rules).findByText('Regula a fost salvată.'),
  ).toBeVisible();
  await waitFor(() =>
    expect(
      within(rules).getByRole('button', {
        name: 'Editează regula Recrut → Voluntar',
      }),
    ).toHaveFocus(),
  );
  const time = ruleRow(rules, 'Recrut → Voluntar');
  await waitFor(() => expect(time).toHaveTextContent('2 luni'));
  expect(time).toHaveTextContent('Oprită');
  expect(time).toHaveTextContent('schimbată deBCBianca Coman');

  const thresholds = await panel('Praguri');
  const log = await within(thresholds).findByRole('list', {
    name: 'Istoricul modificărilor',
  });
  await waitFor(() =>
    expect(
      within(log)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      '28.09.2026 · Recrut → Voluntar · starepornită → oprită·BCBianca Coman',
      '28.09.2026 · Recrut → Voluntar · vechime6 luni → 2 luni·BCBianca Coman',
    ]),
  );
  // A rule change is not a threshold change: the threshold keeps no author.
  expect(thresholds).not.toHaveTextContent('introdus de');
});

it('Renunță closes the rule editor without saving', async () => {
  const user = userEvent.setup();
  show();
  const rules = await rulesSection();
  await user.click(
    await within(rules).findByRole('button', {
      name: 'Editează regula Voluntar → Voluntar Activ',
    }),
  );
  const input = within(rules).getByLabelText('Vechime cerută');
  await user.clear(input);
  await user.type(input, '3');
  await user.click(within(rules).getByRole('button', { name: 'Renunță' }));
  expect(within(rules).queryByLabelText('Vechime cerută')).toBeNull();
  expect(ruleRow(rules, 'Voluntar → Voluntar Activ')).toHaveTextContent(
    '6 luni',
  );
  expect(db.rpc).not.toHaveBeenCalledWith(
    'update_promotion_rule',
    expect.anything(),
  );
});

it('shows a server refusal of a rule edit in the editor', async () => {
  db.refuse.set('update_promotion_rule', {
    code: '42501',
    message: 'promotion_rule_manage_forbidden',
  });
  const user = userEvent.setup();
  show();
  const rules = await rulesSection();
  await user.click(
    await within(rules).findByRole('button', {
      name: 'Editează regula Voluntar → Voluntar Activ',
    }),
  );
  await user.click(
    within(rules).getByRole('switch', { name: 'Regula este pornită' }),
  );
  await user.click(within(rules).getByRole('button', { name: 'Salvează' }));
  expect(
    await within(rules).findByText(
      'Doar BC și Moderatorul pot schimba regulile de promovare.',
    ),
  ).toBeVisible();
  // The editor stays open for another try.
  expect(within(rules).getByLabelText('Vechime cerută')).toBeVisible();
});

it('lists the open Promotion Candidates: Promovează opens Roluri preset, Respinge needs a reason', async () => {
  db.runs = [RUN_VA];
  db.candidates = [
    {
      id: 7,
      member_id: 'ana',
      task_points: 48,
      tenure_since: '2026-03-15',
      role_evaluation_id: 1,
      threshold_used: 30,
      created_at: '2026-07-01T09:00:00Z',
      decision: null,
    },
    {
      id: 8,
      member_id: 'dan',
      task_points: 31,
      tenure_since: '2026-01-10',
      role_evaluation_id: 1,
      threshold_used: 30,
      created_at: '2026-07-01T09:00:00Z',
      decision: null,
    },
  ];
  const user = userEvent.setup();
  show();
  const candidates = await panel('Candidați la promovare');
  const list = await within(candidates).findByRole('list', {
    name: 'Candidați la promovare',
  });
  // #1012 (R37): the list shows every candidate, so all their Notifications
  // are read in one request.
  expect(readNotificationsAbout).toHaveBeenCalledWith(['promotion_candidate']);
  const rows = within(list).getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent(
    '48 de puncte · pragul 30 · vechime din 15.03.2026',
  );
  expect(rows[0]).toHaveTextContent('Evaluarea „Semestrul I”');
  const href =
    within(rows[0] as HTMLElement)
      .getByRole('link', { name: 'Promovează: Ana Pop' })
      .getAttribute('href') ?? '';
  const url = new URL(href, 'https://app.osubb.ro');
  expect(url.pathname).toBe('/administrare/roluri');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    membru: 'ana',
    rol: 'activ',
    motiv: 'Evaluarea de rol „Semestrul I”',
  });

  await user.click(
    within(rows[1] as HTMLElement).getByRole('button', {
      name: 'Respinge: Dănuț',
    }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('heading', { name: 'Respingi candidatul?' }),
  ).toBeVisible();
  // The name renders through MemberName, like every Member's name.
  expect(
    within(dialog).getByRole('button', { name: 'Profilul membrului Dănuț' }),
  ).toBeVisible();
  expect(dialog).toHaveTextContent('31 de puncte · pragul 30');
  const reason = within(dialog).getByLabelText('Motivul respingerii');
  await user.click(
    within(dialog).getByRole('button', { name: 'Respinge candidatul' }),
  );
  expect(reason).toHaveAccessibleDescription('Scrie motivul respingerii.');
  await user.click(reason);
  await user.paste('r'.repeat(501));
  await user.click(
    within(dialog).getByRole('button', { name: 'Respinge candidatul' }),
  );
  expect(reason).toHaveAccessibleDescription(
    'Motivul are cel mult 500 de caractere.',
  );
  expect(db.rpc).not.toHaveBeenCalledWith(
    'reject_promotion_candidate',
    expect.anything(),
  );
  await user.clear(reason);
  await user.type(reason, '  Puncte dintr-un singur eveniment  ');
  await user.click(
    within(dialog).getByRole('button', { name: 'Respinge candidatul' }),
  );
  expect(db.rpc).toHaveBeenCalledWith('reject_promotion_candidate', {
    p_candidate_id: 8,
    p_reason: 'Puncte dintr-un singur eveniment',
  });
  await waitFor(() =>
    expect(
      within(
        within(candidates).getByRole('list', {
          name: 'Candidați la promovare',
        }),
      ).getAllByRole('listitem'),
    ).toHaveLength(1),
  );
  await user.click(
    within(candidates).getByRole('link', { name: 'Promovează: Ana Pop' }),
  );
  expect(screen.getByTestId('where')).toHaveTextContent(
    '/administrare/roluri?membru=ana&rol=activ&motiv=Evaluarea+de+rol+%E2%80%9ESemestrul+I%E2%80%9D',
  );
});

it('lists a candidate who qualified between runs by the day they did, and says how long a rejection holds (#983)', async () => {
  db.runs = [RUN_VA];
  db.candidates = [
    {
      id: 9,
      member_id: 'ana',
      task_points: 32,
      tenure_since: '2026-03-15',
      role_evaluation_id: null,
      threshold_used: 30,
      created_at: '2026-10-02T08:30:00Z',
      decision: null,
    },
  ];
  const user = userEvent.setup();
  show();
  const candidates = await panel('Candidați la promovare');
  const list = await within(candidates).findByRole('list', {
    name: 'Candidați la promovare',
  });
  const row = within(list).getAllByRole('listitem')[0] as HTMLElement;
  expect(row).toHaveTextContent(
    '32 de puncte · pragul 30 · vechime din 15.03.2026',
  );
  expect(row).toHaveTextContent('Eligibil din 02.10.2026, între evaluări');
  expect(row).not.toHaveTextContent('Evaluarea „');
  const href =
    within(row)
      .getByRole('link', { name: 'Promovează: Ana Pop' })
      .getAttribute('href') ?? '';
  const url = new URL(href, 'https://app.osubb.ro');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    membru: 'ana',
    rol: 'activ',
    motiv: 'Candidat la promovare din 02.10.2026',
  });

  await user.click(
    within(row).getByRole('button', { name: 'Respinge: Ana Pop' }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(
    'Respingerea ține până la următoarea evaluare Voluntar Activ: dacă la ea, sau după ea, are din nou cel puțin pragul, reapare în listă.',
  );
  expect(dialog).toHaveTextContent('32 de puncte · pragul 30');
});

it('reports a candidate decided meanwhile, and says so when no candidate waits', async () => {
  db.runs = [RUN_VA];
  db.candidates = [
    {
      id: 7,
      member_id: 'ana',
      task_points: 48,
      tenure_since: '2026-03-15',
      role_evaluation_id: 1,
      threshold_used: 30,
      created_at: '2026-07-01T09:00:00Z',
      decision: null,
    },
  ];
  db.refuse.set('reject_promotion_candidate', {
    code: 'PT409',
    message: 'promotion_candidate_decided',
  });
  const user = userEvent.setup();
  show();
  const candidates = await panel('Candidați la promovare');
  await user.click(
    await within(candidates).findByRole('button', {
      name: 'Respinge: Ana Pop',
    }),
  );
  const dialog = await screen.findByRole('dialog');
  await user.type(
    within(dialog).getByLabelText('Motivul respingerii'),
    'Deja promovată',
  );
  // Another BC promoted her meanwhile: the refetch empties the list.
  db.candidates = [];
  await user.click(
    within(dialog).getByRole('button', { name: 'Respinge candidatul' }),
  );
  expect(
    await within(candidates).findByText(
      'Candidatul a fost deja decis. Pagina a fost actualizată.',
    ),
  ).toBeVisible();
  expect(
    await within(candidates).findByText('Niciun candidat la promovare.'),
  ).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('shows each kind’s Retention Signals from its latest run', async () => {
  db.runs = [
    { ...RUN_VA, id: 3, name: 'Vechi', run_at: '2026-01-01T09:00:00Z' },
    RUN_VA,
    RUN_AG,
  ];
  db.rankings.set('voluntar_activ:2026-02-01:2026-06-30', [
    {
      member_id: 'ana',
      role: 'activ',
      // One point reads "1 punct", never "1 puncte" (F-20).
      task_points: 1,
      rank: 4,
      cohort_size: 4,
      share_size: 1,
      inside: false,
      tenure_since: null,
    },
    {
      member_id: 'ion',
      role: 'activ',
      task_points: 40,
      rank: 1,
      cohort_size: 4,
      share_size: 1,
      inside: true,
      tenure_since: null,
    },
    // A Voluntar below the line is not a Retention Signal.
    {
      member_id: 'dan',
      role: 'voluntar',
      task_points: 2,
      rank: 3,
      cohort_size: 3,
      share_size: 1,
      inside: false,
      tenure_since: '2026-01-10',
    },
  ]);
  db.rankings.set('adunarea_generala:2026-07-01:2026-09-20', []);
  show();
  const signals = await panel('Semnale de retenție');
  const va = within(signals)
    .getByRole('heading', { name: 'Voluntar Activ' })
    .closest('section') as HTMLElement;
  expect(va).toHaveTextContent(
    'Semestrul I · 01.02.2026–30.06.2026 · pragul 30',
  );
  const list = await within(va).findByRole('list', {
    name: 'Semnale de retenție: Voluntar Activ',
  });
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent('Voluntar Activ · 1 punct · locul 4 din 4');
  expect(
    within(rows[0] as HTMLElement).getByRole('link', {
      name: 'Editează rolul: Ana Pop',
    }),
  ).toHaveAttribute('href', '/administrare/roluri?membru=ana');
  const ag = within(signals)
    .getByRole('heading', { name: 'Adunarea Generală' })
    .closest('section') as HTMLElement;
  expect(
    await within(ag).findByText('Niciun semnal la ultima evaluare.'),
  ).toBeVisible();
  expect(db.rpc).toHaveBeenCalledWith('role_evaluation_ranking', {
    p_kind: 'voluntar_activ',
    p_from: '2026-02-01',
    p_to: '2026-06-30',
  });
});

it('shows only Run and Praguri before the first run (B58)', async () => {
  const { container } = show();
  await panel('Rulează o evaluare de rol');
  await panel('Praguri');
  // No empty candidates, signals, history or threshold-log blocks.
  expect(
    [...container.querySelectorAll('[data-slot="panel"] h2')].map(
      (heading) => heading.textContent,
    ),
  ).toEqual(['Rulează o evaluare de rol', 'Praguri']);
  // Once the (empty) log has loaded, it leaves no block behind.
  await waitFor(() =>
    expect(screen.queryByText('Istoricul modificărilor')).toBeNull(),
  );
  expect(screen.queryByText('Nicio schimbare încă.')).toBeNull();
  expect(db.rpc).not.toHaveBeenCalledWith(
    'role_evaluation_ranking',
    expect.anything(),
  );
  // The two boxes of the first row start on one line (X9).
  expect(container.querySelector('[data-slot="page-grid"]')).toHaveAttribute(
    'data-align-headers',
    'true',
  );
});

it('says when a kind has never run, once another kind has', async () => {
  db.runs = [RUN_VA];
  db.rankings.set('voluntar_activ:2026-02-01:2026-06-30', []);
  show();
  const signals = await panel('Semnale de retenție');
  const ag = within(signals)
    .getByRole('heading', { name: 'Adunarea Generală' })
    .closest('section') as HTMLElement;
  expect(
    within(ag).getByText('Nicio evaluare de acest tip încă.'),
  ).toBeVisible();
  expect(await panel('Candidați la promovare')).toBeVisible();
  expect(await panel('Istoricul evaluărilor')).toBeVisible();
});

it('lists the history of runs, newest first, with a dash for no computed threshold', async () => {
  db.runs = [RUN_VA, RUN_AG];
  show();
  const history = await panel('Istoricul evaluărilor');
  const table = within(history).getByRole('table');
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual([
    'Nume',
    'Tip',
    'Interval',
    'Rulată de',
    'Data',
    'Prag folosit',
    'Prag calculat',
  ]);
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows.map((row) => row.textContent)).toEqual([
    'AG toamnăAdunarea Generală01.07.2026–20.09.2026DIDănuț21.09.202610—',
    'Semestrul IVoluntar Activ01.02.2026–30.06.2026BCBianca Coman01.07.20263042',
  ]);
});

it('calls none of the retired open/close commands (R28)', async () => {
  db.runs = [RUN_VA];
  show();
  await panel('Istoricul evaluărilor');
  expect(screen.queryByRole('button', { name: /perioad/i })).toBeNull();
  const called = db.rpc.mock.calls.map(([name]) => name);
  for (const retired of [
    'open_evaluation_period',
    'close_evaluation_period',
    'set_promotion_rule',
    'retention_ranking',
    'evaluation_period_ranking',
    'promotion_threshold_in_force',
  ])
    expect(called).not.toContain(retired);
});
