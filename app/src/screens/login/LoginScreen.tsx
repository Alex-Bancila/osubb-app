import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { toAuthErrorMessage } from '../../lib/auth-error-message';
import { authCallbackUrl } from '../../lib/auth-destination';
import { normalizeEmail } from '../../lib/normalize';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field';
import { SessionScreen } from '../../components/shell/SessionScreen';

type Status = 'idle' | 'sending' | 'sent' | 'error';
type CodeStatus = 'idle' | 'verifying' | 'error';

const inputClassName =
  'min-h-11 rounded-lg border border-input bg-background px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/* There is no password field on this screen, and that is the product working as
   designed: accounts exist only by BC invitation and sign-in is passwordless
   (ADR-0003). Nobody generates, distributes, forgets or leaks a password. */
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('idle');
  const [codeError, setCodeError] = useState('');
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  const address = normalizeEmail(email);

  useEffect(() => {
    if (status === 'sent') sentHeadingRef.current?.focus();
  }, [status]);

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    if (!address) return;

    setStatus('sending');
    let authError;
    try {
      ({ error: authError } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: authCallbackUrl(),
          // Belt and braces: sign-up is already disabled server-side, but saying
          // so here means this screen can never become an account-creation path
          // by a change of configuration somewhere else.
          shouldCreateUser: false,
        },
      }));
    } catch (failure) {
      if (import.meta.env.DEV) {
        console.error('Supabase Auth link request failed', failure);
      }
      setError(toAuthErrorMessage(failure));
      setStatus('error');
      return;
    }

    if (!authError) {
      setStatus('sent');
      return;
    }

    /* An address with no account fails here, and we deliberately do NOT say so.
       This screen is reachable by anyone, and answering "that address has no
       account" turns it into a way to find out who is a member. The confirmation
       below is worded so a member who mistyped still knows what to do. Real
       faults — rate limiting, the mail provider being down — are shown honestly,
       because those are not about who exists. */
    const failureCode = authError.code ?? '';
    const anonymous =
      failureCode === 'otp_disabled' ||
      failureCode === 'signup_disabled' ||
      failureCode === 'user_not_found' ||
      /signups not allowed|not found/i.test(authError.message);

    if (anonymous) {
      setStatus('sent');
      return;
    }

    if (import.meta.env.DEV) {
      console.error('Supabase Auth link request failed', authError);
    }
    setError(toAuthErrorMessage(authError));
    setStatus('error');
  }

  /* The second half of the same one-time password. Supabase puts a link and a
     six-digit code in one email — same OTP, same expiry — so typing the code
     here is not another way in, it is the same way in for a browser the link
     cannot reach. An installed PWA on iOS has its own storage, separate from
     Safari: tapping the link in Mail signs the member into Safari and leaves the
     app they installed sitting on this screen. A link opened on a second device
     fails the same way. Nothing about invite-only changes — an address with no
     `profiles` row still comes back without organization claims. */
  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    const token = code.trim();
    if (token.length !== 6) return;

    setCodeStatus('verifying');
    let authError;
    try {
      ({ error: authError } = await supabase.auth.verifyOtp({
        email: address,
        token,
        type: 'email',
      }));
    } catch (failure) {
      if (import.meta.env.DEV) {
        console.error('Supabase Auth code verification failed', failure);
      }
      setCodeError(toAuthErrorMessage(failure));
      setCodeStatus('error');
      return;
    }

    /* Success deliberately leaves the spinner running: `verifyOtp` stores the
       session, the provider's auth listener picks it up, and the front-door
       guard replaces this screen with the saved destination. Clearing the state
       here would only flash an idle form on its way out. */
    if (!authError) return;

    if (import.meta.env.DEV) {
      console.error('Supabase Auth code verification failed', authError);
    }
    setCodeError(toAuthErrorMessage(authError));
    setCodeStatus('error');
  }

  if (status === 'sent') {
    return (
      <SessionScreen>
        <h1
          ref={sentHeadingRef}
          tabIndex={-1}
          className="text-2xl leading-tight font-extrabold tracking-tight outline-none"
        >
          Verifică-ți emailul
        </h1>
        <p className="leading-relaxed">
          Dacă <strong>{address}</strong> are cont în aplicație, ți-am trimis un
          email cu un link de conectare și un cod de 6 cifre.
        </p>

        <form className="flex flex-col gap-4" onSubmit={verifyCode}>
          <p className="text-sm leading-relaxed">
            Apasă linkul din email sau introdu codul de 6 cifre.
          </p>

          <Field data-invalid={codeStatus === 'error'}>
            <FieldLabel htmlFor="code">Cod de 6 cifre</FieldLabel>
            <input
              id="code"
              className={inputClassName}
              type="text"
              inputMode="numeric"
              // iOS and Android offer the code straight from the message; on a
              // home-screen PWA this is the whole point of the second step.
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              value={code}
              aria-invalid={codeStatus === 'error'}
              aria-describedby={
                codeStatus === 'error' ? 'code-help code-error' : 'code-help'
              }
              onChange={(event) =>
                setCode(
                  event.currentTarget.value.replace(/\D/g, '').slice(0, 6),
                )
              }
            />
            <FieldDescription id="code-help">
              Codul e în același email cu linkul și expiră odată cu el.
            </FieldDescription>
          </Field>

          {codeStatus === 'error' && (
            <p
              id="code-error"
              className="text-sm text-destructive"
              role="alert"
            >
              {codeError}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={codeStatus === 'verifying' || code.length !== 6}
          >
            {codeStatus === 'verifying' && (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {codeStatus === 'verifying' ? 'Te conectăm…' : 'Conectează-mă'}
          </Button>
        </form>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Nu a ajuns nimic în câteva minute? Verifică folderul de spam și adresa
          scrisă mai sus. Dacă e corectă și tot nu primești nimic, contactează
          BC — poate contul nu a fost încă creat.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setStatus('idle');
            setError('');
            setCode('');
            setCodeStatus('idle');
            setCodeError('');
          }}
        >
          Încearcă altă adresă
        </Button>
      </SessionScreen>
    );
  }

  return (
    <SessionScreen>
      <form className="flex flex-col gap-4" onSubmit={requestLink}>
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
          Aplicația OSUBB
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Scrie adresa de email cu care ai fost invitat. Îți trimitem un link de
          conectare și un cod — nu ai nevoie de parolă.
        </p>

        <Field data-invalid={status === 'error'}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <input
            id="email"
            className={inputClassName}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="prenume.nume@exemplu.ro"
            value={email}
            aria-invalid={status === 'error'}
            aria-describedby={
              status === 'error' ? 'email-help login-error' : 'email-help'
            }
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <FieldDescription id="email-help">
            Folosește adresa la care ai primit invitația.
          </FieldDescription>
        </Field>

        {status === 'error' && (
          <p id="login-error" className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={status === 'sending' || email.trim() === ''}
        >
          {status === 'sending' && (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {status === 'sending' ? 'Se trimite…' : 'Trimite linkul'}
        </Button>
      </form>
    </SessionScreen>
  );
}
