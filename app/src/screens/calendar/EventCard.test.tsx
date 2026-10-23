import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    approvalStatus: 'approved',
    rejectionReason: null,
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

describe('EventCard — the description as Formatted Text (R60)', () => {
  it('keeps the description’s own line breaks, which the card lost before', () => {
    render(<EventCard event={event({ description: 'rând\nrând' })} />);

    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    const description = card.querySelector('.event-description');
    expect(description?.querySelector('br')).not.toBeNull();
    expect(description).toHaveTextContent('rândrând');
  });

  it('reads bold and a list inside the description, under the card’s own measure class', () => {
    render(
      <EventCard
        event={event({ description: 'Aduceți **actele**.\n\n- unu\n- doi' })}
      />,
    );

    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    const description = card.querySelector('.event-description');
    expect(description).not.toBeNull();
    // `.event-description` keeps its 62ch measure, spacing and muted colour.
    expect(description).toHaveClass('formatted-text');
    expect(
      within(card).getByText('actele', { selector: 'strong' }),
    ).toBeVisible();
    expect(
      within(card)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['unu', 'doi']);
  });

  it('reads a Titlu in the description as text, so the card title stays its only heading (ruling 22)', () => {
    render(
      <EventCard event={event({ description: '# Program\n\nLa 18:00.' })} />,
    );

    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    expect(
      within(card)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Ședință Educațional']);
    const description = card.querySelector('.event-description');
    expect(
      description?.querySelector('p.formatted-text-title'),
    ).toHaveTextContent('Program');
  });

  it('shows no description block for an Event without one', () => {
    render(<EventCard event={event({ description: null })} />);

    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    expect(card.querySelector('.event-description')).toBeNull();
  });
});

describe('EventCard — approval (spec 2026-10-11)', () => {
  it('marks a pending OSUBB-wide Event and says it waits for BC', () => {
    render(<EventCard event={event({ approvalStatus: 'pending' })} />);
    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    expect(within(card).getByText('În așteptare')).toHaveClass(
      'event-pending-badge',
    );
    expect(within(card).getByText('Așteaptă aprobarea BC.')).toBeVisible();
    expect(within(card).queryByText('Motivul respingerii')).toBeNull();
  });

  it('marks a rejected Event and shows its reason, as a cancellation shows its', () => {
    render(
      <EventCard
        event={event({
          approvalStatus: 'rejected',
          rejectionReason: 'Se suprapune cu Adunarea Generală.',
        })}
      />,
    );
    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    expect(within(card).getByText('Respins')).toHaveClass(
      'event-rejected-badge',
    );
    expect(within(card).getByText('Motivul respingerii')).toBeVisible();
    expect(
      within(card).getByText('Se suprapune cu Adunarea Generală.'),
    ).toBeVisible();
  });

  it('makes only a pending card the hit area of its review, for a Member who decides (2026-10-18)', () => {
    const onReview = vi.fn();
    render(
      <>
        <EventCard
          event={event({ approvalStatus: 'pending' })}
          onReview={onReview}
        />
        <EventCard
          event={event({ id: 32, title: 'Bal', approvalStatus: 'rejected' })}
          onReview={onReview}
        />
        <EventCard
          event={event({ id: 33, title: 'Gala' })}
          onReview={onReview}
        />
        {/* Review I1: a cancelled pending Event is no request. */}
        <EventCard
          event={event({
            id: 34,
            title: 'Anulat',
            approvalStatus: 'pending',
            cancelledAt: '2030-09-01T10:00:00.000Z',
            cancelReason: 'Sala nu mai e liberă.',
          })}
          onReview={onReview}
        />
      </>,
    );
    const pending = screen.getByRole('article', {
      name: 'Ședință Educațional',
    });
    expect(pending).toHaveClass('is-reviewable');
    within(pending)
      .getByRole('button', {
        name: 'Revizuiește evenimentul Ședință Educațional',
      })
      .click();
    expect(onReview).toHaveBeenCalledWith(31);
    for (const name of ['Bal', 'Gala', 'Anulat']) {
      const card = screen.getByRole('article', { name });
      expect(card).not.toHaveClass('is-reviewable');
      expect(
        within(card).queryByRole('button', { name: /^Revizuiește/ }),
      ).toBeNull();
    }
  });

  it('lets a Text Link in the description of a reviewable card open, not the review (final review I1)', () => {
    const onReview = vi.fn();
    render(
      <EventCard
        event={event({
          approvalStatus: 'pending',
          description: 'Completează [formularul](https://forms.gle/x).',
        })}
        onReview={onReview}
      />,
    );
    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    const link = within(card).getByRole('link', { name: /^formularul/ });
    expect(link).toHaveAttribute('href', 'https://forms.gle/x');
    // jsdom has no layout, so what lifts the link above the card-wide hit area
    // is read from the stylesheet below; here the click must not reach the review.
    link.addEventListener('click', (click) => click.preventDefault());
    link.click();
    expect(onReview).not.toHaveBeenCalled();
  });

  it('lifts the description’s links above the review hit area in the stylesheet, as it lifts the managers’ strip', () => {
    const css = readFileSync(path.resolve('src/theme/calendar.css'), 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const lifted = rules.find(([, selectors]) =>
      selectors?.includes('.event-card.is-reviewable .event-description a'),
    );
    expect(lifted).toBeDefined();
    expect(lifted?.[2]).toMatch(/position:\s*relative/);
    expect(lifted?.[2]).toMatch(/z-index:\s*1\b/);
    // The overlay it must clear is still the button's own pseudo-element.
    expect(
      rules.some(
        ([, selectors, body]) =>
          selectors?.includes('.event-review-open::after') &&
          /inset:\s*0/.test(body ?? ''),
      ),
    ).toBe(true);
  });

  it('shows neither on an approved Event', () => {
    render(<EventCard event={event()} />);
    const card = screen.getByRole('article', { name: 'Ședință Educațional' });
    expect(within(card).queryByText('În așteptare')).toBeNull();
    expect(within(card).queryByText('Respins')).toBeNull();
    expect(within(card).queryByText('Așteaptă aprobarea BC.')).toBeNull();
  });
});
