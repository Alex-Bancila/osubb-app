import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { IonContent, IonPage, IonSpinner } from '@ionic/react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';

/* The failures a member can actually cause, said in the language the rest of
   the app speaks. Anything unmapped falls through to GoTrue's own wording,
   which is English but at least specific — better than swallowing a cause we
   have not seen before. */
const REASONS: Record<string, string> = {
  otp_expired:
    'Linkul a expirat sau a fost deja folosit. Cere unul nou mai jos.',
  access_denied: 'Linkul nu mai este valabil.',
  otp_disabled: 'Conectarea prin link nu este disponibilă pentru acest cont.',
};

/** Reads the failure GoTrue reports, whichever half of the URL it used. */
function errorFromUrl(): string | null {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const pick = (key: string) =>
    url.searchParams.get(key) ?? hash.get(key) ?? null;

  const code = pick('error_code') ?? pick('error');
  if (code && REASONS[code]) return REASONS[code];

  const description = pick('error_description') ?? code;
  return description ? description.replace(/\+/g, ' ') : null;
}

/**
 * Where a magic link lands. Supabase hands the session over in one of two
 * shapes and we accept both, because which one is in play depends on the
 * client's flow type and is not worth coupling this screen to:
 *
 *   PKCE     → `?code=…`, which we exchange for a session here.
 *   implicit → `#access_token=…`, which the client already picked up on its own
 *              (detectSessionInUrl), so there is nothing to do but wait for it.
 */
export default function AuthCallback() {
  const { session, loading } = useAuth();

  // The URL is already here on the first render, so a failure GoTrue reported
  // is initial state — not something to discover in an effect.
  const [urlError] = useState(errorFromUrl);
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const error = urlError ?? exchangeError;

  useEffect(() => {
    if (urlError) return;

    const code = new URL(window.location.href).searchParams.get('code');
    if (!code) return;

    void supabase.auth.exchangeCodeForSession(code).then(({ error: e }) => {
      if (e) setExchangeError(e.message);
    });
  }, [urlError]);

  if (error) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <div className="auth-card">
            <h1>Linkul nu a funcționat</h1>
            <p className="muted">
              Linkurile de conectare expiră și pot fi folosite o singură dată.
              Cere unul nou și deschide-l imediat.
            </p>
            <p className="auth-error">{error}</p>
            <Link to="/login">Înapoi la conectare</Link>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  /* Signed in. Where exactly they belong — the app or the "no profile" screen —
     is the guards' decision, not this screen's; sending everyone to "/" lets
     that one rule live in one place. */
  if (!loading && session) return <Navigate to="/" replace />;

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div className="auth-card auth-card--centered">
          <IonSpinner aria-label="Se conectează" />
          <p className="muted">Te conectăm…</p>
        </div>
      </IonContent>
    </IonPage>
  );
}
