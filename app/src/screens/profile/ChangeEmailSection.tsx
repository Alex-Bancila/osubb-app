import { useMemo, useState } from 'react';
import { AlertCircle, Mail, MailCheck } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '../../components/ui/field';
import { useAuth } from '../../lib/auth';
import { authCallbackUrl } from '../../lib/auth-destination';
import {
  emailChangeReason,
  toEmailChangeErrorMessage,
} from '../../lib/auth-error-message';
import { normalizeEmail } from '../../lib/normalize';
import { emailChangeSchema, fieldForReason } from '../../lib/schemas/profile';
import { supabase } from '../../lib/supabase';
import { useFormValidation } from '../../lib/use-form-validation';
import type { MyProfile } from '../../queries/profile';

const INPUT_CLASS =
  'flex min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive';

/**
 * "Adresa de e-mail" on Profil (#632, ruling R7): the address the Member signs
 * in with, and the request to move it.
 *
 * The request is Supabase Auth's `updateUser({ email })`. With secure email
 * change on, Auth mails a confirmation to the current AND the new address
 * (`supabase/templates/email-change.html`, opened on `/auth/confirm`) and
 * changes nothing until both are used. Then `private.sync_profile_email`
 * copies the address into `profiles.email`, and the auth listener re-reads
 * this profile when the session reports the new address. There is no client
 * write to `profiles.email`: that column stays BC's.
 */
export default function ChangeEmailSection({
  profile,
}: {
  profile: MyProfile;
}) {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);

  const schema = useMemo(
    () => emailChangeSchema(profile.email),
    [profile.email],
  );
  const form = useFormValidation(schema, { email }, fieldForReason);

  // A change Auth is still waiting on: the one just asked for, or one asked
  // for earlier (Auth keeps it on the user as `new_email`). Once the profile
  // shows that address, nothing is pending any more.
  const candidate = requested ?? session?.user.new_email ?? null;
  const pendingEmail =
    candidate && normalizeEmail(candidate) !== normalizeEmail(profile.email)
      ? candidate
      : null;

  function showFailure(failure: unknown) {
    const reason = emailChangeReason(failure);
    form.fail(
      reason === undefined ? undefined : { message: reason },
      toEmailChangeErrorMessage(failure),
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;

    setSending(true);
    try {
      const { error } = await supabase.auth.updateUser(
        { email: values.email },
        { emailRedirectTo: authCallbackUrl('/profil') },
      );
      if (error) {
        showFailure(error);
        return;
      }
      setRequested(values.email);
      setEmail('');
      form.reset();
    } catch (failure) {
      showFailure(failure);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card p-6" data-testid="change-email-card">
      <div className="card-head">
        <h3 className="card-title flex items-center gap-2">
          <Mail className="size-5 text-primary" aria-hidden="true" />
          <span>Adresa de e-mail</span>
        </h3>
      </div>

      <p className="text-sm font-medium break-all text-foreground">
        {profile.email ?? (
          <span className="text-muted-foreground italic">Indisponibil</span>
        )}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Autentificarea se face prin link sau cod trimis la această adresă.
      </p>

      {pendingEmail && (
        <div
          role="status"
          data-testid="email-change-pending"
          className="mt-4 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
        >
          <MailCheck
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium text-foreground">Confirmare trimisă</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Am trimis câte un email de confirmare pe adresa actuală și pe{' '}
              <strong className="break-all">{pendingEmail}</strong>. Adresa se
              schimbă doar după ce confirmi de pe amândouă.
            </p>
          </div>
        </div>
      )}

      {form.formError && (
        <FieldError className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>{form.formError}</span>
        </FieldError>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-4 flex flex-col gap-4 border-t border-border pt-4"
      >
        <Field>
          <FieldLabel htmlFor="change-email-input">Adresa nouă</FieldLabel>
          <input
            id="change-email-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ex: ana@gmail.com"
            disabled={sending}
            className={INPUT_CLASS}
            {...form.field('email', 'change-email-hint')}
          />
          <FieldError {...form.errorProps('email')} />
          <FieldDescription id="change-email-hint">
            Primești câte un email de confirmare pe adresa actuală și pe cea
            nouă. Schimbarea se aplică doar după ce le confirmi pe amândouă.
          </FieldDescription>
        </Field>

        <Button
          type="submit"
          variant="outline"
          disabled={sending}
          className="w-full"
        >
          {sending ? 'Se trimite…' : 'Schimbă adresa'}
        </Button>
      </form>
    </section>
  );
}
