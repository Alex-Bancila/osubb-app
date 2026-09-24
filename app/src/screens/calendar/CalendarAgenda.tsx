import { useEffect, useMemo, useRef } from 'react';

import { Empty, ErrorState, Loading } from '../../components/states';
import type { WorkFilterState } from '../../lib/use-work-filter';
import {
  useEvent,
  useEventsInRange,
  type EventPresentation,
} from '../../queries/events';
import type { Group } from '../../queries/reference';
import {
  eventCardId,
  eventRangeForDays,
  filterEvents,
  groupEventsByDay,
} from './calendar-presentation';
import type { EventRelevance } from './calendar-presentation';
import EventCard from './EventCard';

const RANGE_FIRST = 'Corectează perioada din filtre ca să vezi evenimentele.';

function earlier(a: string, b: string): string {
  return a <= b ? a : b;
}

function later(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * The Agendă: readable Events by day, inside the Work Filter's range on the
 * Event start. Without a range it starts today and is open-ended — **Ce
 * urmează**. A `?event=<id>` link widens the range to the Event's day, and the
 * Event is shown even when the filter's Group or Campaign would hide it, then
 * scrolled to and focused.
 */
export function CalendarAgenda({
  now,
  todayKey,
  filter,
  linkedId,
  groups,
  relevanceOf,
}: {
  /** The screen's clock, in milliseconds (a render must not read the time). */
  now: number;
  todayKey: string;
  filter: WorkFilterState;
  linkedId: number | null;
  groups: Map<number, Group> | undefined;
  relevanceOf: (event: EventPresentation) => EventRelevance;
}) {
  const linked = useEvent(linkedId);
  const linkedEvent = linkedId !== null ? (linked.data ?? null) : null;
  const waitingForLink = linkedId !== null && linked.isPending;

  const from = filter.value.from ?? todayKey;
  const to = filter.value.to;
  const startsToday = from === todayKey;
  const range = useMemo(() => {
    if (!filter.params || waitingForLink) return null;
    const day = linkedEvent?.dayKey;
    return eventRangeForDays(
      day ? earlier(from, day) : from,
      day && to ? later(to, day) : to,
    );
  }, [filter.params, waitingForLink, linkedEvent?.dayKey, from, to]);
  const events = useEventsInRange(range);

  const shown = useMemo(() => {
    // The range is the query's; the Group and Campaign levels narrow here.
    const narrowed = filterEvents(events.data ?? [], {
      ...filter.value,
      from: undefined,
      to: undefined,
    });
    if (linkedEvent && !narrowed.some((event) => event.id === linkedEvent.id))
      narrowed.push(linkedEvent);
    return narrowed;
  }, [events.data, filter.value, linkedEvent]);
  const days = groupEventsByDay(shown);

  // Land on the linked card once per link: a refetch must not pull the page
  // back, but a new link lands afresh.
  const landed = useRef<number | null>(null);
  const landing =
    linkedEvent && events.data && shown.some((e) => e.id === linkedEvent.id)
      ? linkedEvent.id
      : null;
  useEffect(() => {
    if (landing === null) {
      if (linkedId === null) landed.current = null;
      return;
    }
    if (landed.current === landing) return;
    landed.current = landing;
    const card = document.getElementById(eventCardId(landing));
    card?.scrollIntoView?.({ block: 'center' });
    card?.focus({ preventScroll: true });
  }, [landing, linkedId]);

  return (
    <div className="calendar-agenda-view">
      {linkedId !== null && !linked.isPending && !linkedEvent && (
        <p className="calendar-notice" role="alert">
          {linked.isError
            ? 'Nu am putut încărca evenimentul din link.'
            : 'Evenimentul nu este disponibil.'}
        </p>
      )}

      {!filter.params ? (
        <Empty text={RANGE_FIRST} />
      ) : waitingForLink || events.isPending ? (
        <Loading label="Se încarcă evenimentele…" />
      ) : events.isError ? (
        <ErrorState
          error={events.error}
          text="Nu am putut încărca evenimentele."
          onRetry={() => void events.refetch()}
        />
      ) : days.length === 0 ? (
        <Empty
          text={
            startsToday
              ? 'Nu sunt evenimente viitoare pentru tine.'
              : 'Nu sunt evenimente în acest interval.'
          }
        />
      ) : (
        <div className="calendar-agenda" aria-label="Evenimente">
          {days.map((day) => {
            const headingId = `calendar-day-${day.dayKey}`;

            return (
              <section
                key={day.dayKey}
                className="calendar-day"
                aria-labelledby={headingId}
              >
                <header className="calendar-day-head">
                  <span className="calendar-day-rule" aria-hidden="true" />
                  <h2 id={headingId}>
                    <time dateTime={day.dayKey}>{day.dayLabel}</time>
                  </h2>
                  <span className="calendar-day-count">
                    {day.events.length}{' '}
                    {day.events.length === 1 ? 'eveniment' : 'evenimente'}
                  </span>
                </header>

                <ol className="calendar-event-list">
                  {day.events.map((event) => (
                    <li key={event.id}>
                      <EventCard
                        event={event}
                        groups={groups}
                        relevance={relevanceOf(event)}
                        past={Date.parse(event.startsAt) < now}
                        highlighted={event.id === linkedId}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
