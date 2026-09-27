import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskRow } from '../test/task-fixtures';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  useManagedTasks: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
vi.mock('./task-tabs', () => ({ useManagedTasks: mocks.useManagedTasks }));

import { reviewCandidates, useAwaitingMyReview } from './task-review';

/** An In-review Task someone else executes, submitted at `at`. */
function inReview(
  id: number,
  at: string | null,
  overrides: Partial<TaskPresentationRow> = {},
): TaskPresentationRow {
  return taskRow({
    id,
    title: `Task ${id}`,
    status: 'in_review',
    assignments: [{ id: 100 + id, member_id: 'other', ended_at: null }],
    submission: at
      ? [
          {
            id: 1000 + id,
            kind: 'submitted',
            note: null,
            details: {},
            occurred_at: at,
          },
        ]
      : [],
    ...overrides,
  });
}

function managed(rows: TaskPresentationRow[] | undefined) {
  mocks.useManagedTasks.mockReturnValue({
    data: rows,
    isPending: rows === undefined,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reviewCandidates', () => {
  it('keeps In-review Tasks I do not execute, oldest submission first, then id', () => {
    const rows = [
      inReview(1, '2026-09-20T10:00:00Z'),
      inReview(2, '2026-09-10T10:00:00Z'),
      // Mine: nobody evaluates their own work.
      inReview(3, '2026-09-01T10:00:00Z', {
        assignments: [{ id: 9, member_id: 'me', ended_at: null }],
      }),
      // Not In review.
      inReview(4, '2026-09-02T10:00:00Z', { status: 'in_progress' }),
      // No visible submission: last.
      inReview(5, null),
      // Same instant as 2: the lower id first.
      inReview(6, '2026-09-10T10:00:00Z'),
    ];
    expect(reviewCandidates(rows, 'me').map((row) => row.id)).toEqual([
      2, 6, 1, 5,
    ]);
  });

  it('skips a Task whose visible Executor is me', () => {
    const row = inReview(7, '2026-09-10T10:00:00Z', {
      assignments: [],
      visibleExecutor: { memberId: 'me', fullName: 'Eu', nickname: null },
    });
    expect(reviewCandidates([row], 'me')).toEqual([]);
  });
});

describe('useAwaitingMyReview', () => {
  it('picks the oldest submission can_evaluate_task allows and counts the allowed', async () => {
    managed([
      inReview(1, '2026-09-20T10:00:00Z'),
      // The oldest, but the server refuses: another Responsible's Task.
      inReview(2, '2026-09-01T10:00:00Z'),
      inReview(3, '2026-09-05T10:00:00Z'),
      inReview(4, '2026-08-01T10:00:00Z', {
        assignments: [{ id: 9, member_id: 'me', ended_at: null }],
      }),
    ]);
    mocks.rpc.mockImplementation(
      (_: string, { p_task_id }: { p_task_id: number }) =>
        Promise.resolve({ data: p_task_id !== 2, error: null }),
    );
    const { result } = renderHook(() => useAwaitingMyReview(true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.task?.id).toBe(3);
    expect(result.current.data?.count).toBe(2);
    expect(mocks.useManagedTasks).toHaveBeenCalledWith(true);
    // My own Task is never asked about.
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_task_id)).toEqual([
      2, 3, 1,
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('can_evaluate_task', {
      p_task_id: 3,
    });
  });

  it('answers none when nothing may be evaluated', async () => {
    managed([inReview(1, '2026-09-20T10:00:00Z')]);
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const { result } = renderHook(() => useAwaitingMyReview(true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ task: null, count: 0 });
  });

  it('reports a failed check as an error', async () => {
    managed([inReview(1, '2026-09-20T10:00:00Z')]);
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    const { result } = renderHook(() => useAwaitingMyReview(true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('reads nothing without manageTasks', () => {
    managed(undefined);
    const { result } = renderHook(() => useAwaitingMyReview(false), {
      wrapper,
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(false);
    expect(mocks.useManagedTasks).toHaveBeenCalledWith(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
