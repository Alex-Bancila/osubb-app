import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { toAuthErrorMessage } from '../../lib/auth-error-message';
import { supabase } from '../../lib/supabase';
import { authDestination, loginDestination } from '../../lib/auth-destination';
import { useAuth } from '../../lib/auth';
import {
  SessionLoader,
  SessionScreen,
} from '../../components/shell/SessionScreen';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';

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
 * Where a link through Supabase's own verify endpoint lands. The client runs
 * the PKCE flow (`lib/supabase.ts`), so the session arrives as `?code=…`,
 * which this screen exchanges using the verifier stored when the link was
 * requested. A `#access_token=…` fragment (the implicit flow) is ignored: it
 * would sign the browser into whichever account the tokens belong to.
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
      <SessionScreen>
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
          Linkul nu a funcționat
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Linkurile de conectare expiră și pot fi folosite o singură dată. Cere
          unul nou și deschide-l imediat.
        </p>
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <Link
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
          to={loginDestination(authDestination())}
        >
          Înapoi la conectare
        </Link>
      </SessionScreen>
    );
  }

  /* Signed in. Where exactly they belong — the app or the "no profile" screen —
     is the guards' decision, not this screen's; the restored internal route still passes through those guards. */
  if (!loading && session) return <Navigate to={authDestination()} replace />;

  return (
    <SessionScreen centered>
      <SessionLoader label="Te conectăm…" />
    </SessionScreen>
  );
}
