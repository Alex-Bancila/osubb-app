import { useState } from 'react';
import { AlertCircle, CheckCircle, Mail } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '../../components/ui/field';
import { cn } from '../../lib/utils';
import { normalizeEmail, toEmailChangeError } from '../../lib/email-change';
import { supabase } from '../../lib/supabase';
import type { MyProfile } from '../../queries/profile';

/**
 * "Adresa de e-mail" section on the profile page (#632).
 *
 * Shows the current email and a form to request an email change via
 * `supabase.auth.updateUser({ email })`. Supabase Auth sends two
 * confirmation emails (one to the old address, one to the new);
 * the profile page shows a pending state until both are confirmed.
 *
 * The sync trigger (`private.sync_profile_email`) updates
 * `profiles.email` automatically after Auth confirms. The
 * `profile.me` query is invalidated on the next `USER_UPDATED` auth
 * event (handled by the AuthProvider in `auth.tsx`).
 */
export default function ChangeEmailSection({
  profile,
}: {
  profile: MyProfile;
}) {
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalized = normalizeEmail(newEmail);
    if (!normalized) {
      setError('Introdu noua adresă de email.');
      return;
    }

    if (normalized === profile.email) {
      setError('Noua adresă este identică cu cea actuală.');
      return;
    }

    setPending(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({
        email: normalized,
      });
      if (authError) {
        setError(toEmailChangeError(authError));
        return;
      }
      setSuccess(true);
      setNewEmail('');
    } catch (err) {
      setError(toEmailChangeError(err));
    } finally {
      setPending(false);
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

      {/* Current address */}
      <dl className="mb-4 text-sm">
        <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Adresa curentă
        </dt>
        <dd className="mt-1 font-medium text-foreground break-all">
          {profile.email ?? (
            <span className="text-muted-foreground italic">Indisponibil</span>
          )}
        </dd>
      </dl>

      {/* Success banner */}
      {success && (
        <div
          role="status"
          data-testid="email-change-pending"
          className="mb-4 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-primary"
        >
          <CheckCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Confirmare trimisă</p>
            <p className="mt-0.5 text-xs text-primary/80">
              Am trimis un email de confirmare la adresa veche și la cea nouă.
              Schimbarea se aplică doar după confirmarea ambelor.
            </p>
          </div>
        </div>
      )}

      {/* Change form */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="change-email-input">Nouă adresă</FieldLabel>
          <input
            id="change-email-input"
            type="email"
            value={newEmail}
            onChange={(e) => {
              setNewEmail(e.target.value);
              if (error) setError(null);
              if (success) setSuccess(false);
            }}
            placeholder="ex: ana@gmail.com"
            disabled={pending}
            className={cn(
              'flex min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
              error &&
                'border-destructive focus-visible:border-destructive',
            )}
          />
          <FieldDescription>
            Vei primi un email de confirmare la adresa veche și la cea nouă.
            Schimbarea se aplică doar după confirmarea ambelor.
          </FieldDescription>
        </Field>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          type="submit"
          variant="outline"
          disabled={pending || !newEmail.trim()}
          className="w-full gap-2"
        >
          {pending ? 'Se trimite…' : 'Schimbă adresa de email'}
        </Button>
      </form>
    </section>
  );
}
