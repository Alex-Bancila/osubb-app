import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { IonContent, IonPage, IonSpinner } from '@ionic/react';
import { toAuthErrorMessage } from '../../lib/auth-error-message';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';

/** Reads the failure GoTrue reports, whichever half of the URL it used. */
function errorFromUrl(): { code?: string; message?: string } | null {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const pick = (key: string) =>
    url.searchParams.get(key) ?? hash.get(key) ?? null;

  const code = pick('error_code') ?? pick('error');
  const description = pick('error_description') ?? code;
  if (!code && !description) return null;

  return {
    code: code ?? undefined,
    message: description?.replace(/\+/g, ' '),
  };
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
  const [urlFailure] = useState(errorFromUrl);
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const error = urlFailure ? toAuthErrorMessage(urlFailure) : exchangeError;

  useEffect(() => {
    if (urlFailure) {
      if (import.meta.env.DEV) {
        console.error('Supabase Auth callback URL failure', urlFailure);
      }
      return;
    }

    const code = new URL(window.location.href).searchParams.get('code');
    if (!code) return;

    void (async () => {
      try {
        const { error: failure } =
          await supabase.auth.exchangeCodeForSession(code);
        if (!failure) return;

        if (import.meta.env.DEV) {
          console.error('Supabase Auth callback exchange failed', failure);
        }
        setExchangeError(toAuthErrorMessage(failure));
      } catch (failure) {
        if (import.meta.env.DEV) {
          console.error('Supabase Auth callback exchange failed', failure);
        }
        setExchangeError(toAuthErrorMessage(failure));
      }
    })();
  }, [urlFailure]);

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
