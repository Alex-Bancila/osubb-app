import { useMemo, useState, type CSSProperties } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';

import { EmptyState, Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { WorkFilterState } from '../../lib/use-work-filter';
import {
  chosenGroupId,
  parseWorkFilter,
  serializeWorkFilter,
} from '../../lib/work-filter';
import { usePendingCandidatureTasks } from '../../queries/calendar-tasks';
import { useEventsInRange, type EventPresentation } from '../../queries/events';
import type { Group } from '../../queries/reference';
import { useManagedTasks, useTaskManagement } from '../../queries/task-tabs';
import { useMyTasks } from '../../queries/tasks';
import {
  buildMonthGrid,
  calendarTasks,
  dayKeyHeading,
  daySummary,
  eventRangeForDays,
  filterEvents,
  filterTasks,
  gridBounds,
  itemsByDay,
  monthBounds,
  monthLabel,
  monthOfDay,
  relevanceColor,
  shiftMonth,
  TASK_SOURCE_LABELS,
  WEEKDAYS,
  type CalendarTask,
  type EventRelevance,
  type MonthKey,
} from './calendar-presentation';
import { CalendarGroupEmpty } from './CalendarGroupEmpty';
import EventCard from './EventCard';

/** Chips a day cell draws before it says "+N". */
const CHIPS_PER_DAY = 3;

/**
 * **Lună**: the month grid (#692). Each day carries the readable Events that
 * start on it and the member's Task deadlines; tapping a day lists it below.
 * The Work Filter's range picks the month (its first day's) and bounds the
 * chips; the arrows move a whole month by writing that month as the range.
 */
export function CalendarMonth({
  month,
  now,
  todayKey,
  filter,
  groups,
  relevanceOf,
  showManaged,
  onShowManagedChange: setShowManaged,
}: {
  month: MonthKey;
  /** The screen's clock, in milliseconds (a render must not read the time). */
  now: number;
  todayKey: string;
  filter: WorkFilterState;
  groups: Map<number, Group> | undefined;
  relevanceOf: (event: EventPresentation) => EventRelevance;
  /** **Taskurile gestionate**, kept by the screen: its Work Filter reads it too (#845). */
  showManaged: boolean;
  onShowManagedChange: (next: boolean) => void;
}) {
  const [, setParams] = useSearchParams();
  const weeks = useMemo(
    () => buildMonthGrid(month, todayKey),
    [month, todayKey],
  );
  const grid = gridBounds(weeks);
  const range = useMemo(
    () => (filter.params ? eventRangeForDays(grid.first, grid.last) : null),
    [filter.params, grid.first, grid.last],
  );
  const events = useEventsInRange(range);

  const mine = useMyTasks();
  const candidatures = usePendingCandidatureTasks();
  const management = useTaskManagement();
  const managesTasks = management.data === true;
  const managed = useManagedTasks(managesTasks && showManaged);

  const tasks = useMemo(
    () =>
      calendarTasks(
        {
          own: mine.data,
          candidate: candidatures.data,
          managed: managesTasks && showManaged ? managed.data : null,
        },
        groups,
      ),
    [
      mine.data,
      candidatures.data,
      managed.data,
      managesTasks,
      showManaged,
      groups,
    ],
  );
  const byDay = useMemo(
    () =>
      itemsByDay(
        filterEvents(events.data ?? [], filter.value),
        filterTasks(tasks, filter.value),
      ),
    [events.data, tasks, filter.value],
  );

  // The day listed below the grid; today's when today is in this month. A day
  // chosen in another month is forgotten when the month changes.
  const [picked, setPicked] = useState<{ month: MonthKey; day: string }>();
  const selectedDay =
    picked?.month === month
      ? picked.day
      : monthOfDay(todayKey) === month
        ? todayKey
        : null;

  function goToMonth(next: MonthKey | null) {
    const bounds = next ? monthBounds(next) : null;
    setParams(
      (current) =>
        serializeWorkFilter(
          {
            ...parseWorkFilter(current),
            from: bounds?.first,
            to: bounds?.last,
          },
          current,
        ),
      { replace: true },
    );
  }

  const taskError = mine.isError || candidatures.isError || managed.isError;
  const tasksLoading =
    mine.isPending ||
    candidatures.isPending ||
    (managesTasks && showManaged && managed.isPending);
  const selected = selectedDay ? byDay.get(selectedDay) : undefined;
  const hasItems = Boolean(
    selected && (selected.events.length > 0 || selected.tasks.length > 0),
  );
  const heading = selectedDay ? dayKeyHeading(selectedDay) : null;
  // R40: a chosen Group with no Event or deadline in this month says so in
  // place of an empty grid — once the deadlines have settled, so a slow or
  // failed Task read never reads as "nothing".
  const groupMonthEmpty =
    chosenGroupId(filter.value) !== undefined &&
    !tasksLoading &&
    !taskError &&
    ![...byDay.keys()].some((day) => monthOfDay(day) === month);

  return (
    <div className="calendar-month-view">
      <div className="calendar-month-bar">
        {/* The month sits between its arrows (C2), so what they move is
            where the eye already is. */}
        <div className="calendar-month-nav">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Luna anterioară: ${monthLabel(shiftMonth(month, -1))}`}
            onClick={() => goToMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <h2 className="calendar-month-label" aria-live="polite">
            {monthLabel(month)}
          </h2>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Luna următoare: ${monthLabel(shiftMonth(month, 1))}`}
            onClick={() => goToMonth(shiftMonth(month, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          {monthOfDay(todayKey) !== month && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => goToMonth(null)}
            >
              Luna curentă
            </Button>
          )}
        </div>
        {managesTasks && (
          <Button
            type="button"
            variant="outline"
            className="calendar-managed-toggle"
            aria-pressed={showManaged ? 'true' : 'false'}
            onClick={() => setShowManaged(!showManaged)}
          >
            <span className="calendar-switch" aria-hidden="true" />
            Taskurile gestionate
          </Button>
        )}
      </div>

      {!filter.params ? (
        <p className="calendar-notice" role="status">
          Corectează perioada din filtre ca să vezi luna.
        </p>
      ) : events.isPending ? (
        <Loading label="Se încarcă luna…" />
      ) : events.isError ? (
        <ErrorState
          error={events.error}
          text="Nu am putut încărca evenimentele."
          onRetry={() => void events.refetch()}
        />
      ) : groupMonthEmpty ? (
        <CalendarGroupEmpty filter={filter}>
          Nimic în luna aceasta.
        </CalendarGroupEmpty>
      ) : (
        <>
          <table className="calendar-grid" aria-label={monthLabel(month)}>
            <thead>
              <tr>
                {WEEKDAYS.map((weekday) => (
                  <th key={weekday.long} scope="col">
                    <abbr title={weekday.long}>{weekday.short}</abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]?.dayKey}>
                  {week.map((day) => {
                    const items = byDay.get(day.dayKey);
                    const chips = [
                      ...(items?.events ?? []).map((event) => ({
                        key: `e${event.id}`,
                        kind: 'event' as const,
                        title: event.title,
                        color: relevanceColor(
                          event,
                          relevanceOf(event),
                          groups,
                        ),
                        other: relevanceOf(event) === 'other',
                        cancelled: event.cancelledAt !== null,
                      })),
                      ...(items?.tasks ?? []).map((task) => ({
                        key: `t${task.id}`,
                        kind: 'task' as const,
                        title: task.title,
                        color: task.color,
                        other: false,
                        cancelled: false,
                      })),
                    ];
                    const overflow = chips.length - CHIPS_PER_DAY;
                    return (
                      <td
                        key={day.dayKey}
                        className={cn(!day.inMonth && 'is-outside')}
                      >
                        <button
                          type="button"
                          className="calendar-cell"
                          aria-label={daySummary(day.dayKey, items)}
                          aria-pressed={
                            selectedDay === day.dayKey ? 'true' : 'false'
                          }
                          aria-current={day.isToday ? 'date' : undefined}
                          onClick={() => setPicked({ month, day: day.dayKey })}
                        >
                          <span className="calendar-cell-number">
                            {day.dayNumber}
                          </span>
                          <span className="calendar-chips" aria-hidden="true">
                            {chips.slice(0, CHIPS_PER_DAY).map((chip) => (
                              <span
                                key={chip.key}
                                className={cn(
                                  'calendar-chip',
                                  chip.kind === 'task' && 'is-task',
                                  chip.other && 'is-other',
                                  chip.cancelled && 'is-cancelled',
                                )}
                                style={
                                  {
                                    '--chip-color': chip.color,
                                  } as CSSProperties
                                }
                              >
                                {chip.kind === 'task' && (
                                  <Flag className="calendar-chip-icon" />
                                )}
                                <span className="calendar-chip-text">
                                  {chip.title}
                                </span>
                              </span>
                            ))}
                            {overflow > 0 && (
                              <span className="calendar-chip-more">
                                +{overflow}
                              </span>
                            )}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="calendar-legend">
            <span className="calendar-legend-item">
              <span className="calendar-legend-swatch" aria-hidden="true" />
              Eveniment
            </span>
            <span className="calendar-legend-item">
              <Flag className="size-3.5" aria-hidden="true" />
              Termen de task
            </span>
          </p>

          {taskError ? (
            <div className="calendar-notice" role="alert">
              <p>Nu am putut încărca termenele taskurilor.</p>
              <Button
                variant="outline"
                onClick={() => {
                  if (mine.isError) void mine.refetch();
                  if (candidatures.isError) void candidatures.refetch();
                  if (managed.isError) void managed.refetch();
                }}
              >
                Reîncarcă termenele
              </Button>
            </div>
          ) : (
            tasksLoading && (
              <p className="calendar-notice" role="status">
                Se încarcă termenele taskurilor…
              </p>
            )
          )}

          {/* One column under the grid (C1): the kit's header over the day's
              cards, or over a box as tall as its one sentence. */}
          <Panel
            className="calendar-selected-day"
            eyebrow={heading?.weekday}
            icon={CalendarDays}
            title={
              selectedDay && heading ? (
                <time dateTime={selectedDay}>{heading.date}</time>
              ) : (
                'Ziua aleasă'
              )
            }
            bare={hasItems}
            stack={hasItems ? 4 : undefined}
          >
            {!selectedDay ? (
              <EmptyState>
                Alege o zi din lună ca să vezi ce conține.
              </EmptyState>
            ) : !selected || !hasItems ? (
              <EmptyState>Nimic programat în această zi.</EmptyState>
            ) : (
              <>
                {selected.events.length > 0 && (
                  <ol className="calendar-day-list" aria-label="Evenimente">
                    {selected.events.map((event) => (
                      <li key={event.id}>
                        <EventCard
                          event={event}
                          groups={groups}
                          relevance={relevanceOf(event)}
                          past={Date.parse(event.startsAt) < now}
                          manageable
                        />
                      </li>
                    ))}
                  </ol>
                )}
                {selected.tasks.length > 0 && (
                  <ul className="calendar-day-list" aria-label="Termene">
                    {selected.tasks.map((task) => (
                      <li key={task.id}>
                        <TaskDayRow task={task} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

/** A Task deadline under the grid: compact, and a link into the Tracker. */
function TaskDayRow({ task }: { task: CalendarTask }) {
  return (
    <Link
      to={`/tracker?task=${task.id}`}
      className="calendar-task-row"
      style={{ '--chip-color': task.color } as CSSProperties}
    >
      <span className="calendar-task-stripe" aria-hidden="true" />
      <span className="calendar-task-main">
        <span className="calendar-task-title">{task.title}</span>
        <span className="calendar-task-meta">
          <span>{task.groupLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{TASK_SOURCE_LABELS[task.source]}</span>
        </span>
      </span>
      <span className="calendar-task-side">
        <span className="calendar-task-time">
          Termen <time dateTime={task.deadline}>{task.time}</time>
        </span>
        <span className="calendar-task-status">{task.statusLabel}</span>
      </span>
    </Link>
  );
}
