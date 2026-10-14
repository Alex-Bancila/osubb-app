import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answered } from '../test/postgrest-fake';
const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
// The Calendar's other Task reads, answered by each test.
const reads = vi.hoisted(() => ({
  summary: vi.fn(),
  candidatures: vi.fn(),
  management: vi.fn(),
}));
vi.mock('./calendar-tasks', () => ({
  usePendingCandidatureTasks: () => reads.candidatures(),
}));
vi.mock('./task-tabs', () => ({
  useTaskManagement: () => reads.management(),
}));
vi.mock('./task-lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-lists')>()),
  useTaskListSummary: (...args: unknown[]) => reads.summary(...args),
}));
import { calendarWorkItems, useCalendarWork } from './work-filter-options';

describe('calendarWorkItems', () => {
  it('keeps every Event and each Task with a deadline — an undated Task draws no chip', () => {
    const events = [
      { group_id: 1, campaign_id: null },
      { group_id: 2, campaign_id: 7 },
    ];
    const mine = [
      { group_id: 3, campaign_id: null, deadline: '2026-10-01T10:00:00Z' },
      { group_id: 4, campaign_id: 8, deadline: null },
    ];
    const candidatures = [
      { group_id: 5, campaign_id: 9, deadline: '2026-10-02T10:00:00Z' },
    ];
    expect(
      calendarWorkItems({ events, tasks: [mine, candidatures, undefined] }),
    ).toEqual([
      { group_id: 1, campaign_id: null },
      { group_id: 2, campaign_id: 7 },
      { group_id: 3, campaign_id: null, deadline: '2026-10-01T10:00:00Z' },
      { group_id: 5, campaign_id: 9, deadline: '2026-10-02T10:00:00Z' },
    ]);
  });

  it('adds the Groups and Campaigns the list summaries name', () => {
    const summarised = [
      { group_id: 6, campaign_id: null },
      { group_id: 6, campaign_id: 10 },
    ];
    expect(
      calendarWorkItems({
        events: [{ group_id: 1, campaign_id: null }],
        tasks: [undefined],
        summarised,
      }),
    ).toEqual([{ group_id: 1, campaign_id: null }, ...summarised]);
  });
});

describe('useCalendarWork', () => {
  const summaryRow = (
    group_id: number,
    campaign_id: number | null,
    dated: boolean,
  ) => ({
    group_id,
    campaign_id,
    status: 'completed',
    late: false,
    dated,
    tasks: 1,
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      {
        client: new QueryClient({
          defaultOptions: { queries: { retry: false } },
        }),
      },
      children,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    // One readable Event, of Group 1.
    api.from.mockReturnValue(
      answered({ data: [{ group_id: 1, campaign_id: null }], error: null }),
    );
    reads.candidatures.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    });
    reads.management.mockReturnValue({ data: false });
  });

  // Fails if the Calendar takes the member's own Groups and Campaigns from
  // anything but the summary of Taskurile mele (its open rows miss every
  // finished Task, and its whole list is no longer read), or counts an
  // undated Task, which draws no chip.
  it('offers the Groups and Campaigns of the member’s own dated Tasks, from the summary of Taskurile mele', async () => {
    reads.summary.mockImplementation((list: string, enabled: boolean) =>
      list === 'mine' && enabled
        ? {
            data: [summaryRow(3, 7, true), summaryRow(4, null, false)],
            isPending: false,
            isError: false,
          }
        : { data: undefined, isPending: true, isError: false },
    );
    const { result } = renderHook(() => useCalendarWork(false), { wrapper });
    await waitFor(() => expect(result.current.work).toBeDefined());
    expect(result.current.ready).toBe(true);
    expect(result.current.work).toEqual([
      { group_id: 1, campaign_id: null },
      { group_id: 3, campaign_id: 7 },
    ]);
  });

  it('waits for that summary, and offers its retry when it fails', async () => {
    const refetch = vi.fn();
    const error = new Error('offline');
    reads.summary.mockImplementation((list: string) =>
      list === 'mine'
        ? { data: undefined, isPending: true, isError: false, refetch }
        : { data: undefined, isPending: true, isError: false },
    );
    const { result, rerender } = renderHook(() => useCalendarWork(false), {
      wrapper,
    });
    expect(result.current.ready).toBe(false);
    reads.summary.mockImplementation((list: string) =>
      list === 'mine'
        ? { data: undefined, isPending: false, isError: true, error, refetch }
        : { data: undefined, isPending: true, isError: false },
    );
    rerender();
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.error).toBe(error);
    result.current.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
