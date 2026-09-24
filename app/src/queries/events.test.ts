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
  eventsRangeQueryOptions,
  fetchEvent,
  fetchEventsInRange,
  toEventPresentation,
} from './events';

type EventTableRow = Database['public']['Tables']['events']['Row'];
type GroupTableRow = Database['public']['Tables']['groups']['Row'];
type EventRow = EventTableRow & {
  group: Pick<
    GroupTableRow,
    'name' | 'short' | 'color' | 'category' | 'path' | 'is_organization'
  > | null;
};

const eduGroup = {
  name: 'Educațional',
  short: 'EDU',
  color: '#284C93',
  category: 'department',
  path: [7],
  is_organization: false,
};

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 42,
    title: 'Ședință Educațional',
    type: 'sedinta',
    starts_at: '2026-08-29T21:30:00.000Z',
    ends_at: '2026-08-29T23:00:00.000Z',
    location: 'Sala 1',
    capacity: 30,
    description: 'Planificarea semestrului',
    created_at: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-20T10:00:00.000Z',
    created_by: null,
    has_qr: false,
    min_level: 0,
    cancelled_at: null,
    cancel_reason: null,
    group_id: 7,
    campaign_id: null,
    group: eduGroup,
    ...overrides,
  };
}

describe('event presentation', () => {
  it('maps a database row into one Bucharest-aware presentation model', () => {
    expect(toEventPresentation(eventRow())).toEqual({
      id: 42,
      title: 'Ședință Educațional',
      type: 'sedinta',
      groupId: 7,
      group: eduGroup,
      campaignId: null,
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

  it('carries the Event Campaign label (#691)', () => {
    expect(toEventPresentation(eventRow({ campaign_id: 3 }))?.campaignId).toBe(
      3,
    );
  });

  it('keeps a Group this member may not read as null rather than inventing one', () => {
    expect(toEventPresentation(eventRow({ group: null }))?.group).toBeNull();
  });
});

describe('events range query', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  const range = {
    from: '2026-09-30T21:00:00.000Z',
    to: '2026-10-31T22:00:00.000Z',
  };

  it('reads a start window, half-open, in chronological order', async () => {
    supabaseMock.order.mockResolvedValue({ data: [eventRow()], error: null });

    const result = await fetchEventsInRange(range);

    expect(supabaseMock.from).toHaveBeenCalledWith('events');
    expect(supabaseMock.select).toHaveBeenCalledWith(
      'id, title, type, group_id, campaign_id, starts_at, ends_at, location, capacity, description, group:groups(name, short, color, category, path, is_organization)',
    );
    expect(supabaseMock.gte).toHaveBeenCalledWith('starts_at', range.from);
    expect(supabaseMock.lt).toHaveBeenCalledWith('starts_at', range.to);
    expect(supabaseMock.order).toHaveBeenCalledWith('starts_at', {
      ascending: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.dayKey).toBe('2026-08-30');
  });

  // #691 / ADR-0008 amended 2026-09-23: past Events are readable, so the read
  // has no `now` floor — the window is the caller's, and an open window sends
  // no bound at all. Mutation this catches: putting `.gte('starts_at', now)`
  // back into the read.
  it('sends no now floor: an open window asks for every readable Event', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T10:00:00.000Z'));
    supabaseMock.order.mockResolvedValue({ data: [], error: null });

    await fetchEventsInRange({});

    expect(supabaseMock.gte).not.toHaveBeenCalled();
    expect(supabaseMock.lt).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('bounds only the ends it is given', async () => {
    supabaseMock.order.mockResolvedValue({ data: [], error: null });

    await fetchEventsInRange({ from: range.from });

    expect(supabaseMock.gte).toHaveBeenCalledWith('starts_at', range.from);
    expect(supabaseMock.lt).not.toHaveBeenCalled();
  });

  // R13: `events_read` (Minimum Level) is the whole visibility rule, so the
  // calendar does not second-guess it. Mutation this catches: putting the
  // `.neq('scope', 'project')` filter back.
  it('asks for every visible Event, Project Events included', async () => {
    supabaseMock.order.mockResolvedValue({ data: [eventRow()], error: null });

    await fetchEventsInRange(range);

    expect(supabaseMock.neq).not.toHaveBeenCalled();
  });

  it('surfaces the Supabase error to React Query', async () => {
    const error = { code: '42501', message: 'permission denied' };
    supabaseMock.order.mockResolvedValue({ data: null, error });

    await expect(fetchEventsInRange(range)).rejects.toBe(error);
  });

  it('treats a successful null payload as an empty event list', async () => {
    supabaseMock.order.mockResolvedValue({ data: null, error: null });

    await expect(fetchEventsInRange(range)).resolves.toEqual([]);
  });

  it('isolates RLS-dependent event caches by member and window', () => {
    const ioana = eventsRangeQueryOptions('member-ioana', range);
    const vlad = eventsRangeQueryOptions('member-vlad', range);

    expect(ioana.queryKey).not.toEqual(vlad.queryKey);
    expect(ioana.queryKey).toEqual([
      'events',
      'range',
      { memberId: 'member-ioana', from: range.from, to: range.to },
    ]);
  });
});

describe('one Event by id', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('reads the linked Event through RLS', async () => {
    supabaseMock.maybeSingle.mockResolvedValue({
      data: eventRow(),
      error: null,
    });

    const event = await fetchEvent(42);

    expect(supabaseMock.eq).toHaveBeenCalledWith('id', 42);
    expect(event?.id).toBe(42);
  });

  it('answers null for an Event RLS hides', async () => {
    supabaseMock.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(fetchEvent(42)).resolves.toBeNull();
  });
});
