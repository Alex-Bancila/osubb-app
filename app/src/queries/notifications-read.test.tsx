import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* #1012 (ruling R37): a Notification is read when it is opened from outside
   the app (`?notificare=<id>`) and when a screen opens what it is about. */

const db = vi.hoisted(() => {
  const calls: { op: string; args: unknown[] }[] = [];
  const state = {
    subjects: [] as (string | null)[],
    updateResult: { error: null } as { error: unknown },
  };
  function builder(kind: 'select' | 'update') {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'not']) {
      chain[op] = (...args: unknown[]) => {
        calls.push({ op, args });
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown) =>
      resolve(
        kind === 'select'
          ? {
              data: state.subjects.map((subject) => ({ subject })),
              error: null,
            }
          : state.updateResult,
      );
    return chain;
  }
  const rpc = vi.fn();
  const update = vi.fn((values: unknown) => {
    calls.push({ op: 'update', args: [values] });
    return builder('update');
  });
  const from = vi.fn((table: string) => {
    calls.push({ op: 'from', args: [table] });
    const chain = builder('select');
    return { ...chain, update };
  });
  return { calls, state, rpc, update, from };
});

vi.mock('../lib/supabase', () => ({
  supabase: { from: db.from, rpc: db.rpc },
}));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'member-1' } } }),
}));

import {
  fetchUnreadNotificationSubjects,
  PROMOTION_CANDIDATES_SUBJECT,
  useReadNotificationsAbout,
  useReadOpenedNotification,
} from './notifications';

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(queryClient: QueryClient, path = '/') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  db.calls.length = 0;
  db.state.subjects = [];
  db.state.updateResult = { error: null };
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({ data: 1, error: null });
  db.update.mockClear();
  db.from.mockClear();
});

describe('fetchUnreadNotificationSubjects', () => {
  it('asks for the subjects of the member’s own unread rows, once each', async () => {
    db.state.subjects = ['task:12', 'task:12', 'event:3'];

    await expect(fetchUnreadNotificationSubjects('member-1')).resolves.toEqual([
      'task:12',
      'event:3',
    ]);
    expect(db.calls).toEqual([
      { op: 'from', args: ['notifications'] },
      { op: 'select', args: ['subject'] },
      { op: 'eq', args: ['member_id', 'member-1'] },
      { op: 'eq', args: ['read', false] },
      { op: 'not', args: ['subject', 'is', null] },
    ]);
  });
});

describe('useReadNotificationsAbout', () => {
  it('opening a thing with an unread Notification about it reads it, once', async () => {
    db.state.subjects = ['task:12', 'event:3'];
    const queryClient = client();

    const { rerender } = renderHook(
      ({ subjects }) => useReadNotificationsAbout(subjects),
      {
        wrapper: wrapper(queryClient),
        initialProps: { subjects: ['task:12', 'task:99'] },
      },
    );

    await waitFor(() => expect(db.rpc).toHaveBeenCalledTimes(1));
    expect(db.rpc).toHaveBeenCalledWith('mark_notifications_read_for', {
      p_subject: 'task:12',
    });
    rerender({ subjects: ['task:12', 'task:99'] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Nothing about task:99 is unread; task:12 is not sent twice.
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when nothing on screen has an unread Notification', async () => {
    db.state.subjects = ['event:3'];
    const queryClient = client();

    renderHook(() => useReadNotificationsAbout(['task:12']), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() =>
      expect(db.calls.some((call) => call.op === 'not')).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('reads nothing at all while no thing is open', async () => {
    const queryClient = client();

    renderHook(() => useReadNotificationsAbout([]), {
      wrapper: wrapper(queryClient),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('the Promotion Candidates list reads every candidate Notification in one request', async () => {
    db.state.subjects = [
      'promotion_candidate:11111111-1111-4111-8111-111111111111',
      'promotion_candidate:22222222-2222-4222-8222-222222222222',
    ];
    const queryClient = client();

    renderHook(
      () => useReadNotificationsAbout([PROMOTION_CANDIDATES_SUBJECT]),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(db.rpc).toHaveBeenCalledTimes(1));
    expect(db.rpc).toHaveBeenCalledWith('mark_notifications_read_for', {
      p_subject: 'promotion_candidate',
    });
  });

  it('refreshes the badge and the list after reading', async () => {
    db.state.subjects = ['event:3'];
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useReadNotificationsAbout(['event:3']), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications'] }),
    );
  });
});

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function Opened() {
  useReadOpenedNotification();
  return <Where />;
}

describe('useReadOpenedNotification (push tap, Email Digest link)', () => {
  it('marks that one Notification read and takes the id out of the address', async () => {
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/tracker?task=12&notificare=55']}>
          <Routes>
            <Route path="*" element={<Opened />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/tracker?task=12'),
    );
    expect(screen.getByTestId('where')).not.toHaveTextContent('notificare');
    await waitFor(() => expect(db.update).toHaveBeenCalledTimes(1));
    expect(db.update).toHaveBeenCalledWith({ read: true });
    // A single-row update of the member's own row, as opening it in Notificări.
    expect(db.calls).toEqual(
      expect.arrayContaining([
        { op: 'eq', args: ['id', 55] },
        { op: 'eq', args: ['member_id', 'member-1'] },
      ]),
    );
    expect(db.rpc).not.toHaveBeenCalled();
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it('ignores an address without the parameter, or with nonsense in it', async () => {
    const queryClient = client();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/calendar?event=3&notificare=abc']}>
          <Routes>
            <Route path="*" element={<Opened />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(db.update).not.toHaveBeenCalled();
  });
});
