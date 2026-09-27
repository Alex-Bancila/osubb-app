import { render, screen, within } from '@testing-library/react';
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
    data?: { seeLeadership: boolean; manageTasks: boolean };
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
}));
vi.mock('../../queries/points', () => ({ useMyPoints: hooks.useMyPoints }));
vi.mock('../../queries/task-review', async (importActual) => ({
  ...(await importActual<typeof import('../../queries/task-review')>()),
  useAwaitingMyReview: hooks.useAwaitingMyReview,
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
    ...overrides,
  };
}

function slot(name: string) {
  return screen.getByRole('region', { name });
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
  hooks.useAwaitingMyReview.mockReturnValue(query({ task: null, count: 0 }));
  hooks.useMyTasks.mockReturnValue(query([]));
  hooks.useEventsInRange.mockReturnValue(query([]));
  hooks.useMyGroupRoles.mockReturnValue(query(teamMember));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function viewer(data: { seeLeadership: boolean; manageTasks: boolean }) {
  capabilities.result = { data, isPending: false, isError: false };
}

/** The panels' titles, in the grid's order. */
function panels(): string[] {
  const grid = document.querySelector('[data-slot="page-grid"]');
  if (!grid) return [];
  return Array.from(grid.children).map(
    (panel) => panel.querySelector('h2')?.textContent ?? '',
  );
}

function gridColumns() {
  return document
    .querySelector('[data-slot="page-grid"]')
    ?.getAttribute('data-columns');
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
      screen.getByRole('heading', { level: 1, name: 'Salut, Ioana 👋' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Joi, 15 ianuarie 2026')).toBeInTheDocument();
  });

  it('greets by Nickname when one is set', () => {
    hooks.profile = { ...hooks.profile, nickname: '  Ioni  ' };
    renderDashboard();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Salut, Ioni 👋' }),
    ).toBeInTheDocument();
  });
});

describe('the panels each viewer sees', () => {
  it('a Voluntar: Punctajul meu, Următorul task, Următorul eveniment in three columns', () => {
    renderDashboard();
    expect(panels()).toEqual([
      'Punctajul meu',
      'Următorul task',
      'Următorul eveniment',
    ]);
    expect(gridColumns()).toBe('3');
    const points = slot('Punctajul meu');
    expect(
      points.querySelector('[data-slot="points-value"]'),
    ).toHaveTextContent(/^12$/);
    expect(within(points).getByText('puncte')).toBeInTheDocument();
    expect(within(points).getByText('voluntar')).toBeInTheDocument();
    expect(hooks.useAwaitingMyReview).not.toHaveBeenCalled();
    expectNoBoards();
  });

  it('a Responsabil below BCE: all four in a 2 × 2', () => {
    auth.useAuth.mockReturnValue(claims(2));
    viewer({ seeLeadership: false, manageTasks: true });
    renderDashboard();
    expect(panels()).toEqual([
      'Punctajul meu',
      'De evaluat',
      'Următorul task',
      'Următorul eveniment',
    ]);
    expect(gridColumns()).toBe('2');
    expectNoBoards();
  });

  it('a BC member: De evaluat and Următorul eveniment only, no score', () => {
    auth.useAuth.mockReturnValue(claims(6));
    viewer({ seeLeadership: true, manageTasks: true });
    renderDashboard();
    expect(panels()).toEqual(['De evaluat', 'Următorul eveniment']);
    expect(gridColumns()).toBe('2');
    expect(screen.queryByText('Punctajul meu')).toBeNull();
    expect(hooks.useMyPoints).not.toHaveBeenCalled();
    expect(hooks.useMyTasks).not.toHaveBeenCalled();
    expectNoBoards();
  });

  it('leadership without manageTasks keeps Următorul task in the work slot', () => {
    auth.useAuth.mockReturnValue(claims(5));
    viewer({ seeLeadership: true, manageTasks: false });
    renderDashboard();
    expect(panels()).toEqual(['Următorul task', 'Următorul eveniment']);
  });

  it('renders no panel until the capability row decides, then retries its error', () => {
    capabilities.result = { isPending: true, isError: false };
    const { unmount } = renderDashboard();
    expect(panels()).toEqual([]);
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
    expect(panels()).toEqual([]);
    within(screen.getByRole('alert')).getByRole('button').click();
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe('De evaluat', () => {
  beforeEach(() => {
    auth.useAuth.mockReturnValue(claims(6));
    viewer({ seeLeadership: true, manageTasks: true });
  });

  it('shows the oldest Task awaiting my Evaluation, the count and Evaluează', () => {
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
    renderDashboard();
    const review = slot('De evaluat');
    expect(
      within(review).getByText('3 taskuri așteaptă evaluarea ta'),
    ).toBeInTheDocument();
    expect(
      within(review).getByRole('heading', {
        level: 3,
        name: 'Raport cheltuieli',
      }),
    ).toBeInTheDocument();
    expect(
      within(review).getByRole('link', { name: 'Evaluează' }),
    ).toHaveAttribute('href', '/tracker?task=31');
    expect(hooks.useAwaitingMyReview).toHaveBeenCalledWith(true);
  });

  it('says one Task in the singular', () => {
    hooks.useAwaitingMyReview.mockReturnValue(
      query({ task: taskRow({ id: 31, status: 'in_review' }), count: 1 }),
    );
    renderDashboard();
    expect(
      within(slot('De evaluat')).getByText('1 task așteaptă evaluarea ta'),
    ).toBeInTheDocument();
  });

  it('says so when nothing awaits, with no link', () => {
    renderDashboard();
    const review = slot('De evaluat');
    expect(
      within(review).getByText('Niciun task nu așteaptă evaluarea ta.'),
    ).toBeInTheDocument();
    expect(within(review).queryByRole('link')).toBeNull();
  });

  it('keeps its own loading and error states', () => {
    hooks.useAwaitingMyReview.mockReturnValue(
      query(undefined, { isPending: true }),
    );
    const { unmount } = renderDashboard();
    expect(within(slot('De evaluat')).getByRole('status')).toBeInTheDocument();
    unmount();

    hooks.useAwaitingMyReview.mockReturnValue(
      query(undefined, { isError: true, error: new Error('boom') }),
    );
    renderDashboard();
    expect(within(slot('De evaluat')).getByRole('alert')).toBeInTheDocument();
    expect(within(slot('Următorul eveniment')).queryByRole('alert')).toBeNull();
  });
});

describe('Următorul task', () => {
  it('picks the soonest deadline in work that I still execute, overdue first', () => {
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
        // Overdue and still mine: the soonest.
        mine({
          id: 3,
          title: 'Buget întârziat',
          status: 'in_progress',
          deadline: '2026-01-10T10:00:00Z',
        }),
        mine({
          id: 4,
          title: 'Prezentare',
          status: 'in_review',
          deadline: '2026-01-18T10:00:00Z',
        }),
        mine({ id: 5, title: 'Fără termen', deadline: null }),
      ]),
    );
    renderDashboard();

    const next = slot('Următorul task');
    const card = within(next).getByRole('article');
    expect(
      within(card).getByRole('heading', { level: 3, name: 'Buget întârziat' }),
    ).toBeInTheDocument();
    expect(within(card).getByText('Termen depășit')).toBeInTheDocument();
    for (const skipped of ['Raport predat', 'Afiș cedat', 'Prezentare'])
      expect(within(next).queryByText(skipped)).toBeNull();
    // The card reads; acting happens in Taskuri, where the link opens it.
    expect(within(card).queryByRole('button', { name: /începe/i })).toBeNull();
    expect(
      within(next).getByRole('link', { name: 'Vezi în Taskuri' }),
    ).toHaveAttribute('href', '/tracker?task=3');
  });

  it('skips undated Tasks and says so when nothing dated is in work', () => {
    hooks.useMyTasks.mockReturnValue(
      query([
        mine({ id: 5, title: 'Fără termen', deadline: null }),
        mine({ id: 6, title: 'Anulat', status: 'cancelled' }),
      ]),
    );
    renderDashboard();

    const next = slot('Următorul task');
    expect(
      within(next).getByText('Niciun task cu termen în lucru.'),
    ).toBeInTheDocument();
    expect(within(next).queryByRole('article')).toBeNull();
    expect(within(next).queryByRole('link')).toBeNull();
  });

  it('keeps its own loading and error states', () => {
    hooks.useMyTasks.mockReturnValue(query(undefined, { isPending: true }));
    const { unmount } = renderDashboard();
    expect(
      within(slot('Următorul task')).getByRole('status'),
    ).toBeInTheDocument();
    unmount();

    hooks.useMyTasks.mockReturnValue(
      query(undefined, { isError: true, error: new Error('boom') }),
    );
    renderDashboard();
    expect(
      within(slot('Următorul task')).getByRole('alert'),
    ).toBeInTheDocument();
    // A failed Task read does not blank the Event next to it.
    expect(within(slot('Următorul eveniment')).queryByRole('alert')).toBeNull();
  });
});

describe('Următorul eveniment', () => {
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
    dayLabel: 'sâmbătă, 17 ianuarie 2026',
  });
  const organization = event({
    id: 13,
    title: 'Adunare OSUBB',
    type: 'eveniment',
    groupId: 5,
    group: orgGroup,
    startsAt: '2026-01-19T16:00:00.000Z',
    dayLabel: 'luni, 19 ianuarie 2026',
  });
  const started = event({
    id: 14,
    title: 'Ședință de azi',
    groupId: 5,
    group: orgGroup,
    startsAt: '2026-01-15T08:00:00.000Z',
  });

  it("picks a parent Group's Event for a Child Group member, skipping unrelated and started ones", () => {
    hooks.useEventsInRange.mockReturnValue(
      query([started, unrelated, parents, organization]),
    );
    renderDashboard();

    const next = slot('Următorul eveniment');
    expect(
      within(next).getByRole('article', { name: 'Ședință Educațional' }),
    ).toBeInTheDocument();
    // The Calendar's card prints the time; the slot prints the day.
    expect(
      within(next).getByText('sâmbătă, 17 ianuarie 2026'),
    ).toBeInTheDocument();
    for (const skipped of ['Festival', 'Ședință de azi', 'Adunare OSUBB'])
      expect(within(next).queryByText(skipped)).toBeNull();
    expect(
      within(next).getByRole('link', { name: 'Vezi în Calendar' }),
    ).toHaveAttribute('href', '/calendar?event=12');
    // Today's Bucharest midnight, open-ended: the Agendă's own window.
    expect(hooks.useEventsInRange).toHaveBeenCalledWith({
      from: '2026-01-14T22:00:00.000Z',
    });
  });

  it("picks an Organization Group Event whatever the member's Groups", () => {
    hooks.useMyGroupRoles.mockReturnValue(query([]));
    hooks.useEventsInRange.mockReturnValue(
      query([unrelated, parents, organization]),
    );
    renderDashboard();

    const next = slot('Următorul eveniment');
    expect(
      within(next).getByRole('article', { name: 'Adunare OSUBB' }),
    ).toBeInTheDocument();
    expect(
      within(next).getByRole('link', { name: 'Vezi în Calendar' }),
    ).toHaveAttribute('href', '/calendar?event=13');
  });

  it('says so when no future Event is Relevant', () => {
    hooks.useEventsInRange.mockReturnValue(query([unrelated, started]));
    renderDashboard();

    const next = slot('Următorul eveniment');
    expect(
      within(next).getByText('Niciun eveniment viitor pentru tine.'),
    ).toBeInTheDocument();
    expect(within(next).queryByRole('article')).toBeNull();
    expect(within(next).queryByRole('link')).toBeNull();
  });

  it('keeps its own error state when the Groups read fails', () => {
    hooks.useEventsInRange.mockReturnValue(query([parents]));
    hooks.useMyGroupRoles.mockReturnValue(
      query(undefined, { isError: true, error: new Error('boom') }),
    );
    renderDashboard();
    const next = slot('Următorul eveniment');
    expect(within(next).getByRole('alert')).toBeInTheDocument();
    expect(within(next).queryByRole('article')).toBeNull();
  });
});
