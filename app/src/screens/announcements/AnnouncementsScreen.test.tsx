import { render, screen, waitFor, within } from '@testing-library/react';
import { swipe } from '../../test/swipe';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnnouncementFeed,
  AnnouncementFeedRow,
  AnnouncementFeedSummary,
} from '../../queries/announcements';
import type { Group } from '../../queries/reference';

// R43: Grupuri preferate. Nothing is unselected unless a test says so.
const preferences = vi.hoisted(() => ({
  muted: new Set<number>() as ReadonlySet<number>,
  memberId: undefined as string | undefined,
}));
vi.mock('../../queries/group-preferences', () => ({
  usePreferredGroupsData: () => ({
    muted: preferences.muted,
    memberId: preferences.memberId,
  }),
}));

const hooks = vi.hoisted(() => ({
  useAnnouncementFeed: vi.fn(),
  useAnnouncementFeedSummary: vi.fn(),
  useAnnouncement: vi.fn(),
  useMarkAnnouncementRead: vi.fn(),
  useGroups: vi.fn(),
  useUnreadCountByKind: vi.fn(),
  useMemberIdentitiesByPage: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
// The details sheet reads its Notifications by subject (R53); this screen's
// queries are all mocked, so that read is too (AnnouncementDetailsSheet.test
// pins what it asks for).
vi.mock('../../queries/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/notifications')>()),
  useReadNotificationsAbout: () => {},
}));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'test-user-id' } },
  }),
}));

// Spec 2026-10-11: the Cereri de aprobare icon, read through one hook.
const approvals = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('../../queries/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/approvals')>()),
  useApprovalRequests: () => ({ data: approvals.data }),
}));
vi.mock('../../queries/announcements', () => ({
  ANNOUNCEMENT_PAGE: 20,
  useAnnouncementFeed: hooks.useAnnouncementFeed,
  useAnnouncementFeedSummary: hooks.useAnnouncementFeedSummary,
  useAnnouncement: hooks.useAnnouncement,
  useMarkAnnouncementRead: hooks.useMarkAnnouncementRead,
  useAnnouncementReaders: () => ({ data: undefined }),
  useSetAnnouncementPinned: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAnnouncement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAnnouncement: () => ({ mutate: vi.fn(), isPending: false }),
  isAnnouncementRefusal: () => false,
}));
// R45: the OSUBB Deals tab has its own suite (DealsTab.test.tsx).
vi.mock('../../queries/deals', () => ({
  useUnreadCountByKind: hooks.useUnreadCountByKind,
}));
vi.mock('../deals/DealsTab', () => ({
  default: () => <p>Conținutul tabului OSUBB Deals</p>,
}));
vi.mock('../deals/DealFormSheet', () => ({ NewDealControl: () => null }));
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: () => ({ data: undefined }),
  useMemberIdentitiesByPage: hooks.useMemberIdentitiesByPage,
}));
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));
vi.mock('../../queries/my-groups', () => ({
  useMyGroupRoles: () => ({ data: [] }),
}));

vi.mock('../../queries/reference', () => ({
  useGroups: hooks.useGroups,
}));
vi.mock('./AnnouncementComposeSheet', () => ({ default: () => null }));

import AnnouncementsScreen from './AnnouncementsScreen';

/** The current query string, rendered so a test can read where the screen sent the URL. */
function LocationProbe() {
  return <span data-testid="location">{useLocation().search}</span>;
}

function currentSearch() {
  return screen.getByTestId('location').textContent;
}

/** The screen under a router at `path`, with the URL's query string beside it. */
function renderAt(path: string) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[path]}>
        {children}
        <LocationProbe />
      </MemoryRouter>
    );
  }
  return render(<AnnouncementsScreen />, { wrapper: Wrapper });
}

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
};

const mockGroups = new Map<number, Group>([[10, mockGroup]]);

function createRow(
  overrides: Partial<AnnouncementFeedRow> = {},
): AnnouncementFeedRow {
  return {
    id: 1,
    approval_status: 'approved',
    approval_decided_by: null,
    approval_decided_at: null,
    rejection_reason: null,
    title: 'Anunț test',
    body: 'Conținut detaliat anunț.',
    priority: 'normal',
    pinned: false,
    group_id: 10,
    audience: 'local',
    published_at: '2026-09-18T10:00:00Z',
    deadline: null,
    event_id: null,
    from_event: false,
    min_level: 0,
    created_by: null,
    form_label: null,
    form_url: null,
    links: [],
    kind: 'announcement',
    code: null,
    announcement_reads: [],
    ...overrides,
  };
}

/** What `useAnnouncementFeed` answers: these rows, every one read. */
function feedRead(
  rows: AnnouncementFeedRow[],
  overrides: Partial<AnnouncementFeed> = {},
): AnnouncementFeed {
  return {
    rows,
    total: rows.length,
    isPending: false,
    isError: false,
    error: null,
    hasMore: false,
    isLoadingMore: false,
    isFetching: false,
    moreFailed: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

/** The feed the server answers, in its own (R15) order. */
function showFeed(
  rows: AnnouncementFeedRow[],
  overrides: Partial<AnnouncementFeed> = {},
) {
  hooks.useAnnouncementFeed.mockReturnValue(feedRead(rows, overrides));
}

/** What `announcement_feed_summary` answers. */
function showSummary(summary: Partial<AnnouncementFeedSummary> = {}) {
  hooks.useAnnouncementFeedSummary.mockReturnValue({
    data: {
      unread: 0,
      criticalId: null,
      everything: 1,
      preferred: 1,
      ...summary,
    },
    isPending: false,
    isError: false,
  });
}

/** `useAnnouncement` answers these rows by their id, and is on its way for any other. */
function readableById(rows: Record<number, AnnouncementFeedRow | null>) {
  hooks.useAnnouncement.mockImplementation((id: number | null) =>
    id !== null && id in rows
      ? { data: rows[id], isPending: false, isError: false }
      : { data: undefined, isPending: id !== null, isError: false },
  );
}

/** The filters of the feed's latest read. */
function feedFilters() {
  return hooks.useAnnouncementFeed.mock.lastCall?.[0];
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
    hooks.useUnreadCountByKind.mockReturnValue({ data: 0 });
    hooks.useMemberIdentitiesByPage.mockReturnValue(new Map());
    showFeed([]);
    showSummary({ everything: 0, preferred: 0 });
    readableById({});
  });

  describe('Anunțuri | OSUBB Deals tabs (R45)', () => {
    it('puts the two tabs under the title, Anunțuri open, each with its own unread count', () => {
      // The server counts each tab under the badge's own rule (R45).
      hooks.useUnreadCountByKind.mockImplementation((kind: string) => ({
        data: kind === 'deal' ? 1 : 3,
      }));

      renderAt('/anunturi');

      const tabs = screen.getByRole('navigation', {
        name: 'Anunțuri și deal-uri',
      });
      const announcements = within(tabs).getByRole('link', {
        name: /Anunțuri/,
      });
      const deals = within(tabs).getByRole('link', { name: /OSUBB Deals/ });
      expect(announcements).toHaveAttribute('aria-current', 'page');
      expect(announcements).toHaveAttribute('href', '/anunturi');
      expect(deals).toHaveAttribute('href', '/anunturi/deals');
      expect(within(announcements).getByLabelText('3 necitite')).toBeVisible();
      expect(within(deals).getByLabelText('1 necitite')).toBeVisible();
    });

    it('shows only the Deals at /anunturi/deals, never the Announcements feed', () => {
      showFeed([createRow({ title: 'Ședință' })]);

      renderAt('/anunturi/deals');

      expect(
        screen.getByText('Conținutul tabului OSUBB Deals'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Ședință')).toBeNull();
      expect(screen.getByRole('link', { name: /OSUBB Deals/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('never shows the Deals tab on Anunțuri', () => {
      showFeed([createRow({ title: 'Ședință' })]);

      renderAt('/anunturi');

      expect(screen.getByText('Ședință')).toBeInTheDocument();
      expect(screen.queryByText('Conținutul tabului OSUBB Deals')).toBeNull();
    });
  });

  it('holds the place of the feed while its first page loads', () => {
    showFeed([], { isPending: true, total: undefined });

    renderAt('/anunturi');

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Se încarcă anunțurile…')).toBeInTheDocument();
  });

  it('renders error state and retry button when feed query fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const refetch = vi.fn();
    const user = userEvent.setup();
    showFeed([], {
      isError: true,
      error: new Error('Failed to load'),
      refetch,
      total: undefined,
    });

    renderAt('/anunturi');

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText('Nu am putut încărca anunțurile.'),
    ).toBeInTheDocument();

    const retryButton = screen.getByText('Încearcă din nou');
    await user.click(retryButton);
    expect(refetch).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('says so when the Member reads no Announcement at all', () => {
    renderAt('/anunturi');

    expect(
      screen.getByText('Nu sunt anunțuri disponibile în acest moment.'),
    ).toBeInTheDocument();
    // Nothing unread: the title carries no count.
    expect(screen.queryByText(/necitit/)).toBeNull();
  });

  it('waits for the summary before it says the feed is empty', () => {
    hooks.useAnnouncementFeedSummary.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });

    renderAt('/anunturi');

    expect(screen.getByText('Se încarcă anunțurile…')).toBeInTheDocument();
    expect(
      screen.queryByText('Nu sunt anunțuri disponibile în acest moment.'),
    ).toBeNull();
  });

  // R56: the server orders the feed (R15) and counts what the page shows
  // around it; the screen neither sorts nor counts its loaded rows.
  it('draws the feed in the server’s order, the header’s count and the banner from the summary', () => {
    showFeed([
      createRow({
        id: 1,
        title: 'Anunț Vechi',
        published_at: '2026-09-15T10:00:00Z',
        announcement_reads: [{ read_at: '2026-09-16T10:00:00Z' }],
      }),
      createRow({
        id: 2,
        title: 'Urgență Server',
        priority: 'critical',
        published_at: '2026-09-18T12:00:00Z',
      }),
      createRow({
        id: 3,
        title: 'Regulament Intern',
        pinned: true,
        priority: 'important',
        published_at: '2026-09-10T10:00:00Z',
        announcement_reads: [{ read_at: '2026-09-11T10:00:00Z' }],
      }),
    ]);
    // More are unread than the loaded rows hold: the count is the server's.
    showSummary({ unread: 7, criticalId: 2, everything: 30, preferred: 30 });

    renderAt('/anunturi');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Anunțuri' }),
    ).toBeInTheDocument();
    expect(screen.getByText('7 anunțuri necitite')).toBeInTheDocument();

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/Urgență Server/)).toBeInTheDocument();

    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(3);
    expect(articles[0]).toHaveAccessibleName('Anunț Vechi');
    expect(articles[1]).toHaveAccessibleName('Urgență Server');
    expect(articles[2]).toHaveAccessibleName('Regulament Intern');
    expect(hooks.useAnnouncement).not.toHaveBeenCalledWith(2);
  });

  it('opens details sheet when a card is clicked and marks it as read', async () => {
    const user = userEvent.setup();
    showFeed([
      createRow({
        id: 42,
        title: 'Ședință Generală',
        body: 'Prezența este obligatorie.',
      }),
    ]);

    renderAt('/anunturi');

    const card = screen.getByRole('article', { name: 'Ședință Generală' });
    const readButton = within(card).getByRole('button', { name: /Citește/ });
    await user.click(readButton);

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Prezența este obligatorie.'),
    ).toBeInTheDocument();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(42, expect.any(Object));
  });

  it('triggers markRead exactly once for an unread announcement even across parent rerenders or mutation changes', async () => {
    const user = userEvent.setup();
    showFeed([
      createRow({ id: 77, title: 'Anunț Unic', body: 'Test unicitate.' }),
    ]);

    const { rerender } = renderAt('/anunturi');

    const card = screen.getByRole('article', { name: 'Anunț Unic' });
    const readButton = within(card).getByRole('button', { name: /Citește/ });
    await user.click(readButton);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(77, expect.any(Object));

    hooks.useMarkAnnouncementRead.mockReturnValue({
      mutate,
      isPending: true,
    });
    rerender(<AnnouncementsScreen />);
    rerender(<AnnouncementsScreen />);

    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('allows retrying markRead if previous mutation failed', async () => {
    const user = userEvent.setup();
    showFeed([
      createRow({ id: 88, title: 'Anunț cu Eșec', body: 'Test reîncercare.' }),
    ]);

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

    renderAt('/anunturi');

    const card = screen.getByRole('article', { name: 'Anunț cu Eșec' });
    const readButton = within(card).getByRole('button', { name: /Citește/ });

    await user.click(readButton);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(88, expect.any(Object));

    const closeButton = screen.getByRole('button', { name: 'Închide' });
    await user.click(closeButton);

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

    await user.click(readButton);
    expect(mutate).toHaveBeenCalledTimes(2);

    await user.click(closeButton);

    await user.click(readButton);
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('renders loading state when groups query is pending even if feed has loaded', () => {
    showFeed([createRow()]);
    hooks.useGroups.mockReturnValue({
      isPending: true,
      data: undefined,
    });

    renderAt('/anunturi');

    // The filter button waits too, and says so to a screen reader.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(screen.getByText('Se încarcă anunțurile…')).toBeInTheDocument();
  });

  describe('the critical banner', () => {
    it('opens the Announcement it points at', async () => {
      const user = userEvent.setup();
      showFeed([
        createRow({ id: 5, title: 'Regulament', pinned: true }),
        createRow({
          id: 99,
          title: 'Atenție Server Cazut',
          priority: 'critical',
        }),
      ]);
      showSummary({ criticalId: 99 });

      renderAt('/anunturi');

      await user.click(screen.getByRole('button', { name: 'Citește acum' }));

      expect(
        screen.getByRole('dialog', { name: 'Atenție Server Cazut' }),
      ).toBeInTheDocument();
      expect(mutate).toHaveBeenCalledWith(99, expect.any(Object));
    });

    it('is not drawn when that Announcement is already the first card (B33)', () => {
      showFeed([
        createRow({
          id: 1,
          title: 'Ședință extraordinară',
          priority: 'critical',
          pinned: true,
        }),
        createRow({ id: 2, title: 'Altceva' }),
      ]);
      showSummary({ criticalId: 1 });

      renderAt('/anunturi');

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Citește acum' }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByText(/Ședință extraordinară/)).toHaveLength(1);
      expect(screen.getAllByRole('article')[0]).toHaveAccessibleName(
        'Ședință extraordinară',
      );
    });

    it('reads one further down by its id, and opens it from there', async () => {
      const user = userEvent.setup();
      showFeed([createRow({ id: 1, title: 'Primul' })], { hasMore: true });
      showSummary({ criticalId: 77 });
      readableById({
        77: createRow({
          id: 77,
          title: 'Critic mai jos',
          priority: 'critical',
        }),
      });

      renderAt('/anunturi');

      expect(hooks.useAnnouncement).toHaveBeenCalledWith(77);
      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(/Critic mai jos/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Citește acum' }));
      expect(
        screen.getByRole('dialog', { name: 'Critic mai jos' }),
      ).toBeInTheDocument();
      expect(mutate).toHaveBeenCalledWith(77, expect.any(Object));
    });

    it('is not drawn without a critical Announcement to point at', () => {
      showFeed([createRow({ id: 1, title: 'Primul' })]);
      showSummary({ criticalId: null });

      renderAt('/anunturi');

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('more Announcements, 20 at a time (R56)', () => {
    const twenty = Array.from({ length: 20 }, (_, index) =>
      createRow({ id: index + 1, title: `Anunț ${index + 1}` }),
    );

    it('asks for the next page from Încarcă mai multe', async () => {
      const user = userEvent.setup();
      const loadMore = vi.fn();
      showFeed(twenty, { total: 45, hasMore: true, loadMore });

      renderAt('/anunturi');

      await user.click(
        screen.getByRole('button', { name: 'Încarcă mai multe' }),
      );
      expect(loadMore).toHaveBeenCalledTimes(1);
    });

    it('says so while the next page loads', () => {
      showFeed(twenty, { total: 45, hasMore: true, isLoadingMore: true });

      renderAt('/anunturi');

      expect(
        screen.getByRole('button', { name: 'Se încarcă…' }),
      ).toBeDisabled();
    });

    it('offers nothing more once every Announcement is read', () => {
      showFeed(twenty, { total: 20, hasMore: false });

      renderAt('/anunturi');

      expect(
        screen.queryByRole('button', { name: 'Încarcă mai multe' }),
      ).toBeNull();
    });

    it('keeps what is loaded and offers a retry when a later page fails', async () => {
      const user = userEvent.setup();
      const loadMore = vi.fn();
      showFeed(twenty, {
        total: 45,
        hasMore: true,
        moreFailed: true,
        loadMore,
      });

      renderAt('/anunturi');

      expect(screen.getAllByRole('article')).toHaveLength(20);
      expect(
        screen.getByText('Nu am putut încărca mai multe anunțuri.'),
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Încearcă din nou' }),
      );
      expect(loadMore).toHaveBeenCalledTimes(1);
    });

    it('loads the next page when the end of the list comes into view', () => {
      const observed: Element[] = [];
      let enter: (entries: { isIntersecting: boolean }[]) => void = () => {};
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: typeof enter) {
            enter = callback;
          }
          observe(element: Element) {
            observed.push(element);
          }
          disconnect() {}
        },
      );
      const loadMore = vi.fn();
      showFeed(twenty, { total: 45, hasMore: true, loadMore });

      renderAt('/anunturi');

      expect(observed).toHaveLength(1);
      expect(observed[0]).toContainElement(
        screen.getByRole('button', { name: 'Încarcă mai multe' }),
      );
      enter([{ isIntersecting: false }]);
      expect(loadMore).not.toHaveBeenCalled();
      enter([{ isIntersecting: true }]);
      expect(loadMore).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    // Fails if the end is watched while any read is on its way: coming into
    // view, it would ask for a page on top of the first one read again.
    it('watches the end of the list only while a next page can be asked for', () => {
      let watching = 0;
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          observe() {
            watching += 1;
          }
          disconnect() {
            watching -= 1;
          }
        },
      );
      showFeed(twenty, { total: 45, hasMore: true, isLoadingMore: true });
      const view = renderAt('/anunturi');
      expect(watching).toBe(0);
      showFeed(twenty, { total: 45, hasMore: true });
      view.rerender(<AnnouncementsScreen />);
      expect(watching).toBe(1);
      showFeed(twenty, { total: 45, hasMore: true, isFetching: true });
      view.rerender(<AnnouncementsScreen />);
      expect(watching).toBe(0);
      showFeed(twenty, { total: 45, hasMore: true, moreFailed: true });
      view.rerender(<AnnouncementsScreen />);
      expect(watching).toBe(0);
      vi.unstubAllGlobals();
    });

    // Fails if the authors are read in one set: a page that lands would ask
    // for every author again, and the names drawn would flicker meanwhile.
    it('reads the authors page by page', () => {
      showFeed(
        Array.from({ length: 21 }, (_, index) =>
          createRow({
            id: index + 1,
            title: `Anunț ${index + 1}`,
            created_by: `author-${index + 1}`,
          }),
        ),
        { total: 21 },
      );
      hooks.useMemberIdentitiesByPage.mockReturnValue(
        new Map([
          [
            'author-1',
            {
              memberId: 'author-1',
              fullName: 'Ana Pop',
              nickname: null,
              avatarColor: null,
            },
          ],
        ]),
      );

      renderAt('/anunturi');

      expect(hooks.useMemberIdentitiesByPage.mock.lastCall?.[0]).toEqual([
        Array.from({ length: 20 }, (_, index) => `author-${index + 1}`),
        ['author-21'],
      ]);
      expect(
        within(screen.getByRole('article', { name: 'Anunț 1' })).getByText(
          'Ana Pop',
        ),
      ).toBeInTheDocument();
    });
  });

  describe('?anunt= deep link (D14)', () => {
    beforeEach(() => {
      showFeed([
        createRow({ id: 1, title: 'Primul', pinned: true }),
        createRow({ id: 42, title: 'Ședință Generală' }),
      ]);
    });

    it('opens the linked Announcement and marks it read', () => {
      renderAt('/anunturi?anunt=42');

      expect(
        screen.getByRole('dialog', { name: 'Ședință Generală' }),
      ).toBeInTheDocument();
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate).toHaveBeenCalledWith(42, expect.any(Object));
      // It is among the loaded rows: nothing is read by its id.
      expect(hooks.useAnnouncement).not.toHaveBeenCalledWith(42);
    });

    it('drops the param when the sheet closes, and does not reopen it', async () => {
      const user = userEvent.setup();
      renderAt('/anunturi?anunt=42&x=1');

      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Închide',
        }),
      );

      await waitFor(() => expect(currentSearch()).toBe('?x=1'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('does not open anything before the feed is in', () => {
      showFeed([], { isPending: true, total: undefined });
      renderAt('/anunturi?anunt=42');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mutate).not.toHaveBeenCalled();
    });

    // R56: the linked one may sit on a page not read yet.
    it('reads one not among the loaded rows by its id, opens it and marks it read', () => {
      readableById({
        500: createRow({ id: 500, title: 'Anunț mai vechi' }),
      });

      renderAt('/anunturi?anunt=500');

      expect(hooks.useAnnouncement).toHaveBeenCalledWith(500);
      expect(
        screen.getByRole('dialog', { name: 'Anunț mai vechi' }),
      ).toBeInTheDocument();
      expect(mutate).toHaveBeenCalledWith(500, expect.any(Object));
    });

    it('waits while that read is on its way', () => {
      renderAt('/anunturi?anunt=500');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mutate).not.toHaveBeenCalled();
    });

    it('opens the unavailable state for an Announcement the member cannot read', async () => {
      const user = userEvent.setup();
      readableById({ 999: null });
      renderAt('/anunturi?anunt=999');

      const dialog = screen.getByRole('dialog', { name: 'Anunț indisponibil' });
      expect(dialog).toBeInTheDocument();
      expect(mutate).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Închide' }));
      await waitFor(() => expect(currentSearch()).toBe(''));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('treats a malformed id as unavailable', () => {
      renderAt('/anunturi?anunt=abc');

      expect(
        screen.getByRole('dialog', { name: 'Anunț indisponibil' }),
      ).toBeInTheDocument();
      expect(mutate).not.toHaveBeenCalled();
    });
  });

  describe('Filtrează, by Group', () => {
    const child: Group = {
      ...mockGroup,
      id: 11,
      name: 'Echipa Web',
      category: 'team',
      path: [10, 11],
      parent_id: 10,
    };
    const other: Group = {
      ...mockGroup,
      id: 20,
      name: 'Educațional',
      path: [20],
    };
    beforeEach(() => {
      hooks.useGroups.mockReturnValue({
        data: new Map([
          [10, mockGroup],
          [11, child],
          [20, other],
        ]),
        isPending: false,
      });
      showFeed([
        createRow({ id: 1, title: 'Din IT', group_id: 10 }),
        createRow({ id: 2, title: 'Din Echipa Web', group_id: 11 }),
        createRow({ id: 3, title: 'Din Educațional', group_id: 20 }),
      ]);
      showSummary({ unread: 3, everything: 3, preferred: 3 });
    });

    it('draws Filtrează on the title row and asks for every Group with none chosen', () => {
      renderAt('/anunturi');

      expect(
        screen
          .getByRole('button', { name: 'Filtrează' })
          .closest('[data-slot="page-actions"]'),
      ).not.toBeNull();
      expect(feedFilters()).toEqual({ p_preferred: false });
      expect(screen.getByText('Din IT')).toBeInTheDocument();
      expect(screen.getByText('Din Echipa Web')).toBeInTheDocument();
      expect(screen.getByText('Din Educațional')).toBeInTheDocument();
    });

    // The server keeps the chosen Group and every Group below it.
    it('asks the server for the chosen Group, and the header still counts every unread', () => {
      showFeed([
        createRow({ id: 1, title: 'Din IT', group_id: 10 }),
        createRow({ id: 2, title: 'Din Echipa Web', group_id: 11 }),
      ]);
      renderAt('/anunturi?grup=10');

      expect(feedFilters()).toEqual({ p_group_id: 10, p_preferred: false });
      expect(hooks.useAnnouncementFeedSummary).toHaveBeenLastCalledWith(
        { p_group_id: 10, p_preferred: false },
        true,
      );
      expect(screen.getByText('Din IT')).toBeInTheDocument();
      expect(screen.getByText('Din Echipa Web')).toBeInTheDocument();
      expect(screen.getByText('3 anunțuri necitite')).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: 'Elimină filtrul Grup principal: IT',
        }),
      ).toBeVisible();
    });

    it('says so when the chosen Group has no Announcement', () => {
      showFeed([]);
      renderAt('/anunturi?grup=20');

      expect(screen.getByText('Niciun anunț în grupul ales.')).toBeVisible();
    });
  });

  describe('Grupuri preferate (R43)', () => {
    const second: Group = {
      ...mockGroup,
      id: 20,
      name: 'Educațional',
      path: [20],
    };
    beforeEach(() => {
      preferences.muted = new Set([20]);
      preferences.memberId = 'test-user-id';
      hooks.useGroups.mockReturnValue({
        data: new Map([
          [10, mockGroup],
          [20, second],
        ]),
        isPending: false,
      });
      showFeed([
        createRow({ id: 1, title: 'Din IT', group_id: 10 }),
        createRow({
          id: 3,
          title: 'Critic din Educațional',
          group_id: 20,
          priority: 'critical',
        }),
      ]);
      showSummary({ everything: 5, preferred: 2 });
    });
    afterEach(() => {
      preferences.muted = new Set();
      preferences.memberId = undefined;
    });

    // The server keeps a critical, organization-wide or own Announcement of
    // an unticked Group (announcement_feed.test.sql).
    it('opens on the preferred Groups, asking the server for them', () => {
      renderAt('/anunturi');

      expect(feedFilters()).toEqual({ p_preferred: true });
      expect(hooks.useAnnouncementFeedSummary).toHaveBeenLastCalledWith(
        { p_preferred: true },
        true,
      );
      expect(screen.getByText('Din IT')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Doar grupurile preferate' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows everything for the visit after Arată tot, and goes back', async () => {
      const user = userEvent.setup();
      renderAt('/anunturi');
      await user.click(
        screen.getByRole('button', { name: 'Doar grupurile preferate' }),
      );
      expect(feedFilters()).toEqual({ p_preferred: false });
      const star = screen.getByRole('button', {
        name: 'Doar grupurile preferate',
      });
      expect(star).toHaveAttribute('aria-pressed', 'false');
      await user.click(star);
      expect(feedFilters()).toEqual({ p_preferred: true });
    });

    it('says so when only the unticked Groups have Announcements', () => {
      showFeed([]);
      showSummary({ everything: 3, preferred: 0 });
      renderAt('/anunturi');

      expect(
        screen.getByText('Niciun anunț în grupurile tale preferate.'),
      ).toBeVisible();
    });

    it('changes nothing for a member who unselected nothing', () => {
      preferences.muted = new Set();
      renderAt('/anunturi');
      expect(feedFilters()).toEqual({ p_preferred: false });
      expect(
        screen.queryByRole('button', { name: 'Doar grupurile preferate' }),
      ).not.toBeInTheDocument();
    });
  });
});

it('moves between Anunțuri and OSUBB Deals with a finger swipe over the panel (2026-10-11)', async () => {
  renderAt('/anunturi/deals');
  swipe(await screen.findByText('Conținutul tabului OSUBB Deals'), 'right');
  expect(
    await screen.findByRole('link', { name: /^Anunțuri/ }),
  ).toHaveAttribute('aria-current', 'page');
});

it('shows the request icon beside Filtrează only while OSUBB-wide Announcements wait (spec 2026-10-11)', () => {
  approvals.data = [
    {
      kind: 'announcement',
      id: 3,
      title: 'Burse',
      groupId: 10,
      createdBy: null,
      createdAt: '2026-10-11T09:00:00Z',
      startsAt: null,
    },
  ];
  renderAt('/anunturi');
  const icon = screen.getByRole('button', { name: '1 cerere de aprobare' });
  expect(icon.closest('[data-slot="page-actions"]')).toContainElement(
    screen.getByRole('button', { name: 'Filtrează' }),
  );
  approvals.data = [];
});
