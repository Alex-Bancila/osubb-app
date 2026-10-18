import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventGroup, EventPresentation } from '../../queries/events';
import type { MyGroup } from '../../queries/my-groups';
import { taskRow } from '../../test/task-fixtures';
import type { TaskPresentationRow } from '../tracker/task-presentation';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('../../lib/auth', () => ({ useAuth: auth.useAuth }));
/* The server capability row (`my_capabilities()`): which panels exist. */
const capabilities = vi.hoisted(() => ({
  result: {
    data: { seeLeadership: false, manageTasks: false },
    isPending: false,
    isError: false,
  } as {
    data?: Record<string, boolean>;
    isPending: boolean;
    isError: boolean;
    error?: unknown;
    refetch?: () => void;
  },
}));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: () => capabilities.result,
}));
const hooks = vi.hoisted(() => ({
  useMyTasks: vi.fn(),
  useEventsInRange: vi.fn(),
  useMyGroupRoles: vi.fn(),
  useAwaitingMyReview: vi.fn(),
  useMyPoints: vi.fn(),
  pointsStartDate: { value: null as string | null | undefined },
  usePendingDecisions: vi.fn(),
  useUnreadAnnouncementsCount: vi.fn(),
  useUnreadNotificationCount: vi.fn(),
  profile: { full_name: 'Ioana Popescu', nickname: null, role: 'voluntar' } as {
    full_name: string;
    nickname: string | null;
    role: string;
  },
}));
// No request is made; the modules the cards import only load the client.
const supabase = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase }));
vi.mock('../../queries/tasks', () => ({ useMyTasks: hooks.useMyTasks }));
vi.mock('../../queries/events', () => ({
  useEventsInRange: hooks.useEventsInRange,
}));
vi.mock('../../queries/my-groups', async (importActual) => ({
  ...(await importActual<typeof import('../../queries/my-groups')>()),
  useMyGroupRoles: hooks.useMyGroupRoles,
}));
vi.mock('../../queries/event-rsvp', () => ({
  EventRsvpMutationError: class EventRsvpMutationError extends Error {},
  useEventRsvp: () => ({ data: null, isPending: false, isError: false }),
  useSetEventRsvp: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../../queries/profile', () => ({
  useMyProfile: () => ({ data: hooks.profile }),
}));
vi.mock('../../queries/reference', () => ({
  useRoles: () => ({ data: new Map() }),
  useGroups: () => ({ data: new Map(), isPending: false }),
  // The points line's Role label (#963): no board row, no Board Title.
  useMyGroups: () => ({ membershipRows: [] }),
  boardTitleFrom: () => null,
}));
vi.mock('../../queries/org-settings', () => ({
  useOrgSettings: () => ({ data: undefined }),
}));
vi.mock('../../queries/points', () => ({ useMyPoints: hooks.useMyPoints }));
// R58: the Points Start Date beside the total; null until BC sets one.
vi.mock('../../queries/evaluation-settings', () => ({
  usePointsStartDate: () => hooks.pointsStartDate.value,
}));
// The shell's badge reads, which the tiles share.
vi.mock('../../queries/request-decisions', () => ({
  usePendingDecisions: hooks.usePendingDecisions,
}));
vi.mock('../../queries/announcements', () => ({
  useUnreadAnnouncementsCount: hooks.useUnreadAnnouncementsCount,
}));
vi.mock('../../queries/notifications', () => ({
  useUnreadNotificationCount: hooks.useUnreadNotificationCount,
}));
vi.mock('../../queries/task-review', async (importActual) => ({
  ...(await importActual<typeof import('../../queries/task-review')>()),
  useAwaitingMyReview: hooks.useAwaitingMyReview,
}));

// The card has its own suite (PushPromptCard.test.tsx); here only its place.
vi.mock('./PushPromptCard', () => ({
  default: () => <p data-testid="push-prompt-slot" />,
}));

import DashboardScreen from './DashboardScreen';
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);

const ME = 'm';

function claims(level: number) {
  return {
    claims: {
      member_role: 'x',
      member_level: level,
      group_ids: [],
    },
    session: { user: { id: ME } },
    loading: false,
    signOut: vi.fn(),
  };
}

function query<T>(data: T, overrides: Record<string, unknown> = {}) {
  return {
    data,
    error: null,
    isError: false,
    isPending: false,
    refetch: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardScreen />
    </MemoryRouter>,
  );
}

/** A Task I am the current Executor of. */
function mine(overrides: Partial<TaskPresentationRow>): TaskPresentationRow {
  return taskRow({
    assignments: [{ id: 1, member_id: ME, ended_at: null }],
    ...overrides,
  });
}

const orgGroup: EventGroup = {
  name: 'OSUBB',
  short: 'ORG',
  color: '#ED2025',
  category: 'organization',
  path: [5],
  is_organization: true,
};
const eduGroup: EventGroup = {
  name: 'Educațional',
  short: 'EDU',
  color: '#284C93',
  category: 'department',
  path: [7],
  is_organization: false,
};
const festivalGroup: EventGroup = {
  name: 'Festival',
  short: null,
  color: '#1B9E4B',
  category: 'department',
  path: [20],
  is_organization: false,
};

/** A member of Social Media (12), a Child Team of Educațional (7). */
const teamMember: MyGroup[] = [
  {
    id: 12,
    name: 'Social Media',
    short: 'SM',
    color: '',
    category: 'team',
    path: [7, 12],
    is_organization: false,
    min_level: 0,
    status: 'active',
    group_role: 'member',
    explicit: true,
    automatic: false,
  },
];

function event(overrides: Partial<EventPresentation>): EventPresentation {
  return {
    id: 1,
    title: 'Ședință',
    type: 'sedinta',
    groupId: 7,
    group: eduGroup,
    campaignId: null,
    startsAt: '2026-01-20T16:00:00.000Z',
    endsAt: null,
    dayKey: '2026-01-20',
    dayLabel: 'marți, 20 ianuarie 2026',
    startTime: '18:00',
    endTime: null,
    location: null,
    capacity: null,
    description: null,
    minLevel: 0,
    createdBy: null,
    cancelledAt: null,
    cancelReason: null,
    approvalStatus: 'approved',
    rejectionReason: null,
    ...overrides,
  };
}

/** The one list of the page. */
function upNext() {
  return screen.getByRole('region', { name: 'Urmează' });
}

/** The rows of Urmează, as their links, in order. */
function rows() {
  return within(upNext()).queryAllByRole('link');
}

/** The tiles' labels, in order. */
function tiles(): string[] {
  return Array.from(
    document.querySelectorAll('[data-slot="count-tile"]'),
    (link) =>
      link.querySelector('[data-slot="count-label"]')?.textContent ?? '',
  );
}

/** A tile, by the count it says in words. */
function tile(name: string | RegExp) {
  return within(screen.getByRole('list', { name: 'Ce te așteaptă' })).getByRole(
    'link',
    { name },
  );
}

beforeEach(() => {
  // DashboardScreen renders the date above the greeting. On the 12th of any
  // month that is a Romanian date like "joi, 12 septembrie 2026", which also
  // matches a loose /12/ points assertion; freeze the clock on a date with no
  // "12" in it so no outcome depends on today's date.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
  auth.useAuth.mockReturnValue(claims(1));
  viewer({ seeLeadership: false, manageTasks: false });
  hooks.profile = {
    full_name: 'Ioana Popescu',
    nickname: null,
    role: 'voluntar',
  };
  hooks.useMyPoints.mockReturnValue(query(12));
  hooks.pointsStartDate.value = null;
  hooks.useAwaitingMyReview.mockReturnValue(query({ task: null, count: 0 }));
  hooks.useMyTasks.mockReturnValue(query([]));
  hooks.useEventsInRange.mockReturnValue(query([]));
  hooks.useMyGroupRoles.mockReturnValue(query(teamMember));
  hooks.usePendingDecisions.mockReturnValue(query([]));
  hooks.useUnreadAnnouncementsCount.mockReturnValue(query(0));
  hooks.useUnreadNotificationCount.mockReturnValue(query(0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function viewer(data: Record<string, boolean>) {
  capabilities.result = { data, isPending: false, isError: false };
}

/** Nothing of the leadership boards or the rank is left on Acasă. */
function expectNoBoards() {
  expect(screen.queryByRole('heading', { name: /clasament/i })).toBeNull();
  expect(screen.queryByRole('heading', { name: /cupa/i })).toBeNull();
  expect(screen.queryByText(/din \d+ membri/)).toBeNull();
  expect(screen.queryByText(/vizibile pentru BCE/i)).toBeNull();
  expect(supabase.rpc).not.toHaveBeenCalled();
  expect(supabase.from).not.toHaveBeenCalled();
}

describe('the greeting', () => {
  it('greets by first name without a Nickname, under the capitalised date', () => {
    renderDashboard();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Salut, Ioana' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Joi, 15 ianuarie 2026')).toBeInTheDocument();
  });

  it('greets by Nickname when one is set', () => {
    hooks.profile = { ...hooks.profile, nickname: '  Ioni  ' };
    renderDashboard();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Salut, Ioni' }),
    ).toBeInTheDocument();
  });
});

describe('Pornește notificările (2026-10-06)', () => {
  it.each([
    ['a Voluntar', false, false],
    ['a Responsabil', false, true],
    ['a BC member', true, true],
  ])(
    '%s gets the card between the greeting and the tiles',
    (_, leader, reviewer) => {
      viewer({ seeLeadership: leader, manageTasks: reviewer });
      renderDashboard();
      const card = screen.getByTestId('push-prompt-slot');
      const heading = screen.getByRole('heading', { level: 1 });
      const list = screen.getByRole('list', { name: 'Ce te așteaptă' });
      expect(
        heading.compareDocumentPosition(card) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        card.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );
});

describe('what each viewer sees', () => {
  it('a Voluntar: the points as a header stat, three tiles, then Urmează', () => {
    renderDashboard();
    expect(tiles()).toEqual([
      'Taskuri în lucru',
      'Anunțuri necitite',
      'Notificări necitite',
    ]);
    expect(upNext()).toBeInTheDocument();
    // The tiles come before the list.
    expect(
      screen
        .getByRole('list', { name: 'Ce te așteaptă' })
        .compareDocumentPosition(upNext()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // #859: no Punctaj panel — a compact stat on the greeting line, to Profil.
    expect(screen.queryByRole('region', { name: /punctaj/i })).toBeNull();
    const stat = screen.getByRole('link', { name: /12\s*puncte/ });
    expect(stat).toHaveAttribute('href', '/profil');
    expect(stat.closest('[data-slot="page-header"]')).not.toBeNull();
    expect(stat.querySelector('[data-slot="points-value"]')).toHaveTextContent(
      /^12$/,
    );
    expect(stat).toHaveTextContent('voluntar');
    expect(screen.queryByRole('link', { name: 'Clasament' })).toBeNull();
    // Nothing a Voluntar can never have is read or drawn.
    expect(hooks.useAwaitingMyReview).not.toHaveBeenCalledWith(true);
    expect(hooks.usePendingDecisions).not.toHaveBeenCalled();
    expectNoBoards();
  });

  it('names the Points Start Date after the Role once BC has set one (R58)', () => {
    hooks.useMyPoints.mockReturnValue(query(14));
    hooks.pointsStartDate.value = '2026-09-01';
    renderDashboard();
    const stat = screen.getByRole('link', { name: /14\s*puncte/ });
    expect(stat).toHaveTextContent('14puncte·voluntar·din 01.09.2026');
    expect(stat.querySelector('[data-slot="points-since"]')).toHaveTextContent(
      /^din 01\.09\.2026$/,
    );
  });

  it('says nothing about a start while none is set or it is still loading (R58)', () => {
    renderDashboard();
    expect(
      screen
        .getByRole('link', { name: /12\s*puncte/ })
        .querySelector('[data-slot="points-since"]'),
    ).toBeNull();
    cleanup();
    hooks.pointsStartDate.value = undefined;
    renderDashboard();
    expect(
      screen.getByRole('link', { name: /12\s*puncte/ }),
    ).not.toHaveTextContent('din');
  });

  it('a Responsabil below BCE: the stat, their own Tasks and what they decide', () => {
    auth.useAuth.mockReturnValue(claims(2));
    viewer({ seeLeadership: false, manageTasks: true });
    renderDashboard();
    expect(tiles()).toEqual([
      'Taskuri în lucru',
      'De evaluat',
      'Cereri de decis',
      'Anunțuri necitite',
      'Notificări necitite',
    ]);
    expect(screen.getByRole('link', { name: /12\s*puncte/ })).toHaveAttribute(
      'href',
      '/profil',
    );
    expect(hooks.useMyTasks).toHaveBeenCalled();
    expect(hooks.useAwaitingMyReview).toHaveBeenCalledWith(true);
    expectNoBoards();
  });

  it('a BC member: De evaluat and Cereri in place of their own Tasks, no score', () => {
    auth.useAuth.mockReturnValue(claims(6));
    viewer({ seeLeadership: true, manageTasks: true });
    renderDashboard();
    expect(tiles()).toEqual([
      'De evaluat',
      'Cereri de decis',
      'Anunțuri necitite',
      'Notificări necitite',
    ]);
    expect(screen.queryByText('Punctajul meu')).toBeNull();
    // No stat for BC/BCE: they do not work by points.
    expect(screen.queryByRole('link', { name: /puncte/ })).toBeNull();
    expect(hooks.useMyPoints).not.toHaveBeenCalled();
    expect(hooks.useMyTasks).not.toHaveBeenCalled();
    expectNoBoards();
  });

  it('leadership without manageTasks keeps its own Tasks', () => {
    auth.useAuth.mockReturnValue(claims(5));
    viewer({ seeLeadership: true, manageTasks: false });
    renderDashboard();
    expect(tiles()).toEqual([
      'Taskuri în lucru',
      'Anunțuri necitite',
      'Notificări necitite',
    ]);
    expect(hooks.useMyTasks).toHaveBeenCalled();
  });

  it('draws no second navigation: the pages off the bar are behind its Mai mult', () => {
    auth.useAuth.mockReturnValue(claims(6));
    viewer({
      seeLeadership: true,
      seeDirectory: true,
      manageTasks: true,
      administer: true,
    });
    renderDashboard();
    expect(screen.queryByRole('region', { name: 'Mai mult' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Clasament' })).toBeNull();
  });

  it('renders nothing until the capability row decides, then retries its error', () => {
    capabilities.result = { isPending: true, isError: false };
    const { unmount } = renderDashboard();
    expect(tiles()).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Urmează' })).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    capabilities.result = {
      isPending: false,
      isError: true,
      error: new Error('boom'),
      refetch,
    };
    renderDashboard();
    expect(tiles()).toEqual([]);
    within(screen.getByRole('alert')).getByRole('button').click();
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe('the count tiles', () => {
  beforeEach(() => {
    auth.useAuth.mockReturnValue(claims(2));
    viewer({ seeLeadership: false, manageTasks: true });
  });

  it('each says its count and opens what is waiting', () => {
    hooks.useMyTasks.mockReturnValue(
      query([
        mine({ id: 1, status: 'in_progress' }),
        mine({ id: 2, deadline: null }),
        // Not in work: finished, in review, or no longer mine.
        mine({ id: 3, status: 'completed' }),
        mine({ id: 4, status: 'in_review' }),
        taskRow({
          id: 5,
          assignments: [{ id: 2, member_id: ME, ended_at: '2026-01-09' }],
        }),
      ]),
    );
    hooks.useAwaitingMyReview.mockReturnValue(
      query({ task: taskRow({ id: 31, status: 'in_review' }), count: 3 }),
    );
    hooks.usePendingDecisions.mockReturnValue(query([{ id: 1 }]));
    hooks.useUnreadAnnouncementsCount.mockReturnValue(query(4));
    hooks.useUnreadNotificationCount.mockReturnValue(query(7));
    renderDashboard();

    const expected: [string, string, string][] = [
      ['2 taskuri în lucru', '2', '/tracker'],
      ['3 taskuri așteaptă evaluarea ta', '3', '/tracker?lista=gestionat'],
      ['1 cerere de decis', '1', '/tracker?vedere=cereri'],
      ['4 anunțuri necitite', '4', '/anunturi'],
      ['7 notificări necitite', '7', '/notificari'],
    ];
    for (const [name, figure, href] of expected) {
      const link = tile(name);
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('data-waiting', 'true');
      expect(link.querySelector('[data-slot="count-value"]')).toHaveTextContent(
        new RegExp(`^${figure}$`),
      );
      // A lucide icon, never an emoji.
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      // A 44 px target.
      expect(link).toHaveClass('min-h-11');
    }
  });

  it('says one Task awaiting Evaluation in the singular', () => {
    hooks.useAwaitingMyReview.mockReturnValue(
      query({ task: taskRow({ id: 31, status: 'in_review' }), count: 1 }),
    );
    renderDashboard();
    expect(tile('1 task așteaptă evaluarea ta')).toBeInTheDocument();
  });

  it('mutes a zero instead of hiding it, and Taskuri în lucru then invites to Disponibile', () => {
    renderDashboard();

    expect(tiles()).toHaveLength(5);
    for (const link of document.querySelectorAll('[data-slot="count-tile"]')) {
      expect(link).not.toHaveAttribute('data-waiting');
      const figure = link.querySelector('[data-slot="count-value"]');
      expect(figure).toHaveTextContent(/^0$/);
      expect(figure).toHaveClass('text-muted-foreground');
    }
    expect(tile('0 taskuri în lucru')).toHaveAttribute(
      'href',
      '/tracker?lista=disponibile',
    );
  });

  it('shows a dash, not a zero, while a count is unknown, and still opens its page', () => {
    hooks.useUnreadNotificationCount.mockReturnValue(
      query(undefined, { isPending: true }),
    );
    hooks.useAwaitingMyReview.mockReturnValue(
      query(undefined, { isError: true, error: new Error('boom') }),
    );
    renderDashboard();

    const notifications = tile('Notificări necitite');
    expect(notifications).toHaveAttribute('href', '/notificari');
    expect(
      notifications.querySelector('[data-slot="count-value"]'),
    ).toHaveTextContent('—');
    expect(
      tile('De evaluat').querySelector('[data-slot="count-value"]'),
    ).toHaveTextContent('—');
    // A failed count holds back none of the others.
    expect(tile('0 anunțuri necitite')).toBeInTheDocument();
  });

  it('is two columns on a phone and one full row from md', () => {
    renderDashboard();
    const list = screen.getByRole('list', { name: 'Ce te așteaptă' });
    expect(list).toHaveClass('grid-cols-2', 'md:grid-cols-5');
  });
});

describe('Urmează', () => {
  const unrelated = event({
    id: 11,
    title: 'Festival',
    groupId: 20,
    group: festivalGroup,
    startsAt: '2026-01-16T16:00:00.000Z',
  });
  const parents = event({
    id: 12,
    title: 'Ședință Educațional',
    groupId: 7,
    group: eduGroup,
    startsAt: '2026-01-17T16:00:00.000Z',
    location: 'Sala 2',
  });
  const organization = event({
    id: 13,
    title: 'Adunare OSUBB',
    type: 'eveniment',
    groupId: 5,
    group: orgGroup,
    startsAt: '2026-01-19T16:00:00.000Z',
  });
  const started = event({
    id: 14,
    title: 'Ședință de azi',
    groupId: 5,
    group: orgGroup,
    startsAt: '2026-01-15T08:00:00.000Z',
  });

  it('mixes my next deadlines and Relevant Events by date, each row linking to its full card', () => {
    hooks.useMyTasks.mockReturnValue(
      query([
        // Terminal: finished work is not next, however early its deadline.
        mine({
          id: 1,
          title: 'Raport predat',
          status: 'completed',
          deadline: '2026-01-05T10:00:00Z',
        }),
        // Given up: my Assignment ended, someone else executes it now.
        taskRow({
          id: 2,
          title: 'Afiș cedat',
          deadline: '2026-01-08T10:00:00Z',
          assignments: [
            { id: 3, member_id: 'other', ended_at: null },
            { id: 2, member_id: ME, ended_at: '2026-01-09T10:00:00Z' },
          ],
        }),
        mine({
          id: 6,
          title: 'Prezentare finală',
          deadline: '2026-01-18T10:00:00Z',
        }),
        // Overdue and still mine: the soonest.
        mine({
          id: 3,
          title: 'Buget întârziat',
          status: 'in_progress',
          deadline: '2026-01-10T10:00:00Z',
        }),
        // În verificare waits on the reviewer, not on me (B1).
        mine({
          id: 4,
          title: 'Prezentare',
          status: 'in_review',
          deadline: '2026-01-16T10:00:00Z',
        }),
        mine({ id: 5, title: 'Fără termen', deadline: null }),
      ]),
    );
    hooks.useEventsInRange.mockReturnValue(
      query([started, unrelated, organization, parents]),
    );
    renderDashboard();

    expect(rows().map((link) => link.textContent)).toEqual([
      'Buget întârziat',
      'Ședință Educațional',
      'Prezentare finală',
      'Adunare OSUBB',
    ]);
    expect(rows().map((link) => link.getAttribute('href'))).toEqual([
      '/tracker?task=3',
      '/calendar?event=12',
      '/tracker?task=6',
      '/calendar?event=13',
    ]);
    // Today's Bucharest midnight, open-ended: the Agendă's own window.
    expect(hooks.useEventsInRange).toHaveBeenCalledWith({
      from: '2026-01-14T22:00:00.000Z',
    });
  });

  it('draws compact rows: a date block, the title, one meta line and a chevron — no full card', () => {
    hooks.useMyTasks.mockReturnValue(
      query([
        mine({
          id: 3,
          title: 'Buget întârziat',
          status: 'in_progress',
          deadline: '2026-01-10T10:00:00Z',
        }),
        mine({
          id: 6,
          title: 'Prezentare finală',
          deadline: '2026-01-18T10:00:00Z',
        }),
      ]),
    );
    hooks.useEventsInRange.mockReturnValue(query([parents]));
    renderDashboard();

    const [overdue, meeting, upcoming] = within(upNext()).getAllByRole(
      'listitem',
    ) as [HTMLElement, HTMLElement, HTMLElement];
    for (const row of [overdue, meeting, upcoming]) {
      expect(row).toHaveAttribute('data-slot', 'list-row');
      expect(row.querySelector('[data-slot="date-block"]')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
      expect(
        row.querySelector('[data-slot="list-row-action"] svg'),
      ).not.toBeNull();
      expect(row.querySelectorAll('p')).toHaveLength(1);
    }
    expect(within(upNext()).queryByRole('article')).toBeNull();
    // The day is the block's: "17" over "IAN", in Romania's day.
    expect(meeting.querySelector('[data-slot="date-block"]')).toHaveTextContent(
      /^17ian$/i,
    );
    // The meta line: what it is, when, where, whose — the day said for a
    // screen reader, who does not get the block.
    expect(meeting.querySelector('p')).toHaveTextContent(
      'Ședință · sâm., 17 ian., 18:00 · Sala 2 · Educațional',
    );
    expect(upcoming.querySelector('p')).toHaveTextContent(
      'Termen · dum., 18 ian., 12:00 · Educațional',
    );
    expect(within(overdue).getByText('Termen depășit')).toHaveClass(
      'text-destructive',
    );
    // The rows read; acting happens in Taskuri.
    expect(within(upNext()).queryByRole('button')).toBeNull();
  });

  it('leads with the Task awaiting my Evaluation', () => {
    auth.useAuth.mockReturnValue(claims(6));
    viewer({ seeLeadership: true, manageTasks: true });
    hooks.useAwaitingMyReview.mockReturnValue(
      query({
        task: taskRow({
          id: 31,
          title: 'Raport cheltuieli',
          status: 'in_review',
          assignments: [{ id: 5, member_id: 'other', ended_at: null }],
        }),
        count: 3,
      }),
    );
    hooks.useEventsInRange.mockReturnValue(query([parents]));
    renderDashboard();

    expect(rows().map((link) => link.textContent)).toEqual([
      'Raport cheltuieli',
      'Ședință Educațional',
    ]);
    expect(rows()[0]).toHaveAttribute('href', '/tracker?task=31');
    const row = rows()[0]?.closest('li') as HTMLElement;
    expect(row.querySelector('p')).toHaveTextContent(
      'De evaluat · Educațional',
    );
    // No day of its own: an icon holds the block.
    expect(row.querySelector('[data-slot="date-block"] svg')).not.toBeNull();
    expect(hooks.useAwaitingMyReview).toHaveBeenCalledWith(true);
  });

  it('keeps to three deadlines and three Events', () => {
    hooks.useMyTasks.mockReturnValue(
      query(
        [1, 2, 3, 4, 5].map((id) =>
          mine({
            id,
            title: `Task ${id}`,
            deadline: `2026-02-0${id}T10:00:00Z`,
          }),
        ),
      ),
    );
    hooks.useEventsInRange.mockReturnValue(
      query(
        [1, 2, 3, 4, 5].map((id) =>
          event({
            id: 100 + id,
            title: `Eveniment ${id}`,
            groupId: 5,
            group: orgGroup,
            startsAt: `2026-03-0${id}T16:00:00.000Z`,
          }),
        ),
      ),
    );
    renderDashboard();

    expect(rows().map((link) => link.textContent)).toEqual([
      'Task 1',
      'Task 2',
      'Task 3',
      'Eveniment 1',
      'Eveniment 2',
      'Eveniment 3',
    ]);
  });

  // #849: a cancelled Event is not the next thing to go to.
  it('skips a cancelled Event, and one that is not Relevant', () => {
    hooks.useEventsInRange.mockReturnValue(
      query([
        { ...parents, cancelledAt: '2026-01-14T10:00:00.000Z' },
        unrelated,
        organization,
      ]),
    );
    renderDashboard();

    expect(rows().map((link) => link.textContent)).toEqual(['Adunare OSUBB']);
  });

  it("shows an Organization Group Event whatever the member's Groups", () => {
    hooks.useMyGroupRoles.mockReturnValue(query([]));
    hooks.useEventsInRange.mockReturnValue(
      query([unrelated, parents, organization]),
    );
    renderDashboard();

    expect(rows().map((link) => link.getAttribute('href'))).toEqual([
      '/calendar?event=13',
    ]);
  });

  it('with nothing in work and nothing ahead it invites to Disponibile', () => {
    hooks.useMyTasks.mockReturnValue(
      query([
        mine({ id: 6, title: 'Anulat', status: 'cancelled' }),
        mine({
          id: 9,
          title: 'În verificare',
          status: 'in_review',
          deadline: '2026-01-16T10:00:00Z',
        }),
      ]),
    );
    hooks.useEventsInRange.mockReturnValue(query([unrelated, started]));
    renderDashboard();

    expect(
      within(upNext()).getByText(
        'Niciun task cu termen și niciun eveniment viitor pentru tine.',
      ),
    ).toBeInTheDocument();
    expect(within(upNext()).queryByRole('listitem')).toBeNull();
    expect(
      within(upNext()).getByRole('link', { name: 'Vezi oportunitățile' }),
    ).toHaveAttribute('href', '/tracker?lista=disponibile');
  });

  it('with only undated work it opens Taskuri instead', () => {
    hooks.useMyTasks.mockReturnValue(
      query([mine({ id: 5, title: 'Fără termen', deadline: null })]),
    );
    renderDashboard();

    expect(within(upNext()).queryByText('Fără termen')).toBeNull();
    expect(
      within(upNext()).getByRole('link', { name: 'Vezi taskurile tale' }),
    ).toHaveAttribute('href', '/tracker');
  });

  it('a viewer who executes no Tasks is told only about Events, with no invitation', () => {
    auth.useAuth.mockReturnValue(claims(6));
    viewer({ seeLeadership: true, manageTasks: true });
    renderDashboard();

    expect(
      within(upNext()).getByText('Niciun eveniment viitor pentru tine.'),
    ).toBeInTheDocument();
    expect(within(upNext()).queryByRole('link')).toBeNull();
  });

  it('waits for every read, then keeps the rows that arrived beside a failed one', () => {
    hooks.useMyTasks.mockReturnValue(query(undefined, { isPending: true }));
    hooks.useEventsInRange.mockReturnValue(query([parents]));
    const { unmount } = renderDashboard();
    expect(within(upNext()).getByRole('status')).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    unmount();

    const refetch = vi.fn().mockResolvedValue({});
    hooks.useMyTasks.mockReturnValue(
      query(undefined, { isError: true, error: new Error('boom'), refetch }),
    );
    renderDashboard();
    // A failed Task read does not blank the Event next to it.
    expect(rows().map((link) => link.textContent)).toEqual([
      'Ședință Educațional',
    ]);
    const alert = within(upNext()).getByRole('alert');
    expect(alert).toHaveTextContent('Nu am putut încărca taskurile tale.');
    within(alert).getByRole('button').click();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('says the Events could not be read when the Groups read fails, and keeps the deadlines', () => {
    hooks.useMyTasks.mockReturnValue(
      query([
        mine({ id: 3, title: 'Buget', deadline: '2026-01-20T10:00:00Z' }),
      ]),
    );
    hooks.useEventsInRange.mockReturnValue(query([parents]));
    hooks.useMyGroupRoles.mockReturnValue(
      query(undefined, { isError: true, error: new Error('boom') }),
    );
    renderDashboard();

    expect(rows().map((link) => link.textContent)).toEqual(['Buget']);
    expect(within(upNext()).getByRole('alert')).toHaveTextContent(
      'Nu am putut încărca evenimentele.',
    );
  });

  it('keeps the failed Evaluation read apart from the rest', () => {
    auth.useAuth.mockReturnValue(claims(6));
    viewer({ seeLeadership: true, manageTasks: true });
    hooks.useAwaitingMyReview.mockReturnValue(
      query(undefined, { isError: true, error: new Error('boom') }),
    );
    hooks.useEventsInRange.mockReturnValue(query([parents]));
    renderDashboard();

    expect(rows()).toHaveLength(1);
    expect(within(upNext()).getByRole('alert')).toHaveTextContent(
      'Nu am putut încărca taskurile de evaluat.',
    );
  });
});
