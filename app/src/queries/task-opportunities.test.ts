import { describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import {
  fetchTaskOpportunities,
  hasOwnOrigin,
  orderOpportunities,
} from './task-opportunities';
import { memberGroupIds, type MyGroup } from './my-groups';
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

describe('Available work ordering (ruling R10)', () => {
  it('puts the own band first, each band by exact deadline, undated last, then title and id', () => {
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
      taskRow({ id: 7, group_id: 88, deadline: null }),
      taskRow({ id: 8, group_id: 88, deadline: '2026-10-01T00:00:00Z' }),
    ];
    const ordered = orderOpportunities(rows, scopes);
    expect(ordered.map((row) => row.id)).toEqual([3, 4, 2, 6, 5, 1, 8, 7]);
    expect(ordered.map((row) => row.relevant)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps every row the server returned — no Audience filter', () => {
    const rows = [
      taskRow({ id: 8, group_id: 99, audience: 'local' }),
      taskRow({ id: 9, group_id: 21, audience: 'local' }),
      taskRow({ id: 10, group_id: 99, audience: 'org' }),
    ];
    expect(orderOpportunities(rows, scopes).map((row) => row.id)).toEqual([
      8, 9, 10,
    ]);
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
    // Another Group's org-Audience Task: other, but joinable.
    expect(classified(taskRow({ group_id: 99, audience: 'org' }))).toEqual({
      relevant: false,
      joinable: true,
    });
    // Another Group's local-Audience Task: other and not joinable.
    expect(classified(taskRow({ group_id: 99, audience: 'local' }))).toEqual({
      relevant: false,
      joinable: false,
    });
    // A Child Group reached only through a managed ancestor is not own (R31).
    expect(classified(taskRow({ group_id: 21, audience: 'local' }))).toEqual({
      relevant: false,
      joinable: false,
    });
  });
});

function mockTaskReads(
  openTasks: ReturnType<typeof taskRow>[],
  participated: ReturnType<typeof taskRow>[],
  candidatures: { task_id: number }[],
) {
  const openQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
  };
  openQuery.select.mockReturnValue(openQuery);
  openQuery.order.mockReturnValue(openQuery);
  openQuery.limit.mockReturnValue(openQuery);
  openQuery.eq.mockReturnValue(openQuery);
  openQuery.is.mockReturnValue(openQuery);
  openQuery.in.mockResolvedValue({ data: openTasks, error: null });
  const participatedQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    in: vi.fn().mockResolvedValue({ data: participated, error: null }),
  };
  participatedQuery.select.mockReturnValue(participatedQuery);
  participatedQuery.order.mockReturnValue(participatedQuery);
  participatedQuery.limit.mockReturnValue(participatedQuery);
  participatedQuery.eq.mockReturnValue(participatedQuery);
  let taskQueryCount = 0;
  api.from.mockImplementation((table: string) => {
    if (table === 'tasks')
      return taskQueryCount++ === 0 ? openQuery : participatedQuery;
    if (table === 'task_candidates')
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: candidatures, error: null }),
        }),
      };
    throw new Error(`unexpected table ${table}`);
  });
  return { openQuery, participatedQuery };
}

it('keeps an own Candidature after its queue closes, in its Group’s band', async () => {
  const openTask = taskRow({ id: 1, group_id: 99, audience: 'org' });
  const participatedTask = taskRow({
    id: 2,
    status: 'completed',
    audience: 'local',
    group_id: 99,
  });
  const { openQuery, participatedQuery } = mockTaskReads(
    [openTask],
    [participatedTask],
    [{ task_id: 2 }],
  );
  api.rpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === 'my_groups'
        ? { data: [], error: null }
        : {
            data: [
              {
                task_id: 1,
                member_id: 'executor',
                full_name: 'Executor Disponibil',
              },
            ],
            error: null,
          },
    ),
  );

  await expect(fetchTaskOpportunities('member')).resolves.toMatchObject([
    {
      id: 1,
      relevant: false,
      joinable: true,
      visibleExecutor: {
        memberId: 'executor',
        fullName: 'Executor Disponibil',
      },
    },
    // A Candidature never lifts a row into the own band.
    { id: 2, relevant: false, joinable: false, visibleExecutor: null },
  ]);
  // Each card's latest Submission Note comes in the same request (#685).
  for (const query of [openQuery, participatedQuery]) {
    expect(query.eq).toHaveBeenCalledWith('submission.kind', 'submitted');
    expect(query.limit).toHaveBeenCalledWith(1, {
      referencedTable: 'submission',
    });
  }
  expect(openQuery.is).toHaveBeenCalledWith('queue_closed_at', null);
  expect(openQuery.in).toHaveBeenCalledWith('status', [
    'todo',
    'in_progress',
    'in_review',
  ]);
  expect(participatedQuery.in).toHaveBeenCalledWith('id', [2]);
  expect(api.rpc).toHaveBeenCalledWith('visible_task_executors', {
    p_task_ids: [1, 2],
  });
});

it('reads membership live from my_groups(), so a new Appointment counts on the next refetch', async () => {
  const local = taskRow({ id: 3, group_id: 40, audience: 'local' });
  let appointed = false;
  api.rpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === 'my_groups'
        ? {
            data: appointed ? [myGroup({ id: 40, path: [40] })] : [],
            error: null,
          }
        : { data: [], error: null },
    ),
  );

  mockTaskReads([local], [], []);
  await expect(fetchTaskOpportunities('member')).resolves.toMatchObject([
    { id: 3, relevant: false, joinable: false },
  ]);

  appointed = true;
  mockTaskReads([local], [], []);
  await expect(fetchTaskOpportunities('member')).resolves.toMatchObject([
    { id: 3, relevant: true, joinable: true },
  ]);
  expect(api.rpc).toHaveBeenCalledWith('my_groups');
  expect(api.from).not.toHaveBeenCalledWith('member_departments');
  expect(api.from).not.toHaveBeenCalledWith('team_members');
  expect(api.from).not.toHaveBeenCalledWith('project_members');
});
