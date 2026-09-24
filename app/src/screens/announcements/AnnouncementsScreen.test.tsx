import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnouncementFeedRow } from '../../queries/announcements';
import type { Group } from '../../queries/reference';

const hooks = vi.hoisted(() => ({
  useAnnouncementsFeed: vi.fn(),
  useMarkAnnouncementRead: vi.fn(),
  useGroups: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'test-user-id' } },
  }),
}));

vi.mock('../../queries/announcements', () => ({
  useAnnouncementsFeed: hooks.useAnnouncementsFeed,
  useMarkAnnouncementRead: hooks.useMarkAnnouncementRead,
  useAnnouncementReaders: () => ({ data: undefined }),
}));
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: () => ({ data: undefined }),
}));
vi.mock('../../queries/my-groups', () => ({
  useMyGroupRoles: () => ({ data: [] }),
}));

vi.mock('../../queries/reference', () => ({
  useGroups: hooks.useGroups,
}));
vi.mock('./AnnouncementComposeSheet', () => ({ default: () => null }));

import AnnouncementsScreen from './AnnouncementsScreen';

const mockGroup: Group = {
  id: 10,
  name: 'IT',
  short: 'IT',
  color: '#3B82F6',
  category: 'department',
  path: [10],
  parent_id: null,
  min_level: 1,
  status: 'active',
  is_organization: false,
  legacy_dept_id: 'it',
};

const mockGroups = new Map<number, Group>([[10, mockGroup]]);

function createRow(
  overrides: Partial<AnnouncementFeedRow> = {},
): AnnouncementFeedRow {
  return {
    id: 1,
    title: 'Anunț test',
    body: 'Conținut detaliat anunț.',
    priority: 'normal',
    category: 'general',
    pinned: false,
    author: 'Admin',
    dept_id: 'it',
    group_id: 10,
    audience: 'local',
    published_at: '2026-09-18T10:00:00Z',
    created_by: null,
    form_label: null,
    form_url: null,
    announcement_reads: [],
    ...overrides,
  };
}

describe('AnnouncementsScreen', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mutate.mockImplementation(
      (
        _id: number,
        options?: {
          onSuccess?: () => void;
          onError?: (err: Error) => void;
          onSettled?: () => void;
        },
      ) => {
        options?.onSuccess?.();
        options?.onSettled?.();
      },
    );
    hooks.useGroups.mockReturnValue({ data: mockGroups, isPending: false });
    hooks.useMarkAnnouncementRead.mockReturnValue({ mutate, isPending: false });
  });

  it('renders loading state when feed query is pending', () => {
    hooks.useAnnouncementsFeed.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    });

    render(<AnnouncementsScreen />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Se încarcă anunțurile…')).toBeInTheDocument();
  });

  it('renders error state and retry button when feed query fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const refetch = vi.fn();
    const user = userEvent.setup();

    hooks.useAnnouncementsFeed.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('Failed to load'),
      refetch,
    });

    render(<AnnouncementsScreen />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText('Nu am putut încărca anunțurile.'),
    ).toBeInTheDocument();

    const retryButton = screen.getByText('Încearcă din nou');
    await user.click(retryButton);
    expect(refetch).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('renders empty state when there are no announcements', () => {
    hooks.useAnnouncementsFeed.mockReturnValue({
      isPending: false,
      isError: false,
      data: [],
    });

    render(<AnnouncementsScreen />);

    expect(
      screen.getByText('Nu sunt anunțuri disponibile în acest moment.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Toate anunțurile sunt citite'),
    ).toBeInTheDocument();
  });

  it('renders feed sorted pinned-first then newest, showing critical banner and unread counts', () => {
    const rowNormalOld = createRow({
      id: 1,
      title: 'Anunț Vechi',
      pinned: false,
      priority: 'normal',
      published_at: '2026-09-15T10:00:00Z',
      announcement_reads: [{ read_at: '2026-09-16T10:00:00Z' }],
    });

    const rowCriticalNew = createRow({
      id: 2,
      title: 'Urgență Server',
      pinned: false,
      priority: 'critical',
      published_at: '2026-09-18T12:00:00Z',
      announcement_reads: [], // unread!
    });

    const rowPinnedOlder = createRow({
      id: 3,
      title: 'Regulament Intern',
      pinned: true,
      priority: 'important',
      published_at: '2026-09-10T10:00:00Z',
      announcement_reads: [{ read_at: '2026-09-11T10:00:00Z' }],
    });

    hooks.useAnnouncementsFeed.mockReturnValue({
      isPending: false,
      isError: false,
      data: [rowNormalOld, rowCriticalNew, rowPinnedOlder],
    });

    render(<AnnouncementsScreen />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Anunțuri' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 anunț necitit')).toBeInTheDocument();

    // Critical banner is present for unread critical announcement
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(within(alert).getByText(/Urgență Server/)).toBeInTheDocument();

    // Feed items ordering: pinned first (Regulament Intern), then newer (Urgență Server), then older (Anunț Vechi)
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(3);
    expect(articles[0]).toHaveAccessibleName('Regulament Intern');
    expect(articles[1]).toHaveAccessibleName('Urgență Server');
    expect(articles[2]).toHaveAccessibleName('Anunț Vechi');
  });

  it('opens details sheet when a card is clicked and marks it as read', async () => {
    const user = userEvent.setup();
    const row = createRow({
      id: 42,
      title: 'Ședință Generală',
      body: 'Prezența este obligatorie.',
      announcement_reads: [], // unread
    });

    hooks.useAnnouncementsFeed.mockReturnValue({
      isPending: false,
      isError: false,
      data: [row],
    });

    render(<AnnouncementsScreen />);

    // Click "Citește" button inside card
    const card = screen.getByRole('article', { name: 'Ședință Generală' });
    const readButton = within(card).getByRole('button', { name: /Citește/ });
    await user.click(readButton);

    // Details sheet dialog should be open
    const dialog = screen.getByRole('dialog', { name: 'Detalii anunț' });
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText('Prezența este obligatorie.'),
    ).toBeInTheDocument();

    // Mark as read should have been triggered exactly once
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(42, expect.any(Object));
  });

  it('triggers markRead exactly once for an unread announcement even across parent rerenders or mutation changes', async () => {
    const user = userEvent.setup();
    const row = createRow({
      id: 77,
      title: 'Anunț Unic',
      body: 'Test unicitate marcare.',
      announcement_reads: [], // unread
    });

    hooks.useAnnouncementsFeed.mockReturnValue({
      isPending: false,
      isError: false,
      data: [row],
    });

    const { rerender } = render(<AnnouncementsScreen />);

    const card = screen.getByRole('article', { name: 'Anunț Unic' });
    const readButton = within(card).getByRole('button', { name: /Citește/ });
    await user.click(readButton);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(77, expect.any(Object));

    // Simulate mutation state update rerendering parent (e.g. isPending: true)
    hooks.useMarkAnnouncementRead.mockReturnValue({
      mutate,
      isPending: true,
    });
    rerender(<AnnouncementsScreen />);

    // Simulate another unrelated rerender
    rerender(<AnnouncementsScreen />);

    // Must remain called exactly once
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('allows retrying markRead if previous mutation failed', async () => {
    const user = userEvent.setup();
    const row = createRow({
      id: 88,
      title: 'Anunț cu Eșec',
      body: 'Test reîncercare.',
      announcement_reads: [], // unread
    });

    hooks.useAnnouncementsFeed.mockReturnValue({
      isPending: false,
      isError: false,
      data: [row],
    });

    // First attempt fails
    mutate.mockImplementationOnce(
      (
        _id: number,
        options?: {
          onError?: (err: Error) => void;
          onSettled?: () => void;
        },
      ) => {
        options?.onError?.(new Error('Network error'));
        options?.onSettled?.();
      },
    );

    render(<AnnouncementsScreen />);

    const card = screen.getByRole('article', { name: 'Anunț cu Eșec' });
    const readButton = within(card).getByRole('button', { name: /Citește/ });

    // Open sheet 1st time - mutation fails
    await user.click(readButton);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(88, expect.any(Object));

    // Close sheet
    const closeButton = screen.getByRole('button', { name: 'Închide' });
    await user.click(closeButton);

    // Second attempt succeeds
    mutate.mockImplementationOnce(
      (
        _id: number,
        options?: {
          onSuccess?: () => void;
          onSettled?: () => void;
        },
      ) => {
        options?.onSuccess?.();
        options?.onSettled?.();
      },
    );

    // Open sheet 2nd time - should retry mutation
    await user.click(readButton);
    expect(mutate).toHaveBeenCalledTimes(2);

    // Close sheet again
    await user.click(closeButton);

    // Open sheet 3rd time - since 2nd attempt succeeded, it should not call mutate again
    await user.click(readButton);
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('renders loading state when groups query is pending even if feed has loaded', () => {
    hooks.useAnnouncementsFeed.mockReturnValue({
      isPending: false,
      isError: false,
      data: [createRow()],
    });
    hooks.useGroups.mockReturnValue({
      isPending: true,
      data: undefined,
    });

    render(<AnnouncementsScreen />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Se încarcă anunțurile…')).toBeInTheDocument();
  });

  it('opens details sheet when critical banner is clicked', async () => {
    const user = userEvent.setup();
    const row = createRow({
      id: 99,
      title: 'Atenție Server Cazut',
      priority: 'critical',
      announcement_reads: [], // unread critical
    });

    hooks.useAnnouncementsFeed.mockReturnValue({
      isPending: false,
      isError: false,
      data: [row],
    });

    render(<AnnouncementsScreen />);

    const bannerButton = screen.getByRole('button', { name: 'Citește acum' });
    await user.click(bannerButton);

    const dialog = screen.getByRole('dialog', { name: 'Detalii anunț' });
    expect(dialog).toBeInTheDocument();
    expect(mutate).toHaveBeenCalledWith(99, expect.any(Object));
  });
});
