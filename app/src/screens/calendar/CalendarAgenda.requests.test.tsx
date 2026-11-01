import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postgrest, type FakeRequest } from '../../test/postgrest-fake';

/*
 * #1134: the Agendă reads the viewer's answers once for the whole list and
 * hands each card its own; **Cine participă** reads an Event's answers, and
 * the names, only once it is opened. Here the cards, the RSVP controls and
 * Cine participă run on their real reads, through a fake that answers as
 * PostgREST does; what the Agendă reads besides (its Events, the approvals
 * icon, the manage controls) is stubbed.
 */

vi.mock('../../lib/supabase', async () => ({
  supabase: (await import('../../test/postgrest-fake')).postgrest.client,
}));
const MEMBER = 'b0000000-0000-0000-0000-000000000006';
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: MEMBER } } }),
}));
// A BC member: every Event's answers are theirs to read (R61).
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: () => ({
    data: {
      createTopLevelGroups: false,
      managesAnyGroup: false,
      seeLeadership: true,
    },
  }),
  useCapability: () => ({ data: false }),
}));
vi.mock('../../queries/event-creation', () => ({
  useEventFormOptions: () => ({ data: undefined }),
}));
const shown = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('../../queries/events', () => ({
  useEventsInRange: () => ({
    data: shown.events,
    isPending: false,
    isError: false,
  }),
  useEvent: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('../../queries/notifications', () => ({
  NO_SUBJECTS: [],
  useReadNotificationsAbout: () => undefined,
}));
vi.mock('../../components/approvals/ApprovalRequestsButton', () => ({
  ApprovalRequestsButton: () => null,
}));
vi.mock('./EventManageControls', () => ({ EventManageControls: () => null }));
vi.mock('../../components/member/MemberName', () => ({
  MemberName: ({ fullName }: { fullName: string }) => <span>{fullName}</span>,
}));

import type { EventPresentation } from '../../queries/events';
import type { WorkFilterState } from '../../lib/use-work-filter';
import { CalendarAgenda } from './CalendarAgenda';

const TODAY = '2030-10-01';

function event(id: number): EventPresentation {
  return {
    id,
    title: `Ședința ${id}`,
    type: 'sedinta',
    groupId: 7,
    group: {
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      category: 'department',
      path: [7],
      is_organization: false,
    },
    campaignId: null,
    startsAt: '2030-10-02T15:00:00.000Z',
    endsAt: null,
    dayKey: '2030-10-02',
    allDay: false,
    lastDayKey: '2030-10-02',
    multiDay: false,
    dayLabel: 'miercuri, 2 octombrie 2030',
    startTime: '18:00',
    endTime: null,
    location: null,
    capacity: null,
    description: null,
    minLevel: 0,
    createdBy: 'someone-else',
    cancelledAt: null,
    cancelReason: null,
    approvalStatus: 'approved',
    rejectionReason: null,
  };
}

const filter = {
  value: {},
  params: {},
  rangeError: undefined,
  active: false,
} as unknown as WorkFilterState;

/** The `event_id` a request filtered on, or undefined for none. */
function eventIdOf(request: FakeRequest): unknown {
  return postgrest
    .argsOf(request, 'eq')
    .find(([column]) => column === 'event_id')?.[1];
}

/**
 * The server's answers: the viewer said Particip to Event 1 and Nu particip
 * to Event 2; two other Members answered every Event.
 */
function serveAnswers() {
  postgrest.serve('event_attendance', (request) => {
    const eventId = eventIdOf(request);
    const mine = postgrest
      .argsOf(request, 'eq')
      .some(([column, value]) => column === 'member_id' && value === MEMBER);
    const rows = [
      { event_id: 1, member_id: MEMBER, status: 'going', checked_in: false },
      { event_id: 2, member_id: MEMBER, status: 'declined', checked_in: false },
      ...shown.events.flatMap((shownEvent) => {
        const id = (shownEvent as EventPresentation).id;
        return [
          {
            event_id: id,
            member_id: 'm-ana',
            status: 'going',
            checked_in: false,
          },
          {
            event_id: id,
            member_id: 'm-ion',
            status: 'declined',
            checked_in: false,
          },
        ];
      }),
    ];
    return rows.filter(
      (row) =>
        (eventId === undefined || row.event_id === eventId) &&
        (!mine || row.member_id === MEMBER),
    );
  });
  postgrest.serve('profiles_directory', [
    { id: 'm-ana', full_name: 'Ana Pop', nickname: null, avatar_color: null },
    { id: 'm-ion', full_name: 'Ion Rus', nickname: null, avatar_color: null },
  ]);
}

function showAgenda(count: number) {
  shown.events = Array.from({ length: count }, (_, index) => event(index + 1));
  serveAnswers();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CalendarAgenda
        now={Date.parse('2030-10-01T08:00:00.000Z')}
        todayKey={TODAY}
        filter={filter}
        linkedId={null}
        groups={undefined}
        relevanceOf={() => 'own'}
      />
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

/** Every card's answer is drawn, and the reads have settled. */
async function settled() {
  await waitFor(() =>
    expect(screen.queryAllByText('Se încarcă răspunsul…')).toHaveLength(0),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const answersRead = () => postgrest.requestsTo('event_attendance');

beforeEach(() => postgrest.reset());

describe('the Agendă’s RSVP reads (#1134)', () => {
  // Fails if each card reads its own answer and every answer on its Event:
  // 60 future Events would be 120 requests on open and on every change.
  it('reads the answers in the same number of requests for 3 cards as for 12', async () => {
    const few = showAgenda(3);
    await settled();
    const forFew = answersRead().length;
    few.unmount();

    postgrest.reset();
    showAgenda(12);
    await settled();
    const forMany = answersRead().length;

    expect(forMany).toBe(forFew);
    expect(forFew).toBe(1);
  });

  it('shows each card the viewer’s own answer from that one read', async () => {
    showAgenda(3);
    await settled();

    const card = (id: number) =>
      screen.getByRole('article', { name: `Ședința ${id}` });
    const pressed = (id: number, name: string) =>
      within(card(id))
        .getByRole('button', { name })
        .getAttribute('aria-pressed');
    expect(pressed(1, 'Particip')).toBe('true');
    expect(pressed(2, 'Nu particip')).toBe('true');
    expect(pressed(3, 'Particip')).toBe('false');
    expect(pressed(3, 'Nu particip')).toBe('false');
  });

  // Fails if Cine participă reads every card's answers as the list opens.
  it('reads an Event’s answers and their names only once Cine participă is opened', async () => {
    const user = userEvent.setup();
    showAgenda(3);
    await settled();
    const forEvent = (id: number) =>
      answersRead().filter((request) => eventIdOf(request) === id);
    expect(forEvent(2)).toHaveLength(0);
    expect(postgrest.requestsTo('profiles_directory')).toHaveLength(0);

    const card = screen.getByRole('article', { name: 'Ședința 2' });
    await user.click(
      within(card).getByRole('button', { name: 'Cine participă' }),
    );

    expect(
      await within(card).findByRole('region', { name: 'Particip 1' }),
    ).toHaveTextContent('Ana Pop');
    // The viewer's own Nu particip is one of the two.
    expect(within(card).getByText('1 participă · 2 nu')).toBeVisible();
    expect(forEvent(2)).toHaveLength(1);
    expect(forEvent(1)).toHaveLength(0);
    expect(postgrest.requestsTo('profiles_directory')).toHaveLength(1);
  });

  // Fails if a change re-reads each card: an `['events']` invalidation must
  // cost the list's one read, however many cards it holds.
  it('reads the answers once again after any Event changes, not once a card', async () => {
    const { queryClient } = showAgenda(12);
    await settled();
    const before = answersRead().length;

    await queryClient.invalidateQueries({ queryKey: ['events'] });
    await settled();

    expect(answersRead().length - before).toBe(1);
  });
});
