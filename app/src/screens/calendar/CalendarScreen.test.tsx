import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalendarTaskRow } from '../../queries/calendar-tasks';
import type { EventGroup, EventPresentation } from '../../queries/events';
import type { MyGroup } from '../../queries/my-groups';
import type { Group } from '../../queries/reference';

const hooks = vi.hoisted(() => ({
  useEventsInRange: vi.fn(),
  useEvent: vi.fn(),
  useGroups: vi.fn(),
  useCampaigns: vi.fn(),
  useMyGroupRoles: vi.fn(),
  useGoingEventIds: vi.fn(),
  useEventRsvp: vi.fn(),
  useSetEventRsvp: vi.fn(),
  useMyTasks: vi.fn(),
  usePendingCandidatureTasks: vi.fn(),
  useTaskManagement: vi.fn(),
  useManagedTasks: vi.fn(),
}));

// The membership rule (isMemberOf) lives beside the my_groups() read; no
// request is made, but the module loads the client.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/events', () => ({
  useEventsInRange: hooks.useEventsInRange,
  useEvent: hooks.useEvent,
}));
vi.mock('../../queries/reference', () => ({ useGroups: hooks.useGroups }));
vi.mock('../../queries/campaigns', () => ({
  useCampaigns: hooks.useCampaigns,
}));
vi.mock('../../queries/my-groups', async (importActual) => ({
  ...(await importActual<typeof import('../../queries/my-groups')>()),
  useMyGroupRoles: hooks.useMyGroupRoles,
}));
vi.mock('../../queries/event-rsvp', () => ({
  EventRsvpMutationError: class EventRsvpMutationError extends Error {},
  useEventRsvp: hooks.useEventRsvp,
  useSetEventRsvp: hooks.useSetEventRsvp,
  useGoingEventIds: hooks.useGoingEventIds,
}));
vi.mock('../../queries/tasks', () => ({ useMyTasks: hooks.useMyTasks }));
vi.mock('../../queries/calendar-tasks', () => ({
  usePendingCandidatureTasks: hooks.usePendingCandidatureTasks,
}));
vi.mock('../../queries/task-tabs', () => ({
  useTaskManagement: hooks.useTaskManagement,
  useManagedTasks: hooks.useManagedTasks,
}));
vi.mock('./NewEventControl', () => ({
  NewEventControl: () => <button type="button">Eveniment nou</button>,
}));

import CalendarScreen from './CalendarScreen';
import { CALENDAR_VIEW_STORAGE_KEY } from './calendar-view';

const osubbGroup: EventGroup = {
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

const socialMediaGroup: EventGroup = {
  name: 'Social Media',
  short: null,
  color: null,
  category: 'team',
  path: [7, 12],
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

function group(id: number, from: EventGroup): Group {
  return {
    id,
    name: from.name,
    short: from.short,
    color: from.color,
    category: from.category,
    path: from.path,
    parent_id: from.path.length > 1 ? (from.path.at(-2) ?? null) : null,
    min_level: 0,
    status: 'active',
    is_organization: from.is_organization,
  };
}

const groups = new Map<number, Group>([
  [5, group(5, osubbGroup)],
  [7, group(7, eduGroup)],
  [12, group(12, socialMediaGroup)],
  [20, group(20, festivalGroup)],
]);

/** An Educațional member (explicit roster row). */
const myGroups: MyGroup[] = [
  {
    id: 7,
    name: 'Educațional',
    short: 'EDU',
    color: '#284C93',
    category: 'department',
    path: [7],
    is_organization: false,
    min_level: 0,
    status: 'active',
    group_role: 'member',
    explicit: true,
    automatic: false,
  },
];

function event(overrides: Partial<EventPresentation> = {}): EventPresentation {
  return {
    id: 1,
    title: 'Ședință Educațional',
    type: 'sedinta',
    groupId: 7,
    group: eduGroup,
    campaignId: null,
    startsAt: '2026-10-20T07:00:00.000Z',
    endsAt: '2026-10-20T09:00:00.000Z',
    dayKey: '2026-10-20',
    dayLabel: 'marți, 20 octombrie 2026',
    startTime: '10:00',
    endTime: '12:00',
    location: 'Sala 305',
    capacity: 30,
    description: 'Planificarea activităților lunii.',
    ...overrides,
  };
}

const festivalEvent = event({
  id: 2,
  title: 'Festival deschis',
  groupId: 20,
  group: festivalGroup,
  startsAt: '2026-10-21T15:00:00.000Z',
  endsAt: null,
  dayKey: '2026-10-21',
  dayLabel: 'miercuri, 21 octombrie 2026',
  startTime: '18:00',
  endTime: null,
  location: null,
  capacity: null,
  description: null,
});

const pastEvent = event({
  id: 9,
  title: 'Ședință de septembrie',
  startsAt: '2026-09-01T15:00:00.000Z',
  endsAt: null,
  dayKey: '2026-09-01',
  dayLabel: 'marți, 1 septembrie 2026',
  startTime: '18:00',
  endTime: null,
});

function task(overrides: Partial<CalendarTaskRow> = {}): CalendarTaskRow {
  return {
    id: 100,
    title: 'Afiș pentru ședință',
    status: 'in_progress',
    deadline: '2026-10-20T15:00:00.000Z',
    group_id: 12,
    campaign_id: null,
    group: socialMediaGroup,
    ...overrides,
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

function setEvents(
  data: EventPresentation[] | undefined,
  overrides: Record<string, unknown> = {},
) {
  const result = query(data, overrides);
  hooks.useEventsInRange.mockReturnValue(result);
  return result;
}

/** A Storage stand-in, so a test decides what the device remembers. */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void store.set(key, value)),
    removeItem: vi.fn((key: string) => void store.delete(key)),
    clear: vi.fn(() => store.clear()),
    key: vi.fn(),
    length: 0,
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

function renderCalendar(url = '/calendar') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CalendarScreen />
    </MemoryRouter>,
  );
}

describe('CalendarScreen', () => {
  beforeEach(() => {
    // Only Date is faked: today is 14 October 2026 in Bucharest.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T09:00:00.000Z'));
    stubStorage();
    Element.prototype.scrollIntoView = vi.fn();
    hooks.useGroups.mockReturnValue(query(groups));
    hooks.useCampaigns.mockReturnValue(
      query([{ id: 3, name: 'Bun venit', group_id: 7, is_active: true }]),
    );
    hooks.useMyGroupRoles.mockReturnValue(query(myGroups));
    hooks.useGoingEventIds.mockReturnValue(query([]));
    hooks.useEvent.mockReturnValue(query(undefined, { isPending: true }));
    hooks.useEventRsvp.mockReturnValue(query(null));
    hooks.useSetEventRsvp.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    hooks.useMyTasks.mockReturnValue(query([task()]));
    hooks.usePendingCandidatureTasks.mockReturnValue(query([]));
    hooks.useTaskManagement.mockReturnValue(query(false));
    hooks.useManagedTasks.mockReturnValue(
      query(undefined, { isPending: true }),
    );
    setEvents([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('Agendă', () => {
    it('opens on the agenda from today, open-ended, by default', () => {
      renderCalendar();

      expect(
        screen.getByRole('heading', { level: 1, name: 'Ce urmează' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Agendă' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // Today's Bucharest midnight, no end: a window, not a `now` floor.
      expect(hooks.useEventsInRange).toHaveBeenLastCalledWith({
        from: '2026-10-13T21:00:00.000Z',
      });
    });

    it('shows a screen-specific loading state', () => {
      setEvents(undefined, { isPending: true });
      renderCalendar();
      expect(screen.getByText('Se încarcă evenimentele…')).toBeInTheDocument();
    });

    it('explains when the member has no upcoming visible events', () => {
      renderCalendar();
      expect(
        screen.getByText('Nu sunt evenimente viitoare pentru tine.'),
      ).toBeInTheDocument();
    });

    it('says the interval is empty when the range starts another day', () => {
      renderCalendar('/calendar?de_la=2026-11-01&pana_la=2026-11-30');
      expect(
        screen.getByText('Nu sunt evenimente în acest interval.'),
      ).toBeInTheDocument();
      expect(hooks.useEventsInRange).toHaveBeenLastCalledWith({
        from: '2026-10-31T22:00:00.000Z',
        to: '2026-11-30T22:00:00.000Z',
      });
    });

    // An end alone bounds only the end: the today floor is for no range at
    // all. Mutation this catches: defaulting `from` to today whenever it is
    // unset, which makes this window empty.
    it('reads everything up to an end day when only Până la is set', () => {
      setEvents([pastEvent]);
      renderCalendar('/calendar?pana_la=2026-09-01');

      expect(hooks.useEventsInRange).toHaveBeenLastCalledWith({
        to: '2026-09-01T21:00:00.000Z',
      });
      expect(
        screen.getByRole('heading', { level: 1, name: 'Agendă' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('article', { name: 'Ședință de septembrie' }),
      ).toBeInTheDocument();
    });

    it('sends nothing while the range is inverted', () => {
      renderCalendar('/calendar?de_la=2026-11-10&pana_la=2026-11-01');
      expect(hooks.useEventsInRange).toHaveBeenLastCalledWith(null);
    });

    it('shows a safe error and retries the query', async () => {
      const user = userEvent.setup();
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const { refetch } = setEvents(undefined, {
        error: { code: '42501', message: 'permission denied' },
        isError: true,
      });

      renderCalendar();
      await user.click(
        screen.getByRole('button', { name: 'Încearcă din nou' }),
      );

      expect(
        screen.getByText('Nu am putut încărca evenimentele.'),
      ).toBeInTheDocument();
      expect(refetch).toHaveBeenCalledOnce();
      consoleError.mockRestore();
    });

    it('renders chronological day groups as a semantic agenda', () => {
      setEvents([event(), festivalEvent]);
      renderCalendar();

      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'marți, 20 octombrie 2026',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'miercuri, 21 octombrie 2026',
        }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });

    it('shows Group identity, time, place, and informational capacity', () => {
      setEvents([event()]);
      renderCalendar();

      const card = screen.getByRole('article', { name: 'Ședință Educațional' });
      expect(card).toHaveStyle({ '--event-accent': '#284C93' });
      expect(within(card).getByText('Ședință')).toBeInTheDocument();
      expect(within(card).getByText('Educațional')).toBeInTheDocument();
      expect(within(card).getByText('10:00–12:00')).toBeInTheDocument();
      expect(within(card).getByText('Sala 305')).toBeInTheDocument();
      expect(
        within(card).getByText('Capacitate: 30 de persoane'),
      ).toBeInTheDocument();
      expect(
        within(card).getByLabelText('Răspuns pentru Ședință Educațional'),
      ).toBeInTheDocument();
    });

    // Mutation this catches: delete the ancestor walk in groupAccentColor and
    // a Department Team's card goes flat grey; stop passing the Groups into
    // EventCard and it loses its Department's name.
    it("gives a Child Group's card its Department's colour and name", () => {
      // A Social Media member: the Team's Events are theirs.
      hooks.useMyGroupRoles.mockReturnValue(
        query([
          { ...myGroups[0], id: 12, name: 'Social Media', path: [7, 12] },
        ]),
      );
      setEvents([
        event({
          title: 'Ședință Social Media',
          groupId: 12,
          group: socialMediaGroup,
        }),
      ]);
      renderCalendar();

      const card = screen.getByRole('article', {
        name: 'Ședință Social Media',
      });
      expect(card).toHaveStyle({ '--event-accent': '#284C93' });
      expect(
        within(card).getByText('Echipă · Educațional'),
      ).toBeInTheDocument();
    });

    it('greys an Other OSUBB Event with a label, until the member says Vin', () => {
      setEvents([
        festivalEvent,
        event({ id: 3, title: 'AG', groupId: 5, group: osubbGroup }),
      ]);
      const { unmount } = renderCalendar();

      const other = screen.getByRole('article', { name: 'Festival deschis' });
      expect(other).toHaveStyle({ '--event-accent': 'var(--event-other)' });
      expect(
        within(other).getByText('Alt eveniment OSUBB'),
      ).toBeInTheDocument();
      const organization = screen.getByRole('article', { name: 'AG' });
      expect(organization).toHaveStyle({
        '--event-accent': 'var(--scope-org)',
      });
      expect(
        within(organization).queryByText('Alt eveniment OSUBB'),
      ).not.toBeInTheDocument();
      unmount();

      hooks.useGoingEventIds.mockReturnValue(query([2]));
      renderCalendar();
      const answered = screen.getByRole('article', {
        name: 'Festival deschis',
      });
      expect(answered).toHaveStyle({ '--event-accent': '#1B9E4B' });
      expect(
        within(answered).queryByText('Alt eveniment OSUBB'),
      ).not.toBeInTheDocument();
    });

    it('omits absent optional event details instead of rendering placeholders', () => {
      setEvents([
        event({
          location: null,
          capacity: null,
          description: null,
          endsAt: null,
          endTime: null,
        }),
      ]);
      renderCalendar();

      const card = screen.getByRole('article', { name: 'Ședință Educațional' });
      expect(within(card).getByText('10:00')).toBeInTheDocument();
      expect(within(card).queryByText(/Capacitate:/)).not.toBeInTheDocument();
      expect(within(card).queryByText('Sala 305')).not.toBeInTheDocument();
    });

    it('narrows Events by the Work Filter in the URL', () => {
      setEvents([
        event(),
        festivalEvent,
        event({ id: 4, title: 'Campanie', campaignId: 3 }),
      ]);
      renderCalendar('/calendar?grup=7');

      expect(screen.queryByRole('article', { name: 'Festival deschis' })).toBe(
        null,
      );
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });

    it('narrows Events by the Campaign level', () => {
      setEvents([
        event(),
        event({ id: 4, title: 'Eveniment de campanie', campaignId: 3 }),
      ]);
      renderCalendar('/calendar?grup=7&campanie=3');

      expect(screen.getAllByRole('article')).toHaveLength(1);
      expect(
        screen.getByRole('article', { name: 'Eveniment de campanie' }),
      ).toBeInTheDocument();
    });
  });

  describe('the ?event= deep link', () => {
    it('opens the Agendă on a past Event, scrolled to and focused', () => {
      stubStorage({ [CALENDAR_VIEW_STORAGE_KEY]: 'month' });
      hooks.useEvent.mockReturnValue(query(pastEvent));
      setEvents([pastEvent, event()]);

      renderCalendar('/calendar?event=9');

      expect(hooks.useEvent).toHaveBeenCalledWith(9);
      expect(screen.getByRole('button', { name: 'Agendă' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // The window widens back to the Event's day (1 September, Bucharest).
      expect(hooks.useEventsInRange).toHaveBeenLastCalledWith({
        from: '2026-08-31T21:00:00.000Z',
      });
      const card = screen.getByRole('article', {
        name: 'Ședință de septembrie',
      });
      expect(card).toHaveFocus();
      expect(card.scrollIntoView).toHaveBeenCalled();
      expect(card).toHaveAttribute('aria-current', 'true');
      // RSVP stays meaningful only on future Events (ADR-0008 amended).
      expect(
        within(card).getByText('Evenimentul a avut loc.'),
      ).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Particip' })).toBe(
        null,
      );
    });

    it('does not overwrite the remembered view', () => {
      const storage = stubStorage({ [CALENDAR_VIEW_STORAGE_KEY]: 'month' });
      hooks.useEvent.mockReturnValue(query(pastEvent));
      setEvents([pastEvent]);

      renderCalendar('/calendar?event=9');

      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('says so when RLS hides the Event', () => {
      hooks.useEvent.mockReturnValue(query(null));
      setEvents([event()]);

      renderCalendar('/calendar?event=404');

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Evenimentul nu este disponibil.',
      );
      expect(screen.getAllByRole('article')).toHaveLength(1);
    });
  });

  describe('Lună', () => {
    it('remembers the view on this device across a reload', async () => {
      const user = userEvent.setup();
      const storage = stubStorage();
      const { unmount } = renderCalendar();

      await user.click(screen.getByRole('button', { name: 'Lună' }));

      expect(storage.setItem).toHaveBeenCalledWith(
        CALENDAR_VIEW_STORAGE_KEY,
        'month',
      );
      expect(
        screen.getByRole('table', { name: 'octombrie 2026' }),
      ).toBeInTheDocument();
      unmount();

      renderCalendar();
      expect(screen.getByRole('button', { name: 'Lună' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(
        screen.getByRole('heading', { level: 1, name: 'Octombrie 2026' }),
      ).toBeInTheDocument();
    });

    it('still works when storage is unavailable', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      });
      renderCalendar();

      await user.click(screen.getByRole('button', { name: 'Lună' }));

      expect(
        screen.getByRole('table', { name: 'octombrie 2026' }),
      ).toBeInTheDocument();
    });

    it('reads the whole grid, past days included, and marks today', () => {
      stubStorage({ [CALENDAR_VIEW_STORAGE_KEY]: 'month' });
      renderCalendar();

      // 28 September → 1 November: the grid's weeks, Bucharest midnights.
      expect(hooks.useEventsInRange).toHaveBeenLastCalledWith({
        from: '2026-09-27T21:00:00.000Z',
        to: '2026-11-01T22:00:00.000Z',
      });
      expect(
        screen.getByRole('button', { name: /^miercuri, 14 octombrie 2026/ }),
      ).toHaveAttribute('aria-current', 'date');
    });

    it('lists a tapped day below the grid: Events as cards, Tasks as rows', async () => {
      const user = userEvent.setup();
      stubStorage({ [CALENDAR_VIEW_STORAGE_KEY]: 'month' });
      setEvents([event(), festivalEvent]);
      renderCalendar();

      const day = screen.getByRole('button', {
        name: 'marți, 20 octombrie 2026: 1 eveniment, 1 termen de task',
      });
      await user.click(day);

      expect(day).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'marți, 20 octombrie 2026',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('article', { name: 'Ședință Educațional' }),
      ).toBeInTheDocument();
      const row = screen.getByRole('link', { name: /Afiș pentru ședință/ });
      expect(row).toHaveAttribute('href', '/tracker?task=100');
      expect(row).toHaveTextContent('În lucru');
      expect(row).toHaveTextContent('Taskul tău');
      expect(screen.queryByRole('article', { name: 'Festival deschis' })).toBe(
        null,
      );
    });

    it('adds pending candidatures to the own deadlines', () => {
      stubStorage({ [CALENDAR_VIEW_STORAGE_KEY]: 'month' });
      hooks.useMyTasks.mockReturnValue(query([]));
      hooks.usePendingCandidatureTasks.mockReturnValue(
        query([task({ id: 101, title: 'Voluntar la stand' })]),
      );
      renderCalendar();

      expect(
        screen.getByRole('button', {
          name: 'marți, 20 octombrie 2026: 1 termen de task',
        }),
      ).toBeInTheDocument();
    });

    it('offers managers the managed Tasks behind a toggle', async () => {
      const user = userEvent.setup();
      stubStorage({ [CALENDAR_VIEW_STORAGE_KEY]: 'month' });
      hooks.useTaskManagement.mockReturnValue(query(true));
      hooks.useManagedTasks.mockImplementation((enabled: boolean) =>
        enabled
          ? query([
              task({
                id: 102,
                title: 'Raport trimestrial',
                deadline: '2026-10-22T09:00:00.000Z',
              }),
            ])
          : query(undefined, { isPending: true }),
      );
      renderCalendar();

      const toggle = screen.getByRole('button', {
        name: 'Taskurile gestionate',
      });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(
        screen.getByRole('button', { name: 'joi, 22 octombrie 2026' }),
      ).toBeInTheDocument();

      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(hooks.useManagedTasks).toHaveBeenLastCalledWith(true);
      expect(
        screen.getByRole('button', {
          name: 'joi, 22 octombrie 2026: 1 termen de task',
        }),
      ).toBeInTheDocument();
    });

    it('hides the managed toggle from a member without management', () => {
      stubStorage({ [CALENDAR_VIEW_STORAGE_KEY]: 'month' });
      renderCalendar();
      expect(
        screen.queryByRole('button', { name: 'Taskurile gestionate' }),
      ).toBeNull();
    });

    it('narrows Events and Task chips alike by the Work Filter', () => {
      stubStorage({ [CALENDAR_VIEW_STORAGE_KEY]: 'month' });
      setEvents([event(), festivalEvent]);
      hooks.useMyTasks.mockReturnValue(
        query([
          task(),
          task({
            id: 103,
            title: 'Standul festivalului',
            group_id: 20,
            group: festivalGroup,
            deadline: '2026-10-21T09:00:00.000Z',
          }),
        ]),
      );
      renderCalendar('/calendar?grup=20');

      expect(
        screen.getByRole('button', {
          name: 'miercuri, 21 octombrie 2026: 1 eveniment, 1 termen de task',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'marți, 20 octombrie 2026' }),
      ).toBeInTheDocument();
    });

    it('lets the range pick the month and the arrows move it', async () => {
      const user = userEvent.setup();
      stubStorage({ [CALENDAR_VIEW_STORAGE_KEY]: 'month' });
      renderCalendar('/calendar?de_la=2026-12-05');

      expect(
        screen.getByRole('table', { name: 'decembrie 2026' }),
      ).toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: 'Luna următoare: ianuarie 2027' }),
      );
      expect(
        screen.getByRole('table', { name: 'ianuarie 2027' }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Luna curentă' }));
      expect(
        screen.getByRole('table', { name: 'octombrie 2026' }),
      ).toBeInTheDocument();
    });
  });
});
