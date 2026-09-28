import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ListFilter, ListIcon } from 'lucide-react';
import { useSearchParams } from 'react-router';

import {
  Page,
  PageHeader,
  Panel,
  SegmentedToggle,
  type SegmentedOption,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { bucharestDayKey } from '../../lib/calendar-time';
import { useWorkFilter } from '../../lib/use-work-filter';
import { useCampaigns } from '../../queries/campaigns';
import { useGoingEventIds } from '../../queries/event-rsvp';
import type { EventPresentation } from '../../queries/events';
import { useMyGroupRoles } from '../../queries/my-groups';
import { useGroups } from '../../queries/reference';
import { CalendarAgenda } from './CalendarAgenda';
import { CalendarMonth } from './CalendarMonth';
import {
  eventRelevance,
  linkedEventId,
  monthLabel,
  monthOfDay,
  relevantGroupIds,
  type EventRelevance,
} from './calendar-presentation';
import { useCalendarView, type CalendarView } from './calendar-view';
import { NewEventControl } from './NewEventControl';

const VIEWS: ReadonlyArray<SegmentedOption<CalendarView>> = [
  { value: 'month', label: 'Lună', icon: CalendarDays },
  { value: 'agenda', label: 'Agendă', icon: ListIcon },
];

function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase('ro-RO') + text.slice(1);
}

/**
 * The Calendar (#692, ruling R14): **Lună**, a month grid of readable Events
 * and the member's Task deadlines, and **Agendă**, the list by day — both under
 * the Work Filter, whose state is in the URL. The view is remembered per
 * device; `?event=<id>` (Acasă's deep link, R4) opens the Agendă on the Event.
 */
export default function CalendarScreen() {
  const [params, setParams] = useSearchParams();
  const filter = useWorkFilter();
  const [storedView, storeView] = useCalendarView();
  const linkedId = linkedEventId(params.get('event'));
  // The deep link opens the Agendă for this visit, whatever this device
  // remembers; it does not change what is remembered.
  const view: CalendarView = linkedId !== null ? 'agenda' : storedView;
  // The clock ticks each minute, so "past" and "today" follow the wall.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const todayKey = bucharestDayKey(new Date(now)) ?? '';

  const groups = useGroups();
  const campaigns = useCampaigns();
  const mine = useMyGroupRoles();
  const going = useGoingEventIds();
  const relevant = useMemo(
    () => relevantGroupIds(mine.data ?? []),
    [mine.data],
  );
  const goingIds = useMemo(() => new Set(going.data ?? []), [going.data]);
  const relevanceOf = useCallback(
    (event: EventPresentation): EventRelevance =>
      eventRelevance(event, relevant, goingIds),
    [relevant, goingIds],
  );

  function chooseView(next: CalendarView) {
    storeView(next);
    if (linkedId !== null)
      setParams(
        (current) => {
          const nextParams = new URLSearchParams(current);
          nextParams.delete('event');
          return nextParams;
        },
        { replace: true },
      );
  }

  const shownMonth = monthOfDay(
    filter.value.from ?? filter.value.to ?? todayKey,
  );
  const agendaFromToday =
    filter.value.from === undefined || filter.value.from === todayKey;
  const title =
    view === 'month'
      ? capitalized(monthLabel(shownMonth))
      : agendaFromToday && filter.value.to === undefined
        ? 'Ce urmează'
        : 'Agendă';

  return (
    <Page>
      <PageHeader
        eyebrow="Calendar"
        title={title}
        description="Întâlnirile, activitățile și termenele vizibile pentru tine."
        actions={
          <>
            <SegmentedToggle
              label="Vizualizare"
              options={VIEWS}
              value={view}
              onChange={chooseView}
            />
            <NewEventControl />
          </>
        }
      />

      <Panel eyebrow="Filtre" icon={ListFilter} aria-label="Filtre calendar">
        {groups.isError || campaigns.isError ? (
          <ErrorState
            error={groups.error ?? campaigns.error}
            text="Nu am putut încărca filtrele."
            retryLabel="Reîncarcă filtrele"
            onRetry={() => {
              void groups.refetch();
              void campaigns.refetch();
            }}
          />
        ) : !groups.data || !campaigns.data ? (
          <Loading label="Se încarcă filtrele…" />
        ) : (
          <WorkFilter
            groups={[...groups.data.values()]}
            campaigns={campaigns.data}
            hint={
              view === 'month'
                ? 'Grupul include toate subgrupurile sale. Perioada citește începutul evenimentului și termenul taskului, iar luna afișată este cea a primei zile alese.'
                : 'Grupul include toate subgrupurile sale. Perioada citește începutul evenimentului; fără perioadă, agenda începe azi.'
            }
          />
        )}
      </Panel>

      {view === 'month' ? (
        <CalendarMonth
          month={shownMonth}
          now={now}
          todayKey={todayKey}
          filter={filter}
          groups={groups.data}
          relevanceOf={relevanceOf}
        />
      ) : (
        <CalendarAgenda
          now={now}
          todayKey={todayKey}
          filter={filter}
          linkedId={linkedId}
          groups={groups.data}
          relevanceOf={relevanceOf}
        />
      )}
    </Page>
  );
}
