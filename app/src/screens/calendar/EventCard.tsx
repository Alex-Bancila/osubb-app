import { IonIcon } from '@ionic/react';
import type { CSSProperties } from 'react';

import type { EventPresentation } from '../../queries/events';
import type { Group } from '../../queries/reference';
import {
  eventAccentColor,
  eventGroupIcon,
  eventGroupLabel,
  eventTypeLabel,
} from './calendar-presentation';
import EventRsvpControls from './EventRsvpControls';

type EventCardProps = {
  event: EventPresentation;
  groups?: Map<number, Group>;
};

export default function EventCard({ event, groups }: EventCardProps) {
  // Colour comes off the Group chain, not off a scope enum — see
  // eventAccentColor. The category icon is painted from the same variable.
  const accent = eventAccentColor(event, groups);
  const titleId = `calendar-event-${event.id}`;
  const timeLabel = event.endTime
    ? `${event.startTime}–${event.endTime}`
    : event.startTime;

  return (
    <article
      className="event-card"
      aria-labelledby={titleId}
      style={{ '--event-accent': accent } as CSSProperties}
    >
      <header className="event-card-head">
        <span className="event-type">{eventTypeLabel(event.type)}</span>
        <span className="event-scope">
          <IonIcon
            className="event-scope-icon"
            icon={eventGroupIcon(event)}
            aria-hidden="true"
          />
          {eventGroupLabel(event, groups)}
        </span>
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

      <EventRsvpControls eventId={event.id} eventTitle={event.title} />
    </article>
  );
}
