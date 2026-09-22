import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { LogOut, Menu, X } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router';
import logoDark from '../../assets/brand/osubb-logo-on-dark.png';
import logoLight from '../../assets/brand/osubb-logo-on-light.png';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { initials } from '../../lib/format';
import { useSignOutAction } from '../../lib/use-sign-out-action';
import { cn } from '../../lib/utils';
import { useUnreadNotificationCount } from '../../queries/notifications';
import { useMyProfile } from '../../queries/profile';
import { useRoles } from '../../queries/reference';
import { unreadBadgeLabel } from '../../screens/notifications/notifications-presentation';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
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
  NAV_ITEMS,
  NOTIFICATIONS_PATH,
  TAB_ORDER,
  type NavItem,
} from './navItems';

type SidebarContentProps = {
  items: NavItem[];
  label: string;
  firstLinkRef?: Ref<HTMLAnchorElement>;
  unreadNotifications: number;
  memberName: string | undefined;
  memberEmail: string | undefined;
  avatarColor: string | null | undefined;
  roleLabel: string;
  level: number | undefined;
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
  unreadNotifications,
  memberName,
  memberEmail,
  avatarColor,
  roleLabel,
  level,
  signOutAction,
  onNavigate,
}: SidebarContentProps) {
  const signOutErrorId = useId();
  return (
    <>
      <Brand />
      <nav
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
        aria-label={label}
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              ref={index === 0 ? firstLinkRef : undefined}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                  isActive &&
                    'bg-accent text-accent-foreground before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-primary',
                )
              }
              onClick={onNavigate}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              {item.label}
              {item.path === NOTIFICATIONS_PATH && unreadNotifications > 0 && (
                <Badge variant="destructive" className="ml-auto">
                  <span aria-hidden="true">{unreadNotifications}</span>
                  <span className="sr-only">
                    {unreadBadgeLabel(unreadNotifications)}
                  </span>
                </Badge>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="flex flex-col gap-2 border-t border-border p-3">
        <div className="flex min-w-0 items-center gap-3 rounded-lg p-2">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
            style={{ background: avatarColor ?? 'var(--brand-red)' }}
            aria-hidden="true"
          >
            {initials(memberName ?? memberEmail)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {memberName ?? memberEmail}
            </span>
            <Badge
              className="mt-1 max-w-full"
              title={`${roleLabel} · nivel ${level}`}
            >
              <span className="truncate">
                {roleLabel} · nivel {level}
              </span>
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
  const { claims, session, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const firstMobileLinkRef = useRef<HTMLAnchorElement>(null);
  const signOutAction = useSignOutAction(signOut);
  const profile = useMyProfile();
  const roles = useRoles();
  const unreadNotifications = useUnreadNotificationCount();
  const roleLabel =
    (claims && roles.data?.get(claims.member_role)?.name) ??
    claims?.member_role ??
    '';

  const visible = NAV_ITEMS.filter(
    (item) => !item.capability || can(claims, item.capability),
  );
  const tabs = TAB_ORDER.map((path) =>
    visible.find((item) => item.path === path),
  ).filter((item) => item !== undefined);
  const current = visible.find((item) =>
    item.path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(item.path),
  );

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
    level: claims?.member_level,
    signOutAction,
    unreadNotifications: unreadNotifications.data ?? 0,
  };

  return (
    <div className="grid h-dvh grid-cols-1 grid-rows-[calc(var(--topbar-h)+env(safe-area-inset-top))_minmax(0,1fr)_auto] [grid-template-areas:'topbar'_'main'_'tabbar'] bg-background lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)] lg:grid-rows-[var(--topbar-h)_minmax(0,1fr)] lg:[grid-template-areas:'sidebar_topbar'_'sidebar_main']">
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
              label="Meniu principal"
              firstLinkRef={firstMobileLinkRef}
              onNavigate={() => setMenuOpen(false)}
            />
          </SheetPopup>
        </SheetPortal>

        <header className="flex items-center gap-3 border-b border-border bg-card px-4 pt-[env(safe-area-inset-top)] [grid-area:topbar] sm:px-6">
          <SheetTrigger
            render={<Button variant="ghost" size="icon" />}
            className="lg:hidden"
            aria-label="Deschide meniul"
            aria-controls="mobile-navigation"
          >
            <Menu aria-hidden="true" />
          </SheetTrigger>
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
          <span className="truncate text-lg font-extrabold">
            {current?.label ?? 'OSUBB'}
          </span>
        </header>
      </Sheet>

      <main className="relative min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain [grid-area:main] [scrollbar-gutter:stable]">
        <>
          {location.state?.leadershipDenied === true && (
            <p
              role="alert"
              className="m-4 rounded-lg border border-border bg-card p-4"
            >
              Clasamentul și istoricul membrilor sunt disponibile doar
              conducerii OSUBB.
            </p>
          )}
          <Outlet />
        </>
      </main>

      <nav
        className="flex justify-around border-t border-border bg-card px-1 pt-1.5 pb-[calc(.375rem+env(safe-area-inset-bottom))] [grid-area:tabbar] lg:hidden"
        aria-label="Navigare rapidă"
      >
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10.5px] font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  isActive && 'text-primary',
                )
              }
            >
              <Icon className="size-[22px]" aria-hidden="true" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
