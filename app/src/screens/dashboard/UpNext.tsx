import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, ClipboardCheck } from 'lucide-react';
import { cn } from 'cn';
import {
  EmptyState,
  ListRow,
  Panel,
  rowListClass,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { buttonVariants } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import {
  BUCHAREST_TIME_ZONE,
  bucharestDayKey,
  formatBucharestShortDay,
  formatBucharestTime,
} from '../../lib/calendar-time';
import { useEventsInRange } from '../../queries/events';
import { useMyGroupRoles } from '../../queries/my-groups';
import { useAwaitingMyReview } from '../../queries/task-review';
import { useMyTasks } from '../../queries/tasks';
import {
  eventRangeForDays,
  eventTimeLabel,
  eventTypeLabel,
  relevantGroupIds,
} from '../calendar/calendar-presentation';
import {
  ownTasksByDeadline,
  ownTasksInWork,
  upcomingRelevantEvents,
} from './next-items';

/** How many of the Member's deadlines, and how many Events, the list holds. */
const SHOWN_EACH = 3;

const dayFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TIME_ZONE,
  calendar: 'gregory',
  day: 'numeric',
});
const monthFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TIME_ZONE,
  calendar: 'gregory',
  month: 'short',
});

type UpNextItem = {
  key: string;
  /** Where the full card lives. */
  to: string;
  title: string;
  /** The instant the row is dated by; null for a row with no day of its own. */
  at: string | null;
  meta: ReactNode;
};

type Source = {
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

/**
 * **Urmează** on Acasă: what comes next, as one short list — the Task
 * awaiting the viewer's Evaluation first (it is already waiting), then the
 * Member's next deadlines and the next Relevant Events in the order they
 * come. Each row links to where the full card lives: `/tracker?task=<id>`
 * opens the Task in Taskuri, `/calendar?event=<id>` the Event in the
 * Calendar. The rows only read; acting happens there.
 *
 * `ownTasks` says whether the viewer executes Tasks at all (BC and BCE with
 * `manageTasks` do not: their Tasks are the ones they evaluate), so their
 * Tasks are never read; `reviewer` is `manageTasks`.
 *
 * Every source keeps its own failure: a read that failed is named under the
 * rows that did arrive, with its retry, and blanks none of them.
 */
export default function UpNext({
  now,
  ownTasks,
  reviewer,
}: {
  now: Date;
  ownTasks: boolean;
  reviewer: boolean;
}) {
  return ownTasks ? (
    <WithOwnTasks now={now} reviewer={reviewer} />
  ) : (
    <UpNextPanel now={now} reviewer={reviewer} />
  );
}

/** The Tracker's own read, mounted only for a viewer who executes Tasks. */
function WithOwnTasks(props: { now: Date; reviewer: boolean }) {
  const tasks = useMyTasks();
  return <UpNextPanel {...props} tasks={tasks} />;
}

function UpNextPanel({
  now,
  reviewer,
  tasks,
}: {
  now: Date;
  reviewer: boolean;
  tasks?: ReturnType<typeof useMyTasks>;
}) {
  const memberId = useAuth().session?.user.id;
  const review = useAwaitingMyReview(reviewer);
  // The Calendar's read (#692), windowed from today's Bucharest midnight and
  // open-ended — the key the Agendă's default opens on, so the two screens
  // share one cache entry and the key does not move with the clock. Events
  // that already started today are dropped below, against `now`.
  const todayKey = bucharestDayKey(now) ?? undefined;
  const range = useMemo(() => eventRangeForDays(todayKey), [todayKey]);
  const events = useEventsInRange(todayKey ? range : null);
  const mine = useMyGroupRoles();
  const relevant = useMemo(
    () => relevantGroupIds(mine.data ?? []),
    [mine.data],
  );

  const items: UpNextItem[] = [];
  const toEvaluate = review.data?.task;
  if (toEvaluate)
    items.push({
      key: `review-${toEvaluate.id}`,
      to: `/tracker?task=${toEvaluate.id}`,
      title: taskTitle(toEvaluate.title),
      at: null,
      meta: metaLine(['De evaluat', toEvaluate.group?.name]),
    });
  const dated: (UpNextItem & { at: string })[] = [];
  const inWork =
    tasks?.data && memberId ? ownTasksInWork(tasks.data, memberId) : [];
  if (tasks?.data && memberId)
    for (const task of ownTasksByDeadline(tasks.data, memberId).slice(
      0,
      SHOWN_EACH,
    )) {
      const deadline = task.deadline as string;
      const overdue = Date.parse(deadline) < now.getTime();
      dated.push({
        key: `task-${task.id}`,
        to: `/tracker?task=${task.id}`,
        title: taskTitle(task.title),
        at: deadline,
        meta: metaLine([
          overdue ? (
            <span key="overdue" className="font-semibold text-destructive">
              Termen depășit
            </span>
          ) : (
            'Termen'
          ),
          <When key="when" at={deadline} now={now} />,
          task.group?.name,
        ]),
      });
    }
  if (events.data && mine.data)
    for (const event of upcomingRelevantEvents(
      events.data,
      relevant,
      now.getTime(),
    ).slice(0, SHOWN_EACH))
      dated.push({
        key: `event-${event.id}`,
        to: `/calendar?event=${event.id}`,
        title: event.title,
        at: event.startsAt,
        meta: metaLine([
          eventTypeLabel(event.type),
          <When
            key="when"
            at={event.startsAt}
            now={now}
            // #1098 (R63): an all-day Event has no time to show.
            text={
              event.allDay || event.multiDay
                ? eventTimeLabel(event, now)
                : undefined
            }
          />,
          event.location,
          event.group?.name,
        ]),
      });
  dated.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  items.push(...dated);

  const failed: { text: string; source: Source }[] = [];
  if (review.isError)
    failed.push({
      text: 'Nu am putut încărca taskurile de evaluat.',
      source: review,
    });
  if (tasks?.isError)
    failed.push({ text: 'Nu am putut încărca taskurile tale.', source: tasks });
  // The Events are only Relevant against the Member's Groups: either read
  // failing leaves no Event to show.
  const eventsFailed = events.isError ? events : mine.isError ? mine : null;
  if (eventsFailed)
    failed.push({
      text: 'Nu am putut încărca evenimentele.',
      source: eventsFailed,
    });
  // Waiting for every read keeps a row from arriving above the one being read.
  const isPending =
    review.isPending ||
    Boolean(tasks?.isPending) ||
    (!eventsFailed && (events.isPending || mine.isPending));

  return (
    <Panel
      title="Urmează"
      flush={!isPending && items.length > 0}
      boxClassName={items.length > 0 ? 'overflow-hidden' : undefined}
    >
      {isPending ? (
        <Loading />
      ) : (
        <>
          {items.length > 0 && (
            <ul className={rowListClass}>
              {items.map((item) => (
                <UpNextRow key={item.key} item={item} />
              ))}
            </ul>
          )}
          {failed.map(({ text, source }) => (
            <ErrorState
              key={text}
              text={text}
              error={source.error}
              onRetry={() => void source.refetch()}
            />
          ))}
          {items.length === 0 && failed.length === 0 && (
            <EmptyState
              action={
                !tasks ? undefined : inWork.length > 0 ? (
                  // Work without a deadline is not "next", but it is work.
                  <Link
                    to="/tracker"
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    Vezi taskurile tale
                  </Link>
                ) : (
                  <Link
                    to="/tracker?lista=disponibile"
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    Vezi oportunitățile
                  </Link>
                )
              }
            >
              {tasks
                ? 'Niciun task cu termen și niciun eveniment viitor pentru tine.'
                : 'Niciun eveniment viitor pentru tine.'}
            </EmptyState>
          )}
        </>
      )}
    </Panel>
  );
}

/** The Tracker card's own fallback for a Task whose title is blank. */
function taskTitle(title: string): string {
  return title.trim() || 'Task fără titlu';
}

/** The meta line's parts that exist, with a middle dot between them. */
function metaLine(parts: ReactNode[]): ReactNode {
  const present = parts.filter(
    (part) => part !== null && part !== undefined && part !== '',
  );
  return present.map((part, index) => (
    // The parts never reorder: a row is rebuilt whole when its item changes.
    <span key={index}>
      {index > 0 && <span aria-hidden="true"> · </span>}
      {part}
    </span>
  ));
}

/**
 * The time on the meta line. The day is the date block's, which a screen
 * reader does not get, so it is said here for them.
 */
function When({
  at,
  now,
  text,
}: {
  at: string;
  now: Date;
  /** In place of the time: an all-day or several-day Event's own words. */
  text?: string;
}) {
  return (
    <time dateTime={at}>
      <span className="sr-only">{formatBucharestShortDay(at, now)}, </span>
      {text ?? formatBucharestTime(at)}
    </time>
  );
}

/** "17" over "OCT", in Romania's day; an icon for a row with no day. */
function DateBlock({ at }: { at: string | null }) {
  const date = at === null ? null : new Date(at);
  return (
    <span
      data-slot="date-block"
      aria-hidden="true"
      className="grid size-10 shrink-0 place-content-center rounded-md bg-muted text-center leading-none"
    >
      {date ? (
        <>
          <span className="text-base font-extrabold tabular-nums">
            {dayFormatter.format(date)}
          </span>
          <span className="mt-0.5 text-[0.625rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">
            {monthFormatter.format(date).replace('.', '')}
          </span>
        </>
      ) : (
        <ClipboardCheck className="size-5 text-(--red-600)" />
      )}
    </span>
  );
}

/**
 * One compact row: the date block, the title, one muted meta line and a
 * chevron. The whole row is the link (its `::after` covers it), with the
 * focus ring drawn inside, because the rows run to the box's frame.
 */
function UpNextRow({ item }: { item: UpNextItem }) {
  return (
    <ListRow
      className="pressable relative"
      leading={<DateBlock at={item.at} />}
      action={
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      }
    >
      <Link
        to={item.to}
        className={cn(
          'block truncate font-semibold text-foreground no-underline underline-offset-4 after:absolute after:inset-0 hover:underline',
          'outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-ring focus-visible:after:outline-solid',
        )}
      >
        {item.title}
      </Link>
      <p className="m-0 truncate text-sm text-muted-foreground">{item.meta}</p>
    </ListRow>
  );
}
