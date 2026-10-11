import { Link } from 'react-router';
import {
  Bell,
  ClipboardCheck,
  ClipboardPlus,
  ListTodo,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';
import { cn } from 'cn';
import { focusRingClass, panelBoxClass } from '../../components/layout';
import { useAuth } from '../../lib/auth';
import { formatTaskCount } from '../../lib/format';
import { useUnreadAnnouncementsCount } from '../../queries/announcements';
import { useUnreadNotificationCount } from '../../queries/notifications';
import { usePendingDecisions } from '../../queries/request-decisions';
import { useAwaitingMyReview } from '../../queries/task-review';
import { useMyTasks } from '../../queries/tasks';
import { unreadAnnouncementsLabel } from '../announcements/announcements-presentation';
import { unreadBadgeLabel } from '../notifications/notifications-presentation';
import { decisionsBadgeLabel } from '../requests/requests-presentation';
import { ownTasksInWork } from './next-items';

/**
 * The md+ column count for the tiles a viewer has, so the row is always full:
 * three for a Voluntar, four for BC, five for a Responsabil below BCE. Static
 * strings, so Tailwind sees every one.
 */
const columnsClass: Record<number, string> = {
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
};

/**
 * **Ce te așteaptă** on Acasă: what is waiting for the viewer, as counts that
 * open it — the same numbers the shell shows as badges, plus their own work.
 * Two columns on a phone (an odd last tile takes the row), one row from `md`.
 *
 * Only the tiles the viewer can ever have are drawn: **Taskuri în lucru**
 * for whoever executes Tasks (`ownTasks`), **De evaluat** and **Cereri de
 * decis** with `manageTasks` (`reviewer`), **Anunțuri** and **Notificări**
 * for everyone. Each tile owns its read, so a slow or failed one shows a
 * dash and holds back none of the others.
 */
export default function CountTiles({
  ownTasks,
  reviewer,
}: {
  ownTasks: boolean;
  reviewer: boolean;
}) {
  const count = 2 + (ownTasks ? 1 : 0) + (reviewer ? 2 : 0);
  return (
    <ul
      aria-label="Ce te așteaptă"
      data-slot="count-tiles"
      className={cn(
        'm-0 grid list-none grid-cols-2 gap-3 p-0 md:gap-4',
        columnsClass[count],
      )}
    >
      {ownTasks && <OwnTasksTile />}
      {reviewer && <ReviewTile />}
      {reviewer && <DecisionsTile />}
      <AnnouncementsTile />
      <NotificationsTile />
    </ul>
  );
}

function OwnTasksTile() {
  const tasks = useMyTasks();
  const memberId = useAuth().session?.user.id;
  const count =
    tasks.data && memberId
      ? ownTasksInWork(tasks.data, memberId).length
      : undefined;
  return (
    <CountTile
      icon={ListTodo}
      label="Taskuri în lucru"
      count={count}
      name={
        count === undefined ? undefined : `${formatTaskCount(count)} în lucru`
      }
      // With nothing in work the tile is the invitation: Disponibile (#846).
      to={count === 0 ? '/tracker?lista=disponibile' : '/tracker'}
    />
  );
}

function ReviewTile() {
  const review = useAwaitingMyReview(true);
  const count = review.data?.count;
  return (
    <CountTile
      icon={ClipboardCheck}
      label="De evaluat"
      count={count}
      name={
        count === undefined
          ? undefined
          : `${formatTaskCount(count)} așteaptă evaluarea ta`
      }
      to="/tracker?lista=gestionat"
    />
  );
}

function DecisionsTile() {
  const count = usePendingDecisions().data?.length;
  return (
    <CountTile
      icon={ClipboardPlus}
      label="Cereri de decis"
      count={count}
      name={count === undefined ? undefined : decisionsBadgeLabel(count)}
      to="/tracker?vedere=cereri"
    />
  );
}

function AnnouncementsTile() {
  const count = useUnreadAnnouncementsCount().data;
  return (
    <CountTile
      icon={Megaphone}
      label="Anunțuri necitite"
      count={count}
      name={count === undefined ? undefined : unreadAnnouncementsLabel(count)}
      to="/anunturi"
    />
  );
}

function NotificationsTile() {
  const count = useUnreadNotificationCount().data;
  return (
    <CountTile
      icon={Bell}
      label="Notificări necitite"
      count={count}
      name={count === undefined ? undefined : unreadBadgeLabel(count)}
      to="/notificari"
    />
  );
}

/**
 * One count: a lucide icon, the number in the dashboard's figure style and a
 * short label, the whole tile a link to where the things are. A zero is
 * muted, never hidden — the tile keeps its place, so the row does not move as
 * things arrive. While the count is unknown (loading, or a failed read) the
 * figure is a dash and the link still works.
 */
function CountTile({
  icon: Icon,
  label,
  count,
  name,
  to,
}: {
  icon: LucideIcon;
  label: string;
  count: number | undefined;
  /** The count in words ("3 notificări necitite"), for a screen reader. */
  name: string | undefined;
  to: string;
}) {
  const waiting = count !== undefined && count > 0;
  return (
    <li className="min-w-0 max-md:last:odd:col-span-2">
      <Link
        to={to}
        data-slot="count-tile"
        data-waiting={waiting || undefined}
        className={cn(
          panelBoxClass,
          'flex h-full min-h-11 flex-col gap-2 no-underline transition-colors hover:bg-muted motion-reduce:transition-none',
          focusRingClass,
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span
            data-slot="count-value"
            aria-hidden="true"
            className={cn(
              'text-[length:var(--fs-2xl)] leading-none font-extrabold tracking-[-0.03em] tabular-nums',
              waiting ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {count ?? '—'}
          </span>
          <Icon
            aria-hidden="true"
            className={cn(
              'size-5 shrink-0',
              waiting ? 'text-(--red-600)' : 'text-muted-foreground',
            )}
          />
        </span>
        <span
          data-slot="count-label"
          aria-hidden="true"
          className={cn(
            'text-sm leading-snug font-semibold',
            waiting ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {label}
        </span>
        <span className="sr-only">{name ?? label}</span>
      </Link>
    </li>
  );
}
