import { describe, expect, it, vi } from 'vitest';
import type { EventPresentation } from '../../queries/events';

// The relevance rule reaches the query layer; this suite never touches it.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { upcomingRelevantEvents } from './next-items';

function event(overrides: Partial<EventPresentation> = {}): EventPresentation {
  return {
    id: 31,
    title: 'Ședință Educațional',
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
    startsAt: '2030-10-01T15:00:00.000Z',
    endsAt: '2030-10-01T17:00:00.000Z',
    dayKey: '2030-10-01',
    dayLabel: 'marți, 1 octombrie 2030',
    startTime: '18:00',
    endTime: '20:00',
    location: 'Sala 305',
    capacity: 30,
    description: null,
    minLevel: 0,
    createdBy: 'someone-else',
    cancelledAt: null,
    cancelReason: null,
    approvalStatus: 'approved',
    rejectionReason: null,
    ...overrides,
  };
}

describe('upcomingRelevantEvents', () => {
  const now = Date.parse('2030-09-01T00:00:00.000Z');

  it('keeps the relevant Events that have not started, soonest first', () => {
    const later = event({ id: 32, startsAt: '2030-10-02T15:00:00.000Z' });
    expect(
      upcomingRelevantEvents([later, event()], new Set([7]), now).map(
        (item) => item.id,
      ),
    ).toEqual([31, 32]);
  });

  it('is not something to go to when cancelled, pending or rejected (final review, 2026-10-13)', () => {
    const items = [
      event({ id: 41, cancelledAt: '2030-08-01T00:00:00.000Z' }),
      event({ id: 42, approvalStatus: 'pending' }),
      event({
        id: 43,
        approvalStatus: 'rejected',
        rejectionReason: 'Se suprapune cu AG.',
      }),
      event({ id: 44 }),
    ];
    expect(
      upcomingRelevantEvents(items, new Set([7]), now).map((item) => item.id),
    ).toEqual([44]);
  });
});
