import type { ReactElement } from 'react';
import { IonApp, IonContent, IonPage, IonSpinner } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { can, type Capability } from './lib/capabilities';
import AppShell from './components/shell/AppShell';
import LoginScreen from './screens/login/LoginScreen';
import AuthCallback from './screens/login/AuthCallback';
import NoProfileScreen from './screens/no-profile/NoProfileScreen';
import Placeholder from './screens/Placeholder';

/* Shown while the stored session is being read — a beat, not a screen. It
   matters that this is not a redirect: `loading` is true for a moment on every
   page load, and treating it as "signed out" would bounce a signed-in member to
   the login screen every single time they refresh. */
function Splash() {
  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div className="auth-card auth-card--centered">
          <IonSpinner aria-label="Se încarcă" />
        </div>
      </IonContent>
    </IonPage>
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
function RequireMember({ children }: { children: ReactElement }) {
  const { session, claims, loading } = useAuth();

  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  if (!claims) return <Navigate to="/no-profile" replace />;
  return children;
}

/** Same idea one level in: a route the navigation never offers you. */
function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactElement;
}) {
  const { claims } = useAuth();
  return can(claims, capability) ? children : <Navigate to="/" replace />;
}

/** Keeps a signed-in member off the front door. */
function FrontDoor({ children }: { children: ReactElement }) {
  const { session, claims, loading } = useAuth();

  if (loading) return <Splash />;
  if (session && claims) return <Navigate to="/" replace />;
  // Signed in without claims: /no-profile explains it and offers a way out.
  if (session) return <Navigate to="/no-profile" replace />;
  return children;
}

export default function App() {
  return (
    <IonApp>
      {/* Opting into both v7 behaviours now: it silences the deprecation
          warnings React Router otherwise prints on every page load — a console
          that always has warnings in it is a console nobody reads — and it
          means the eventual v7/v8 upgrade is a version bump rather than a
          behaviour change. */}
      <IonReactRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
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

          <Route path="/no-profile" element={<NoProfileScreen />} />

          {/* Everything a member sees renders inside the shell. */}
          <Route
            element={
              <RequireMember>
                <AppShell />
              </RequireMember>
            }
          >
            <Route
              path="/"
              element={<Placeholder title="Acasă" issue="#93–#95" />}
            />
            <Route
              path="/tracker"
              element={<Placeholder title="Taskuri" issue="#88–#92" />}
            />
            <Route
              path="/calendar"
              element={<Placeholder title="Calendar" issue="#96–#98" />}
            />
            <Route
              path="/anunturi"
              element={<Placeholder title="Anunțuri" issue="#99–#101" />}
            />
            <Route
              path="/voluntari"
              element={
                <RequireCapability capability="seeDirectory">
                  <Placeholder title="Voluntari" issue="#102–#103" />
                </RequireCapability>
              }
            />
            <Route
              path="/profil"
              element={<Placeholder title="Profil" issue="#108" />}
            />
            <Route
              path="/bc"
              element={
                <RequireCapability capability="manageRoles">
                  <Placeholder title="Panou BC" issue="#104–#107" />
                </RequireCapability>
              }
            />
          </Route>

          {/* Anything unknown goes home and lets the guard sort it out. Note
              there is no "return to the page you wanted" here, on purpose: a
              magic link leaves the app entirely and comes back in a new tab, so
              the intent would not survive the trip anyway — and carrying no
              destination in the URL means this app has no redirect target for
              anyone to aim somewhere else. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </IonReactRouter>
    </IonApp>
  );
}
