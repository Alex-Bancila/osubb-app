import { useNavigate } from 'react-router';
import { Empty, ErrorState, Loading } from '../../components/states';
import {
  ListRow,
  Page,
  PageHeader,
  panelBoxClass,
  rowListClass,
} from '../../components/layout';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/utils';
import {
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from '../../queries/notifications';
import {
  toNotificationPresentation,
  type NotificationPresentation,
} from './notifications-presentation';

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
      className={cn(
        'relative rounded-sm has-[button:hover]:bg-muted',
        !notification.isRead && 'bg-accent/40',
      )}
      leading={
        <span
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
      }
    >
      {/* The whole row opens the notification: the button's ::after covers
          it, and carries the focus ring. */}
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="block w-full text-left outline-none after:absolute after:inset-0 after:rounded-sm focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
      >
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={notification.critical ? 'destructive' : 'outline'}>
            {notification.kindLabel}
          </Badge>
          {!notification.isRead && (
            <>
              {/* The dot is the marker people see; the word is the one a
                  screen reader gets, so both audiences learn the same fact. */}
              <span
                className="size-2 rounded-full bg-primary"
                aria-hidden="true"
              />
              <span className="sr-only">Necitită</span>
            </>
          )}
        </span>
        <span
          className={cn(
            'mt-1 block text-sm',
            notification.isRead ? 'font-medium' : 'font-bold',
          )}
        >
          {notification.title}
        </span>
        {notification.body && (
          <span className="mt-1 block text-sm text-muted-foreground">
            {notification.body}
          </span>
        )}
        <time
          className="mt-2 block text-xs text-muted-foreground"
          dateTime={notification.createdAt}
          title={notification.momentLabel}
        >
          {notification.ageLabel}
        </time>
      </button>
    </ListRow>
  );
}

export default function NotificationsScreen() {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const navigate = useNavigate();

  const feed = useNotifications(memberId);
  const unread = useUnreadNotificationCount(memberId);
  const markRead = useMarkNotificationRead(memberId);

  const notifications = (feed.data?.pages ?? [])
    .flatMap((page) => page.rows)
    .map((row) => toNotificationPresentation(row));

  const unreadCount = unread.data ?? 0;

  /* Opening is two independent acts: the read marker is written straight away
     under #65's self-scoped policy, and the link is followed without waiting
     for it — a slow write must never hold a member on this screen, and a
     failed one leaves the row unread, which is the honest outcome. */
  function open(notification: NotificationPresentation) {
    if (!notification.isRead) markRead.mutate(notification.id);
    if (notification.link) void navigate(notification.link);
  }

  return (
    <Page width="reading">
      <PageHeader title="Notificări" description={`Necitite: ${unreadCount}`} />

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
          <div className={panelBoxClass}>
            <ul
              className={cn(rowListClass, '-mx-3 -my-2')}
              aria-label="Lista de notificări"
            >
              {notifications.map((notification) => (
                <NotificationListItem
                  key={notification.id}
                  notification={notification}
                  onOpen={open}
                />
              ))}
            </ul>
          </div>

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
