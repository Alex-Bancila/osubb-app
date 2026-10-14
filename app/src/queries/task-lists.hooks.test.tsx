import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
// The shared label reads: answered at once unless a test says otherwise.
const labels = vi.hoisted(() => ({
  groups: { data: undefined, isError: false } as {
    data: Map<number, unknown> | undefined;
    isError: boolean;
  },
  campaigns: { data: undefined, isError: false } as {
    data: { id: number; name: string }[] | undefined;
    isError: boolean;
  },
}));
vi.mock('./reference', () => ({ useGroups: () => labels.groups }));
vi.mock('./campaigns', () => ({ useCampaigns: () => labels.campaigns }));
// The org:changes topic as `useLiveChanges` joins it: a test sends a
// change by hand.
const live = vi.hoisted(() => ({
  onChange: (() => undefined) as (table: string) => void,
}));
vi.mock('./live-changes-channel', () => ({
  subscribe: (handlers: { onChange: (table: string) => void }) => {
    live.onChange = handlers.onChange;
    return () => undefined;
  },
}));
import { useLiveChanges } from './live-changes';
import {
  useFinishedTasks,
  useManagedTasks,
  type TaskListRpcRow,
} from './task-lists';

const edu = {
  id: 10,
  name: 'Educațional',
  short: 'EDU',
  color: '#0a7d4f',
  category: 'department',
  path: [10],
  is_organization: false,
  is_private: false,
};

function row(id: number, total: number): TaskListRpcRow {
  return {
    id,
    group_id: 10,
    title: `Task ${id}`,
    description: null,
    status: 'completed',
    deadline: null,
    completed_at: '2026-03-09T10:00:00+00:00',
    review_round: 0,
    assignment_mode: 'direct',
    audience: 'local',
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
    total,
  };
}
const rows = (from: number, to: number, total: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => row(from + index, total));

/** A request the test answers when it chooses to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  rpc.mockReset();
  labels.groups = { data: new Map([[10, edu]]), isError: false };
  labels.campaigns = { data: [], isError: false };
});

describe('useFinishedTasks', () => {
  it('is pending until the first page lands, then has its rows and the total', async () => {
    const first = deferred<{ data: TaskListRpcRow[]; error: null }>();
    rpc.mockReturnValue(first.promise);
    const { result } = renderHook(() => useFinishedTasks('managed', {}, true), {
      wrapper: wrapper(),
    });
    // The labels are already there: only the page is on its way.
    expect(result.current.isPending).toBe(true);
    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBeUndefined();
    first.resolve({ data: rows(1, 50, 120), error: null });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.rows).toHaveLength(50);
    expect(result.current.rows[0]?.group?.name).toBe('Educațional');
    expect(result.current.total).toBe(120);
    expect(result.current.hasMore).toBe(true);
  });

  it('is pending again, and empty, while a changed filter is on its way', async () => {
    rpc.mockResolvedValueOnce({ data: rows(1, 2, 2), error: null });
    const next = deferred<{ data: TaskListRpcRow[]; error: null }>();
    rpc.mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(
      ({ search }: { search: string }) =>
        useFinishedTasks('managed', search ? { p_search: search } : {}, true),
      { wrapper: wrapper(), initialProps: { search: '' } },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    rerender({ search: 'afis' });
    expect(result.current.isPending).toBe(true);
    expect(result.current.rows).toEqual([]);
    next.resolve({ data: [], error: null });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.total).toBe(0);
  });

  it('keeps a Task once when it appears on two pages, and the first page’s total', async () => {
    rpc
      .mockResolvedValueOnce({ data: rows(1, 50, 120), error: null })
      // A Task finished meanwhile: the next page starts one row early.
      .mockResolvedValueOnce({ data: rows(50, 99, 121), error: null });
    const { result } = renderHook(() => useFinishedTasks('managed', {}, true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(99));
    expect(result.current.rows.map((task) => task.id)).toEqual(
      Array.from({ length: 99 }, (_, index) => index + 1),
    );
    expect(result.current.total).toBe(120);
    // The next page starts after the rows read, not after the ids kept.
    expect(rpc.mock.calls.map(([, args]) => args.p_offset)).toEqual([0, 50]);
  });

  it('keeps the rows and says so when a later page fails; loading more asks again', async () => {
    rpc
      .mockResolvedValueOnce({ data: rows(1, 50, 120), error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('offline') })
      .mockResolvedValueOnce({ data: rows(51, 100, 120), error: null });
    const { result } = renderHook(() => useFinishedTasks('managed', {}, true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.moreFailed).toBe(true));
    expect(result.current.rows).toHaveLength(50);
    expect(result.current.isError).toBe(false);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    expect(result.current.moreFailed).toBe(false);
  });

  // Fails if `loadMore` asks for the next page while the first is read
  // again after a change: `fetchNextPage` would cancel that read and append
  // page 2 to page 1 as it was, so the Task that just finished never shows.
  it('asks for the next page only once the first, read again after a change, has landed', async () => {
    const fresh = deferred<{ data: TaskListRpcRow[]; error: null }>();
    let changed = false;
    rpc.mockImplementation((_name: string, args: { p_offset: number }) =>
      changed && args.p_offset === 0
        ? fresh.promise
        : Promise.resolve({
            data: rows(args.p_offset + 1, args.p_offset + 50, 200),
            error: null,
          }),
    );
    const offsets = () => rpc.mock.calls.map(([, args]) => args.p_offset);
    const { result } = renderHook(
      () => {
        useLiveChanges('me');
        return useFinishedTasks('managed', {}, true);
      },
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    // A Task finishes elsewhere: the list keeps its first page and reads it
    // again.
    changed = true;
    act(() => live.onChange('tasks'));
    await waitFor(() => expect(offsets()).toEqual([0, 50, 0]));
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    // The end of the list comes into view meanwhile: nothing is asked.
    act(() => result.current.loadMore());
    expect(offsets()).toEqual([0, 50, 0]);
    expect(result.current.isFetching).toBe(true);
    // The first page lands, with the Task that just finished on top.
    await act(async () => {
      fresh.resolve({
        data: [row(1000, 201), ...rows(1, 49, 201)],
        error: null,
      });
      await fresh.promise;
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.rows[0]?.id).toBe(1000);
    expect(result.current.total).toBe(201);
    // Only now is the next page asked, after the fresh first one.
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    expect(offsets()).toEqual([0, 50, 0, 50]);
    expect(result.current.rows[0]?.id).toBe(1000);
  });

  it('reports a failed first page as the error it is', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('offline') });
    const { result } = renderHook(() => useFinishedTasks('all', {}, true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPending).toBe(false);
    expect(result.current.rows).toEqual([]);
  });

  // Fails if `useLabelled` stops showing rows while a failed label read is
  // retried: the finished part would be "on its way" again.
  it('keeps its rows, not pending, while a failed label read is retried', async () => {
    labels.campaigns = { data: undefined, isError: true };
    rpc.mockResolvedValue({ data: rows(1, 3, 3), error: null });
    const { result, rerender } = renderHook(
      () => useFinishedTasks('managed', {}, true),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    labels.campaigns = { data: undefined, isError: false };
    rerender();
    expect(result.current.isPending).toBe(false);
    expect(result.current.rows).toHaveLength(3);
  });

  it('asks nothing and is settled and empty without filters', () => {
    const { result } = renderHook(
      () => useFinishedTasks('managed', null, true),
      { wrapper: wrapper() },
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      rows: [],
      total: 0,
      isPending: false,
      isError: false,
      hasMore: false,
    });
  });
});

describe('useManagedTasks', () => {
  it('waits for the Group labels rather than show a Task without its Group', async () => {
    labels.groups = { data: undefined, isError: false };
    rpc.mockResolvedValue({ data: rows(1, 2, 2), error: null });
    const { result, rerender } = renderHook(() => useManagedTasks(true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
    labels.groups = { data: new Map([[10, edu]]), isError: false };
    rerender();
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.isPending).toBe(false);
    expect(result.current.data?.[0]?.group?.name).toBe('Educațional');
  });

  it('shows the Tasks unlabelled when the labels cannot be read', async () => {
    labels.groups = { data: undefined, isError: true };
    rpc.mockResolvedValue({ data: rows(1, 2, 2), error: null });
    const { result } = renderHook(() => useManagedTasks(true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.[0]?.group).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  // Fails if `useLabelled` waits for the labels on every render instead of
  // only until they first answer: a retried label read has no data and no
  // error while it runs, and the rows would go back to loading.
  it('keeps the rows on screen while a failed label read is retried', async () => {
    labels.groups = { data: undefined, isError: true };
    rpc.mockResolvedValue({ data: rows(1, 2, 2), error: null });
    const { result, rerender } = renderHook(() => useManagedTasks(true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    // The retry is on its way: no data, and no error any more.
    labels.groups = { data: undefined, isError: false };
    rerender();
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]?.group).toBeNull();
    // It lands: the same rows, labelled.
    labels.groups = { data: new Map([[10, edu]]), isError: false };
    rerender();
    expect(result.current.data?.[0]?.group?.name).toBe('Educațional');
  });

  it('asks nothing while it is not enabled', () => {
    const { result } = renderHook(() => useManagedTasks(false), {
      wrapper: wrapper(),
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
