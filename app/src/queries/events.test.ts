import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../lib/database.types';

const query = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  gte: vi.fn(),
  order: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { from: query.from },
}));

import {
  fetchUpcomingEvents,
  toEventPresentation,
  upcomingEventsQueryOptions,
} from './events';

type EventRow = Database['public']['Tables']['events']['Row'];

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 42,
    title: 'Ședință Educațional',
    type: 'sedinta',
    scope: 'dept',
    dept_id: 'edu',
    team_id: null,
    starts_at: '2026-08-29T21:30:00.000Z',
    ends_at: '2026-08-29T23:00:00.000Z',
    location: 'Sala 1',
    capacity: 30,
    description: 'Planificarea semestrului',
    created_by: null,
    has_qr: false,
    ...overrides,
  };
}

describe('event presentation', () => {
  it('maps a database row into one Bucharest-aware presentation model', () => {
    expect(toEventPresentation(eventRow())).toEqual({
      id: 42,
      title: 'Ședință Educațional',
      type: 'sedinta',
      scope: 'dept',
      departmentId: 'edu',
      teamId: null,
      startsAt: '2026-08-29T21:30:00.000Z',
      endsAt: '2026-08-29T23:00:00.000Z',
      dayKey: '2026-08-30',
      dayLabel: 'duminică, 30 august 2026',
      startTime: '00:30',
      endTime: '02:00',
      location: 'Sala 1',
      capacity: 30,
      description: 'Planificarea semestrului',
    });
  });

  it('rejects undated rows from an upcoming-events model', () => {
    expect(toEventPresentation(eventRow({ starts_at: null }))).toBeNull();
  });
});

describe('upcoming-events query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.from.mockReturnValue({ select: query.select });
    query.select.mockReturnValue({ gte: query.gte });
    query.gte.mockReturnValue({ order: query.order });
  });

  it('loads visible events from the current instant in chronological order', async () => {
    query.order.mockResolvedValue({ data: [eventRow()], error: null });
    const now = new Date('2026-08-29T18:00:00.000Z');

    const result = await fetchUpcomingEvents(now);

    expect(query.from).toHaveBeenCalledWith('events');
    expect(query.select).toHaveBeenCalledWith(
      'id, title, type, scope, dept_id, team_id, starts_at, ends_at, location, capacity, description',
    );
    expect(query.gte).toHaveBeenCalledWith('starts_at', now.toISOString());
    expect(query.order).toHaveBeenCalledWith('starts_at', { ascending: true });
    expect(result).toHaveLength(1);
    expect(result[0]?.dayKey).toBe('2026-08-30');
  });

  it('surfaces the Supabase error to React Query', async () => {
    const error = { code: '42501', message: 'permission denied' };
    query.order.mockResolvedValue({ data: null, error });

    await expect(
      fetchUpcomingEvents(new Date('2026-08-29T18:00:00.000Z')),
    ).rejects.toBe(error);
  });

  it('treats a successful null payload as an empty event list', async () => {
    query.order.mockResolvedValue({ data: null, error: null });

    await expect(
      fetchUpcomingEvents(new Date('2026-08-29T18:00:00.000Z')),
    ).resolves.toEqual([]);
  });

  it('isolates RLS-dependent event caches by member', () => {
    const ioana = upcomingEventsQueryOptions('member-ioana');
    const vlad = upcomingEventsQueryOptions('member-vlad');

    expect(ioana.queryKey).not.toEqual(vlad.queryKey);
    expect(ioana.queryKey).toEqual([
      'events',
      'upcoming',
      { memberId: 'member-ioana' },
    ]);
    expect(ioana.staleTime).toBe(0);
  });
});
