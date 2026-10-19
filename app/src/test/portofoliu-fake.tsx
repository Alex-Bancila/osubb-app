import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import { answered } from './postgrest-fake';

/*
 * A small fake of the database behind Portofoliu Interne (R58): the tables
 * the page reads through `from()` and the functions it calls through `rpc()`.
 * Each RPC records its payload in `db.rpc`, and a test can make one refuse
 * with a server reason (`db.refuse`). One state for a test file: every panel
 * spec resets it in `beforeEach` with `resetDb()`.
 */

export type Run = {
  id: number;
  kind: string;
  name: string;
  period_from: string;
  period_to: string;
  run_by: string;
  run_at: string;
  threshold_used: number | null;
  threshold_computed: number | null;
  ranked_count: number;
  eligibility_floor: number | null;
  percent_used: number | null;
  membership_cutoff: string | null;
  evaluated_count: number | null;
};
export type Threshold = {
  kind: string;
  threshold: number | null;
  updated_at: string;
  updated_by: string | null;
};
export type Change = {
  id: number;
  kind: string | null;
  field?: string;
  promotion_rule_id?: number | null;
  from_value: number | null;
  to_value: number | null;
  from_date?: string | null;
  to_date?: string | null;
  source: string;
  changed_by: string | null;
  role_evaluation_id: number | null;
  changed_at: string;
};
export type Candidate = {
  id: number;
  member_id: string;
  task_points: number;
  tenure_since: string;
  role_evaluation_id: number | null;
  threshold_used: number;
  created_at: string;
  decision: string | null;
};
export type Signal = {
  id: number;
  kind: string;
  member_id: string;
  role_at_listing: string;
  reason: string;
  task_points: number | null;
  threshold_used: number | null;
  role_evaluation_id: number | null;
  created_at: string;
  closed_at: string | null;
};
/** A row of `simulate_role_evaluation` / `role_evaluation_ranking`. */
export type Ranked = {
  member_id: string;
  role: string;
  task_points: number;
  ranked: boolean;
  rank: number | null;
  evaluated_count: number;
  ranked_count: number;
  share_size: number;
  line: number | null;
  inside: boolean;
  listable: boolean;
};
export type Settings = {
  eligibility_floor: number | null;
  membership_cutoff: string | null;
  points_start_date: string | null;
  activ_percent: number;
  vot_percent: number;
  updated_at: string;
  updated_by: string | null;
};

export const db = {
  runs: [] as Run[],
  thresholds: [] as Threshold[],
  changes: [] as Change[],
  candidates: [] as Candidate[],
  signals: [] as Signal[],
  settings: {} as Settings,
  /** What `simulate_role_evaluation` answers. */
  simulation: [] as Ranked[],
  /** What `role_evaluation_ranking` answers, by run id. */
  rankings: new Map<number, Ranked[]>(),
  /** What a finalised run reports back. */
  runResult: { candidates: 2, retention_signals: 1 },
  refuse: new Map<string, { code: string; message: string }>(),
  rpc: vi.fn(),
};

/** The state every spec starts from: nothing run, the settings in force. */
export function resetDb() {
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
  db.candidates = [];
  db.signals = [];
  db.settings = {
    eligibility_floor: 10,
    membership_cutoff: '2026-03-31',
    points_start_date: null,
    activ_percent: 35,
    vot_percent: 25,
    updated_at: '2026-09-01T00:00:00Z',
    updated_by: null,
  };
  db.simulation = [];
  db.rankings = new Map();
  db.runResult = { candidates: 2, retention_signals: 1 };
  db.refuse = new Map();
  db.rpc.mockReset();
}
resetDb();

/** Only Date is faked: today is 28 September 2026 in Bucharest. */
export function freezeToday() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T09:00:00.000Z'));
}

export const RUN_VA: Run = {
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
  eligibility_floor: 10,
  percent_used: 35,
  membership_cutoff: '2026-03-31',
  evaluated_count: 12,
};
export const RUN_AG: Run = {
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
  eligibility_floor: 10,
  percent_used: 25,
  membership_cutoff: null,
  evaluated_count: 5,
};
/** A run recorded before R58: no Floor, no share, no cutoff, no count. */
export const RUN_OLD: Run = {
  id: 3,
  kind: 'voluntar_activ',
  name: 'Vechi',
  period_from: '2026-01-01',
  period_to: '2026-01-31',
  run_by: 'bc',
  run_at: '2026-02-01T09:00:00Z',
  threshold_used: 20,
  threshold_computed: 25,
  ranked_count: 6,
  eligibility_floor: null,
  percent_used: null,
  membership_cutoff: null,
  evaluated_count: null,
};

/** Six Members evaluated: Floor 10, 35 %, four ranked, the line 40. */
export function rankedRows(): Ranked[] {
  const totals = {
    evaluated_count: 6,
    ranked_count: 4,
    share_size: 2,
    line: 40,
  };
  return [
    {
      member_id: 'ion',
      role: 'voluntar',
      task_points: 55,
      ranked: true,
      rank: 1,
      inside: true,
      listable: true,
      ...totals,
    },
    {
      member_id: 'ana',
      role: 'voluntar',
      task_points: 40,
      ranked: true,
      rank: 2,
      inside: true,
      listable: false,
      ...totals,
    },
    {
      member_id: 'dan',
      role: 'activ',
      task_points: 12,
      ranked: true,
      rank: 3,
      inside: false,
      listable: false,
      ...totals,
    },
    {
      member_id: 'eva',
      role: 'vot',
      task_points: 11,
      ranked: true,
      rank: 4,
      inside: false,
      listable: false,
      ...totals,
    },
    {
      member_id: 'mia',
      role: 'activ',
      task_points: 3,
      ranked: false,
      rank: null,
      inside: false,
      listable: false,
      ...totals,
    },
    {
      member_id: 'rec',
      role: 'recrut',
      task_points: 0,
      ranked: false,
      rank: null,
      inside: false,
      listable: false,
      ...totals,
    },
  ];
}

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
          from_date: null,
          to_date: null,
          ...row,
        }));
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
    case 'retention_signals':
      return db.signals.filter((row) => row.closed_at === null);
    case 'evaluation_settings':
      return db.settings;
    default:
      throw new Error(`unexpected table ${table}`);
  }
}

function logChange(
  change: Omit<Change, 'id' | 'changed_at'> & { changed_at?: string },
) {
  db.changes.push({
    id: db.changes.length + 100,
    changed_at: '2026-09-28T11:00:00Z',
    ...change,
  });
}

const answer = async (name: string, args: Record<string, unknown>) => {
  db.rpc(name, args);
  const refusal = db.refuse.get(name);
  if (refusal) return { data: null, error: refusal };
  switch (name) {
    case 'simulate_role_evaluation':
      return { data: db.simulation, error: null };
    case 'role_evaluation_ranking':
      return {
        data: db.rankings.get(Number(args.p_role_evaluation_id)) ?? [],
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
        eligibility_floor: Number(args.p_floor),
        percent_used: Number(args.p_percent),
        membership_cutoff: (args.p_cutoff as string | undefined) ?? null,
        evaluated_count: 6,
      });
      // The values used become the settings in force (write-through).
      db.settings.eligibility_floor = Number(args.p_floor);
      if (args.p_kind === 'voluntar_activ') {
        db.settings.activ_percent = Number(args.p_percent);
        db.settings.membership_cutoff = (args.p_cutoff as string) ?? null;
      } else db.settings.vot_percent = Number(args.p_percent);
      return {
        data: [
          {
            role_evaluation_id: id,
            candidates: db.runResult.candidates,
            retention_signals: db.runResult.retention_signals,
          },
        ],
        error: null,
      };
    }
    case 'set_promotion_threshold': {
      const row = db.thresholds.find((t) => t.kind === args.p_kind);
      logChange({
        kind: String(args.p_kind),
        from_value: row?.threshold ?? null,
        to_value: Number(args.p_threshold),
        source: 'manual',
        changed_by: 'bc',
        role_evaluation_id: null,
      });
      if (row) {
        row.threshold = Number(args.p_threshold);
        row.updated_by = 'bc';
      }
      return { data: row, error: null };
    }
    case 'set_evaluation_percent': {
      const kind = String(args.p_kind);
      logChange({
        kind,
        field: 'percent',
        from_value:
          kind === 'voluntar_activ'
            ? db.settings.activ_percent
            : db.settings.vot_percent,
        to_value: Number(args.p_percent),
        source: 'manual',
        changed_by: 'bc',
        role_evaluation_id: null,
        changed_at: '2026-09-28T11:30:00Z',
      });
      if (kind === 'voluntar_activ')
        db.settings.activ_percent = Number(args.p_percent);
      else db.settings.vot_percent = Number(args.p_percent);
      return { data: null, error: null };
    }
    case 'set_eligibility_floor':
      logChange({
        kind: null,
        field: 'floor',
        from_value: db.settings.eligibility_floor,
        to_value: Number(args.p_points),
        source: 'manual',
        changed_by: 'bc',
        role_evaluation_id: null,
      });
      db.settings.eligibility_floor = Number(args.p_points);
      return { data: db.settings, error: null };
    case 'set_membership_cutoff':
      logChange({
        kind: null,
        field: 'cutoff',
        from_value: null,
        to_value: null,
        from_date: db.settings.membership_cutoff,
        to_date: String(args.p_date),
        source: 'manual',
        changed_by: 'bc',
        role_evaluation_id: null,
      });
      db.settings.membership_cutoff = String(args.p_date);
      return { data: db.settings, error: null };
    case 'set_points_start_date':
      logChange({
        kind: null,
        field: 'points_start',
        from_value: null,
        to_value: null,
        from_date: db.settings.points_start_date,
        to_date: String(args.p_date),
        source: 'manual',
        changed_by: 'bc',
        role_evaluation_id: null,
      });
      db.settings.points_start_date = String(args.p_date);
      return { data: db.settings, error: null };
    case 'reject_promotion_candidate': {
      const row = db.candidates.find((c) => c.id === args.p_candidate_id);
      if (row) row.decision = 'rejected';
      return { data: row, error: null };
    }
    default:
      throw new Error(`unexpected rpc ${name}`);
  }
};

/** The factory for `vi.mock('…/lib/supabase', …)`. */
export function supabaseMock() {
  const from = (table: string) => {
    const builder = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      eq: () => builder,
      is: () => builder,
      single: () => Promise.resolve({ data: tableRows(table), error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: tableRows(table), error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: tableRows(table), error: null }),
    };
    return builder;
  };
  // A read may page itself (`.order`, `.range`): the answer passes through.
  const rpc = (name: string, args: Record<string, unknown>) =>
    answered(answer(name, args));
  return { supabase: { from, rpc } };
}

/** The factory for `vi.mock('…/lib/auth', …)`: BC is signed in. */
export function authMock() {
  return {
    useAuth: () => ({
      session: { user: { id: 'bc' } },
      claims: { member_level: 6 },
    }),
  };
}

/** The factory for `vi.mock('…/queries/member-identities', …)`. */
export function identitiesMock() {
  const people: Record<string, [string | null, string]> = {
    bc: [null, 'Bianca Coman'],
    ana: [null, 'Ana Pop'],
    dan: ['Dănuț', 'Dan Ionescu'],
    ion: [null, 'Ion Vlad'],
    eva: [null, 'Eva Rus'],
    mia: [null, 'Mia Toma'],
    rec: [null, 'Radu Cozma'],
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
}

// oxlint-disable-next-line react/only-export-components
function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

/**
 * Mount a panel (or the page) under a query client and a router. The client
 * comes back with the render, to move the data under a page that is up.
 */
export function show(element: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/administrare/portofoliu-interne']}>
        <Routes>
          <Route path="/administrare/portofoliu-interne" element={element} />
          <Route path="/administrare/roluri" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
