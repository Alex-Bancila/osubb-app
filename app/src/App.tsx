import { lazy, Suspense, type ReactElement } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router';
import { useAuth } from './lib/auth';
import { authDestination, loginDestination } from './lib/auth-destination';
import { useCapability, type Capability } from './lib/capabilities';
import LeadershipScreen from './screens/leadership/LeadershipScreen';
import MemberTrackerScreen from './screens/leadership/MemberTrackerScreen';
import AppShell from './components/shell/AppShell';
import LoginScreen from './screens/login/LoginScreen';
import AuthCallback from './screens/login/AuthCallback';
import NoProfileScreen from './screens/no-profile/NoProfileScreen';
import CampaignsScreen from './screens/campaigns/CampaignsScreen';
import VolunteersScreen from './screens/volunteers/VolunteersScreen';
import DashboardScreen from './screens/dashboard/DashboardScreen';
import CompletedWorkRequestScreen from './screens/requests/CompletedWorkRequestScreen';
import AnnouncementsScreen from './screens/announcements/AnnouncementsScreen';
import NotificationsScreen from './screens/notifications/NotificationsScreen';
import ProfileScreen from './screens/profile/ProfileScreen';
import { SessionLoader, SessionScreen } from './components/shell/SessionScreen';

const TrackerScreen = lazy(() => import('./screens/tracker/TrackerScreen'));
const CalendarScreen = lazy(() => import('./screens/calendar/CalendarScreen'));
const AdministrareScreen = lazy(
  () => import('./screens/administrare/AdministrareScreen'),
);
const GroupScreen = lazy(() => import('./screens/administrare/GroupScreen'));

/* Shown while the stored session is being read — a beat, not a screen. It
   matters that this is not a redirect: `loading` is true for a moment on every
   page load, and treating it as "signed out" would bounce a signed-in member to
   the login screen every single time they refresh. */
function Splash() {
  return (
    <SessionScreen centered>
      <SessionLoader label="Se încarcă" />
    </SessionScreen>
  );
}

function RouteLoader() {
  return (
    <div className="page">
      <SessionLoader label="Se încarcă pagina" />
    </div>
  );
}

function DeferredRoute({ children }: { children: ReactElement }) {
  return <Suspense fallback={<RouteLoader />}>{children}</Suspense>;
}

/**
 * The three session states, decided in one place (mini-spec §3).
 *
 * This is navigation, not security. Every redirect here is cosmetic: the
 * database returns nothing to a session without claims whatever the URL bar
 * says, so someone who types their way past a guard sees an empty app, never
 * somebody else's data. What the guard buys is that they see an explanation
 * instead of that emptiness.
 */
function RequireSession({ children }: { children: ReactElement }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Splash />;
  if (!session)
    return (
      <Navigate
        to={loginDestination(
          location.pathname + location.search + location.hash,
        )}
        replace
      />
    );
  return children;
}

function RequireMember({ children }: { children: ReactElement }) {
  const { session, claims, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Splash />;
  if (!session)
    return (
      <Navigate
        to={loginDestination(
          location.pathname + location.search + location.hash,
        )}
        replace
      />
    );
  if (!claims) return <Navigate to="/no-profile" replace />;
  return children;
}

/**
 * Waits for the one capability row (`my_capabilities()`), then admits or sends
 * home. Cosmetic: the server decides every read and command again.
 */
function RequireNamedCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactElement;
}) {
  const allowed = useCapability(capability);
  if (allowed.isPending) return null;
  return allowed.data === true ? (
    children
  ) : (
    <Navigate
      to="/"
      replace
      state={
        capability === 'seeLeadership' ? { leadershipDenied: true } : undefined
      }
    />
  );
}

/** Same idea one level in: a route the navigation never offers you. */
function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactElement;
}) {
  return (
    <RequireMember>
      <RequireNamedCapability capability={capability}>
        {children}
      </RequireNamedCapability>
    </RequireMember>
  );
}

/** Keeps a signed-in member off the front door. */
function FrontDoor({ children }: { children: ReactElement }) {
  const { session, claims, loading } = useAuth();

  if (loading) return <Splash />;
  if (session && claims) return <Navigate to={authDestination()} replace />;
  // Signed in without claims: /no-profile explains it and offers a way out.
  if (session) return <Navigate to="/no-profile" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <FrontDoor>
              <LoginScreen />
            </FrontDoor>
          }
        />

        {/* Deliberately unguarded: this route's whole job is to turn a link
              into a session, so it has to run before there is one. */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        <Route
          path="/no-profile"
          element={
            <RequireSession>
              <NoProfileScreen />
            </RequireSession>
          }
        />

        {/* Everything a member sees renders inside the shell. */}
        <Route
          element={
            <RequireMember>
              <AppShell />
            </RequireMember>
          }
        >
          <Route path="/" element={<DashboardScreen />} />
          <Route
            path="/tracker"
            element={
              <DeferredRoute>
                <TrackerScreen />
              </DeferredRoute>
            }
          />
          <Route
            path="/administrare/campanii"
            element={
              <RequireCapability capability="manageTasks">
                <CampaignsScreen />
              </RequireCapability>
            }
          />
          <Route
            path="/administrare/grupuri/:groupId/campanii"
            element={
              <RequireCapability capability="manageTasks">
                <CampaignsScreen />
              </RequireCapability>
            }
          />
          <Route
            path="/clasament"
            element={
              <RequireCapability capability="seeLeadership">
                <LeadershipScreen />
              </RequireCapability>
            }
          />
          <Route
            path="/tracker/membru/:id"
            element={
              <RequireCapability capability="seeLeadership">
                <MemberTrackerScreen />
              </RequireCapability>
            }
          />
          <Route
            path="/calendar"
            element={
              <DeferredRoute>
                <CalendarScreen />
              </DeferredRoute>
            }
          />
          <Route path="/cereri" element={<CompletedWorkRequestScreen />} />
          <Route path="/anunturi" element={<AnnouncementsScreen />} />
          <Route path="/notificari" element={<NotificationsScreen />} />
          <Route
            path="/voluntari"
            element={
              <RequireCapability capability="seeDirectory">
                <VolunteersScreen />
              </RequireCapability>
            }
          />
          <Route path="/profil" element={<ProfileScreen />} />
          <Route
            path="/administrare"
            element={
              <RequireCapability capability="administer">
                <DeferredRoute>
                  <AdministrareScreen />
                </DeferredRoute>
              </RequireCapability>
            }
          />
          <Route
            path="/administrare/grupuri/:groupId"
            element={
              <RequireCapability capability="administer">
                <DeferredRoute>
                  <GroupScreen />
                </DeferredRoute>
              </RequireCapability>
            }
          />
        </Route>

        {/* Unknown routes still return through the member guard. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
