import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRow } from '../../queries/notifications';

const hooks = vi.hoisted(() => ({
  useNotifications: vi.fn(),
  useUnreadNotificationCount: vi.fn(),
  useMarkNotificationRead: vi.fn(),
  useMarkAllNotificationsRead: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'test-user-id' } } }),
}));

vi.mock('../../queries/notifications', () => ({
  useNotifications: hooks.useNotifications,
  useUnreadNotificationCount: hooks.useUnreadNotificationCount,
  useMarkNotificationRead: hooks.useMarkNotificationRead,
  useMarkAllNotificationsRead: hooks.useMarkAllNotificationsRead,
}));

import NotificationsScreen from './NotificationsScreen';

const MEMBER = 'test-user-id';

function notificationRow(
  overrides: Partial<NotificationRow> = {},
): NotificationRow {
  return {
    id: 1,
    member_id: MEMBER,
    kind: 'task',
    icon: null,
    title: 'Task nou: Afiș pentru AGO',
    body: 'Ai fost desemnat executor.',
    critical: false,
    read: false,
    link: '/tracker/12',
    created_at: '2026-09-20T09:00:00.000Z',
    dedupe_key: null,
    task_id: 12,
    ...overrides,
  };
}

const markRead = vi.fn();
const markAll = vi.fn();

function feed(
  rows: NotificationRow[],
  overrides: Record<string, unknown> = {},
) {
  return {
    data: { pages: [{ rows, nextPage: null }] },
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/notificari']}>
      <Routes>
        <Route path="/notificari" element={<NotificationsScreen />} />
        <Route path="/tracker/:taskId" element={<h1>Detalii task</h1>} />
        <Route path="/calendar" element={<h1>Calendar</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NotificationsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.useMarkNotificationRead.mockReturnValue({
      mutate: markRead,
      isPending: false,
    });
    hooks.useMarkAllNotificationsRead.mockReturnValue({
      mutate: markAll,
      isPending: false,
      isError: false,
    });
    hooks.useUnreadNotificationCount.mockReturnValue({ data: 0 });
    hooks.useNotifications.mockReturnValue(feed([]));
  });

  it('renders one row per notification kind, newest first as the query returned them', () => {
    hooks.useNotifications.mockReturnValue(
      feed([
        notificationRow({ id: 5, kind: 'announce', title: 'Anunț nou' }),
        notificationRow({ id: 4, kind: 'deadline', title: 'Termen mâine' }),
        notificationRow({ id: 3, kind: 'event', title: 'Ședință Educațional' }),
        notificationRow({ id: 2, kind: 'task', title: 'Task nou' }),
        notificationRow({ id: 1, kind: 'system', title: 'Cont activat' }),
      ]),
    );

    renderScreen();

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Anunț nou');
    expect(rows[4]).toHaveTextContent('Cont activat');

    for (const label of [
      'Anunț',
      'Termen limită',
      'Eveniment',
      'Task',
      'Sistem',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('shows how many notifications are unread, and marks unread rows for screen readers', () => {
    hooks.useUnreadNotificationCount.mockReturnValue({ data: 3 });
    hooks.useNotifications.mockReturnValue(
      feed([
        notificationRow({ id: 2, read: false }),
        notificationRow({ id: 1, read: true, title: 'Task vechi' }),
      ]),
    );

    renderScreen();

    expect(screen.getByText('Necitite: 3')).toBeInTheDocument();
    expect(screen.getAllByText('Necitită')).toHaveLength(1);
  });

  it('marks a notification read when it is opened, then follows its link', async () => {
    const user = userEvent.setup();
    hooks.useNotifications.mockReturnValue(
      feed([notificationRow({ id: 12, link: '/tracker/12' })]),
    );

    renderScreen();

    await user.click(
      screen.getByRole('button', { name: /Task nou: Afiș pentru AGO/ }),
    );

    expect(markRead).toHaveBeenCalledWith(12);
    expect(
      screen.getByRole('heading', { name: 'Detalii task' }),
    ).toBeInTheDocument();
  });

  it('opens a row without a usable link without breaking it', async () => {
    const user = userEvent.setup();
    hooks.useNotifications.mockReturnValue(
      feed([
        notificationRow({ id: 8, link: null, title: 'Fără link' }),
        notificationRow({
          id: 9,
          link: 'https://example.com',
          title: 'Link extern',
        }),
      ]),
    );

    renderScreen();

    await user.click(screen.getByRole('button', { name: /Fără link/ }));
    await user.click(screen.getByRole('button', { name: /Link extern/ }));

    expect(markRead).toHaveBeenNthCalledWith(1, 8);
    expect(markRead).toHaveBeenNthCalledWith(2, 9);
    // Still on the notification centre: nothing navigated anywhere.
    expect(
      screen.getByRole('heading', { name: 'Notificări' }),
    ).toBeInTheDocument();
  });

  it('does not rewrite a notification that is already read', async () => {
    const user = userEvent.setup();
    hooks.useNotifications.mockReturnValue(
      feed([notificationRow({ id: 3, read: true, link: '/calendar' })]),
    );

    renderScreen();

    await user.click(
      screen.getByRole('button', { name: /Task nou: Afiș pentru AGO/ }),
    );

    expect(markRead).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'Calendar' }),
    ).toBeInTheDocument();
  });

  it('marks everything read from one action, and offers it only when something is unread', async () => {
    const user = userEvent.setup();
    hooks.useUnreadNotificationCount.mockReturnValue({ data: 2 });
    hooks.useNotifications.mockReturnValue(
      feed([notificationRow({ id: 2 }), notificationRow({ id: 1 })]),
    );

    const view = renderScreen();

    await user.click(
      screen.getByRole('button', { name: 'Marchează tot ca citit' }),
    );
    expect(markAll).toHaveBeenCalledTimes(1);

    hooks.useUnreadNotificationCount.mockReturnValue({ data: 0 });
    view.rerender(
      <MemoryRouter initialEntries={['/notificari']}>
        <Routes>
          <Route path="/notificari" element={<NotificationsScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('button', { name: 'Marchează tot ca citit' }),
    ).toBeDisabled();
    expect(screen.getByText('Necitite: 0')).toBeInTheDocument();
  });

  it('pages through older notifications on request', async () => {
    const user = userEvent.setup();
    const fetchNextPage = vi.fn();
    hooks.useNotifications.mockReturnValue(
      feed([notificationRow()], { hasNextPage: true, fetchNextPage }),
    );

    renderScreen();

    await user.click(
      screen.getByRole('button', { name: 'Încarcă mai multe notificări' }),
    );

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('says so when there is nothing to read', () => {
    renderScreen();

    expect(
      screen.getByText('Nu ai nicio notificare deocamdată.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('renders the loading state while the first page is in flight', () => {
    hooks.useNotifications.mockReturnValue(
      feed([], { isPending: true, data: undefined }),
    );

    renderScreen();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Se încarcă notificările…')).toBeInTheDocument();
  });

  it('offers a retry when the list cannot be read', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    const refetch = vi.fn();
    hooks.useNotifications.mockReturnValue(
      feed([], {
        isPending: false,
        isError: true,
        error: new Error('permission denied'),
        data: undefined,
        refetch,
      }),
    );

    renderScreen();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText('Nu am putut încărca notificările.'),
    ).toBeInTheDocument();
    // The shared error state still renders Ionic's button element, which jsdom
    // gives no role — click the copy a member would click.
    await user.click(screen.getByText('Încearcă din nou'));
    expect(refetch).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
  });

  it('passes automated accessibility checks', async () => {
    hooks.useUnreadNotificationCount.mockReturnValue({ data: 1 });
    hooks.useNotifications.mockReturnValue(
      feed([
        notificationRow({ id: 2, critical: true }),
        notificationRow({ id: 1, read: true, body: null, link: null }),
      ]),
    );

    const { container } = renderScreen();
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });

    expect(result.violations).toEqual([]);
  });
});
