import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { Bell, LogOut, Menu, X } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import logoDark from '../../assets/brand/osubb-logo-on-dark.png';
import logoLight from '../../assets/brand/osubb-logo-on-light.png';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
import { safeHexColor } from '../../lib/color';
import { initials } from '../../lib/format';
import { useSignOutAction } from '../../lib/use-sign-out-action';
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
import { Badge } from '../ui/badge';
import { Button, buttonVariants } from '../ui/button';
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetPopup,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from '../ui/sheet';
import {
  ANNOUNCEMENTS_PATH,
  NAV_ITEMS,
  NOTIFICATIONS_PATH,
  PROFILE_PATH,
  TAB_ORDER,
  TRACKER_PATH,
  isNavItemActive,
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
  label: string;
  firstLinkRef?: Ref<HTMLAnchorElement>;
  badges: NavBadges;
  memberName: string | undefined;
  memberEmail: string | undefined;
  avatarColor: string | null | undefined;
  roleLabel: string;
  signOutAction: ReturnType<typeof useSignOutAction>;
  onNavigate?: () => void;
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
  label,
  firstLinkRef,
  badges,
  memberName,
  memberEmail,
  avatarColor,
  roleLabel,
  signOutAction,
  onNavigate,
}: SidebarContentProps) {
  const signOutErrorId = useId();
  const { pathname } = useLocation();
  return (
    <>
      <Brand />
      <nav
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
        aria-label={label}
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          const badge = badges[item.path];
          const isActive = isNavItemActive(item, pathname);
          return (
            <Link
              key={item.path}
              ref={index === 0 ? firstLinkRef : undefined}
              to={item.path}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                isActive &&
                  'bg-accent text-accent-foreground before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-primary',
              )}
              onClick={onNavigate}
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
      <div className="flex flex-col gap-2 border-t border-border p-3">
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
        <Button
          variant="ghost"
          className="w-full justify-start"
          disabled={signOutAction.pending}
          aria-describedby={signOutAction.error ? signOutErrorId : undefined}
          onClick={() => void signOutAction.run()}
        >
          <LogOut aria-hidden="true" />
          {signOutAction.pending ? 'Se deconectează…' : 'Deconectare'}
        </Button>
        {signOutAction.error && (
          <p
            id={signOutErrorId}
            className="text-sm text-destructive"
            role="alert"
          >
            {signOutAction.error}
          </p>
        )}
      </div>
    </>
  );
}

export default function AppShell() {
  const { session, signOut } = useAuth();
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
  const [menuOpen, setMenuOpen] = useState(false);
  const firstMobileLinkRef = useRef<HTMLAnchorElement>(null);
  const signOutAction = useSignOutAction(signOut);
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

  const visible = NAV_ITEMS.filter(
    (item) => !item.capability || capabilities.data?.[item.capability] === true,
  );
  const tabs = TAB_ORDER.map((path) =>
    visible.find((item) => item.path === path),
  ).filter((item) => item !== undefined);
  // On a phone Notificări and Profil are the top bar's (#972): the drawer
  // holds the rest, and opens only when some page would otherwise be
  // unreachable — a volunteer needs nothing but the bar and the top bar.
  const drawerItems = visible.filter(
    (item) => item.path !== NOTIFICATIONS_PATH && item.path !== PROFILE_PATH,
  );
  const drawerNeeded = drawerItems.some((item) => !tabs.includes(item));
  const denied = deniedMessage(location.state);
  const isNotificationsActive =
    location.pathname.startsWith(NOTIFICATIONS_PATH);
  const isProfileActive = location.pathname.startsWith(PROFILE_PATH);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeMobileMenu = (event: Pick<MediaQueryListEvent, 'matches'>) => {
      if (event.matches) setMenuOpen(false);
    };

    closeMobileMenu(desktop);
    desktop.addEventListener('change', closeMobileMenu);
    return () => desktop.removeEventListener('change', closeMobileMenu);
  }, []);

  const sidebarProps = {
    items: visible,
    memberName: profile.data?.full_name,
    memberEmail: session?.user.email,
    avatarColor: profile.data?.avatar_color,
    roleLabel,
    signOutAction,
    badges,
  };

  return (
    <div className="grid h-[calc(100dvh-var(--keyboard-inset))] grid-cols-1 grid-rows-[calc(var(--topbar-h)+env(safe-area-inset-top))_minmax(0,1fr)_auto] [grid-template-areas:'topbar'_'main'_'tabbar'] bg-background lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:[grid-template-areas:'sidebar_main']">
      <aside className="hidden min-h-0 flex-col border-r border-border bg-card lg:flex lg:[grid-area:sidebar]">
        <SidebarContent {...sidebarProps} label="Navigare principală" />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetPortal>
          <SheetBackdrop className="lg:hidden" />
          <SheetPopup
            id="mobile-navigation"
            className="pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:hidden"
            initialFocus={firstMobileLinkRef}
          >
            <SheetTitle className="sr-only">Meniu</SheetTitle>
            <SheetClose
              render={<Button variant="ghost" size="icon" />}
              className="absolute top-[calc(.5rem+env(safe-area-inset-top))] right-2"
              aria-label="Închide meniul"
            >
              <X aria-hidden="true" />
            </SheetClose>
            <SidebarContent
              {...sidebarProps}
              items={drawerItems}
              label="Meniu principal"
              firstLinkRef={firstMobileLinkRef}
              onNavigate={() => setMenuOpen(false)}
            />
          </SheetPopup>
        </SheetPortal>

        <header className="flex items-center gap-3 border-b border-border bg-card px-4 pt-[env(safe-area-inset-top)] [grid-area:topbar] sm:px-6 lg:hidden">
          {drawerNeeded && (
            <SheetTrigger
              render={<Button variant="ghost" size="icon" />}
              className="lg:hidden"
              aria-label="Deschide meniul"
              aria-controls="mobile-navigation"
            >
              <Menu aria-hidden="true" />
            </SheetTrigger>
          )}
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
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon' }),
              'relative ml-auto shrink-0 lg:hidden',
              isNotificationsActive && 'bg-accent text-accent-foreground',
            )}
            aria-current={isNotificationsActive ? 'page' : undefined}
            aria-label={
              unreadCount > 0
                ? `Notificări, ${unreadBadgeLabel(unreadCount)}`
                : 'Notificări'
            }
          >
            <Bell aria-hidden="true" />
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute top-1.5 right-1.5 h-4 min-w-4 justify-center rounded-full px-1 text-[10px]"
              >
                <span aria-hidden="true">{unreadCount}</span>
              </Badge>
            )}
          </Link>
          {/* Profil's only door on a phone (#972): the Member's own initials
              on their colour, the one personal mark in the top bar. */}
          <Link
            to={PROFILE_PATH}
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden',
              isProfileActive && 'bg-accent',
            )}
            aria-current={isProfileActive ? 'page' : undefined}
            aria-label="Profil"
          >
            <span
              className="grid size-8 place-items-center rounded-full text-xs font-bold text-white"
              style={{
                backgroundColor: safeHexColor(profile.data?.avatar_color),
              }}
              aria-hidden="true"
            >
              {initials(profile.data?.full_name ?? session?.user.email)}
            </span>
          </Link>
        </header>
      </Sheet>

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
          <Outlet />
        </>
      </main>

      {/* The bar is drawn by its two pseudo-elements (#977): the surface
          with its top border, masked by a round cut-out centred on the
          raised Acasă (its centre sits 12 px below the bar's edge: lifted
          20 px from a 6 px padding, radius 26), and a one-pixel arc that
          carries the border around the cut. `relative z-10` keeps the bar
          above the positioned content area, which otherwise painted over
          the disc's upper half. While a phone keyboard is open the bar
          steps aside, and the page keeps that height for the field and its
          actions (#1013); the shell itself ends at the keyboard. */}
      <nav
        className="relative isolate z-10 flex justify-around px-1 pt-1.5 pb-[calc(.375rem+env(safe-area-inset-bottom))] [grid-area:tabbar] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:border-t before:border-border before:bg-card before:[mask-image:radial-gradient(circle_at_50%_12px,transparent_32px,#000_33px)] after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-[radial-gradient(circle_at_50%_12px,transparent_32px,var(--border)_32.5px,var(--border)_33.5px,transparent_34px)] keyboard:hidden lg:hidden"
        aria-label="Navigare rapidă"
      >
        {tabs.map((item) => {
          const Icon = item.icon;
          const badge = badges[item.path];
          const isActive = isNavItemActive(item, location.pathname);
          if (item.path === '/')
            // The raised home (#972): the one disc in brand red, lifted over
            // the bar's edge in the centre, floating in the bar's cut-out
            // (#977), the four flat tabs around it. The disc keeps its
            // colour; the caption and aria-current say active.
            return (
              <Link
                key={item.path}
                to={item.path}
                data-slot="home-tab"
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  '-mt-5 flex min-h-14 flex-1 flex-col items-center justify-start gap-1 rounded-lg px-1 text-[10.5px] font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  isActive && 'text-red-700',
                )}
              >
                <span
                  className="grid size-[52px] place-items-center rounded-full bg-(--brand-red) text-white shadow-(--sh-red)"
                  aria-hidden="true"
                >
                  <Icon className="size-6" />
                </span>
                {item.label}
              </Link>
            );
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10.5px] font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                isActive && 'text-red-700',
              )}
            >
              <span className="relative">
                <Icon className="size-[22px]" aria-hidden="true" />
                {badge && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-1.5 -right-2.5 h-4 min-w-4 justify-center rounded-full px-1 text-[10px]"
                  >
                    <span aria-hidden="true">{badge.count}</span>
                  </Badge>
                )}
              </span>
              {item.label}
              {badge && <span className="sr-only">, {badge.label}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
