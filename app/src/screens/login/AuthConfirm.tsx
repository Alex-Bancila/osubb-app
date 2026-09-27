import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { LoaderCircle } from 'lucide-react';
import type { EmailOtpType } from '@supabase/supabase-js';
import { toAuthErrorMessage } from '../../lib/auth-error-message';
import { supabase } from '../../lib/supabase';
import {
  confirmDestination,
  loginDestination,
  type LoginHandoff,
} from '../../lib/auth-destination';
import { useAuth } from '../../lib/auth';
import {
  ANY_ACCOUNT,
  clearAccountPending,
  forgetSignInRequest,
  markAccountPending,
  requestedSignInFor,
} from '../../lib/sign-in-request';
import { ConfirmAccountScreen } from '../../components/shell/ConfirmAccountScreen';
import { Button, buttonVariants } from '../../components/ui/button';
import {
  SessionLoader,
  SessionScreen,
} from '../../components/shell/SessionScreen';
import { cn } from '../../lib/utils';

const LINK_TYPES = new Set<EmailOtpType>([
  'invite',
  'magiclink',
  'email',
  'email_change',
  'recovery',
]);

type ConfirmLink = {
  tokenHash: string;
  type: EmailOtpType;
  email: string;
};

const MISMATCH_MESSAGE = 'Linkul nu corespunde adresei tale.';

const normalize = (email: string) => email.trim().toLowerCase();

/**
 * What a verified session means for a link, before the Member is let in.
 *
 *   'mismatch' — the link names an address and signed in another one.
 *   'ask'      — nothing ties the account to this browser: no request for it
 *                was made here (an invitation, another device, or a link
 *                someone else sent). The verified address is shown first.
 *   'ok'       — this browser asked for exactly that address.
 *
 * An email change is not compared: its link carries the old address while the
 * session ends on the new one, and only a signed-in Member can start one.
 */
function checkAccount(
  link: ConfirmLink,
  verified: string,
): 'ok' | 'ask' | 'mismatch' {
  if (link.type === 'email_change') return 'ok';
  if (link.email && normalize(verified) !== normalize(link.email))
    return 'mismatch';
  return requestedSignInFor(verified) ? 'ok' : 'ask';
}

/** Reads the emailed link. `null` when it is not one we can verify. */
function linkFromUrl(): ConfirmLink | null {
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get('token_hash')?.trim() ?? '';
  const type = params.get('type') ?? '';
  if (!tokenHash || !LINK_TYPES.has(type)) return null;
  return { tokenHash, type, email: params.get('email')?.trim() ?? '' };
}

type Status =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string; mismatch?: boolean }
  /* An email change confirmed at one address of two (`double_confirm_changes`):
     GoTrue accepts the link but returns no session until the other one is used. */
  | { kind: 'half-confirmed' }
  /* Signed in, but not by a request from this browser: the verified address
     is shown and the Member confirms it is theirs before going in. */
  | { kind: 'confirm-account'; email: string }
  | { kind: 'signed-in' };

/**
 * Where an emailed link lands (ruling L7, #768). Nothing happens on load: a
 * mail scanner that fetches this URL — Microsoft 365 does, for every
 * `stud.ubbcluj.ro` address — gets a page with a button and spends nothing.
 * Only the Member's tap calls `verifyOtp` with the token hash, so the link and
 * the six-digit code in the same email stay valid until then.
 *
 * `/auth/callback` still handles `?code=` (PKCE) for any link that goes
 * through Supabase's own verify endpoint.
 *
 * The address in the link is never shown: it is text anyone can put in a URL.
 * After `verifyOtp`, a link that names another address than the one it signed
 * in is refused, and a link this browser did not ask for shows the verified
 * address and waits for the Member to confirm it (`checkAccount`). Someone
 * sending a Member a link to their own account (login CSRF) is caught either
 * way: the session is dropped on this device and the page says so.
 */
export default function AuthConfirm() {
  const { session, loading } = useAuth();
  const [link] = useState(linkFromUrl);
  const [destination] = useState(confirmDestination);
  const [status, setStatus] = useState<Status>(() =>
    link
      ? { kind: 'idle' }
      : {
          kind: 'error',
          message: toAuthErrorMessage({ code: 'invalid_link' }),
        },
  );

  function enter() {
    forgetSignInRequest();
    clearAccountPending();
    setStatus({ kind: 'signed-in' });
  }

  /** Drops the session on this device, and says so only once it is gone. */
  async function refuse() {
    let failure: unknown = null;
    try {
      ({ error: failure } = await supabase.auth.signOut({ scope: 'local' }));
    } catch (thrown) {
      failure = thrown;
    }
    // Every guarded route stays held while the session could not be dropped.
    if (!failure) clearAccountPending();
    setStatus({
      kind: 'error',
      message: failure ? toAuthErrorMessage(failure) : MISMATCH_MESSAGE,
      mismatch: true,
    });
  }

  async function confirm() {
    if (!link) return;
    setStatus({ kind: 'verifying' });
    // Hold every tab's guarded routes until this link's account is settled.
    markAccountPending(ANY_ACCOUNT);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: link.tokenHash,
        type: link.type,
      });
      if (error) {
        if (import.meta.env.DEV) {
          console.error('Supabase Auth link confirmation failed', error);
        }
        clearAccountPending();
        setStatus({ kind: 'error', message: toAuthErrorMessage(error) });
        return;
      }
      if (!data.session) {
        clearAccountPending();
        setStatus({ kind: 'half-confirmed' });
        return;
      }
      const email = data.session.user.email ?? '';
      const check = checkAccount(link, email);
      if (check === 'mismatch') await refuse();
      else if (check === 'ask') {
        markAccountPending(data.session.user.id);
        setStatus({ kind: 'confirm-account', email });
      } else enter();
    } catch (failure) {
      if (import.meta.env.DEV) {
        console.error('Supabase Auth link confirmation failed', failure);
      }
      clearAccountPending();
      setStatus({ kind: 'error', message: toAuthErrorMessage(failure) });
    }
  }

  /* Signed in. Where exactly they belong — the app or the "no profile" screen —
     is the guards' decision, not this screen's. An existing session alone is
     not enough: a signed-in Member confirming an email change must still tap. */
  if (status.kind === 'signed-in') {
    if (!loading && session) return <Navigate to={destination} replace />;
    return (
      <SessionScreen centered>
        <SessionLoader label="Te conectăm…" />
      </SessionScreen>
    );
  }

  if (status.kind === 'confirm-account') {
    return (
      <ConfirmAccountScreen
        email={status.email}
        onContinue={enter}
        onRefuse={() => void refuse()}
      />
    );
  }

  if (status.kind === 'half-confirmed') {
    return (
      <SessionScreen>
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
          Adresă confirmată
        </h1>
        <p className="text-sm leading-relaxed">
          Mai deschide și linkul trimis pe cealaltă adresă ca să termini
          schimbarea emailului.
        </p>
        <Link
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
          to={destination}
        >
          Mergi în aplicație
        </Link>
      </SessionScreen>
    );
  }

  const verifying = status.kind === 'verifying';
  // The link's address only pre-fills the login form, and not after a
  // mismatch: then it is not this Member's address at all.
  const handoff: LoginHandoff | undefined =
    link?.email && !(status.kind === 'error' && status.mismatch)
      ? { email: link.email }
      : undefined;

  return (
    <SessionScreen>
      <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
        Conectare la aplicația OSUBB
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Apasă butonul ca să intri în aplicație pe acest dispozitiv. Linkul se
        folosește o singură dată.
      </p>

      {link && (
        <Button
          type="button"
          className="w-full"
          disabled={verifying}
          onClick={() => void confirm()}
        >
          {verifying && (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {verifying ? 'Te conectăm…' : 'Conectează-mă'}
        </Button>
      )}

      {status.kind === 'error' && (
        <>
          <p className="text-sm text-destructive" role="alert">
            {status.message}
          </p>
          <Link
            className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
            to={loginDestination(destination)}
            state={handoff}
          >
            Trimite alt link
          </Link>
        </>
      )}
    </SessionScreen>
  );
}
