import { createElement, type CSSProperties } from 'react';

import { cn } from '../../lib/utils';
import type { EventPresentation } from '../../queries/events';
import type { Group } from '../../queries/reference';
import {
  eventCardId,
  eventGroupIcon,
  eventGroupLabel,
  eventTypeLabel,
  OTHER_EVENT_LABEL,
  relevanceColor,
  type EventRelevance,
} from './calendar-presentation';
import EventRsvpControls from './EventRsvpControls';

type EventCardProps = {
  event: EventPresentation;
  groups?: Map<number, Group>;
  /** The colour band (ruling R10); an unknown relevance reads as the member's own. */
  relevance?: EventRelevance;
  /** Whether the Event has started: RSVP stays meaningful only before (ADR-0008). */
  past?: boolean;
  /** The `?event=<id>` landing. */
  highlighted?: boolean;
};

export default function EventCard({
  event,
  groups,
  relevance = 'own',
  past = false,
  highlighted = false,
}: EventCardProps) {
  // Colour follows the relevance rule, then the Group chain (eventAccentColor).
  // The category icon is painted from the same variable.
  const accent = relevanceColor(event, relevance, groups);
  const titleId = `calendar-event-${event.id}`;
  const timeLabel = event.endTime
    ? `${event.startTime}–${event.endTime}`
    : event.startTime;

  return (
    <article
      id={eventCardId(event.id)}
      tabIndex={-1}
      className={cn(
        'event-card',
        relevance === 'other' && 'is-other',
        highlighted && 'is-highlighted',
      )}
      aria-labelledby={titleId}
      aria-current={highlighted ? 'true' : undefined}
      style={{ '--event-accent': accent } as CSSProperties}
    >
      <header className="event-card-head">
        <span className="event-type">{eventTypeLabel(event.type)}</span>
        <span className="event-scope">
          {createElement(eventGroupIcon(event), {
            className: 'event-scope-icon',
            'aria-hidden': true,
          })}
          {eventGroupLabel(event, groups)}
        </span>
        {relevance === 'other' && (
          <span className="event-relevance">{OTHER_EVENT_LABEL}</span>
        )}
      </header>

      <h3 id={titleId} className="event-title">
        {event.title}
      </h3>

      <dl className="event-details">
        <div>
          <dt>Ora</dt>
          <dd>
            <time dateTime={event.startsAt}>{timeLabel}</time>
          </dd>
        </div>

        {event.location && (
          <div>
            <dt>Loc</dt>
            <dd>{event.location}</dd>
          </div>
        )}

        {event.capacity !== null && (
          <div>
            <dt>Locuri</dt>
            <dd>Capacitate: {event.capacity} de persoane</dd>
          </div>
        )}
      </dl>

      {event.description && (
        <p className="event-description">{event.description}</p>
      )}

      {past ? (
        <p className="event-past">Evenimentul a avut loc.</p>
      ) : (
        <EventRsvpControls eventId={event.id} eventTitle={event.title} />
      )}
    </article>
  );
}
