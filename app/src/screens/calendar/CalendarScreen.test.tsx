import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventGroup, EventPresentation } from '../../queries/events';
import type { Group } from '../../queries/reference';

const hooks = vi.hoisted(() => ({
  useUpcomingEvents: vi.fn(),
  useGroups: vi.fn(),
  useEventRsvp: vi.fn(),
  useSetEventRsvp: vi.fn(),
}));

vi.mock('../../queries/events', () => ({
  useUpcomingEvents: hooks.useUpcomingEvents,
}));

vi.mock('../../queries/reference', () => ({
  useGroups: hooks.useGroups,
}));

vi.mock('../../queries/event-rsvp', () => ({
  EventRsvpMutationError: class EventRsvpMutationError extends Error {},
  useEventRsvp: hooks.useEventRsvp,
  useSetEventRsvp: hooks.useSetEventRsvp,
}));

import CalendarScreen from './CalendarScreen';

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

const groups = new Map<number, Group>([
  [
    7,
    {
      id: 7,
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      category: 'department',
      path: [7],
      parent_id: null,
      min_level: 0,
      status: 'active',
      is_organization: false,
      legacy_dept_id: 'edu',
    },
  ],
]);

function event(overrides: Partial<EventPresentation> = {}): EventPresentation {
  return {
    id: 1,
    title: 'Ședință Educațional',
    type: 'sedinta',
    groupId: 7,
    group: eduGroup,
    startsAt: '2026-08-30T07:00:00.000Z',
    endsAt: '2026-08-30T09:00:00.000Z',
    dayKey: '2026-08-30',
    dayLabel: 'duminică, 30 august 2026',
    startTime: '10:00',
    endTime: '12:00',
    location: 'Sala 305',
    capacity: 30,
    description: 'Planificarea activităților lunii.',
    ...overrides,
  };
}

function setEventsQuery(overrides: Record<string, unknown> = {}): {
  refetch: ReturnType<typeof vi.fn>;
} {
  const refetch = vi.fn().mockResolvedValue({});
  hooks.useUpcomingEvents.mockReturnValue({
    data: [],
    error: null,
    isError: false,
    isPending: false,
    refetch,
    ...overrides,
  });
  return { refetch };
}

describe('CalendarScreen', () => {
  beforeEach(() => {
    hooks.useGroups.mockReturnValue({ data: groups });
    hooks.useEventRsvp.mockReturnValue({
      data: null,
      error: null,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    hooks.useSetEventRsvp.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
  });

  it('shows a screen-specific loading state', () => {
    setEventsQuery({ data: undefined, isPending: true });

    render(<CalendarScreen />);

    expect(screen.getByText('Se încarcă evenimentele…')).toBeInTheDocument();
  });

  it('explains when the member has no upcoming visible events', () => {
    setEventsQuery();

    render(<CalendarScreen />);

    expect(
      screen.getByText('Nu sunt evenimente viitoare pentru tine.'),
    ).toBeInTheDocument();
  });

  it('shows a safe error and retries the query', async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { refetch } = setEventsQuery({
      error: { code: '42501', message: 'permission denied' },
      isError: true,
    });

    render(<CalendarScreen />);
    // Ionic's custom element is upgraded to a real button in the browser;
    // jsdom keeps the host element, so its visible label is the stable target.
    await user.click(screen.getByText('Încearcă din nou'));

    expect(
      screen.getByText('Nu am putut încărca evenimentele.'),
    ).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('renders chronological day groups as a semantic agenda', () => {
    setEventsQuery({
      data: [
        event(),
        event({
          id: 2,
          title: 'Adunarea Generală',
          type: 'eveniment',
          groupId: 5,
          group: {
            name: 'OSUBB',
            short: 'ORG',
            color: '#ED2025',
            category: 'organization',
            path: [5],
            is_organization: true,
          },
          startsAt: '2026-08-31T15:00:00.000Z',
          endsAt: null,
          dayKey: '2026-08-31',
          dayLabel: 'luni, 31 august 2026',
          startTime: '18:00',
          endTime: null,
          location: null,
          capacity: null,
          description: null,
        }),
      ],
    });

    render(<CalendarScreen />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Ce urmează' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'duminică, 30 august 2026',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'luni, 31 august 2026',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('shows Group identity, time, place, and informational capacity', () => {
    setEventsQuery({ data: [event()] });

    render(<CalendarScreen />);

    const card = screen.getByRole('article', {
      name: 'Ședință Educațional',
    });
    expect(card).toHaveStyle({ '--event-accent': '#284C93' });
    expect(within(card).getByText('Ședință')).toBeInTheDocument();
    expect(within(card).getByText('Educațional')).toBeInTheDocument();
    expect(within(card).getByText('10:00–12:00')).toBeInTheDocument();
    expect(within(card).getByText('Sala 305')).toBeInTheDocument();
    expect(
      within(card).getByText('Capacitate: 30 de persoane'),
    ).toBeInTheDocument();
    expect(screen.queryByText('edu')).not.toBeInTheDocument();
  });

  // A Department Team's Group carries no colour of its own — `groups.color` is
  // mirrored from `departments.color` and `teams` has no such column — so the
  // card takes its Department's. Mutation this catches: delete the ancestor
  // walk in eventAccentColor and this card goes flat `var(--ink-400)`, taking
  // the category icon with it.
  it("gives a Child Group's card its Department's colour", () => {
    setEventsQuery({
      data: [
        event({
          title: 'Ședință Social Media',
          groupId: 12,
          group: socialMediaGroup,
        }),
      ],
    });

    render(<CalendarScreen />);

    expect(
      screen.getByRole('article', { name: 'Ședință Social Media' }),
    ).toHaveStyle({ '--event-accent': '#284C93' });
  });

  // The Event's own Group rides with the Event; the Groups the member may read
  // are what name its parent. Mutation this catches: stop passing
  // `groups.data` into EventCard and the Child Group loses its Department.
  it('names a Child Group by the Department above it', () => {
    setEventsQuery({
      data: [
        event({
          title: 'Ședință Social Media',
          groupId: 12,
          group: socialMediaGroup,
        }),
      ],
    });

    render(<CalendarScreen />);

    const card = screen.getByRole('article', { name: 'Ședință Social Media' });
    expect(within(card).getByText('Echipă · Educațional')).toBeInTheDocument();
  });

  it('offers an RSVP choice on every visible event card', () => {
    setEventsQuery({ data: [event()] });

    render(<CalendarScreen />);

    expect(
      screen.getByLabelText('Răspuns pentru Ședință Educațional'),
    ).toBeInTheDocument();
  });

  it('omits absent optional event details instead of rendering placeholders', () => {
    setEventsQuery({
      data: [
        event({
          location: null,
          capacity: null,
          description: null,
          endsAt: null,
          endTime: null,
        }),
      ],
    });

    render(<CalendarScreen />);

    const card = screen.getByRole('article', {
      name: 'Ședință Educațional',
    });
    expect(within(card).getByText('10:00')).toBeInTheDocument();
    expect(within(card).queryByText(/Capacitate:/)).not.toBeInTheDocument();
    expect(within(card).queryByText('Sala 305')).not.toBeInTheDocument();
  });
});
