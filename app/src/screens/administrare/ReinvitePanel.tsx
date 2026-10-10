import { useId, useState, type FormEvent } from 'react';
import { Panel } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import {
  invitationFieldForReason,
  memberInvitationSchema,
} from '../../lib/schemas/member-identity';
import { useFormValidation } from '../../lib/use-form-validation';
import { useReceiptTurn } from '../tracker/receipt-turn';
import {
  invitationPending,
  REINVITE_FAILED,
  useInvitationStatus,
  useReinviteMember,
  type InvitationStatus,
} from '../../queries/member-invitation';

function ReinviteForm({
  memberId,
  status,
}: {
  memberId: string;
  status: InvitationStatus;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [email, setEmail] = useState(status.email);
  const [message, setMessage] = useState<string | null>(null);
  const turn = useReceiptTurn();
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
      turn.claim();
    } catch (failure) {
      form.fail(failure, REINVITE_FAILED);
    }
  }

  // On the layout kit like the page's other panels (header above the box).
  // Why the panel is here is said once, behind the field's "i".
  return (
    <Panel title="Invitație">
      <form noValidate onSubmit={send} className="grid gap-3">
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${id}-email`} className="text-sm font-medium">
              Adresa de email
            </label>
            <InfoHint label="Despre invitație" id={hintId}>
              Membrul nu s-a autentificat încă. Dacă adresa e greșită,
              corecteaz-o înainte să retrimiți invitația.
            </InfoHint>
          </div>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="off"
            value={email}
            disabled={reinvite.isPending}
            onChange={(event) => setEmail(event.target.value)}
            {...form.field('email', hintId)}
          />
          <FieldError {...form.errorProps('email')} />
        </div>
        <Button
          type="submit"
          block
          className="sm:justify-self-start"
          disabled={reinvite.isPending}
        >
          {reinvite.isPending ? 'Se trimite…' : 'Retrimite invitația'}
        </Button>
        <FieldError>{form.formError}</FieldError>
        {message && turn.current && <p role="status">{message}</p>}
      </form>
    </Panel>
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
