import { createElement, type CSSProperties } from 'react';
import { Clock, MapPin, Users } from 'lucide-react';

import { formatBucharestShortDay } from '../../lib/calendar-time';
import { cn } from '../../lib/utils';
import type { EventPresentation } from '../../queries/events';
import type { Group } from '../../queries/reference';
import {
  eventCardId,
  eventGroupIcon,
  eventGroupLabel,
  eventTypeLabel,
  relevanceColor,
  type EventRelevance,
} from './calendar-presentation';
import { EventAttendance } from './EventAttendance';
import { EventManageControls } from './EventManageControls';
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
  /**
   * Print the Event's day in the card, in its short form (Acasă, X9/A2). The
   * Calendar's lists sit under a day heading, so there the card shows only
   * the time.
   */
  showDay?: boolean;
  /**
   * Offer **Editează** / **Anulează evenimentul** to those the commands accept
   * (#849), and **Cine participă** (#934), to the Event's managers: on the
   * Calendar's cards, not on Acasă's preview.
   */
  manageable?: boolean;
};

export default function EventCard({
  event,
  groups,
  relevance = 'own',
  past = false,
  highlighted = false,
  showDay = false,
  manageable = false,
}: EventCardProps) {
  // Colour follows the relevance rule, then the Group chain (eventAccentColor).
  // The category icon is painted from the same variable.
  const accent = relevanceColor(event, relevance, groups);
  const titleId = `calendar-event-${event.id}`;
  const timeLabel = event.endTime
    ? `${event.startTime}–${event.endTime}`
    : event.startTime;
  // Nobody answers a deadline (B25): it is a date to keep, not a gathering.
  const takesRsvp = event.type !== 'deadline';
  // A cancelled Event stays readable history (ADR-0008): no RSVP, its reason.
  const cancelled = event.cancelledAt !== null;

  return (
    <article
      id={eventCardId(event.id)}
      tabIndex={-1}
      className={cn(
        'event-card',
        relevance === 'other' && 'is-other',
        highlighted && 'is-highlighted',
        cancelled && 'is-cancelled',
      )}
      aria-labelledby={titleId}
      aria-current={highlighted ? 'true' : undefined}
      style={{ '--event-accent': accent } as CSSProperties}
    >
      <header className="event-card-head">
        <span className="event-type">{eventTypeLabel(event.type)}</span>
        {cancelled && <span className="event-cancelled-badge">Anulat</span>}
        {/* The Group's name, never a category (ruling of 2026-09-28): it is
            also what tells an Other OSUBB Event apart besides its grey. */}
        <span className="event-scope">
          {createElement(eventGroupIcon(event), {
            className: 'event-scope-icon',
            'aria-hidden': true,
          })}
          <span className="event-scope-name">
            {eventGroupLabel(event, groups)}
          </span>
        </span>
      </header>

      <h3 id={titleId} className="event-title">
        {event.title}
      </h3>

      {/* One wrapping line: when, where, how many. The icons draw the labels;
          the words stay for a screen reader. */}
      <dl className="event-details">
        <div>
          <dt className="sr-only">{showDay ? 'Data și ora' : 'Ora'}</dt>
          <dd>
            <Clock className="event-detail-icon" aria-hidden="true" />
            {showDay && (
              <>
                <time dateTime={event.dayKey}>
                  {formatBucharestShortDay(event.startsAt)}
                </time>
                <span aria-hidden="true">·</span>
              </>
            )}
            <time dateTime={event.startsAt}>{timeLabel}</time>
          </dd>
        </div>

        {event.location && (
          <div>
            <dt className="sr-only">Loc</dt>
            <dd>
              <MapPin className="event-detail-icon" aria-hidden="true" />
              {event.location}
            </dd>
          </div>
        )}

        {event.capacity !== null && (
          <div>
            <dt className="sr-only">Locuri</dt>
            <dd>
              <Users className="event-detail-icon" aria-hidden="true" />
              <span className="event-capacity">{event.capacity}</span>
              <span aria-hidden="true">locuri</span>
            </dd>
          </div>
        )}
      </dl>

      {event.description && (
        <p className="event-description">{event.description}</p>
      )}

      {cancelled ? (
        <p className="event-cancelled">
          <span className="event-cancelled-label">Motivul anulării</span>
          <span className="event-cancelled-reason">{event.cancelReason}</span>
        </p>
      ) : (
        takesRsvp &&
        (past ? (
          <p className="event-past">Evenimentul a avut loc.</p>
        ) : (
          <EventRsvpControls eventId={event.id} eventTitle={event.title} />
        ))
      )}

      {/* Cine participă (#934): the Event's managers read every answer —
          history too, on a past or cancelled Event. A deadline takes none. */}
      {manageable && takesRsvp && <EventAttendance event={event} />}

      {manageable && <EventManageControls event={event} groups={groups} />}
    </article>
  );
}
