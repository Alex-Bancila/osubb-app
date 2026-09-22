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

describe('Available work ordering', () => {
  it('puts own Origins first, with exact-instant deadlines and deterministic ties', () => {
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
    ];
    expect(orderOpportunities(rows, scopes).map((row) => row.id)).toEqual([
      3, 4, 2, 1,
    ]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4]);
  });

  it('offers an org-audience Task regardless of own Group membership', () => {
    const orgTask = taskRow({ id: 7, group_id: 99, audience: 'org' });
    expect(orderOpportunities([orgTask], scopes)).toEqual([orgTask]);
    expect(orderOpportunities([orgTask], new Set())).toEqual([orgTask]);
  });

  it('drops a local Task outside my Groups, including a managed Child Group', () => {
    expect(
      orderOpportunities(
        [
          taskRow({ id: 8, group_id: 99, audience: 'local' }),
          taskRow({ id: 9, group_id: 21, audience: 'local' }),
        ],
        scopes,
      ),
    ).toEqual([]);
  });

  it('retains existing participation and overdue opportunities', () => {
    const closedLocal = taskRow({
      id: 19,
      group_id: 99,
      audience: 'local',
      deadline: '2020-01-01T00:00:00Z',
    });
    expect(orderOpportunities([closedLocal], scopes, new Set([19]))).toEqual([
      closedLocal,
    ]);
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
    is: vi.fn(),
    in: vi.fn(),
  };
  openQuery.select.mockReturnValue(openQuery);
  openQuery.eq.mockReturnValue(openQuery);
  openQuery.is.mockReturnValue(openQuery);
  openQuery.in.mockResolvedValue({ data: openTasks, error: null });
  const participatedQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({ data: participated, error: null }),
  };
  participatedQuery.select.mockReturnValue(participatedQuery);
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

it('keeps an own candidature after its queue closes without broadening other rows', async () => {
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
      visibleExecutor: {
        memberId: 'executor',
        fullName: 'Executor Disponibil',
      },
    },
    { id: 2, visibleExecutor: null },
  ]);
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
  await expect(fetchTaskOpportunities('member')).resolves.toEqual([]);

  appointed = true;
  mockTaskReads([local], [], []);
  await expect(fetchTaskOpportunities('member')).resolves.toMatchObject([
    { id: 3 },
  ]);
  expect(api.rpc).toHaveBeenCalledWith('my_groups');
  expect(api.from).not.toHaveBeenCalledWith('member_departments');
  expect(api.from).not.toHaveBeenCalledWith('team_members');
  expect(api.from).not.toHaveBeenCalledWith('project_members');
});
