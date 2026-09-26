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
  | { kind: 'error'; message: string }
  /* An email change confirmed at one address of two (`double_confirm_changes`):
     GoTrue accepts the link but returns no session until the other one is used. */
  | { kind: 'half-confirmed' }
  | { kind: 'signed-in' };

/**
 * Where an emailed link lands (ruling L7, #768). Nothing happens on load: a
 * mail scanner that fetches this URL — Microsoft 365 does, for every
 * `stud.ubbcluj.ro` address — gets a page with a button and spends nothing.
 * Only the Member's tap calls `verifyOtp` with the token hash, so the link and
 * the six-digit code in the same email stay valid until then.
 *
 * `/auth/callback` still handles `?code=` and `#access_token=` for any link
 * that goes through Supabase's own verify endpoint.
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

  async function confirm() {
    if (!link) return;
    setStatus({ kind: 'verifying' });
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: link.tokenHash,
        type: link.type,
      });
      if (error) {
        if (import.meta.env.DEV) {
          console.error('Supabase Auth link confirmation failed', error);
        }
        setStatus({ kind: 'error', message: toAuthErrorMessage(error) });
        return;
      }
      setStatus(
        data.session ? { kind: 'signed-in' } : { kind: 'half-confirmed' },
      );
    } catch (failure) {
      if (import.meta.env.DEV) {
        console.error('Supabase Auth link confirmation failed', failure);
      }
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
  const handoff: LoginHandoff | undefined = link?.email
    ? { email: link.email }
    : undefined;

  return (
    <SessionScreen>
      <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
        Conectare la aplicația OSUBB
      </h1>
      {link?.email && (
        <p className="leading-relaxed">
          Te conectezi ca <strong>{link.email}</strong>.
        </p>
      )}
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
