import { BellDot, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Empty, ErrorState, Loading } from '../../components/states';
import { TaskActionSuccess } from '../../components/tasks/TaskActionSuccess';
import {
  ListRow,
  Page,
  PageHeader,
  Panel,
  rowListClass,
} from '../../components/layout';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { marksAllNotificationsRead } from '../../lib/capabilities';
import { commandErrorMessage } from '../../lib/command-reasons';
import { cn } from '../../lib/utils';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from '../../queries/notifications';
import {
  markedAllReceipt,
  toNotificationPresentation,
  unreadBadgeLabel,
  type NotificationPresentation,
} from './notifications-presentation';

/**
 * One notification, said once each way: the icon is its category (named for
 * a screen reader), one dot at the row's left edge is "unread" (with the word
 * for a screen reader), and a critical one has its icon in the alert colour.
 * The title's line ends in the age; the body keeps to two lines — the page
 * the row opens has the rest.
 */
function NotificationListItem({
  notification,
  onOpen,
}: {
  notification: NotificationPresentation;
  onOpen: (notification: NotificationPresentation) => void;
}) {
  const Icon = notification.icon;

  return (
    <ListRow
      className="relative items-start py-3 has-[button:hover]:bg-muted"
      leading={
        <>
          {!notification.isRead && (
            <span
              data-slot="unread-dot"
              className="absolute top-1/2 left-1 size-2 -translate-y-1/2 rounded-full bg-primary"
              aria-hidden="true"
            />
          )}
          <span
            data-slot="notification-icon"
            data-critical={notification.critical || undefined}
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-lg',
              notification.critical
                ? 'bg-destructive/10 text-destructive dark:bg-destructive/20'
                : 'bg-muted text-muted-foreground',
            )}
            aria-hidden="true"
          >
            <Icon className="size-5" />
          </span>
        </>
      }
    >
      {/* The whole row opens the notification: the button's ::after covers
          it, and carries the focus ring — drawn inside, because the rows run
          to the box's frame (O1) and the box clips anything outside it. */}
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="block w-full text-left outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-solid focus-visible:after:outline-ring"
      >
        {/* What the icon and the dot show, in words. */}
        <span className="sr-only">{notification.kindLabel}</span>
        {!notification.isRead && <span className="sr-only">Necitită</span>}
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              'min-w-0 text-sm wrap-anywhere',
              notification.isRead ? 'font-medium' : 'font-bold',
            )}
          >
            {notification.title}
          </span>
          <time
            className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
            dateTime={notification.createdAt}
            title={notification.momentLabel}
          >
            <span aria-hidden="true">{notification.shortAgeLabel}</span>
            <span className="sr-only">{notification.ageLabel}</span>
          </time>
        </span>
        {notification.body && (
          <span className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {notification.body}
          </span>
        )}
      </button>
    </ListRow>
  );
}

export default function NotificationsScreen() {
  const { session, claims } = useAuth();
  const memberId = session?.user.id;
  const navigate = useNavigate();

  const feed = useNotifications(memberId);
  const unread = useUnreadNotificationCount(memberId);
  const markRead = useMarkNotificationRead(memberId);
  // R37 (#1012, amends R16): BCE, BC and the Moderator may also read
  // everything at once; nobody else is offered it, and the server refuses it.
  const canMarkAll = marksAllNotificationsRead(claims);
  const markAll = useMarkAllNotificationsRead();
  const [marked, setMarked] = useState<number | null>(null);

  const notifications = (feed.data?.pages ?? [])
    .flatMap((page) => page.rows)
    .map((row) => toNotificationPresentation(row));

  /* The count is `undefined` while it loads or after it fails: the header
     then says nothing rather than claiming everything is read. A zero is also
     not trusted while an unread row is already on screen. */
  const unreadCount = unread.data;
  const hasUnread =
    (unreadCount ?? 0) > 0 || notifications.some((row) => !row.isRead);

  /* Opening is two independent acts: the read marker is written straight away
     under #65's self-scoped policy, and the link is followed without waiting
     for it — a slow write must never hold a member on this screen, and a
     failed one leaves the row unread, which is the honest outcome. */
  function open(notification: NotificationPresentation) {
    if (!notification.isRead) markRead.mutate(notification.id);
    if (notification.link) void navigate(notification.link);
  }

  function markAllRead() {
    setMarked(null);
    markAll.mutate(undefined, { onSuccess: (count) => setMarked(count) });
  }

  return (
    <Page width="reading">
      {/* B35: no "Necitite: 0" — a zero says it in words, as Anunțuri does.
          R37 (amends R16): a notification becomes read when it is opened —
          here, from a push or an email, or by opening or acting on what it is
          about; only level 5 and above get "Marchează toate ca citite". */}
      <PageHeader
        title="Notificări"
        badge={
          unreadCount !== undefined &&
          unreadCount > 0 && (
            <Badge variant="destructive" className="h-6 gap-1.5 px-2.5 text-sm">
              <BellDot aria-hidden="true" />
              <span aria-hidden="true">{unreadCount}</span>
              <span className="sr-only">{unreadBadgeLabel(unreadCount)}</span>
            </Badge>
          )
        }
        actions={
          canMarkAll && (
            // An icon on the title's row: a wide button on a row of its own
            // pushed the list down for something done once a visit.
            <Button
              variant="outline"
              size="icon"
              aria-label="Marchează toate ca citite"
              title="Marchează toate ca citite"
              disabled={markAll.isPending || !hasUnread}
              onClick={markAllRead}
            >
              <CheckCheck aria-hidden="true" />
            </Button>
          )
        }
      />
      {marked !== null && (
        <TaskActionSuccess>{markedAllReceipt(marked)}</TaskActionSuccess>
      )}
      {markAll.isError && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {commandErrorMessage(
            markAll.error,
            'Nu am putut marca notificările ca citite. Încearcă din nou.',
          )}
        </p>
      )}

      {feed.isPending ? (
        <Loading label="Se încarcă notificările…" />
      ) : feed.isError ? (
        <ErrorState
          error={feed.error}
          text="Nu am putut încărca notificările."
          onRetry={() => void feed.refetch()}
        />
      ) : notifications.length === 0 ? (
        <Empty bare text="Nu ai nicio notificare deocamdată." />
      ) : (
        <>
          {/* O1: a flush box — the rows carry the padding, so a row's hover
              tint runs to the frame; the box clips it to its rounded corners. */}
          <Panel
            flush
            aria-label="Notificările tale"
            boxClassName="overflow-hidden"
          >
            <ul className={rowListClass} aria-label="Lista de notificări">
              {notifications.map((notification) => (
                <NotificationListItem
                  key={notification.id}
                  notification={notification}
                  onOpen={open}
                />
              ))}
            </ul>
          </Panel>

          {feed.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                {feed.isFetchingNextPage
                  ? 'Se încarcă…'
                  : 'Încarcă mai multe notificări'}
              </Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
