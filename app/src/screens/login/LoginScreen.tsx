import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  IonButton,
  IonContent,
  IonInput,
  IonPage,
  IonSpinner,
} from '@ionic/react';
import { toAuthErrorMessage } from '../../lib/auth-error-message';
import { supabase } from '../../lib/supabase';

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
      <IonPage>
        <IonContent className="ion-padding">
          <div className="auth-card">
            <h1 ref={sentHeadingRef} tabIndex={-1}>
              Verifică-ți emailul
            </h1>
            <p>
              Dacă <strong>{email.trim().toLowerCase()}</strong> are cont în
              aplicație, ți-am trimis un link de conectare. Deschide-l de pe
              acest dispozitiv, dacă poți.
            </p>
            <p className="muted">
              Nu a ajuns nimic în câteva minute? Verifică folderul de spam și
              adresa scrisă mai sus. Dacă e corectă și tot nu primești nimic,
              contactează BC — poate contul nu a fost încă creat.
            </p>
            <IonButton
              fill="clear"
              onClick={() => {
                setStatus('idle');
                setError('');
              }}
            >
              Încearcă altă adresă
            </IonButton>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <form className="auth-card" onSubmit={requestLink}>
          <h1>Aplicația OSUBB</h1>
          <p className="muted">
            Scrie adresa de email cu care ai fost invitat. Îți trimitem un link
            de conectare — nu ai nevoie de parolă.
          </p>

          <IonInput
            label="Email"
            labelPlacement="stacked"
            type="email"
            inputmode="email"
            autocomplete="email"
            required
            fill="outline"
            placeholder="prenume.nume@exemplu.ro"
            value={email}
            onIonInput={(e) => setEmail(e.detail.value ?? '')}
          />

          {status === 'error' && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <IonButton
            type="submit"
            expand="block"
            disabled={status === 'sending' || email.trim() === ''}
          >
            {status === 'sending' ? (
              <IonSpinner name="dots" aria-label="Se trimite" />
            ) : (
              'Trimite linkul'
            )}
          </IonButton>
        </form>
      </IonContent>
    </IonPage>
  );
}
