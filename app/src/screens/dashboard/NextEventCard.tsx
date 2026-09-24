import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { Empty, ErrorState, Loading } from '../../components/states';
import { bucharestDayKey } from '../../lib/calendar-time';
import { useEventsInRange } from '../../queries/events';
import { useMyGroupRoles } from '../../queries/my-groups';
import { useGroups } from '../../queries/reference';
import EventCard from '../calendar/EventCard';
import {
  eventRangeForDays,
  eventRelevance,
  relevantGroupIds,
} from '../calendar/calendar-presentation';
import { nextRelevantEvent } from './next-items';
import { NextPlaceholder, NextSlot } from './NextSlot';

/**
 * **Următorul eveniment** (#700, ruling R4): the soonest Relevant Event that
 * has not started, drawn with the Calendar's own card, linking to
 * `/calendar?event=<id>`.
 *
 * The read is the Calendar's (#692), windowed from today's Bucharest midnight
 * and open-ended — the same key the Agendă's default opens on, so the two
 * screens share one cache entry and the key does not move with the clock.
 * Events that already started today are dropped here, against `now`.
 *
 * The Calendar's card shows only the time (the Agendă prints the day above
 * it), so the day is printed here too.
 */
export default function NextEventCard({ now }: { now: Date }) {
  const todayKey = bucharestDayKey(now) ?? undefined;
  const range = useMemo(() => eventRangeForDays(todayKey), [todayKey]);
  const events = useEventsInRange(todayKey ? range : null);
  const mine = useMyGroupRoles();
  const groups = useGroups();

  const relevant = useMemo(
    () => relevantGroupIds(mine.data ?? []),
    [mine.data],
  );
  const next =
    events.data && mine.data
      ? nextRelevantEvent(events.data, relevant, now.getTime())
      : null;

  // A failed Groups lookup only costs the card its parent's name; it is not
  // worth an error, but waiting for it keeps a label from changing under you.
  const isPending = events.isPending || mine.isPending || groups.isPending;
  const failed = events.isError ? events : mine.isError ? mine : null;

  return (
    <NextSlot
      title="Următorul eveniment"
      icon={CalendarDays}
      link={
        next && { to: `/calendar?event=${next.id}`, label: 'Vezi în Calendar' }
      }
    >
      {failed ? (
        <NextPlaceholder>
          <ErrorState
            error={failed.error}
            onRetry={() => void failed.refetch()}
          />
        </NextPlaceholder>
      ) : isPending ? (
        <NextPlaceholder>
          <Loading />
        </NextPlaceholder>
      ) : next ? (
        <div className="next-event">
          <p className="next-when">
            <time dateTime={next.startsAt}>{next.dayLabel}</time>
          </p>
          <EventCard
            event={next}
            groups={groups.data}
            relevance={eventRelevance(next, relevant, new Set())}
          />
        </div>
      ) : (
        <NextPlaceholder>
          <Empty text="Niciun eveniment viitor pentru tine." />
        </NextPlaceholder>
      )}
    </NextSlot>
  );
}
