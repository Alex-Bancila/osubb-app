import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { IonIcon } from '@ionic/react';
import { logOutOutline, menuOutline } from 'ionicons/icons';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { initials } from '../../lib/format';
import { useMyProfile } from '../../queries/profile';
import { useRoles } from '../../queries/reference';
import { NAV_ITEMS, TAB_ORDER } from './navItems';

/**
 * The frame every signed-in screen renders inside: sidebar on desktop, a
 * drawer plus a five-item tab bar below 1024px, exactly as in the mockup.
 *
 * The navigation is the permission model made visible — but only visible.
 * Hiding a tab is a kindness, not a fence: someone who types /bc by hand gets
 * the screen and no data, because the database is what refuses.
 */
export default function AppShell() {
  const { claims, session, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  /* The sidebar identifies the person, not the account: their name and their
     own avatar colour, with the address as the fallback for the moment before
     the profile arrives. Both queries are shared with the screens — the shell
     costs no extra requests. */
  const profile = useMyProfile();
  const roles = useRoles();
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

  return (
    <div className="app">
      <aside className={`sidebar${menuOpen ? ' is-open' : ''}`}>
        <div className="sidebar-brand">OSUBB</div>

        <nav className="nav" aria-label="Navigare principală">
          {visible.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `nav-item${isActive ? ' is-active' : ''}`
              }
              /* Close the drawer here rather than in an effect on the location:
                 these links are the only way to navigate while it is open, and
                 handling it at the click that causes it avoids a second render
                 pass on every navigation. */
              onClick={() => setMenuOpen(false)}
            >
              <IonIcon icon={item.icon} aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="usercard">
            <span
              className="avatar"
              style={{ background: profile.data?.avatar_color ?? 'var(--red)' }}
              aria-hidden="true"
            >
              {initials(profile.data?.full_name ?? session?.user.email)}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="usercard-name">
                {profile.data?.full_name ?? session?.user.email}
              </span>
              <span className="usercard-role" style={{ display: 'block' }}>
                {roleLabel} · nivel {claims?.member_level}
              </span>
            </span>
          </div>
          <button type="button" className="nav-item" onClick={signOut}>
            <IonIcon icon={logOutOutline} aria-hidden="true" />
            Deconectare
          </button>
        </div>
      </aside>

      {menuOpen && (
        <button
          type="button"
          className="scrim"
          aria-label="Închide meniul"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <header className="topbar">
        <button
          type="button"
          className="icon-btn menu-btn"
          aria-label="Deschide meniul"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <IonIcon icon={menuOutline} aria-hidden="true" />
        </button>
        <span className="topbar-title">{current?.label ?? 'OSUBB'}</span>
        <span className="topbar-spacer" />
      </header>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Navigare rapidă">
        {tabs.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `tab-link${isActive ? ' is-active' : ''}`
            }
          >
            <IonIcon icon={item.icon} aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
