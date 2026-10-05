import { useMemo, useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import { GroupMultiCombobox } from '../../components/group/GroupMultiCombobox';
import { SubHeading } from '../../components/layout';
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
 * "Invită membru" (#931, #949): one invitation through `invite-member`. The
 * address and full name are required; the rank (Recrut unless chosen) and
 * the Groups (none: OSUBB only, by Automatic Membership) are optional. The
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
  const groupsDescribedBy =
    [
      selected.length === 0 ? 'invite-groups-hint' : null,
      form.error('groups') ? form.errorId('groups') : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

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
        className="w-full"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <UserPlus aria-hidden="true" />
        Invită membru
      </Button>
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
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

          <fieldset className="m-0 grid min-w-0 gap-4 border-0 border-t border-border p-0 pt-4">
            <legend className="float-left w-full p-0">
              <SubHeading as="p">Opțional</SubHeading>
            </legend>

            <div className="grid gap-1.5">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Rol</span>
                <NativeSelect
                  value={rank}
                  disabled={pending || rankOptions.length === 0}
                  aria-describedby={
                    LEADERSHIP_RANKS.has(rank) ? 'invite-rank-hint' : undefined
                  }
                  onChange={(event) => setRank(event.target.value)}
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

            <div className="grid gap-1.5" {...form.slot('groups')}>
              <span id="invite-member-groups" className="text-sm font-medium">
                Grupuri
              </span>
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
              {selected.length === 0 && (
                <p
                  id="invite-groups-hint"
                  className="text-sm text-muted-foreground"
                >
                  Fără grup: membrul intră doar în OSUBB și își alege
                  departamentul mai târziu.
                </p>
              )}
              <FieldError {...form.errorProps('groups')} />
            </div>
          </fieldset>

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
