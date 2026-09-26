import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import {
  invitationFieldForReason,
  memberInvitationSchema,
} from '../../lib/schemas/member-identity';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  invitationPending,
  REINVITE_FAILED,
  useInvitationStatus,
  useReinviteMember,
  type InvitationStatus,
} from '../../queries/member-invitation';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2';

function ReinviteForm({
  memberId,
  status,
}: {
  memberId: string;
  status: InvitationStatus;
}) {
  const [email, setEmail] = useState(status.email);
  const [message, setMessage] = useState<string | null>(null);
  const reinvite = useReinviteMember();
  const form = useFormValidation(
    memberInvitationSchema,
    { email },
    invitationFieldForReason,
  );

  async function send(event: FormEvent) {
    event.preventDefault();
    if (reinvite.isPending) return;
    setMessage(null);
    const values = form.validate();
    if (!values) return;
    try {
      const sent = await reinvite.mutateAsync({ memberId, ...values });
      setEmail(sent.email);
      setMessage(`Invitația a fost retrimisă la ${sent.email}.`);
    } catch (failure) {
      form.fail(failure, REINVITE_FAILED);
    }
  }

  return (
    <form
      noValidate
      onSubmit={send}
      aria-labelledby="reinvite-title"
      className="grid gap-3 rounded-xl border p-5"
    >
      <h2 id="reinvite-title" className="text-lg font-semibold">
        Invitație
      </h2>
      <p className="text-sm text-muted-foreground">
        Membrul nu s-a autentificat încă. Dacă adresa e greșită, corecteaz-o
        înainte să retrimiți invitația.
      </p>
      <div className="grid gap-1.5">
        <label className="grid gap-1">
          Adresa de email
          <input
            className={control}
            type="email"
            autoComplete="off"
            value={email}
            disabled={reinvite.isPending}
            onChange={(event) => setEmail(event.target.value)}
            {...form.field('email')}
          />
        </label>
        <FieldError {...form.errorProps('email')} />
      </div>
      <Button type="submit" disabled={reinvite.isPending}>
        {reinvite.isPending ? 'Se trimite…' : 'Retrimite invitația'}
      </Button>
      <FieldError>{form.formError}</FieldError>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

/**
 * "Retrimite invitația" (#773, ruling L19): BC and the Moderator correct the
 * address of a Member who never signed in and send the invitation again. The
 * page mounts it behind `manageRoles`; it shows nothing until
 * `reinvite-member` confirms the Member never signed in and their address is
 * still unconfirmed, and the function refuses everyone else regardless.
 */
export function ReinvitePanel({ memberId }: { memberId: string }) {
  const { data } = useInvitationStatus(memberId);
  if (!data || !invitationPending(data)) return null;
  return <ReinviteForm memberId={memberId} status={data} />;
}
