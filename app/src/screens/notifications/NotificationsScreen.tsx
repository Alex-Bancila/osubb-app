import { useNavigate } from 'react-router';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/utils';
import {
  useMarkAllNotificationsRead,
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
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border border-border p-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
        notification.isRead ? 'bg-card' : 'bg-accent/40',
      )}
    >
      <span
        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
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
      </span>
    </button>
  );
}

export default function NotificationsScreen() {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const navigate = useNavigate();

  const feed = useNotifications(memberId);
  const unread = useUnreadNotificationCount(memberId);
  const markRead = useMarkNotificationRead(memberId);
  const markAll = useMarkAllNotificationsRead(memberId);

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
    <section
      className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8"
      aria-labelledby="notifications-title"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1
            id="notifications-title"
            className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
          >
            Notificări
          </h1>
          <p className="text-sm text-muted-foreground">
            Necitite: {unreadCount}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Marchează tot ca citit
        </Button>
      </header>

      {markAll.isError && (
        <p className="text-sm text-destructive" role="alert">
          Nu am putut marca notificările ca citite. Încearcă din nou.
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
        <Empty text="Nu ai nicio notificare deocamdată." />
      ) : (
        <>
          <ul className="space-y-3" aria-label="Lista de notificări">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <NotificationListItem
                  notification={notification}
                  onOpen={open}
                />
              </li>
            ))}
          </ul>

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
    </section>
  );
}
