import { describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import {
  fetchTaskOpportunities,
  hasOwnOrigin,
  orderOpportunities,
} from './task-opportunities';
import { memberGroupIds, type MyGroup } from './my-groups';
import type { TaskListRpcRow } from './task-lists';
import { taskRow } from '../test/task-fixtures';

function myGroup(overrides: Partial<MyGroup> = {}): MyGroup {
  return {
    id: 10,
    name: 'Educațional',
    short: 'EDU',
    category: 'department',
    color: '#123456',
    path: [10],
    min_level: 0,
    status: 'active',
    is_organization: false,
    group_role: 'member',
    explicit: true,
    automatic: false,
    ...overrides,
  };
}

// The Member sits on Group 10 (Department) and Group 30 (Project), is an
// Automatic Member of Group 5 (the Organization), and manages Group 20, which
// reaches Group 21 (its Child Team) only by inheritance.
const myGroups = [
  myGroup({ id: 5, path: [5], explicit: false, automatic: true }),
  myGroup({ id: 10 }),
  myGroup({ id: 20, path: [20], group_role: 'manager' }),
  myGroup({
    id: 21,
    path: [20, 21],
    group_role: 'manager',
    explicit: false,
    automatic: false,
  }),
  myGroup({ id: 30, path: [30], category: 'project' }),
];
const scopes = memberGroupIds(myGroups);

describe('hasOwnOrigin', () => {
  it('is true exactly when the Task’s Group is one of my_groups() I am a member of', () => {
    expect(hasOwnOrigin(taskRow({ group_id: 10 }), scopes)).toBe(true);
    expect(hasOwnOrigin(taskRow({ group_id: 30 }), scopes)).toBe(true);
    expect(hasOwnOrigin(taskRow({ group_id: 5 }), scopes)).toBe(true);
    expect(hasOwnOrigin(taskRow({ group_id: 99 }), scopes)).toBe(false);
  });

  it('never counts a Group reached only through a managed ancestor (R31)', () => {
    expect(hasOwnOrigin(taskRow({ group_id: 21 }), scopes)).toBe(false);
    expect(hasOwnOrigin(taskRow({ group_id: 20 }), scopes)).toBe(true);
  });

  it('is false for every Task when my_groups() is empty', () => {
    expect(hasOwnOrigin(taskRow({ group_id: 10 }), new Set())).toBe(false);
  });
});

describe('Available work ordering (ruling R26)', () => {
  it('orders one band by exact deadline, undated last, then title and id — never by Group', () => {
    const rows = [
      taskRow({
        id: 1,
        group_id: 99,
        audience: 'org',
        deadline: '2026-09-01T00:00:00Z',
      }),
      taskRow({ id: 2, group_id: 10, deadline: '2026-09-20T00:00:00Z' }),
      taskRow({
        id: 3,
        group_id: 30,
        deadline: '2026-09-15T10:00:00+03:00',
      }),
      taskRow({
        id: 4,
        group_id: 20,
        deadline: '2026-09-15T08:00:00Z',
      }),
      taskRow({ id: 5, group_id: 10, deadline: null, title: 'Bibliotecă' }),
      taskRow({ id: 6, group_id: 10, deadline: null, title: 'Afiș' }),
      taskRow({
        id: 7,
        group_id: 88,
        audience: 'org',
        deadline: null,
        title: 'Zar',
      }),
      taskRow({
        id: 8,
        group_id: 88,
        audience: 'org',
        deadline: '2026-10-01T00:00:00Z',
      }),
    ];
    const ordered = orderOpportunities(rows, scopes);
    // Another Group's org Opportunities (1, 7, 8) sit among the own ones.
    expect(ordered.map((row) => row.id)).toEqual([1, 3, 4, 2, 8, 6, 5, 7]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps what the Member can join and drops rows leadership can only read (R1/R3)', () => {
    const rows = [
      // Another Group's local Task, read as a BCE (R1): not listed.
      taskRow({ id: 8, group_id: 99, audience: 'local' }),
      // A Child Team's local Task, read as its Department's Manager (R3).
      taskRow({ id: 9, group_id: 21, audience: 'local' }),
      taskRow({ id: 10, group_id: 99, audience: 'org' }),
      taskRow({ id: 11, group_id: 10, audience: 'local' }),
    ];
    expect(orderOpportunities(rows, scopes).map((row) => row.id)).toEqual([
      10, 11,
    ]);
  });

  it('keeps a pending Candidature the Member cannot join, so they can withdraw', () => {
    const rows = [
      taskRow({ id: 8, group_id: 99, audience: 'local' }),
      taskRow({ id: 9, group_id: 21, audience: 'local' }),
    ];
    expect(
      orderOpportunities(rows, scopes, { pending: new Set([9]) }).map(
        ({ id, joinable }) => ({ id, joinable }),
      ),
    ).toEqual([{ id: 9, joinable: true }]);
  });

  it('lists no finished Task, even one the Member was a Candidate on (B10)', () => {
    const rows = (
      ['todo', 'in_progress', 'in_review', 'completed', 'cancelled'] as const
    ).map((status, index) =>
      taskRow({ id: index + 1, status, group_id: 10, audience: 'local' }),
    );
    rows.push(
      taskRow({ id: 6, status: 'unfulfilled', group_id: 10, audience: 'org' }),
    );
    expect(
      orderOpportunities(rows, scopes, {
        pending: new Set([4, 5, 6]),
      }).map((row) => row.id),
    ).toEqual([1, 2, 3]);
  });

  it('lists no Task the Member executes now; an ended assignment is no longer theirs (B11)', () => {
    const mine = taskRow({
      id: 1,
      status: 'in_progress',
      group_id: 10,
      assignments: [{ id: 1, member_id: 'member', ended_at: null }],
    });
    const gaveUp = taskRow({
      id: 2,
      group_id: 10,
      assignments: [
        { id: 2, member_id: 'member', ended_at: '2026-09-20T10:00:00Z' },
      ],
    });
    const someoneElse = taskRow({
      id: 3,
      status: 'in_progress',
      group_id: 10,
      assignments: [{ id: 3, member_id: 'other', ended_at: null }],
    });
    expect(
      orderOpportunities([mine, gaveUp, someoneElse], scopes, {
        memberId: 'member',
      }).map((row) => row.id),
    ).toEqual([2, 3]);
  });

  it('classifies relevant by membership and joinable by membership or org Audience', () => {
    const classified = (row: ReturnType<typeof taskRow>) => {
      const [only] = orderOpportunities([row], scopes);
      return { relevant: only?.relevant, joinable: only?.joinable };
    };
    // Own local and own org: relevant and joinable.
    expect(classified(taskRow({ group_id: 10, audience: 'local' }))).toEqual({
      relevant: true,
      joinable: true,
    });
    // The Organization Group is an Automatic Membership: always relevant.
    expect(classified(taskRow({ group_id: 5, audience: 'org' }))).toEqual({
      relevant: true,
      joinable: true,
    });
    // Another Group's org-Audience Task: joinable by every Member.
    expect(classified(taskRow({ group_id: 99, audience: 'org' }))).toEqual({
      relevant: false,
      joinable: true,
    });
    // Another Group's local-Audience Task: not joinable, so not listed.
    expect(classified(taskRow({ group_id: 99, audience: 'local' }))).toEqual({
      relevant: undefined,
      joinable: undefined,
    });
    // A Child Group reached only through a managed ancestor is not own (R31).
    expect(classified(taskRow({ group_id: 21, audience: 'local' }))).toEqual({
      relevant: undefined,
      joinable: undefined,
    });
  });
});

/** One `task_list('available')` row as the server sends it. */
function available(overrides: Partial<TaskListRpcRow> = {}): TaskListRpcRow {
  return {
    id: 1,
    group_id: 99,
    title: 'Distribuie afisul',
    description: null,
    status: 'todo',
    deadline: null,
    completed_at: null,
    review_round: 0,
    assignment_mode: 'public',
    audience: 'org',
    kind: 'task',
    parent_task_id: null,
    campaign_id: null,
    duplicated_from_task_id: null,
    queue_closed_at: null,
    links: [],
    assignments: [],
    evaluations: [],
    submission: [],
    executor: null,
    my_candidature: null,
    total: 1,
    ...overrides,
  };
}

/** A request the test answers when it chooses to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** The server: `my_groups` and `task_list` answer `groups` and `rows`. */
function serve(groups: MyGroup[], rows: TaskListRpcRow[]) {
  api.rpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === 'my_groups'
        ? { data: groups, error: null }
        : name === 'task_list'
          ? { data: rows, error: null }
          : { data: null, error: new Error(`unexpected ${name}`) },
    ),
  );
}

describe('fetchTaskOpportunities (spec 2026-10-14, part 3)', () => {
  // Fails if Disponibile goes back to reading its Tasks once the Member's
  // Groups have landed (one round trip after another), or reads them
  // through more than the one list request.
  it('reads the available list beside the Member’s Groups, one request each', async () => {
    api.rpc.mockReset();
    api.from.mockReset();
    const groups = deferred<{ data: MyGroup[]; error: null }>();
    api.rpc.mockImplementation((name: string) =>
      name === 'my_groups'
        ? groups.promise
        : Promise.resolve({ data: [available()], error: null }),
    );
    const read = fetchTaskOpportunities('member');
    // The Groups have not answered, and the list is already asked.
    expect(api.rpc).toHaveBeenCalledWith('task_list', {
      p_list: 'available',
      p_finished: false,
      p_limit: 500,
      p_offset: 0,
    });
    groups.resolve({ data: [], error: null });
    await expect(read).resolves.toHaveLength(1);
    expect(api.rpc.mock.calls.map(([name]) => name).sort()).toEqual([
      'my_groups',
      'task_list',
    ]);
    expect(api.from).not.toHaveBeenCalled();
  });

  // Fails if a pending Candidature stops coming from the row's own
  // `my_candidature`: another Group's local Task the Member is queued on
  // would lose its controls, and a withdrawn one would keep them.
  it('keeps the Tasks of pending Candidatures, and names the Executor from the row', async () => {
    api.rpc.mockReset();
    serve(
      [],
      [
        available({
          id: 1,
          executor: {
            member_id: 'executor',
            full_name: ' Executor Disponibil ',
            nickname: null,
            is_current: true,
          },
        }),
        // Another Group's local Task, its queue since closed: queued on.
        available({
          id: 2,
          audience: 'local',
          queue_closed_at: '2026-09-20T10:00:00Z',
          my_candidature: 'pending',
        }),
        // Withdrawn: nothing to act on, and not the Member's to join.
        available({ id: 3, audience: 'local', my_candidature: 'withdrawn' }),
      ],
    );
    await expect(fetchTaskOpportunities('member')).resolves.toMatchObject([
      {
        id: 1,
        relevant: false,
        joinable: true,
        visibleExecutor: {
          memberId: 'executor',
          fullName: 'Executor Disponibil',
          isCurrent: true,
        },
      },
      { id: 2, relevant: false, joinable: true, visibleExecutor: null },
    ]);
    const asked = api.rpc.mock.calls.map(([name]) => name);
    expect(asked).not.toContain('visible_task_executors');
  });

  it('reads membership live from my_groups(), so a new Appointment counts on the next read', async () => {
    api.rpc.mockReset();
    const local = available({ id: 3, group_id: 40, audience: 'local' });
    // Another Group's local Task the Member never joined is not listed (R26).
    serve([], [local]);
    await expect(fetchTaskOpportunities('member')).resolves.toEqual([]);
    serve([myGroup({ id: 40, path: [40] })], [local]);
    await expect(fetchTaskOpportunities('member')).resolves.toMatchObject([
      { id: 3, relevant: true, joinable: true },
    ]);
  });

  it('lists no Task the Member executes now, and orders by deadline', async () => {
    api.rpc.mockReset();
    serve(
      [],
      [
        available({ id: 5, deadline: '2026-10-20T10:00:00Z' }),
        available({
          id: 6,
          status: 'in_progress',
          assignments: [{ id: 9, member_id: 'member', ended_at: null }],
        }),
        available({ id: 7, deadline: '2026-10-18T10:00:00Z' }),
      ],
    );
    const offered = await fetchTaskOpportunities('member');
    expect(offered.map((task) => task.id)).toEqual([7, 5]);
  });

  it('propagates a refusal of either read', async () => {
    api.rpc.mockReset();
    const error = new Error('offline');
    api.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'task_list'
          ? { data: null, error }
          : { data: [], error: null },
      ),
    );
    await expect(fetchTaskOpportunities('member')).rejects.toBe(error);
  });
});
