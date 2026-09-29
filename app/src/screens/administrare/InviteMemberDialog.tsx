import { useMemo, useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import { GroupFilterCombobox } from '../../components/group/GroupFilterCombobox';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FieldError } from '../../components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
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

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/** The rank a new Member starts at unless BC chooses otherwise. */
const DEFAULT_RANK = 'recrut';

/** Ranks that open Administrare: said out loud before one is given. */
const LEADERSHIP_RANKS: ReadonlySet<string> = new Set(['bc', 'moderator']);

export type InvitedMember = { userId: string; email: string; name: string };

/**
 * "Invită membru" (#931): one invitation through `invite-member` — address,
 * full name, rank and an optional first Group. The function sends the magic
 * link and provisions the Member in one request; a refusal leaves no account.
 * Mounted only behind `provisionMembers`, the function's own level-6 gate.
 */
export function InviteMemberDialog({
  onInvited,
}: {
  onInvited: (member: InvitedMember) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [rank, setRank] = useState(DEFAULT_RANK);
  const [group, setGroup] = useState<AdminGroup | null>(null);
  const roles = useRoles();
  const groups = useAdminGroups();
  const invite = useInviteMember();
  const form = useFormValidation(
    memberInviteSchema,
    { email, fullName },
    inviteFieldForReason,
  );

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
  const pending = invite.isPending;

  function reset() {
    setEmail('');
    setFullName('');
    setRank(DEFAULT_RANK);
    setGroup(null);
    form.reset();
  }

  function chooseRank(next: string) {
    setRank(next);
    // A Group closed to the new rank would only be refused: drop it.
    const level = roles.data?.get(next)?.level ?? 0;
    if (group && group.min_level > level) setGroup(null);
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
        groupId: group?.id ?? null,
      });
      setOpen(false);
      onInvited({ ...sent, name: values.fullName });
      reset();
    } catch (failure) {
      form.fail(failure, INVITE_FAILED);
    }
  }

  const rankName = roles.data?.get(rank)?.name;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) reset();
      }}
    >
      <Button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <UserPlus aria-hidden="true" />
        Invită membru
      </Button>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Invită membru</DialogTitle>
            <DialogDescription>
              Primește pe email un link de autentificare. Apare în listă de acum
              și intră în aplicație când deschide linkul.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Adresa de email</span>
              <input
                className={control}
                type="email"
                required
                autoComplete="off"
                inputMode="email"
                value={email}
                disabled={pending}
                onChange={(event) => setEmail(event.target.value)}
                {...form.field('email')}
              />
            </label>
            <FieldError {...form.errorProps('email')} />
          </div>

          <div className="grid gap-1.5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Numele complet</span>
              <input
                className={control}
                required
                autoComplete="off"
                value={fullName}
                disabled={pending}
                onChange={(event) => setFullName(event.target.value)}
                {...form.field('fullName')}
              />
            </label>
            <FieldError {...form.errorProps('fullName')} />
          </div>

          <div className="grid gap-1.5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Rol</span>
              <NativeSelect
                value={rank}
                disabled={pending || rankOptions.length === 0}
                aria-describedby={
                  LEADERSHIP_RANKS.has(rank) ? 'invite-rank-hint' : undefined
                }
                onChange={(event) => chooseRank(event.target.value)}
              >
                {rankOptions.length === 0 && (
                  <NativeSelectOption value={DEFAULT_RANK}>
                    Recrut
                  </NativeSelectOption>
                )}
                {rankOptions.map(([id, role]) => (
                  <NativeSelectOption key={id} value={id}>
                    {role.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
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

          <div className="grid gap-1.5" {...form.slot('group')}>
            <span id="invite-member-group" className="text-sm font-medium">
              Grup{' '}
              <span className="font-normal text-muted-foreground">
                (opțional)
              </span>
            </span>
            <GroupFilterCombobox
              ariaLabelledBy="invite-member-group"
              groups={groupOptions}
              groupsById={groupsById}
              value={group}
              onValueChange={setGroup}
              placeholder="Fără grup deocamdată"
              disabled={pending}
            />
            <FieldError {...form.errorProps('group')} />
          </div>

          <FieldError>{form.formError}</FieldError>

          <DialogFooter>
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
