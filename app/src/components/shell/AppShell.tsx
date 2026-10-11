import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import logoDark from '../../assets/brand/osubb-logo-on-dark.png';
import logoLight from '../../assets/brand/osubb-logo-on-light.png';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
import { safeHexColor } from '../../lib/color';
import { initials } from '../../lib/format';
import { useEnterMotion, usePopMotion } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { useUnreadAnnouncementsCount } from '../../queries/announcements';
import { useLiveChanges } from '../../queries/live-changes';
import {
  useReadOpenedNotification,
  useUnreadNotificationCount,
} from '../../queries/notifications';
import { useNotificationRealtime } from '../../queries/notifications-realtime';
import { useMyRoleLabel } from '../../queries/my-role-label';
import { useMyProfile } from '../../queries/profile';
import { usePushSelfRepair } from '../../queries/push-subscription';
import { usePendingDecisions } from '../../queries/request-decisions';
import { unreadAnnouncementsLabel } from '../../screens/announcements/announcements-presentation';
import { unreadBadgeLabel } from '../../screens/notifications/notifications-presentation';
import { decisionsBadgeLabel } from '../../screens/requests/requests-presentation';
import { FabSlotContext } from '../layout/fab-context';
import { Badge } from '../ui/badge';
import { TabBar } from './TabBar';
import {
  ANNOUNCEMENTS_PATH,
  NOTIFICATIONS_PATH,
  PROFILE_PATH,
  TRACKER_PATH,
  isNavItemActive,
  navFor,
  type NavItem,
} from './navItems';

/**
 * The one line the shell shows above a page it was sent to instead of the one
 * asked for: a capability guard's refusal (#844, D21), Clasament's in its own
 * words. Router state, so a reload or the next navigation drops it.
 */
function deniedMessage(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const flags = state as Record<string, unknown>;
  if (flags.leadershipDenied === true)
    return 'Clasamentul și istoricul membrilor sunt disponibile doar conducerii OSUBB.';
  if (flags.denied === true) return 'Nu ai acces la pagina cerută.';
  return null;
}

/** The unread counts the shell badges, by the path whose entry carries them. */
type NavBadges = Partial<Record<string, { count: number; label: string }>>;

function navBadges(
  notifications: number,
  announcements: number,
  decisions: number,
): NavBadges {
  const badges: NavBadges = {};
  // The Requests waiting for the viewer's decision live under Taskuri (#972).
  if (decisions > 0)
    badges[TRACKER_PATH] = {
      count: decisions,
      label: decisionsBadgeLabel(decisions),
    };
  if (notifications > 0)
    badges[NOTIFICATIONS_PATH] = {
      count: notifications,
      label: unreadBadgeLabel(notifications),
    };
  if (announcements > 0)
    badges[ANNOUNCEMENTS_PATH] = {
      count: announcements,
      label: unreadAnnouncementsLabel(announcements),
    };
  return badges;
}

type SidebarContentProps = {
  items: NavItem[];
  badges: NavBadges;
  memberName: string | undefined;
  memberEmail: string | undefined;
  avatarColor: string | null | undefined;
  roleLabel: string;
};

function Brand() {
  return (
    <div className="flex h-[var(--topbar-h)] items-center border-b border-border px-5">
      <img className="h-8 w-auto dark:hidden" src={logoLight} alt="OSUBB" />
      <img
        className="hidden h-8 w-auto dark:block"
        src={logoDark}
        alt="OSUBB"
      />
    </div>
  );
}

function SidebarContent({
  items,
  badges,
  memberName,
  memberEmail,
  avatarColor,
  roleLabel,
}: SidebarContentProps) {
  const { pathname } = useLocation();
  return (
    <>
      <Brand />
      <nav
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
        aria-label="Navigare principală"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const badge = badges[item.path];
          const isActive = isNavItemActive(item, pathname);
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                isActive &&
                  'bg-accent text-accent-foreground before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-primary',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              {item.label}
              {badge && (
                <Badge variant="destructive" className="ml-auto">
                  <span aria-hidden="true">{badge.count}</span>
                  <span className="sr-only">{badge.label}</span>
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>
      {/* Who is signed in, never a way out (R41): sign-out lives once, at the
          foot of Profil, behind a confirmation. */}
      <div className="border-t border-border p-3">
        <div className="flex min-w-0 items-center gap-3 rounded-lg p-2">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: safeHexColor(avatarColor) }}
            aria-hidden="true"
          >
            {initials(memberName ?? memberEmail)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {memberName ?? memberEmail}
            </span>
            {/* The Role's name — or the Board Title (#963) — never its
                level: a system number (#844, B44). */}
            <Badge className="mt-1 max-w-full" title={roleLabel}>
              <span className="truncate">{roleLabel}</span>
            </Badge>
          </span>
        </div>
      </div>
    </>
  );
}

/**
 * Notificări and Profil are the top bar's two places: on either, its mark
 * opens into the bar's own selection — the light pill with the page's name —
 * so "you are here" looks the same at the top as at the bottom. The mark is
 * one element in both states (`data-open`), so the pill opens and closes
 * instead of swapping.
 */
const topMarkClass =
  'group/mark inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden';

const topPillClass =
  'inline-flex items-center rounded-full transition-[background-color,color] duration-200 group-data-open/mark:bg-(--text) group-data-open/mark:text-(--surface) motion-reduce:transition-none';

/** The page's name in the mark: no width until the mark is open. */
function TopMarkLabel({
  className,
  children,
}: {
  className?: string;
  children: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="top-mark-label"
      className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out group-data-open/mark:grid-cols-[1fr] motion-reduce:transition-none"
    >
      <span
        className={cn(
          'overflow-hidden text-xs font-bold whitespace-nowrap transition-[padding] duration-200 group-data-open/mark:pl-1.5 motion-reduce:transition-none',
          className,
        )}
      >
        {children}
      </span>
    </span>
  );
}

export default function AppShell() {
  const { session } = useAuth();
  useNotificationRealtime(session?.user.id);
  // #961: every other change arrives on the org:changes broadcast.
  useLiveChanges(session?.user.id);
  // #769: keep this device's push subscription working across VAPID key
  // rotations and push-service renewals, silently, from every app start.
  usePushSelfRepair();
  // #1012 (R37): a push tap or an Email Digest link opened this page with
  // the Notification's id; that Notification is read now.
  useReadOpenedNotification();
  const location = useLocation();
  const [fabSlot, setFabSlot] = useState<HTMLDivElement | null>(null);
  const profile = useMyProfile();
  const unreadNotifications = useUnreadNotificationCount();
  const unreadCount = unreadNotifications.data ?? 0;
  const unreadAnnouncements = useUnreadAnnouncementsCount();
  // The one cached my_capabilities() row the route guards and the Tracker
  // share: live rank and Group Roles, which the token cannot carry.
  const capabilities = useCapabilities();
  // The same query the Cereri view reads, so the badge costs no request:
  // Taskuri carries the Requests waiting for the viewer's decision (#972).
  const requestsToDecide = usePendingDecisions();
  const badges = navBadges(
    unreadCount,
    unreadAnnouncements.data ?? 0,
    requestsToDecide.data?.length ?? 0,
  );
  // The Board Title when the Member holds one (#963), else the Role's name.
  const roleLabel = useMyRoleLabel();

  // What the viewer may open, the phone bar's three, and the pages behind
  // its Mai mult (`navFor`).
  const { visible, tabs, more } = navFor(capabilities.data);
  const denied = deniedMessage(location.state);
  const unreadPop = usePopMotion<HTMLSpanElement>(unreadCount);
  const page = useEnterMotion<HTMLDivElement>(
    location.pathname.split('/')[1] ?? '',
  );
  const isNotificationsActive =
    location.pathname.startsWith(NOTIFICATIONS_PATH);
  const isProfileActive = location.pathname.startsWith(PROFILE_PATH);

  const sidebarProps = {
    items: visible,
    memberName: profile.data?.full_name,
    memberEmail: session?.user.email,
    avatarColor: profile.data?.avatar_color,
    roleLabel,
    badges,
  };

  return (
    <div className="grid h-[calc(100dvh-var(--keyboard-inset))] grid-cols-1 grid-rows-[calc(var(--topbar-h)+env(safe-area-inset-top))_minmax(0,1fr)] [grid-template-areas:'topbar'_'main'] bg-background lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:[grid-template-areas:'sidebar_main']">
      <aside className="hidden min-h-0 flex-col border-r border-border bg-card lg:flex lg:[grid-area:sidebar]">
        <SidebarContent {...sidebarProps} />
      </aside>

      {/* A phone's top bar is the logo, the bell and the avatar for everyone:
          no menu. The bar below, its Mai mult drawer and these two reach
          every page. */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 pt-[env(safe-area-inset-top)] [grid-area:topbar] sm:px-6 lg:hidden">
        <span className="shrink-0 lg:hidden" aria-hidden="true">
          <img
            className="h-8 w-auto object-contain dark:hidden"
            src={logoLight}
            alt=""
          />
          <img
            className="hidden h-8 w-auto object-contain dark:block"
            src={logoDark}
            alt=""
          />
        </span>
        {/* A link, drawn as the icon button: a Base UI Button rendered as
              a link logs the `nativeButton` error, and `nativeButton={false}`
              would announce it as a button (F-26). */}
        <Link
          to={NOTIFICATIONS_PATH}
          data-open={isNotificationsActive || undefined}
          className={cn(topMarkClass, 'ml-auto')}
          aria-current={isNotificationsActive ? 'page' : undefined}
          aria-label={
            unreadCount > 0
              ? `Notificări, ${unreadBadgeLabel(unreadCount)}`
              : 'Notificări'
          }
        >
          <span className={cn(topPillClass, 'h-[36px] px-[10px]')}>
            <span className="relative inline-flex shrink-0">
              <Bell aria-hidden="true" className="size-4" />
              {unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-2 left-2.5 h-4 min-w-4 justify-center rounded-full bg-destructive px-1 text-[10px] text-white ring-2 ring-card transition-[box-shadow] group-data-open/mark:ring-(--text) dark:bg-destructive"
                >
                  <span
                    ref={unreadPop}
                    aria-hidden="true"
                    className="inline-block"
                  >
                    {unreadCount}
                  </span>
                </Badge>
              )}
            </span>
            {/* Clear of the count on the bell's corner. */}
            <TopMarkLabel className="group-data-open/mark:pl-3">
              Notificări
            </TopMarkLabel>
          </span>
        </Link>
        {/* Profil's only door on a phone (#972): the Member's own initials
              on their colour, the one personal mark in the top bar. */}
        <Link
          to={PROFILE_PATH}
          data-open={isProfileActive || undefined}
          className={topMarkClass}
          aria-current={isProfileActive ? 'page' : undefined}
          aria-label="Profil"
        >
          {/* The avatar keeps its size: the pill grows around it. */}
          <span className={cn(topPillClass, 'h-[44px] p-[2px]')}>
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
              style={{
                backgroundColor: safeHexColor(profile.data?.avatar_color),
              }}
              aria-hidden="true"
            >
              {initials(profile.data?.full_name ?? session?.user.email)}
            </span>
            <TopMarkLabel className="group-data-open/mark:pr-2.5">
              Profil
            </TopMarkLabel>
          </span>
        </Link>
      </header>

      <main className="relative min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain [grid-area:main] [scrollbar-gutter:stable] keyboard:scroll-pb-3">
        <>
          {denied && (
            // On the page's own frame, so it lines up with the header below.
            <div className="mx-auto w-full max-w-(--content-max) px-4 pt-4 md:px-6 md:pt-6">
              <p
                role="alert"
                className="rounded-lg border border-border bg-card p-4"
              >
                {denied}
              </p>
            </div>
          )}
          <FabSlotContext.Provider value={fabSlot}>
            {/* A page arrives when the area changes; its own tabs move
                their own content. */}
            {/* A phone's bar floats over the page: the page ends with the
                bar's height of room, so its last row scrolls clear. */}
            <div
              ref={page}
              className="max-lg:pb-[calc(4.75rem+env(safe-area-inset-bottom))] keyboard:pb-0"
            >
              <Outlet />
            </div>
          </FabSlotContext.Provider>
        </>
      </main>

      {/* The foot of the content area. On a phone: the floating tab bar and,
          beside it, the page's create button (`FabActions` draws it into the
          slot). From `lg` the bar is gone and the button keeps the bottom
          right corner, clear of the sidebar. All of it steps aside for a
          phone keyboard. */}
      <div
        data-slot="bottom-bar"
        className="pointer-events-none z-10 flex items-end justify-center gap-2 self-end px-3 pt-2 pb-[calc(.75rem+env(safe-area-inset-bottom))] [grid-area:main] *:pointer-events-auto lg:justify-end lg:p-6 keyboard:hidden"
      >
        <TabBar tabs={tabs} more={more} badges={badges} />
        <div ref={setFabSlot} data-slot="fab-slot" className="empty:hidden" />
      </div>
    </div>
  );
}
