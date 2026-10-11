import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { formatBucharestShortDay } from '../../lib/calendar-time';
import type { EventPresentation } from '../../queries/events';

// Each part has its own suite; here only the card's own lines are read.
// The real client needs env that CI does not have; nothing here calls it.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./EventRsvpControls', () => ({ default: () => null }));
vi.mock('./EventAttendance', () => ({ EventAttendance: () => null }));
vi.mock('./EventManageControls', () => ({ EventManageControls: () => null }));

import EventCard from './EventCard';

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
    ...overrides,
  };
}

describe('EventCard — the meta line', () => {
  it('prints the day in its short form, before the time, when asked to', () => {
    render(<EventCard event={event()} showDay />);

    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    const when = within(card).getByText('Data și ora');
    expect(when).toHaveClass('sr-only');
    const [day, time] = Array.from(
      when.nextElementSibling?.querySelectorAll('time') ?? [],
    );
    expect(day).toHaveAttribute('datetime', '2030-10-01');
    expect(day).toHaveTextContent(formatBucharestShortDay(event().startsAt));
    expect(day).toHaveTextContent(/^mar\., 1 oct\./);
    expect(time).toHaveTextContent('18:00–20:00');
    // Never the long form: that is a day heading's.
    expect(within(card).queryByText(/octombrie/)).not.toBeInTheDocument();
  });

  it('keeps when, where and how many in one list, each named for a screen reader', () => {
    render(<EventCard event={event()} />);

    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    const terms = Array.from(card.querySelectorAll('dl.event-details dt'));
    expect(terms.map((term) => term.textContent)).toEqual([
      'Ora',
      'Loc',
      'Locuri',
    ]);
    for (const term of terms) expect(term).toHaveClass('sr-only');
    expect(within(card).getByText('Sala 305')).toBeInTheDocument();
    // "30 locuri" to the eye; "Locuri: 30" to a screen reader.
    expect(within(card).getByText('locuri')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
