import { lazy, Suspense, type ReactElement } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router';
import { useAuth } from './lib/auth';
import {
  authDestination,
  loginDestination,
  loginEmailFrom,
} from './lib/auth-destination';
import { useCapabilities, type Capability } from './lib/capabilities';
import { useKeyboardInset } from './lib/keyboard-inset';
import {
  NOTIFICATION_PARAM,
  openedNotificationId,
} from './lib/notification-param';
import {
  administrareTab,
  type AdministrareTabPath,
} from './screens/administrare/administrare-tabs';
import LeadershipScreen from './screens/leadership/LeadershipScreen';
import MemberTrackerScreen from './screens/leadership/MemberTrackerScreen';
import AppShell from './components/shell/AppShell';
import LoginScreen from './screens/login/LoginScreen';
import AuthCallback from './screens/login/AuthCallback';
import AuthConfirm from './screens/login/AuthConfirm';
import NoProfileScreen from './screens/no-profile/NoProfileScreen';
import CampaignsScreen from './screens/campaigns/CampaignsScreen';
import VolunteersScreen from './screens/volunteers/VolunteersScreen';
import DashboardScreen from './screens/dashboard/DashboardScreen';
import AnnouncementsScreen from './screens/announcements/AnnouncementsScreen';
import NotificationsScreen from './screens/notifications/NotificationsScreen';
import ProfileScreen from './screens/profile/ProfileScreen';
import PrivacyNoticeScreen from './screens/privacy/PrivacyNoticeScreen';
import { PrivacyGate } from './components/shell/PrivacyGate';
import { AccountConfirmGate } from './components/shell/AccountConfirmGate';
import { SessionLoader, SessionScreen } from './components/shell/SessionScreen';
import { Loading } from './components/states';

const GroupsScreen = lazy(() => import('./screens/groups/GroupsScreen'));
const MemberGroupScreen = lazy(
  () => import('./screens/groups/MemberGroupScreen'),
);
const TrackerScreen = lazy(() => import('./screens/tracker/TrackerScreen'));
const CalendarScreen = lazy(() => import('./screens/calendar/CalendarScreen'));
const AdministrareLayout = lazy(
  () => import('./screens/administrare/AdministrareLayout'),
);
const AdminMembersTab = lazy(
  () => import('./screens/administrare/AdminMembersTab'),
);
const AdminGroupsTab = lazy(
  () => import('./screens/administrare/AdminGroupsTab'),
);
const AdminRolesTab = lazy(() =>
  import('./screens/administrare/RolePanel').then((module) => ({
    default: module.RolePanel,
  })),
);
const AdminApplicationsTab = lazy(
  () => import('./screens/administrare/AdminApplicationsTab'),
);
const RoleEvaluationsScreen = lazy(
  () => import('./screens/administrare/RoleEvaluationsScreen'),
);
const AdminPrivacyTab = lazy(() =>
  import('./screens/administrare/PrivacyPanel').then((module) => ({
    default: module.PrivacyPanel,
  })),
);
const AdminSettingsTab = lazy(
  () => import('./screens/administrare/AdminSettingsTab'),
);
const AdminDealsTab = lazy(() => import('./screens/deals/DealsAdminTab'));
const AdminBcTab = lazy(() => import('./screens/administrare/AdminBcTab'));
const MemberScreen = lazy(() => import('./screens/administrare/MemberScreen'));
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
 * Where a guard sends a visitor without a session: back to this page after
 * sign-in, unless the Member just signed out here — then a bare `/login`, so
 * the next account on the device starts on Acasă (#844, D25).
 */
function SignInRedirect() {
  const { signedOut } = useAuth();
  const location = useLocation();
  return (
    <Navigate
      to={
        signedOut
          ? '/login'
          : loginDestination(
              location.pathname + location.search + location.hash,
            )
      }
      replace
    />
  );
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

  if (loading) return <Splash />;
  if (!session) return <SignInRedirect />;
  return <AccountConfirmGate session={session}>{children}</AccountConfirmGate>;
}

function RequireMember({ children }: { children: ReactElement }) {
  const { session, claims, loading } = useAuth();

  if (loading) return <Splash />;
  if (!session) return <SignInRedirect />;
  if (!claims) return <Navigate to="/no-profile" replace />;
  return <AccountConfirmGate session={session}>{children}</AccountConfirmGate>;
}

/** One capability, or any one of several. */
type CapabilityGate = Capability | readonly Capability[];

/**
 * Waits for the one capability row (`my_capabilities()`), then admits or sends
 * home. Cosmetic: the server decides every read and command again.
 */
function RequireNamedCapability({
  capability,
  children,
}: {
  capability: CapabilityGate;
  children: ReactElement;
}) {
  const names: readonly Capability[] =
    typeof capability === 'string' ? [capability] : capability;
  const allowed = useCapabilities((row) =>
    names.some((name) => row[name] === true),
  );
  if (allowed.isPending) return null;
  return allowed.data === true ? (
    children
  ) : (
    <Navigate
      to="/"
      replace
      // The shell says why the Member is on Acasă (#844, D21); Clasament keeps
      // its own, more specific line.
      state={
        capability === 'seeLeadership'
          ? { leadershipDenied: true }
          : { denied: true }
      }
    />
  );
}

/** Same idea one level in: a route the navigation never offers you. */
function RequireCapability({
  capability,
  children,
}: {
  capability: CapabilityGate;
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

/**
 * One Administrare tab's page, behind the capabilities its tab is shown for
 * (`administrare-tabs.ts`), so the tab bar and the guard read one list.
 */
function AdministrareTabRoute({
  path,
  children,
}: {
  path: AdministrareTabPath;
  children: ReactElement;
}) {
  return (
    <RequireCapability capability={administrareTab(path).capabilities}>
      {/* Inside the area's frame: a plain loader, not a second page frame. */}
      <Suspense fallback={<Loading label="Se încarcă pagina" />}>
        {children}
      </Suspense>
    </RequireCapability>
  );
}

/** The login screen, prefilled when `/auth/confirm` sent the Member back. */
function LoginRoute() {
  const { state } = useLocation();
  return <LoginScreen initialEmail={loginEmailFrom(state)} />;
}

/**
 * Task links sent before #843 carried `/tracker/<id>`, which no route ever
 * answered. Pushes and emails already delivered still do, so a numeric id opens
 * the Task the way every link now does; anything else is an unknown route.
 * Unguarded on purpose: the Tracker route it forwards to is guarded, so a
 * signed-out Member keeps `/tracker?task=<id>` through sign-in. The id of the
 * Notification a push tap opened (#1012) travels with it, so the shell can
 * still mark that Notification read.
 */
function TaskAlias() {
  const { taskId = '' } = useParams();
  const { search } = useLocation();
  const opened = openedNotificationId(search);
  const carried = opened === null ? '' : `&${NOTIFICATION_PARAM}=${opened}`;
  return (
    <Navigate
      to={/^[0-9]+$/.test(taskId) ? `/tracker?task=${taskId}${carried}` : '/'}
      replace
    />
  );
}

/**
 * One Group page per Group: keyed by the id, so moving to another Group (the
 * breadcrumb, a child Group) starts on its default tab with no message carried
 * over from the previous one (#844, D18).
 */
function GroupRoute() {
  const { groupId } = useParams();
  return <GroupScreen key={groupId} />;
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
  // Every screen, the sign-in included, keeps its fields and actions above a
  // phone keyboard (#1013).
  useKeyboardInset();
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <FrontDoor>
              <LoginRoute />
            </FrontDoor>
          }
        />

        {/* Deliberately unguarded: this route's whole job is to turn a link
              into a session, so it has to run before there is one. */}
        <Route path="/auth/callback" element={<AuthCallback />} />
        {/* Same reason, and nothing happens here until the Member taps: a
              mail scanner fetching the link must not spend it (#768). */}
        <Route path="/auth/confirm" element={<AuthConfirm />} />

        {/* Public: the login screen links here before there is a session,
              and Profil after (#771). It reads nothing. */}
        <Route path="/confidentialitate" element={<PrivacyNoticeScreen />} />

        {/* Task links sent before #843 (D1). `/tracker/membru/:id` still
              wins: a static segment outranks a parameter. */}
        <Route path="/tracker/:taskId" element={<TaskAlias />} />

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
              <PrivacyGate>
                <AppShell />
              </PrivacyGate>
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
          <Route
            path="/grupuri"
            element={
              <DeferredRoute>
                <GroupsScreen />
              </DeferredRoute>
            }
          />
          <Route
            path="/grupuri/:groupId"
            element={
              <DeferredRoute>
                <MemberGroupScreen />
              </DeferredRoute>
            }
          />
          {/* Cereri is a view of Taskuri (#973). Notifications and saved
                sign-in destinations still name `/cereri`: forward them. */}
          <Route
            path="/cereri"
            element={<Navigate to="/tracker?vedere=cereri" replace />}
          />
          <Route path="/anunturi" element={<AnnouncementsScreen />} />
          {/* OSUBB Deals, the second tab of Anunțuri (R45); `?deal=<id>`
                opens one, as "Deal nou" notifications link. */}
          <Route path="/anunturi/deals" element={<AnnouncementsScreen />} />
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
          {/* Administrare: routed tabs under one header (ruling R27, #825).
                The layout lands /administrare on the first tab the viewer may
                open; each tab is gated again on its own capability. */}
          <Route
            path="/administrare"
            element={
              <RequireCapability capability="administer">
                <DeferredRoute>
                  <AdministrareLayout />
                </DeferredRoute>
              </RequireCapability>
            }
          >
            <Route
              path="membri"
              element={
                <AdministrareTabRoute path="/administrare/membri">
                  <AdminMembersTab />
                </AdministrareTabRoute>
              }
            />
            <Route
              path="grupuri"
              element={
                <AdministrareTabRoute path="/administrare/grupuri">
                  <AdminGroupsTab />
                </AdministrareTabRoute>
              }
            />
            <Route
              path="roluri"
              element={
                <AdministrareTabRoute path="/administrare/roluri">
                  <AdminRolesTab />
                </AdministrareTabRoute>
              }
            />
            <Route
              path="cereri"
              element={
                <AdministrareTabRoute path="/administrare/cereri">
                  <AdminApplicationsTab />
                </AdministrareTabRoute>
              }
            />
            <Route
              path="evaluari"
              element={
                <AdministrareTabRoute path="/administrare/evaluari">
                  <RoleEvaluationsScreen />
                </AdministrareTabRoute>
              }
            />
            {/* Ruling R28 renamed the tab; old links still arrive. */}
            <Route
              path="perioade"
              element={<Navigate to="/administrare/evaluari" replace />}
            />
            <Route
              path="confidentialitate"
              element={
                <AdministrareTabRoute path="/administrare/confidentialitate">
                  <AdminPrivacyTab />
                </AdministrareTabRoute>
              }
            />
            <Route
              path="setari"
              element={
                <AdministrareTabRoute path="/administrare/setari">
                  <AdminSettingsTab />
                </AdministrareTabRoute>
              }
            />
            <Route
              path="deals"
              element={
                <AdministrareTabRoute path="/administrare/deals">
                  <AdminDealsTab />
                </AdministrareTabRoute>
              }
            />
            <Route
              path="bc"
              element={
                <AdministrareTabRoute path="/administrare/bc">
                  <AdminBcTab />
                </AdministrareTabRoute>
              }
            />
          </Route>
          {/* A Group Role or BC+ (`managesAnyGroup`): `administer` also
                admits the OSUBB Deals team (R44), who manage no Group. */}
          <Route
            path="/administrare/membri/:memberId"
            element={
              <RequireCapability capability="managesAnyGroup">
                <DeferredRoute>
                  <MemberScreen />
                </DeferredRoute>
              </RequireCapability>
            }
          />
          <Route
            path="/administrare/grupuri/:groupId"
            element={
              <RequireCapability capability="managesAnyGroup">
                <DeferredRoute>
                  <GroupRoute />
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
