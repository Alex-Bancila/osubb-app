import { answered } from '../test/postgrest-fake';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: mocks }));
import {
  FINISHED_PAGE,
  fetchFinishedPage,
  fetchOpenTasks,
  fetchTaskListSummary,
  fetchTaskManageCapability,
  fetchTaskReadable,
  fetchTasksInRange,
  finishedTasksQueryOptions,
  summaryWork,
  taskListRow,
  withLabels,
  type TaskListRpcRow,
} from './task-lists';

/** One `task_list` row as the server sends it. */
function rpcRow(overrides: Partial<TaskListRpcRow> = {}): TaskListRpcRow {
  return {
    id: 1,
    group_id: 10,
    title: 'Afiș',
    description: null,
    status: 'completed',
    deadline: '2026-03-10T10:00:00+00:00',
    completed_at: '2026-03-09T10:00:00+00:00',
    review_round: 0,
    assignment_mode: 'direct',
    audience: 'local',
    kind: 'task',
    parent_task_id: null,
    campaign_id: 7,
    duplicated_from_task_id: null,
    queue_closed_at: null,
    links: [],
    assignments: [
      { id: 3, member_id: 'ana', ended_at: '2026-03-09T10:00:00+00:00' },
    ],
    evaluations: [
      { id: 5, difficulty: 3, rating: 4, points: 6, reversed_at: null },
    ],
    submission: [],
    executor: {
      member_id: 'ana',
      full_name: ' Ana Pop ',
      nickname: null,
      is_current: false,
    },
    total: 1,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('taskListRow', () => {
  it('keeps the Task and its history, and names the Executor as the cards read it', () => {
    expect(taskListRow(rpcRow())).toEqual({
      id: 1,
      group_id: 10,
      title: 'Afiș',
      description: null,
      status: 'completed',
      deadline: '2026-03-10T10:00:00+00:00',
      completed_at: '2026-03-09T10:00:00+00:00',
      review_round: 0,
      assignment_mode: 'direct',
      audience: 'local',
      kind: 'task',
      parent_task_id: null,
      campaign_id: 7,
      duplicated_from_task_id: null,
      queue_closed_at: null,
      links: [],
      assignments: [
        { id: 3, member_id: 'ana', ended_at: '2026-03-09T10:00:00+00:00' },
      ],
      evaluations: [
        { id: 5, difficulty: 3, rating: 4, points: 6, reversed_at: null },
      ],
      submission: [],
      visibleExecutor: {
        memberId: 'ana',
        fullName: 'Ana Pop',
        nickname: null,
        isCurrent: false,
      },
    });
  });

  it('says there is no Executor when the server found none', () => {
    expect(taskListRow(rpcRow({ executor: null })).visibleExecutor).toBeNull();
  });
});

describe('withLabels', () => {
  const groups = new Map([
    [
      10,
      {
        id: 10,
        name: 'Educațional',
        short: 'EDU',
        color: '#0a7d4f',
        category: 'department',
        path: [10],
        is_organization: false,
        is_private: false,
      },
    ],
  ]);
  const campaigns = [{ id: 7, name: 'Toamnă' }];

  it('joins the Group and the Campaign the Member can read', () => {
    const [row] = withLabels([taskListRow(rpcRow())], groups, campaigns);
    expect(row?.group).toEqual({
      name: 'Educațional',
      short: 'EDU',
      color: '#0a7d4f',
      category: 'department',
      path: [10],
      is_organization: false,
      is_private: false,
    });
    expect(row?.campaign).toEqual({ name: 'Toamnă' });
  });

  it('leaves a Group or Campaign RLS withheld as null, never an id', () => {
    const [row] = withLabels(
      [taskListRow(rpcRow({ group_id: 99, campaign_id: 8 }))],
      groups,
      campaigns,
    );
    expect(row?.group).toBeNull();
    expect(row?.campaign).toBeNull();
  });

  it('has no Campaign for a Task that carries none', () => {
    const [row] = withLabels(
      [taskListRow(rpcRow({ campaign_id: null }))],
      groups,
      campaigns,
    );
    expect(row?.campaign).toBeNull();
  });
});

describe('fetchOpenTasks', () => {
  it('reads the open Tasks of a list in one request', async () => {
    mocks.rpc.mockResolvedValue({
      data: [rpcRow({ id: 4, status: 'todo' })],
      error: null,
    });
    const rows = await fetchOpenTasks('managed');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('task_list', {
      p_list: 'managed',
      p_finished: false,
      p_limit: 500,
      p_offset: 0,
    });
    expect(rows.map((row) => row.id)).toEqual([4]);
  });

  it('asks for the next 500 only after a full page', async () => {
    const full = Array.from({ length: 500 }, (_, index) =>
      rpcRow({ id: index + 1, status: 'todo' }),
    );
    mocks.rpc
      .mockResolvedValueOnce({ data: full, error: null })
      .mockResolvedValueOnce({
        data: [rpcRow({ id: 501, status: 'todo' })],
        error: null,
      });
    const rows = await fetchOpenTasks('all');
    expect(rows).toHaveLength(501);
    expect(mocks.rpc.mock.calls.map(([, args]) => args)).toEqual([
      { p_list: 'all', p_finished: false, p_limit: 500, p_offset: 0 },
      { p_list: 'all', p_finished: false, p_limit: 500, p_offset: 500 },
    ]);
  });

  it('propagates a refusal', async () => {
    const error = { code: '42501', message: 'denied' };
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(fetchOpenTasks('managed')).rejects.toBe(error);
  });
});

describe('fetchFinishedPage', () => {
  it('sends the filters, the order and the page, and returns the total', async () => {
    mocks.rpc.mockResolvedValue({
      data: [rpcRow({ id: 9, total: 120 }), rpcRow({ id: 8, total: 120 })],
      error: null,
    });
    const page = await fetchFinishedPage(
      'managed',
      {
        p_group_id: 3,
        p_campaign_id: 7,
        p_from: '2026-03-01T00:00:00.000Z',
        p_to: '2026-04-01T00:00:00.000Z',
        p_state: 'late',
        p_search: 'afis',
        p_preferred: true,
        p_sort: 'title',
      },
      50,
    );
    expect(mocks.rpc).toHaveBeenCalledWith('task_list', {
      p_list: 'managed',
      p_finished: true,
      p_group_id: 3,
      p_campaign_id: 7,
      p_from: '2026-03-01T00:00:00.000Z',
      p_to: '2026-04-01T00:00:00.000Z',
      p_state: 'late',
      p_search: 'afis',
      p_preferred: true,
      p_sort: 'title',
      p_limit: FINISHED_PAGE,
      p_offset: 50,
    });
    expect(page.total).toBe(120);
    expect(page.rows.map((row) => row.id)).toEqual([9, 8]);
  });

  it('counts nothing when the page is empty', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchFinishedPage('all', {}, 0)).resolves.toEqual({
      rows: [],
      total: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('task_list', {
      p_list: 'all',
      p_finished: true,
      p_limit: FINISHED_PAGE,
      p_offset: 0,
    });
  });
});

describe('finishedTasksQueryOptions', () => {
  const options = finishedTasksQueryOptions('managed', {}, 'me');

  it('asks for the page after the rows already read', () => {
    const first = {
      rows: Array.from({ length: 50 }, (_, index) =>
        taskListRow(rpcRow({ id: index + 1 })),
      ),
      total: 120,
    };
    expect(options.initialPageParam).toBe(0);
    expect(options.getNextPageParam(first, [first])).toBe(50);
    expect(options.getNextPageParam(first, [first, first])).toBe(100);
  });

  it('stops when every Task is read, or a page comes back empty', () => {
    const last = { rows: [taskListRow(rpcRow())], total: 51 };
    const first = {
      rows: Array.from({ length: 50 }, (_, index) =>
        taskListRow(rpcRow({ id: index + 2 })),
      ),
      total: 51,
    };
    expect(options.getNextPageParam(last, [first, last])).toBeUndefined();
    const empty = { rows: [], total: 0 };
    expect(options.getNextPageParam(empty, [first, empty])).toBeUndefined();
  });
});

describe('fetchTasksInRange', () => {
  it('reads open and finished Tasks whose deadline is in the range', async () => {
    mocks.rpc.mockResolvedValue({ data: [rpcRow()], error: null });
    await fetchTasksInRange('managed', {
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-04-12T00:00:00.000Z',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('task_list', {
      p_list: 'managed',
      p_from: '2026-03-01T00:00:00.000Z',
      p_to: '2026-04-12T00:00:00.000Z',
      p_limit: 500,
      p_offset: 0,
    });
  });
});

describe('fetchTaskListSummary', () => {
  it('reads what the list holds', async () => {
    const summary = [
      {
        group_id: 10,
        campaign_id: null,
        status: 'completed',
        late: true,
        dated: true,
        tasks: 12,
      },
    ];
    mocks.rpc.mockReturnValue(answered({ data: summary, error: null }));
    await expect(fetchTaskListSummary('all')).resolves.toEqual(summary);
    expect(mocks.rpc).toHaveBeenCalledWith('task_list_summary', {
      p_list: 'all',
    });
  });
});

describe('summaryWork', () => {
  const summary = [
    {
      group_id: 10,
      campaign_id: 7,
      status: 'completed',
      late: false,
      dated: true,
      tasks: 3,
    },
    {
      group_id: 10,
      campaign_id: null,
      status: 'todo',
      late: false,
      dated: false,
      tasks: 2,
    },
    {
      group_id: 11,
      campaign_id: null,
      status: 'cancelled',
      late: false,
      dated: true,
      tasks: 1,
    },
  ] as const;

  it('gives Rule W one item per Group and Campaign of the chosen rows', () => {
    expect(summaryWork(summary, (row) => row.status !== 'todo')).toEqual([
      { group_id: 10, campaign_id: 7 },
      { group_id: 11, campaign_id: null },
    ]);
    expect(summaryWork(summary, (row) => row.dated)).toHaveLength(2);
  });
});

describe('fetchTaskManageCapability', () => {
  it('asks the server about one Task', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(fetchTaskManageCapability(7)).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('can_manage_task', { p_task_id: 7 });
  });
});

describe('fetchTaskReadable', () => {
  function reading(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    mocks.from.mockReturnValue({ select });
    return { select, eq };
  }

  it('reads the one row through RLS and says whether it came back', async () => {
    const { select, eq } = reading({ data: { id: 7 }, error: null });
    await expect(fetchTaskReadable(7)).resolves.toBe(true);
    expect(mocks.from).toHaveBeenCalledWith('tasks');
    expect(select).toHaveBeenCalledWith('id');
    expect(eq).toHaveBeenCalledWith('id', 7);
    reading({ data: null, error: null });
    await expect(fetchTaskReadable(8)).resolves.toBe(false);
  });

  it('propagates a failure instead of calling the Task unreadable', async () => {
    const error = new Error('offline');
    reading({ data: null, error });
    await expect(fetchTaskReadable(7)).rejects.toBe(error);
  });
});
