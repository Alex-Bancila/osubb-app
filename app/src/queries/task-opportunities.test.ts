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
    const assigned = taskRow({ deadline: '2020-01-01T00:00:00Z' });
    expect(orderOpportunities([assigned], scopes)).toEqual([assigned]);
  });
});

it('asks the server for unfinished public Tasks with an open queue', async () => {
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.in.mockResolvedValue({
    data: [taskRow({ audience: 'org' })],
    error: null,
  });
  from.mockImplementation((table) =>
    table === 'tasks'
      ? query
      : {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        },
  );
  await expect(fetchTaskOpportunities('member')).resolves.toHaveLength(1);
  expect(query.eq).toHaveBeenCalledWith('assignment_mode', 'public');
  expect(query.is).toHaveBeenCalledWith('queue_closed_at', null);
  expect(query.in).toHaveBeenCalledWith('status', [
    'todo',
    'in_progress',
    'in_review',
  ]);
});
