import { useId, useMemo, useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import { GroupMultiCombobox } from '../../components/group/GroupMultiCombobox';
import { FabAction } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import {
  inviteFieldForReason,
  memberInviteSchema,
} from '../../lib/schemas/member-identity';
import { useFormValidation } from '../../lib/use-form-validation';
import { useAdminGroups, type AdminGroup } from '../../queries/groups-admin';
import {
  INVITE_FAILED,
  useInviteMember,
} from '../../queries/member-invitation';
import { useRoles } from '../../queries/reference';
import { inviteGroupOptions, inviteRankOptions } from './invite-options';

const labelClass = 'text-sm font-medium';
/** A label with its "i" at the end of the row. */
const labelRowClass = 'flex items-center justify-between gap-2';

/** The rank a new Member starts at unless BC chooses otherwise. */
const DEFAULT_RANK = 'recrut';

/** Ranks that open Administrare: said out loud before one is given. */
const LEADERSHIP_RANKS: ReadonlySet<string> = new Set(['bc', 'moderator']);

export type InvitedMember = { userId: string; email: string; name: string };

/**
 * "Invită membru" (#931, #949): one invitation through `invite-member`, in
 * a form sheet. The address and full name are required; the rank (Recrut
 * unless chosen) and the Groups (none: OSUBB only, by Automatic Membership)
 * are optional. What the invitation does and what no Group means sit behind
 * the "i" of the field they concern; the warning for a leadership rank stays
 * in view. The
 * function asks every chosen Group before it sends the magic link, then
 * places the Member in all of them or in none. Group Roles are appointed
 * from the Group's own page, never here. Mounted only behind
 * `provisionMembers`, the function's own level-6 gate.
 */
export function InviteMemberDialog({
  onInvited,
}: {
  onInvited: (member: InvitedMember) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const emailHintId = `${id}-email-hint`;
  const groupsHintId = `${id}-groups-hint`;
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [rank, setRank] = useState(DEFAULT_RANK);
  const [chosen, setChosen] = useState<AdminGroup[]>([]);
  const roles = useRoles();
  const groups = useAdminGroups();
  const invite = useInviteMember();

  const rankOptions = useMemo(
    () => inviteRankOptions(roles.data),
    [roles.data],
  );
  const rankLevel = roles.data?.get(rank)?.level ?? 0;
  const groupOptions = useMemo(
    () => inviteGroupOptions(groups.data ?? [], rankLevel),
    [groups.data, rankLevel],
  );
  const groupsById = useMemo(
    () => new Map((groups.data ?? []).map((row) => [row.id, row])),
    [groups.data],
  );
  // Only what the list still offers stays chosen: a Group the rank no longer
  // reaches, or one archived since (the list reloads after a refusal), drops
  // out of the choice and out of the payload.
  const selected = useMemo(() => {
    const offered = new Set(groupOptions.map((row) => row.id));
    return chosen.filter((row) => offered.has(row.id));
  }, [chosen, groupOptions]);
  // The refusal is judged against the CHOICE, not what the reloaded list
  // still offers: the Group that dropped out keeps its message on screen,
  // saying why it went, until the choice itself changes. One array per
  // choice, since a message stays while its value is the same object.
  const chosenIds = useMemo(() => chosen.map((row) => row.id), [chosen]);
  const form = useFormValidation(
    memberInviteSchema,
    { email, fullName, groups: chosenIds },
    inviteFieldForReason,
  );
  const pending = invite.isPending;

  function reset() {
    setEmail('');
    setFullName('');
    setRank(DEFAULT_RANK);
    setChosen([]);
    form.reset();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const values = form.validate();
    if (!values) return;
    try {
      const sent = await invite.mutateAsync({
        email: values.email,
        fullName: values.fullName,
        role: rank,
        groupIds: selected.map((row) => row.id),
      });
      setOpen(false);
      onInvited({ ...sent, name: values.fullName });
      reset();
    } catch (failure) {
      form.fail(failure, INVITE_FAILED);
    }
  }

  const rankName = roles.data?.get(rank)?.name;
  const groupsDescribedBy = [
    groupsHintId,
    form.error('groups') ? form.errorId('groups') : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <FabAction
        label="Invită membru"
        icon={UserPlus}
        onSelect={() => {
          reset();
          setOpen(true);
        }}
      />
      <FormSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) reset();
        }}
        title="Invită membru"
        busy={pending}
      >
        <form
          onSubmit={submit}
          noValidate
          className="flex flex-1 flex-col gap-4"
        >
          <div className="grid gap-1.5">
            <div className={labelRowClass}>
              <label htmlFor={`${id}-email`} className={labelClass}>
                Adresa de email
              </label>
              <InfoHint label="Despre invitație" id={emailHintId}>
                Primește pe email un link de autentificare. Apare în listă de
                acum și intră în aplicație când deschide linkul.
              </InfoHint>
            </div>
            <Input
              id={`${id}-email`}
              type="email"
              required
              autoComplete="off"
              inputMode="email"
              value={email}
              disabled={pending}
              onChange={(event) => setEmail(event.target.value)}
              {...form.field('email', emailHintId)}
            />
            <FieldError {...form.errorProps('email')} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${id}-name`} className={labelClass}>
              Numele complet
            </label>
            <Input
              id={`${id}-name`}
              required
              autoComplete="off"
              value={fullName}
              disabled={pending}
              onChange={(event) => setFullName(event.target.value)}
              {...form.field('fullName')}
            />
            <FieldError {...form.errorProps('fullName')} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${id}-rank`} className={labelClass}>
              Rol
            </label>
            <Select
              id={`${id}-rank`}
              value={rank}
              options={
                rankOptions.length === 0
                  ? [{ value: DEFAULT_RANK, label: 'Recrut' }]
                  : rankOptions.map(([roleId, role]) => ({
                      value: roleId,
                      label: role.name,
                    }))
              }
              disabled={pending || rankOptions.length === 0}
              aria-describedby={
                LEADERSHIP_RANKS.has(rank) ? 'invite-rank-hint' : undefined
              }
              onValueChange={setRank}
            />
            {/* Read before sending: it stays in view, not behind an "i". */}
            {LEADERSHIP_RANKS.has(rank) && (
              <p
                id="invite-rank-hint"
                className="text-sm text-muted-foreground"
              >
                Rolul {rankName ?? rank} deschide Administrare: poate invita
                membri și schimba rolul oricui.
              </p>
            )}
          </div>

          <div className="grid gap-1.5" {...form.slot('groups')}>
            <div className={labelRowClass}>
              <span id="invite-member-groups" className={labelClass}>
                Grupuri (opțional)
              </span>
              <InfoHint label="Despre grupuri" id={groupsHintId}>
                Fără grup: membrul intră doar în OSUBB și își alege
                departamentul mai târziu.
              </InfoHint>
            </div>
            <GroupMultiCombobox
              ariaLabelledBy="invite-member-groups"
              ariaDescribedBy={groupsDescribedBy}
              groups={groupOptions}
              groupsById={groupsById}
              value={selected}
              onValueChange={setChosen}
              placeholder="Niciun grup"
              disabled={pending}
            />
            <FieldError {...form.errorProps('groups')} />
          </div>

          <FieldError>{form.formError}</FieldError>

          <FormSheetFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Renunță
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Se trimite…' : 'Trimite invitația'}
            </Button>
          </FormSheetFooter>
        </form>
      </FormSheet>
    </>
  );
}
