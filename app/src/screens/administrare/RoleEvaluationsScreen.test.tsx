import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pickDate } from '../../test/date-picker';

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

vi.mock('../../lib/supabase', async () => {
  const { answered } = await import('../../test/postgrest-fake');
  const from = (table: string) => {
    const builder = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      eq: () => builder,
      is: () => builder,
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
  const answer = async (name: string, args: Record<string, unknown>) => {
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

/** The page's one kind switch: it drives the form, Praguri and the results. */
const chooseKind = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(
    within(screen.getByRole('radiogroup', { name: 'Tip' })).getByRole('radio', {
      name,
    }),
  );

/** The threshold/rule log, a panel of its own under the page. */
const changeLog = async () =>
  within(await panel('Istoricul modificărilor')).findByRole('list', {
    name: 'Istoricul modificărilor',
  });

it('runs a Voluntar Activ Role Evaluation after a confirmation that names its consequences', async () => {
  db.runs = [RUN_VA];
  const user = userEvent.setup();
  const { container } = show();
  const run = await panel('Rulează o evaluare de rol');
  // De la: the day after the kind's last range; Până la: today.
  // Both are the app's picker, reading short and Romanian; no browser field.
  const from = within(run).getByLabelText('De la');
  expect(from).toHaveAttribute('data-slot', 'date-picker');
  expect(from).toHaveAttribute('data-value', '2026-07-01');
  expect(from).toHaveTextContent('mie., 1 iul. 2026');
  expect(within(run).getByLabelText('Până la')).toHaveAttribute(
    'data-value',
    '2026-09-28',
  );
  expect(run.querySelector('input[type="date"]')).toBeNull();
  // Tip is one choice of three for the whole page — the two kinds and the
  // promotion by tenure — a radio group above the panels, not a field of the
  // form.
  const kinds = screen.getByRole('radiogroup', { name: 'Tip' });
  expect(within(run).queryByRole('radiogroup')).toBeNull();
  expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
  expect(
    within(kinds).getByRole('radio', { name: 'Voluntar Activ' }),
  ).toBeChecked();
  expect(
    within(kinds).getByRole('radio', { name: 'Adunarea Generală' }),
  ).not.toBeChecked();
  expect(
    within(kinds)
      .getAllByRole('radio')
      .map((radio) => radio.textContent),
  ).toEqual(['Voluntar Activ', 'Adunarea Generală', 'Vechime']);
  expect(within(run).getByLabelText('Nume')).toHaveAttribute(
    'data-slot',
    'input',
  );

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
  expect(within(run).getByLabelText('De la')).toHaveAttribute('data-value', '');
  expect(within(run).getByLabelText('Până la')).toHaveAttribute(
    'data-value',
    '2026-09-28',
  );
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
  await chooseKind(user, 'Adunarea Generală');
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
      name: 'Editează pragul Adunării Generale',
    }),
  );
  // The pencil hands focus to the field it opened.
  expect(
    within(thresholds).getByLabelText('Pragul Adunării Generale'),
  ).toHaveFocus();
  await user.type(
    within(thresholds).getByLabelText('Pragul Adunării Generale'),
    '12',
  );
  await user.click(
    within(thresholds).getByRole('button', { name: 'Salvează' }),
  );
  await waitFor(() => expect(button).toBeEnabled());

  await pickDate(user, within(run).getByLabelText('De la'), '2026-07-01');
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
  expect(within(run).getByLabelText('De la')).toHaveAttribute('data-value', '');
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

  await pickDate(user, within(run).getByLabelText('De la'), '2026-09-01');
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
  const log = await changeLog();
  expect(
    within(log)
      .getAllByRole('listitem')
      .map((row) => row.textContent),
  ).toEqual([
    '01.07.2026 · Voluntar Activ30 → 42·evaluarea „Semestrul I”',
    '01.06.2026 · Voluntar Activnesetat → 30·DIDănuț',
  ]);
  // A row: the name, then the value in force at its end.
  expect(thresholds).toHaveTextContent('Pragul Voluntar Activ42 de puncte');
  expect(thresholds).toHaveTextContent('calculat de evaluarea „Semestrul I”');
  // Only the chosen kind's numbers: the other kind's are behind the switch.
  expect(thresholds).not.toHaveTextContent('Adunării Generale');
  await chooseKind(user, 'Adunarea Generală');
  expect(thresholds).toHaveTextContent('Pragul Adunării GeneraleNesetat');
  expect(thresholds).not.toHaveTextContent('Voluntar Activ');
  expect(thresholds).not.toHaveTextContent('42 de puncte');
  await chooseKind(user, 'Voluntar Activ');

  // One pencil per row, and no filled button but the run form's.
  const edit = within(thresholds).getByRole('button', {
    name: 'Editează pragul Voluntar Activ',
  });
  expect(edit.querySelector('svg')).not.toBeNull();
  expect(edit).toHaveTextContent('');
  await user.click(edit);
  // The page's one filled button stays the run form's.
  expect(
    within(thresholds).getByRole('button', { name: 'Salvează' }),
  ).not.toHaveClass('bg-primary');
  expect(
    [...document.querySelectorAll('button, a')].filter((control) =>
      control.classList.contains('bg-primary'),
    ),
  ).toEqual([screen.getByRole('button', { name: 'Rulează evaluarea' })]);
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
    expect(within(log).getAllByRole('listitem')[0]).toHaveTextContent(
      '28.09.2026 · Voluntar Activ42 → 35·BCBianca Coman',
    ),
  );
  expect(thresholds).toHaveTextContent('introdus deBCBianca Coman');
  // Back from the editor, focus returns to the pencil that opened it.
  expect(
    within(thresholds).getByRole('button', {
      name: 'Editează pragul Voluntar Activ',
    }),
  ).toHaveFocus();

  // One receipt at a time (F-11): the share's replaces the threshold's.
  await user.click(
    within(thresholds).getByRole('button', {
      name: 'Editează procentul Voluntar Activ',
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
  await waitFor(() =>
    expect(thresholds).toHaveTextContent('Procentul Voluntar Activ20 %'),
  );
  // y is the other kind's: shown only once that kind is chosen.
  expect(thresholds).not.toHaveTextContent('25 %');
  await chooseKind(user, 'Adunarea Generală');
  expect(thresholds).toHaveTextContent('Procentul Adunării Generale25 %');
  expect(thresholds).not.toHaveTextContent('20 %');
  await chooseKind(user, 'Voluntar Activ');

  await user.click(
    within(thresholds).getByRole('button', {
      name: 'Editează procentul Voluntar Activ',
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
      'Procentul Voluntar Activ35 %schimbat deBCBianca Coman',
    ),
  );
  const log = await changeLog();
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
  await chooseKind(user, 'Adunarea Generală');
  await user.click(
    await within(thresholds).findByRole('button', {
      name: 'Editează procentul Adunării Generale',
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

/** A Promotion Rule's row, named by the Roles it joins (#935). */
const ruleRow = (label: string) =>
  screen.findByRole('listitem', { name: label });

/** The page's blocks a member can see: its panels' titles, in order. */
const shownPanels = () =>
  screen
    .getAllByRole('heading', { level: 2 })
    .map((title) => title.textContent);

it('puts each Promotion Rule where it belongs: the candidates’ rule with Voluntar Activ, Recrut → Voluntar under Vechime (#935)', async () => {
  db.rules = db.rules.map((rule) =>
    rule.kind === 'top_percent'
      ? { ...rule, min_tenure_months: 24, enabled: false }
      : rule,
  );
  const user = userEvent.setup();
  show();
  const thresholds = await panel('Praguri');
  const top = await ruleRow('Voluntar → Voluntar Activ');
  // The rule a Voluntar Activ evaluation reads sits with that kind's numbers;
  // the daily job's rule is no kind's, and no panel under a kind shows it.
  expect(thresholds).toContainElement(top);
  expect(top).toHaveTextContent('24 de luni');
  // The row says the state; it is not a control (a rule changes on Salvează).
  expect(within(top).queryByRole('switch')).toBeNull();
  expect(top.querySelector('[data-slot="rule-state"]')).toHaveTextContent(
    'Oprită',
  );
  // What an off rule stops stays on the row.
  expect(
    within(top).getByText(
      'Oprită: nimeni nu mai devine candidat la promovare.',
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole('listitem', { name: 'Recrut → Voluntar' }),
  ).toBeNull();
  expect(
    screen.queryByRole('heading', { name: 'Promovare după vechime' }),
  ).toBeNull();

  // Vechime is a page of its own: the rule, and nothing of either kind.
  await chooseKind(user, 'Vechime');
  const tenure = await panel('Promovare după vechime');
  const time = await ruleRow('Recrut → Voluntar');
  expect(tenure).toContainElement(time);
  expect(shownPanels()).toEqual(['Promovare după vechime']);
  expect(
    screen.queryByRole('listitem', { name: 'Voluntar → Voluntar Activ' }),
  ).toBeNull();

  // The tenure is the value, a chip the state, and what the rule does is
  // behind its "i".
  expect(time).toHaveTextContent('Recrut → VoluntarVechime cerută: 6 luni');
  expect(within(time).queryByRole('switch')).toBeNull();
  expect(time.querySelector('[data-slot="rule-state"]')).toHaveTextContent(
    'Pornită',
  );
  expect(time).not.toHaveTextContent('Zilnic');
  await user.click(
    within(time).getByRole('button', {
      name: 'Despre regula Recrut → Voluntar',
    }),
  );
  expect(
    await screen.findByText(
      'Zilnic, fiecare Recrut care a împlinit vechimea devine automat Voluntar.',
    ),
  ).toBeVisible();
  await user.keyboard('{Escape}');

  // Under Adunarea Generală neither rule shows: the candidates' is Voluntar
  // Activ's, the tenure one Vechime's.
  await chooseKind(user, 'Adunarea Generală');
  expect(shownPanels()).toEqual(['Rulează o evaluare de rol', 'Praguri']);
  expect(screen.queryByRole('listitem', { name: /→/ })).toBeNull();
});

it('keeps Vechime to the tenure rule’s own changes, and a kind’s log whole', async () => {
  db.runs = [RUN_VA];
  db.changes = [
    {
      id: 1,
      kind: 'voluntar_activ',
      from_value: null,
      to_value: 30,
      source: 'manual',
      changed_by: 'bianca',
      role_evaluation_id: null,
      changed_at: '2026-06-01T08:00:00Z',
    },
    {
      id: 2,
      kind: null,
      field: 'tenure',
      promotion_rule_id: 1,
      from_value: 6,
      to_value: 3,
      source: 'manual',
      changed_by: 'bianca',
      role_evaluation_id: null,
      changed_at: '2026-06-02T08:00:00Z',
    },
    {
      id: 3,
      kind: null,
      field: 'tenure',
      promotion_rule_id: 2,
      from_value: 6,
      to_value: 12,
      source: 'manual',
      changed_by: 'bianca',
      role_evaluation_id: null,
      changed_at: '2026-06-03T08:00:00Z',
    },
  ];
  const user = userEvent.setup();
  show();
  await waitFor(async () =>
    expect(within(await changeLog()).getAllByRole('listitem')).toHaveLength(3),
  );
  await chooseKind(user, 'Vechime');
  // The run form, Praguri, the candidates, the signals and the runs' history
  // are the kinds'; the log keeps to Recrut → Voluntar.
  expect(shownPanels()).toEqual([
    'Promovare după vechime',
    'Istoricul modificărilor',
  ]);
  expect(
    within(await changeLog())
      .getAllByRole('listitem')
      .map((row) => row.textContent),
  ).toEqual([
    expect.stringContaining('Recrut → Voluntar · vechime6 luni → 3 luni'),
  ]);

  // Back on a kind, everything it showed is there again.
  await chooseKind(user, 'Voluntar Activ');
  expect(shownPanels()).not.toContain('Promovare după vechime');
  expect(shownPanels()).toEqual(
    expect.arrayContaining([
      'Rulează o evaluare de rol',
      'Praguri',
      'Istoricul evaluărilor',
      'Istoricul modificărilor',
    ]),
  );
  expect(within(await changeLog()).getAllByRole('listitem')).toHaveLength(3);
});

it('changes a Promotion Rule only from its editor, on Salvează — never from the row', async () => {
  const user = userEvent.setup();
  show();
  const top = await ruleRow('Voluntar → Voluntar Activ');
  // The row offers no switch: nothing to mis-tap.
  expect(within(top).queryByRole('switch')).toBeNull();
  expect(db.rpc).not.toHaveBeenCalledWith(
    'update_promotion_rule',
    expect.anything(),
  );

  await user.click(
    within(top).getByRole('button', {
      name: 'Editează regula Voluntar → Voluntar Activ',
    }),
  );
  const toggle = within(top).getByRole('switch', {
    name: 'Regula este pornită',
  });
  const before = toggle.getAttribute('aria-checked');
  await user.click(toggle);
  // Flipping the switch in the editor sends nothing yet.
  expect(db.rpc).not.toHaveBeenCalledWith(
    'update_promotion_rule',
    expect.anything(),
  );
  await user.click(within(top).getByRole('button', { name: 'Salvează' }));
  expect(db.rpc).toHaveBeenCalledWith(
    'update_promotion_rule',
    expect.objectContaining({
      p_rule_id: 2,
      p_enabled: before !== 'true',
    }),
  );
  expect(await within(top).findByText('Regula a fost salvată.')).toBeVisible();
});

it('edits a Promotion Rule’s tenure and on/off with the #923 row pattern, logged with its author (#935)', async () => {
  const user = userEvent.setup();
  show();
  await panel('Praguri');
  await chooseKind(user, 'Vechime');
  const time = await ruleRow('Recrut → Voluntar');
  await user.click(
    within(time).getByRole('button', {
      name: 'Editează regula Recrut → Voluntar',
    }),
  );
  const input = within(time).getByLabelText('Vechime cerută');
  expect(input).toHaveValue(6);
  expect(input).toHaveFocus();
  // Nothing changed yet: nothing to save.
  const save = within(time).getByRole('button', { name: 'Salvează' });
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
  const toggle = within(time).getByRole('switch', {
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

  expect(await within(time).findByText('Regula a fost salvată.')).toBeVisible();
  await waitFor(() =>
    expect(
      within(time).getByRole('button', {
        name: 'Editează regula Recrut → Voluntar',
      }),
    ).toHaveFocus(),
  );
  await waitFor(() => expect(time).toHaveTextContent('2 luni'));
  expect(time).toHaveTextContent('Oprită');
  expect(time).toHaveTextContent('schimbată deBCBianca Coman');

  const log = await changeLog();
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
  await chooseKind(user, 'Voluntar Activ');
  expect(await panel('Praguri')).not.toHaveTextContent('introdus de');
});

it('Renunță closes the rule editor without saving', async () => {
  const user = userEvent.setup();
  show();
  const top = await ruleRow('Voluntar → Voluntar Activ');
  await user.click(
    within(top).getByRole('button', {
      name: 'Editează regula Voluntar → Voluntar Activ',
    }),
  );
  const input = within(top).getByLabelText('Vechime cerută');
  await user.clear(input);
  await user.type(input, '3');
  await user.click(within(top).getByRole('button', { name: 'Renunță' }));
  expect(within(top).queryByLabelText('Vechime cerută')).toBeNull();
  expect(top).toHaveTextContent('6 luni');
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
  const top = await ruleRow('Voluntar → Voluntar Activ');
  await user.click(
    within(top).getByRole('button', {
      name: 'Editează regula Voluntar → Voluntar Activ',
    }),
  );
  await user.click(
    within(top).getByRole('switch', { name: 'Regula este pornită' }),
  );
  await user.click(within(top).getByRole('button', { name: 'Salvează' }));
  expect(
    await within(top).findByText(
      'Doar BC și Moderatorul pot schimba regulile de promovare.',
    ),
  ).toBeVisible();
  // The editor stays open for another try.
  expect(within(top).getByLabelText('Vechime cerută')).toBeVisible();
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
  // No eyebrow over the title, and no filled button in the list.
  expect(document.querySelector('[data-slot="section-eyebrow"]')).toBeNull();
  const list = await within(candidates).findByRole('list', {
    name: 'Candidați la promovare',
  });
  expect(
    within(list).getByRole('link', { name: 'Promovează: Ana Pop' }),
  ).not.toHaveClass('bg-primary');
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
  const user = userEvent.setup();
  show();
  const signals = await panel('Semnale de retenție');
  // The chosen kind's signals, and only its.
  expect(signals).toHaveTextContent(
    'Semestrul I · 01.02.2026–30.06.2026 · pragul 30',
  );
  expect(signals).not.toHaveTextContent('AG toamnă');
  const list = await within(signals).findByRole('list', {
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
  expect(db.rpc).toHaveBeenCalledWith('role_evaluation_ranking', {
    p_kind: 'voluntar_activ',
    p_from: '2026-02-01',
    p_to: '2026-06-30',
  });

  await chooseKind(user, 'Adunarea Generală');
  const ag = await panel('Semnale de retenție');
  expect(ag).toHaveTextContent('AG toamnă · 01.07.2026–20.09.2026 · pragul 10');
  expect(ag).not.toHaveTextContent('Semestrul I');
  expect(
    await within(ag).findByText('Niciun semnal la ultima evaluare.'),
  ).toBeVisible();
  // Promotion Candidates wait for a decision under either kind.
  expect(
    screen.getByRole('heading', { name: 'Candidați la promovare' }),
  ).toBeVisible();
});

it('shows only Run and Praguri under a kind, and only the tenure rule under Vechime, before the first run (B58)', async () => {
  const user = userEvent.setup();
  const { container } = show();
  await panel('Rulează o evaluare de rol');
  await panel('Praguri');
  // No empty candidates, signals, history or threshold-log blocks — and no
  // tenure rule under a kind.
  expect(
    [...container.querySelectorAll('[data-slot="panel"] h2')].map(
      (heading) => heading.textContent,
    ),
  ).toEqual(['Rulează o evaluare de rol', 'Praguri']);
  await chooseKind(user, 'Vechime');
  expect(shownPanels()).toEqual(['Promovare după vechime']);
  await chooseKind(user, 'Voluntar Activ');
  // Titles only: no eyebrow, no paragraph under a title.
  expect(container.querySelector('[data-slot="section-eyebrow"]')).toBeNull();
  expect(container).not.toHaveTextContent('Clasează punctele de task');
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

// Fails if the candidates wait for a run: since #983 a Voluntar becomes a
// candidate the moment their points reach the threshold, with no run at all
// (the Legacy Import listed 64 that way), and their Notifications lead here.
it('lists live Promotion Candidates before the first run, and only them (B58, #983)', async () => {
  db.candidates = [
    {
      id: 9,
      member_id: 'ana',
      task_points: 48,
      tenure_since: '2026-03-15',
      role_evaluation_id: null,
      threshold_used: 30,
      created_at: '2026-10-17T09:00:00Z',
      decision: null,
    },
  ];
  show();
  const candidates = await panel('Candidați la promovare');
  const list = await within(candidates).findByRole('list', {
    name: 'Candidați la promovare',
  });
  expect(
    within(list).getByRole('link', { name: 'Promovează: Ana Pop' }),
  ).toBeVisible();
  // The other panels still wait for their first row.
  expect(shownPanels()).toEqual([
    'Rulează o evaluare de rol',
    'Praguri',
    'Candidați la promovare',
  ]);
});

it('says when a kind has never run, once another kind has', async () => {
  db.runs = [RUN_VA];
  db.rankings.set('voluntar_activ:2026-02-01:2026-06-30', []);
  const user = userEvent.setup();
  show();
  expect(await panel('Candidați la promovare')).toBeVisible();
  expect(await panel('Istoricul evaluărilor')).toBeVisible();
  await chooseKind(user, 'Adunarea Generală');
  expect(
    within(await panel('Semnale de retenție')).getByText(
      'Nicio evaluare de acest tip încă.',
    ),
  ).toBeVisible();
  // The history is a record of both kinds: it stays.
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

it('lists the runs as rows under the width the table’s seven columns fit, so nothing scrolls sideways', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  try {
    db.runs = [RUN_VA, RUN_AG];
    show();
    const history = await panel('Istoricul evaluărilor');
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 80rem)');
    expect(within(history).queryByRole('table')).toBeNull();
    const rows = within(
      within(history).getByRole('list', { name: 'Istoricul evaluărilor' }),
    ).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'AG toamnăAdunarea Generală · 01.07.2026–20.09.2026Rulată deDIDănuț·21.09.2026Prag folosit 10 · prag calculat —',
      'Semestrul IVoluntar Activ · 01.02.2026–30.06.2026Rulată deBCBianca Coman·01.07.2026Prag folosit 30 · prag calculat 42',
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
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
