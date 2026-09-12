import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../lib/database.types';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

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
    created_at: '2026-08-20T10:00:00.000Z',
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
});

describe('upcoming-events query', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('loads visible events from the current instant in chronological order', async () => {
    supabaseMock.order.mockResolvedValue({ data: [eventRow()], error: null });
    const now = new Date('2026-08-29T18:00:00.000Z');

    const result = await fetchUpcomingEvents(now);

    expect(supabaseMock.from).toHaveBeenCalledWith('events');
    expect(supabaseMock.select).toHaveBeenCalledWith(
      'id, title, type, scope, dept_id, team_id, starts_at, ends_at, location, capacity, description',
    );
    expect(supabaseMock.gte).toHaveBeenCalledWith(
      'starts_at',
      now.toISOString(),
    );
    expect(supabaseMock.neq).toHaveBeenCalledWith('scope', 'project');
    expect(supabaseMock.order).toHaveBeenCalledWith('starts_at', {
      ascending: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.dayKey).toBe('2026-08-30');
  });

  it('surfaces the Supabase error to React Query', async () => {
    const error = { code: '42501', message: 'permission denied' };
    supabaseMock.order.mockResolvedValue({ data: null, error });

    await expect(
      fetchUpcomingEvents(new Date('2026-08-29T18:00:00.000Z')),
    ).rejects.toBe(error);
  });

  it('treats a successful null payload as an empty event list', async () => {
    supabaseMock.order.mockResolvedValue({ data: null, error: null });

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
