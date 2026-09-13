import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { toAuthErrorMessage } from '../../lib/auth-error-message';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field';
import { SessionScreen } from '../../components/shell/SessionScreen';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/* There is no password field on this screen, and that is the product working as
   designed: accounts exist only by BC invitation and sign-in is passwordless
   (ADR-0003). Nobody generates, distributes, forgets or leaks a password. */
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (status === 'sent') sentHeadingRef.current?.focus();
  }, [status]);

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;

    setStatus('sending');
    let authError;
    try {
      ({ error: authError } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
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
    const code = authError.code ?? '';
    const anonymous =
      code === 'otp_disabled' ||
      code === 'signup_disabled' ||
      code === 'user_not_found' ||
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
          Dacă <strong>{email.trim().toLowerCase()}</strong> are cont în
          aplicație, ți-am trimis un link de conectare. Deschide-l de pe acest
          dispozitiv, dacă poți.
        </p>
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
          conectare — nu ai nevoie de parolă.
        </p>

        <Field data-invalid={status === 'error'}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <input
            id="email"
            className="min-h-11 rounded-lg border border-input bg-background px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
