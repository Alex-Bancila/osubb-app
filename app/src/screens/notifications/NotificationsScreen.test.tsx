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

// The signed-in Member's level: mark-all is offered from 5 up (#1012, R37).
const auth = vi.hoisted(() => ({ level: 1 }));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'test-user-id' } },
    claims: { member_level: auth.level },
  }),
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
    digested_at: null,
    subject: null,
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
    auth.level = 1;
    hooks.useMarkAllNotificationsRead.mockReturnValue({
      mutate: markAll,
      isPending: false,
      isError: false,
      error: null,
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

    // Opening issues exactly one single-row update, never a bulk one (#695).
    expect(markRead).toHaveBeenCalledTimes(1);
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

  describe('Marchează toate ca citite (R37 amends R16, #1012)', () => {
    beforeEach(() => {
      hooks.useUnreadNotificationCount.mockReturnValue({ data: 2 });
      hooks.useNotifications.mockReturnValue(
        feed([notificationRow({ id: 2 }), notificationRow({ id: 1 })]),
      );
    });

    it.each([
      ['a Voluntar', 1],
      ['a Voluntar cu Drept de Vot', 3],
    ])('offers %s (level %i) no mark-all control', (_who, level) => {
      auth.level = level;

      renderScreen();

      expect(
        screen.queryByRole('button', { name: /Marchează/ }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Marchează/)).not.toBeInTheDocument();
      expect(screen.getByText('Necitite: 2')).toBeInTheDocument();
      // Showing the list writes nothing; only opening a row does.
      expect(markRead).not.toHaveBeenCalled();
      expect(markAll).not.toHaveBeenCalled();
    });

    it.each([
      ['BCE', 5],
      ['BC', 6],
      ['the Moderator', 9],
    ])(
      'offers it to %s (level %i), and showing it writes nothing',
      (_who, level) => {
        auth.level = level;

        renderScreen();

        expect(
          screen.getByRole('button', { name: 'Marchează toate ca citite' }),
        ).toBeEnabled();
        expect(markAll).not.toHaveBeenCalled();
      },
    );

    it('sends one request and shows a receipt', async () => {
      auth.level = 6;
      markAll.mockImplementation(
        (_: unknown, options: { onSuccess: (count: number) => void }) =>
          options.onSuccess(2),
      );
      const user = userEvent.setup();

      renderScreen();
      await user.click(
        screen.getByRole('button', { name: 'Marchează toate ca citite' }),
      );

      expect(markAll).toHaveBeenCalledTimes(1);
      expect(markRead).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Am marcat 2 notificări ca citite.',
      );
    });

    it('is disabled while it runs', () => {
      auth.level = 5;
      hooks.useMarkAllNotificationsRead.mockReturnValue({
        mutate: markAll,
        isPending: true,
        isError: false,
        error: null,
      });

      renderScreen();

      expect(
        screen.getByRole('button', { name: 'Marchează toate ca citite' }),
      ).toBeDisabled();
    });

    it('is disabled when nothing is unread', () => {
      auth.level = 9;
      hooks.useUnreadNotificationCount.mockReturnValue({ data: 0 });
      hooks.useNotifications.mockReturnValue(
        feed([notificationRow({ id: 1, read: true })]),
      );

      renderScreen();

      expect(
        screen.getByRole('button', { name: 'Marchează toate ca citite' }),
      ).toBeDisabled();
    });

    it('says why when the server refuses it', () => {
      auth.level = 5;
      hooks.useMarkAllNotificationsRead.mockReturnValue({
        mutate: markAll,
        isPending: false,
        isError: true,
        error: { code: '42501', message: 'notification_mark_all_forbidden' },
      });

      renderScreen();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Doar BCE, BC și Moderatorul pot marca toate notificările ca citite.',
      );
    });
  });

  describe('header counter (B35)', () => {
    it('says everything is read instead of "Necitite: 0"', () => {
      hooks.useUnreadNotificationCount.mockReturnValue({ data: 0 });
      hooks.useNotifications.mockReturnValue(
        feed([notificationRow({ id: 1, read: true })]),
      );

      renderScreen();

      expect(
        screen.getByText('Toate notificările sunt citite'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Necitite: 0')).not.toBeInTheDocument();
    });

    it('claims nothing while the count is unknown', () => {
      hooks.useUnreadNotificationCount.mockReturnValue({ data: undefined });
      hooks.useNotifications.mockReturnValue(feed([notificationRow()]));

      renderScreen();

      expect(
        screen.queryByText('Toate notificările sunt citite'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Necitite:/)).not.toBeInTheDocument();
    });

    it('does not call a stale zero "all read" while a row on screen is unread', () => {
      hooks.useUnreadNotificationCount.mockReturnValue({ data: 0 });
      hooks.useNotifications.mockReturnValue(feed([notificationRow()]));

      renderScreen();

      expect(
        screen.queryByText('Toate notificările sunt citite'),
      ).not.toBeInTheDocument();
    });
  });

  it('labels Group membership notifications "Grupuri" (B37)', () => {
    hooks.useNotifications.mockReturnValue(
      feed([
        notificationRow({
          kind: 'system',
          title: 'Ai fost adăugat în Echipa Logistică',
          body: null,
          link: '/grupuri/4',
          task_id: null,
        }),
      ]),
    );

    renderScreen();

    expect(screen.getByText('Grupuri')).toBeInTheDocument();
    expect(screen.queryByText('Sistem')).not.toBeInTheDocument();
  });

  it('runs the rows to the box frame, with the focus ring drawn inside (O1)', () => {
    hooks.useNotifications.mockReturnValue(feed([notificationRow()]));

    const { container } = renderScreen();

    const box = container.querySelector('[data-slot="panel-box"]');
    expect(box).toHaveAttribute('data-flush', 'true');
    expect(box).toHaveClass('p-0', 'overflow-hidden');
    expect(screen.getByRole('list')).not.toHaveClass('-mx-3');
    expect(
      screen.getByRole('button', { name: /Task nou: Afiș pentru AGO/ }),
    ).toHaveClass(
      'focus-visible:after:outline-solid',
      'focus-visible:after:outline-offset-[-2px]',
    );
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
