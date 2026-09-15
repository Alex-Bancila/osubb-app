import { describe, expect, it, vi } from 'vitest';
const from = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { from } }));
import {
  fetchTaskOpportunities,
  orderOpportunities,
} from './task-opportunities';
import { taskRow } from '../test/task-fixtures';

const scopes = { departments: ['edu'], teams: ['team'], projects: [1] };
describe('Available work ordering', () => {
  it('puts own Origins first, with exact-instant deadlines and deterministic ties', () => {
    const rows = [
      taskRow({
        id: 1,
        dept_id: 'fin',
        audience: 'org',
        deadline: '2026-09-01T00:00:00Z',
      }),
      taskRow({ id: 2, deadline: '2026-09-20T00:00:00Z' }),
      taskRow({
        id: 3,
        dept_id: null,
        project_id: 1,
        deadline: '2026-09-15T10:00:00+03:00',
      }),
      taskRow({
        id: 4,
        dept_id: null,
        team_id: 'team',
        deadline: '2026-09-15T08:00:00Z',
      }),
    ];
    expect(orderOpportunities(rows, scopes).map((row) => row.id)).toEqual([
      3, 4, 2, 1,
    ]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4]);
  });
  it('never treats a parent Department membership as membership of its Team', () => {
    expect(
      orderOpportunities(
        [taskRow({ dept_id: null, team_id: 'other', audience: 'local' })],
        scopes,
      ),
    ).toEqual([]);
  });
  it('retains existing participation and overdue opportunities', () => {
    const closedLocal = taskRow({
      id: 19,
      dept_id: 'former-department',
      audience: 'local',
      deadline: '2020-01-01T00:00:00Z',
    });
    expect(orderOpportunities([closedLocal], scopes, new Set([19]))).toEqual([
      closedLocal,
    ]);
  });
});

it('keeps an own candidature after its queue closes without broadening other rows', async () => {
  const openTask = taskRow({ id: 1, audience: 'org' });
  const participatedTask = taskRow({
    id: 2,
    status: 'completed',
    audience: 'local',
    dept_id: 'former-department',
  });
  const openQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
  };
  openQuery.select.mockReturnValue(openQuery);
  openQuery.eq.mockReturnValue(openQuery);
  openQuery.is.mockReturnValue(openQuery);
  openQuery.in.mockResolvedValue({ data: [openTask], error: null });
  const participatedQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({ data: [participatedTask], error: null }),
  };
  participatedQuery.select.mockReturnValue(participatedQuery);
  participatedQuery.eq.mockReturnValue(participatedQuery);
  let taskQueryCount = 0;
  from.mockImplementation((table) => {
    if (table === 'tasks')
      return taskQueryCount++ === 0 ? openQuery : participatedQuery;
    if (table === 'task_candidates')
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [{ task_id: 2 }], error: null }),
        }),
      };
    return {
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    };
  });

  await expect(fetchTaskOpportunities('member')).resolves.toEqual([
    openTask,
    participatedTask,
  ]);
  expect(openQuery.is).toHaveBeenCalledWith('queue_closed_at', null);
  expect(openQuery.in).toHaveBeenCalledWith('status', [
    'todo',
    'in_progress',
    'in_review',
  ]);
  expect(participatedQuery.in).toHaveBeenCalledWith('id', [2]);
});
