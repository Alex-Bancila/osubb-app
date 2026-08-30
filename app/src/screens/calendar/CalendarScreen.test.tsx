import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventPresentation } from '../../queries/events';
import type { Department } from '../../queries/reference';

const hooks = vi.hoisted(() => ({
  useUpcomingEvents: vi.fn(),
  useDepartments: vi.fn(),
}));

vi.mock('../../queries/events', () => ({
  useUpcomingEvents: hooks.useUpcomingEvents,
}));

vi.mock('../../queries/reference', () => ({
  useDepartments: hooks.useDepartments,
}));

import CalendarScreen from './CalendarScreen';

const departments = new Map<string, Department>([
  [
    'edu',
    {
      id: 'edu',
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      kind: 'department',
    },
  ],
]);

function event(overrides: Partial<EventPresentation> = {}): EventPresentation {
  return {
    id: 1,
    title: 'Ședință Educațional',
    type: 'sedinta',
    scope: 'dept',
    departmentId: 'edu',
    teamId: null,
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
    vi.clearAllMocks();
    hooks.useDepartments.mockReturnValue({ data: departments });
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
          scope: 'org',
          departmentId: null,
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

  it('shows department identity, time, place, and informational capacity', () => {
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
