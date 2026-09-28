import { useMemo } from 'react';
import { EmptyState, Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
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
 * it); here the card prints the day itself (`showDay`), so the box starts
 * level with its row neighbour, and fills the box (`*:flex-1`) so it ends
 * level with Următorul task's card in their `equalHeights` row.
 *
 * No eyebrow: "Calendar" above "Următorul eveniment" says the title twice,
 * as "Taskuri" did above "Următorul task" (B7).
 */
export default function NextEventCard({
  now,
  className,
}: {
  now: Date;
  className?: string;
}) {
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
  const shown = !failed && !isPending ? next : null;

  return (
    <Panel
      title="Următorul eveniment"
      className={className}
      action={
        shown
          ? { to: `/calendar?event=${shown.id}`, label: 'Vezi în Calendar' }
          : undefined
      }
      bare={Boolean(shown)}
      boxClassName={shown ? '*:flex-1' : undefined}
    >
      {failed ? (
        <ErrorState
          error={failed.error}
          onRetry={() => void failed.refetch()}
        />
      ) : isPending ? (
        <Loading />
      ) : shown ? (
        // The day is inside the card (X9/A2): a line above it pushed the box
        // below its row neighbour's.
        <EventCard
          event={shown}
          groups={groups.data}
          relevance={eventRelevance(shown, relevant, new Set())}
          showDay
        />
      ) : (
        <EmptyState>Niciun eveniment viitor pentru tine.</EmptyState>
      )}
    </Panel>
  );
}
