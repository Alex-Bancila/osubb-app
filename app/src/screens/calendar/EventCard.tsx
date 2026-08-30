import type { CSSProperties } from 'react';

import type { EventPresentation } from '../../queries/events';
import type { Department } from '../../queries/reference';
import { eventScopeLabel, eventTypeLabel } from './calendar-presentation';

type EventCardProps = {
  event: EventPresentation;
  departments?: Map<string, Department>;
};

export default function EventCard({ event, departments }: EventCardProps) {
  const department = event.departmentId
    ? departments?.get(event.departmentId)
    : undefined;
  const accent =
    event.scope === 'org'
      ? 'var(--scope-org)'
      : (department?.color ?? 'var(--ink-400)');
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
          <span className="event-scope-dot" aria-hidden="true" />
          {eventScopeLabel(event, departments)}
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
    </article>
  );
}
