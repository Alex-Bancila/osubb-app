import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ListIcon } from 'lucide-react';
import { useSearchParams } from 'react-router';

import {
  Page,
  PageHeader,
  SegmentedToggle,
  type SegmentedOption,
} from '../../components/layout';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { bucharestDayKey } from '../../lib/calendar-time';
import { useWorkFilter } from '../../lib/use-work-filter';
import { useCampaigns } from '../../queries/campaigns';
import { useGoingEventIds } from '../../queries/event-rsvp';
import type { EventPresentation } from '../../queries/events';
import { useMyGroupRoles } from '../../queries/my-groups';
import { useGroups } from '../../queries/reference';
import { useCalendarWork } from '../../queries/work-filter-options';
import { CalendarAgenda } from './CalendarAgenda';
import { CalendarMonth } from './CalendarMonth';
import {
  eventRelevance,
  linkedEventId,
  monthOfDay,
  relevantGroupIds,
  type EventRelevance,
} from './calendar-presentation';
import { useCalendarView, type CalendarView } from './calendar-view';
import { clearEventReceipts, useCalendarReceipt } from './event-receipts';
import { NewEventControl } from './NewEventControl';
import { PreferredGroupsScope } from '../../components/preferred-groups/PreferredGroupsScope';
import { usePreferredGroups } from '../../components/preferred-groups/preferred-groups';

const VIEWS: ReadonlyArray<SegmentedOption<CalendarView>> = [
  { value: 'month', label: 'Lună', icon: CalendarDays },
  { value: 'agenda', label: 'Agendă', icon: ListIcon },
];

/** An Event deleted for good (#1017): its card is gone, the page says so. */
function CalendarReceipt({ children }: { children: string }) {
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    message.current?.focus();
  }, []);
  return (
    <p ref={message} role="status" tabIndex={-1} className="calendar-notice">
      {children}
    </p>
  );
}

/**
 * The Calendar (#692, ruling R14): **Lună**, a month grid of readable Events
 * and the member's Task deadlines, and **Agendă**, the list by day — both under
 * the Work Filter, whose state is in the URL. The view is remembered per
 * device; `?event=<id>` (Acasă's deep link, R4) opens the Agendă on the Event.
 */
export default function CalendarScreen() {
  return (
    <PreferredGroupsScope>
      <CalendarContent />
    </PreferredGroupsScope>
  );
}

function CalendarContent() {
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
  // An edit or cancel receipt belongs to this visit (#849).
  useEffect(() => clearEventReceipts, []);
  const deleted = useCalendarReceipt();
  const todayKey = bucharestDayKey(new Date(now)) ?? '';

  const groups = useGroups();
  const campaigns = useCampaigns();
  // Taskurile gestionate: only the month grid draws them, so Rule W offers
  // their Campaigns only there, while they are on (#845). The Group levels
  // offer every Group regardless (R40).
  const [showManaged, setShowManaged] = useState(false);
  const calendarWork = useCalendarWork(view === 'month' && showManaged);
  const filterGroups = useMemo(
    () => [...(groups.data?.values() ?? [])],
    [groups.data],
  );
  const mine = useMyGroupRoles();
  const going = useGoingEventIds();
  const relevant = useMemo(
    () => relevantGroupIds(mine.data ?? []),
    [mine.data],
  );
  const goingIds = useMemo(() => new Set(going.data ?? []), [going.data]);
  // R43: the Calendar opens on the preferred Groups. An Event the member
  // answered Particip to, and their own deadlines, stay whatever their Group.
  const preferred = usePreferredGroups();
  const keepEvent = useCallback(
    (event: EventPresentation) =>
      event.groupId === null ||
      preferred.keepGroup(event.groupId) ||
      goingIds.has(event.id),
    [preferred, goingIds],
  );
  const relevanceOf = useCallback(
    (event: EventPresentation): EventRelevance =>
      eventRelevance(event, relevant, goingIds),
    [relevant, goingIds],
  );

  // A new Event: the Agendă opens on its card, its receipt on it (D-11).
  function showCreated(eventId: number) {
    setParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        nextParams.set('event', String(eventId));
        return nextParams;
      },
      { replace: true },
    );
  }

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
  // The month's name sits between its arrows (C2); the title names the view.
  const title =
    view === 'month'
      ? 'Lună'
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
            <NewEventControl onCreated={showCreated} />
          </>
        }
      />

      <WorkFilter
        label="Filtre calendar"
        status={{
          pending: !groups.data || !campaigns.data || !calendarWork.ready,
          failed: groups.isError || campaigns.isError || calendarWork.failed,
          error: groups.error ?? campaigns.error ?? calendarWork.error,
          onRetry: () => {
            if (groups.isError) void groups.refetch();
            if (campaigns.isError) void campaigns.refetch();
            calendarWork.retry();
          },
        }}
        groups={filterGroups}
        campaigns={campaigns.data ?? []}
        work={calendarWork.work}
        alwaysShowGroups
        hint="Grupul include subgrupurile sale."
      />

      {deleted && (
        <CalendarReceipt key={deleted.key}>{deleted.text}</CalendarReceipt>
      )}

      {view === 'month' ? (
        <CalendarMonth
          month={shownMonth}
          now={now}
          todayKey={todayKey}
          filter={filter}
          groups={groups.data}
          relevanceOf={relevanceOf}
          keepEvent={keepEvent}
          keepGroup={preferred.keepGroup}
          showManaged={showManaged}
          onShowManagedChange={setShowManaged}
        />
      ) : (
        <CalendarAgenda
          now={now}
          todayKey={todayKey}
          filter={filter}
          linkedId={linkedId}
          groups={groups.data}
          relevanceOf={relevanceOf}
          keepEvent={keepEvent}
        />
      )}
    </Page>
  );
}
