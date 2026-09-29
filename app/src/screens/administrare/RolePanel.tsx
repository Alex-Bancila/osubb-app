import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { UserCog } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { Panel, SubHeading } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import type { MemberIdentity } from '../../components/member/member-identity';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
import { useAuth } from '../../lib/auth';
import { memberEditRights } from '../../lib/member-edit-rights';
import { commandErrorMessage } from '../../lib/command-reasons';
import { isUuid } from '../../lib/ids';
import {
  useAdminGroups,
  useAppointableMembers,
} from '../../queries/groups-admin';
import { useRoles } from '../../queries/reference';
import {
  useMemberChange,
  useMemberGroupIds,
  type MemberChange,
} from '../../queries/member-role-management';
import { statusLabel, statusLabels } from '../volunteers/directory-filters';
import type { Database } from '../../lib/database.types';
import { MemberPicker } from './MemberPicker';
import { useReceiptTurn } from '../tracker/receipt-turn';

type MemberRole = Database['public']['Enums']['member_role'];
type MemberStatus = Database['public']['Enums']['member_status'];
const control =
  'min-h-11 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm dark:border-input dark:bg-input/30';
/**
 * The leadership ranks. Since ruling R31 (#905, #917) every BC member grants
 * and removes them and changes a holder's Status, as the Moderator does. Their
 * live holders are the only viewers who change Roles or Status at all.
 */
const PROTECTED_ROLES: ReadonlySet<string> = new Set(['bc', 'moderator']);
/** How the panel names the one holder a leadership rank is left with. */
const LAST_HOLDER: Record<string, string> = {
  moderator: 'ultimul Moderator',
  bc: 'ultimul membru BC',
};
/** `member_status` enum values, in the reference list's canonical order. */
const statusOptions = Object.keys(statusLabels);

/** A refused change, in the shared copy of `command-reasons.ts`. */
function changeError(error: unknown) {
  return commandErrorMessage(
    error,
    'Nu am putut salva modificarea. Încearcă din nou.',
  );
}

const DEACTIVATION_WARNING =
  'Dezactivarea revocă sesiunile de reîmprospătare. Un token deja emis poate rămâne valabil cel mult o oră.';

/**
 * "Dezactivează" asks first (F-11), like "Scoate" on a Roster: the dialog
 * repeats the warning and only its own button sends the change.
 */
function DeactivateDialog({
  member,
  disabled,
  onConfirm,
}: {
  member: MemberIdentity;
  disabled: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <Button
        type="button"
        block
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Dezactivează
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dezactivezi acest membru?</DialogTitle>
          <DialogDescription>{DEACTIVATION_WARNING}</DialogDescription>
        </DialogHeader>
        {/* The name through MemberName, in the body: a title holds no button. */}
        <MemberName size="sm" {...member} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => setOpen(false)}
          >
            Renunță
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={disabled}
            onClick={async () => {
              // A refusal closes it too: the panel shows the reason.
              await onConfirm();
              setOpen(false);
            }}
          >
            Dezactivează membrul
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One line of the replacement dialog: whose Role goes from what to what. The
 * viewer reads as "Tu"; anyone else is named through MemberName.
 */
type RoleMove = {
  key: string;
  who: MemberIdentity | 'self';
  from: string;
  to: string;
};

/** The identity MemberName needs, from a picker row. */
function identityOf(row: {
  memberId: string;
  name: string;
  nickname?: string | null;
  avatarColor: string | null;
}): MemberIdentity {
  return {
    memberId: row.memberId,
    fullName: row.name,
    nickname: row.nickname,
    avatarColor: row.avatarColor,
  };
}

/**
 * Removing the last Moderator or BC asks first (#905), whether the save takes
 * their rank or, since #917, their `activ` Status: the dialog names both
 * changes the one save makes, the replacement's first, as the server applies
 * them. `note` carries the deactivation warning when the Status changes.
 */
function ReplacementDialog({
  open,
  onOpenChange,
  moves,
  note,
  disabled,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moves: RoleMove[];
  note?: string;
  disabled: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!disabled) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmi cele două schimbări?</DialogTitle>
          <DialogDescription>
            Se salvează împreună și apar în istoric cu numele tău.
          </DialogDescription>
        </DialogHeader>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          {moves.map((move) => (
            <li key={move.key}>
              {move.who === 'self' ? (
                <span className="font-medium">Tu</span>
              ) : (
                <MemberName size="sm" {...move.who} />
              )}
              : {move.from} → <span className="font-medium">{move.to}</span>
            </li>
          ))}
        </ul>
        {note && <p className="m-0 text-sm text-muted-foreground">{note}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onOpenChange(false)}
          >
            Renunță
          </Button>
          <Button
            type="button"
            disabled={disabled}
            onClick={async () => {
              // A refusal closes it too: the panel shows the reason.
              await onConfirm();
              onOpenChange(false);
            }}
          >
            Salvează ambele schimbări
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The query parameter that opens the panel on one Member (#702). */
export const ROLE_PANEL_MEMBER_PARAM = 'membru';
/** Preselects the new Role beside `membru` (#827: a Promotion Candidate). */
export const ROLE_PANEL_ROLE_PARAM = 'rol';
/** Prefills the reason beside `membru` (#827: the Role Evaluation's name). */
export const ROLE_PANEL_REASON_PARAM = 'motiv';
/** `set_member_role`'s reason limit; a longer prefill is cut, never sent. */
const REASON_MAX = 1000;

/**
 * The Role and Status management surface; the server capability gates mount.
 * `?membru=<id>` pre-selects a Member — the Evaluări de rol tab's
 * **Editează rolul** links here from a Retention Signal — and scrolls the
 * panel into view. Beside it, `rol` preselects the new Role and `motiv`
 * prefills the reason: a Promotion Candidate's **Promovează** (#827) arrives
 * with `rol=activ` and the Role Evaluation's name. Both only prefill; BC
 * still saves. On a Member's own page (#103) `selectedMemberId` fixes the
 * Member and the picker is not shown.
 */
export function RolePanel({
  selectedMemberId,
}: { selectedMemberId?: string } = {}) {
  const { session } = useAuth();
  const members = useAppointableMembers();
  const roles = useRoles();
  const groups = useAdminGroups();
  const change = useMemberChange();
  const [searchParams] = useSearchParams();
  // `?membru=` only preselects; anything but a Member id is ignored.
  const param = searchParams.get(ROLE_PANEL_MEMBER_PARAM);
  const requested = isUuid(param) ? param : '';
  const [memberId, setMemberId] = useState(selectedMemberId ?? requested);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (requested) panel.current?.scrollIntoView?.({ block: 'start' });
  }, [requested]);
  // `rol` and `motiv` only travel with a Member; a malformed Role is ignored.
  const roleParam = searchParams.get(ROLE_PANEL_ROLE_PARAM) ?? '';
  const reasonParam = searchParams.get(ROLE_PANEL_REASON_PARAM) ?? '';
  const [roleDraft, setRoleDraft] = useState(
    requested && !selectedMemberId && /^[a-z_]+$/.test(roleParam)
      ? roleParam
      : '',
  );
  const [statusDraft, setStatusDraft] = useState('');
  const [replacementId, setReplacementId] = useState('');
  // Which guarded save the replacement dialog confirms, if any.
  const [confirming, setConfirming] = useState<'role' | 'status' | null>(null);
  const [reason, setReason] = useState(
    requested && !selectedMemberId
      ? reasonParam.trim().slice(0, REASON_MAX)
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // On a Member's page, one receipt at a time with the other panels (F-11).
  const turn = useReceiptTurn();
  const groupIds = useMemberGroupIds(memberId || null);
  const member = members.data?.find((row) => row.memberId === memberId);
  const actor = members.data?.find((row) => row.memberId === session?.user.id);
  const actorRole = actor?.roleId;
  const self = memberId !== '' && memberId === session?.user.id;
  // A live active BC or Moderator: the only viewer the server lets re-rank
  // anyone or change their Status, leadership included (ruling R31).
  const leader =
    actor?.status === 'activ' && PROTECTED_ROLES.has(actorRole ?? '');
  // The member page's predicate (#944): the same viewer, never on themselves.
  const canEditMember = memberEditRights(
    { id: session?.user.id, leads: leader },
    member?.memberId,
  ).rankAndStatus;
  // Only what the viewer can save (B57): without live leadership the lists
  // name no BC or Moderator holder and stop at BCE.
  const roleOptions = useMemo(
    () =>
      [...(roles.data?.entries() ?? [])]
        .filter(
          ([id]) =>
            id !== 'responsabil' && (leader || !PROTECTED_ROLES.has(id)),
        )
        .sort((a, b) => a[1].level - b[1].level),
    [roles.data, leader],
  );
  const pickable = useMemo(
    () =>
      (members.data ?? [])
        .filter((row) => leader || !PROTECTED_ROLES.has(row.roleId ?? ''))
        .sort((a, b) => a.name.localeCompare(b.name, 'ro')),
    [members.data, leader],
  );
  const nextRole = roleDraft || member?.roleId || '';
  const nextStatus = statusDraft || member?.status || '';
  // The leadership rank the Member is the last live holder of, if any.
  const lastHolderRank = useMemo(() => {
    const rank = member?.roleId ?? '';
    if (!member || member.status !== 'activ' || !PROTECTED_ROLES.has(rank))
      return null;
    const others = (members.data ?? []).some(
      (row) =>
        row.memberId !== member.memberId &&
        row.roleId === rank &&
        row.status === 'activ',
    );
    return others ? null : rank;
  }, [member, members.data]);
  // Ruling R31: a change that takes that rank away (#905) or takes its holder
  // out of `activ` (#917) must name who takes it in the same save. `null`
  // when no guard applies.
  const roleGuard =
    lastHolderRank && nextRole !== lastHolderRank ? lastHolderRank : null;
  const statusGuard =
    lastHolderRank && nextStatus !== 'activ' ? lastHolderRank : null;
  const guardedRank = roleGuard ?? statusGuard;
  const viewerId = session?.user.id;
  // Who may take it: any active Member but the target, the viewer first as
  // "Eu" — less the last holder of the other leadership rank, whom the server
  // refuses unless a rank change hands the target that rank in the same save
  // (a Status change keeps the target's rank, so there is no swap).
  const replacementOptions = useMemo(() => {
    if (!guardedRank || !member) return [];
    const rows = members.data ?? [];
    const other = guardedRank === 'moderator' ? 'bc' : 'moderator';
    const soleOther = (id: string) =>
      !rows.some(
        (row) =>
          row.memberId !== id && row.roleId === other && row.status === 'activ',
      );
    return rows
      .filter(
        (row) =>
          row.status === 'activ' &&
          row.memberId !== member.memberId &&
          !(
            row.roleId === other &&
            (statusGuard !== null || nextRole !== other) &&
            soleOther(row.memberId)
          ),
      )
      .map((row) =>
        row.memberId === viewerId
          ? { ...row, name: 'Eu', nickname: null }
          : row,
      )
      .sort((a, b) =>
        a.memberId === viewerId
          ? -1
          : b.memberId === viewerId
            ? 1
            : a.name.localeCompare(b.name, 'ro'),
      );
  }, [guardedRank, statusGuard, member, members.data, nextRole, viewerId]);
  const replacement = replacementOptions.find(
    (row) => row.memberId === replacementId,
  );
  const nextLevel = roles.data?.get(nextRole)?.level;
  const memberships = groupIds.data;
  const leavingGroups = useMemo(() => {
    if (nextLevel === undefined || !member || !groups.data || !memberships)
      return [];
    return groups.data
      .filter(
        (group) =>
          group.min_level > nextLevel &&
          (memberships.has(group.id) ||
            (group.status === 'active' &&
              group.automatic_membership &&
              member.status === 'activ' &&
              member.level >= group.min_level)),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  }, [groups.data, member, memberships, nextLevel]);
  const canSaveRole =
    canEditMember &&
    nextRole !== member?.roleId &&
    roleOptions.some(([id]) => id === nextRole) &&
    (!roleGuard || replacement !== undefined) &&
    groups.isSuccess &&
    groupIds.isSuccess &&
    !change.isPending;
  const canSaveStatus =
    canEditMember &&
    nextStatus !== member?.status &&
    statusOptions.includes(nextStatus) &&
    (!statusGuard || replacement !== undefined) &&
    !change.isPending;

  async function save(next: MemberChange): Promise<boolean> {
    setError(null);
    setMessage(null);
    try {
      await change.mutateAsync(next);
      setMessage(
        next.kind === 'role'
          ? 'Rolul organizațional a fost schimbat și înregistrat în istoric.'
          : next.status === 'inactiv'
            ? 'Membrul a fost dezactivat. Sesiunile de reîmprospătare au fost revocate.'
            : 'Membrul a fost reactivat și schimbarea a fost înregistrată.',
      );
      turn.claim();
      setReason('');
      setRoleDraft('');
      setStatusDraft('');
      setReplacementId('');
      return true;
    } catch (failure) {
      setError(changeError(failure));
      return false;
    }
  }

  const pickerId = useId();
  const roleId = useId();
  const statusId = useId();
  const reasonId = useId();
  const replacementHeadingId = useId();
  const roleChange: MemberChange = {
    kind: 'role',
    memberId,
    role: nextRole as MemberRole,
    reason: reason.trim() || null,
    ...(roleGuard && replacement
      ? { replacementId: replacement.memberId }
      : {}),
  };
  const statusChange: MemberChange = {
    kind: 'status',
    memberId,
    status: nextStatus as MemberStatus,
    reason: reason.trim() || null,
    ...(statusGuard && replacement
      ? { replacementId: replacement.memberId }
      : {}),
  };
  const roleName = (id: string | null | undefined) =>
    (id && roles.data?.get(id)?.name) || '—';
  // The dialog's two lines: the replacement's rank first, as the server
  // applies it, then the target's own change — their rank or their Status.
  const moves: RoleMove[] =
    confirming && guardedRank && replacement && member
      ? [
          {
            key: 'replacement',
            // The picker row reads "Eu"; the identity keeps the real name.
            who:
              replacement.memberId === viewerId
                ? 'self'
                : identityOf(replacement),
            from: roleName(replacement.roleId),
            to: roleName(guardedRank),
          },
          confirming === 'status'
            ? {
                key: 'target',
                who: identityOf(member),
                from: statusLabel(member.status),
                to: statusLabel(nextStatus),
              }
            : {
                key: 'target',
                who: identityOf(member),
                from: roleName(member.roleId),
                to: roleName(nextRole),
              },
        ]
      : [];

  return (
    // The wrapper is what `?membru=` scrolls to; the Panel has no ref.
    <div ref={panel} className="h-full min-w-0 scroll-mt-4">
      <Panel
        eyebrow="Roluri"
        icon={UserCog}
        title="Roluri și status"
        description="Schimbările sunt înregistrate cu autorul lor. Rolul organizațional este separat de rolul într-un Grup."
        stack={4}
      >
        {members.isPending || roles.isPending ? (
          <p role="status" className="m-0">
            Se încarcă membrii și rolurile…
          </p>
        ) : members.isError || roles.isError ? (
          <p role="alert" className="m-0">
            Nu am putut încărca membrii și rolurile.
          </p>
        ) : (
          <>
            {!selectedMemberId && (
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
                <div className="flex w-full min-w-0 flex-col gap-2 sm:max-w-md">
                  <SubHeading as="p" id={pickerId}>
                    Membru
                  </SubHeading>
                  <MemberPicker
                    ariaLabelledBy={pickerId}
                    members={pickable}
                    value={
                      pickable.find((row) => row.memberId === memberId) ?? null
                    }
                    disabled={change.isPending}
                    onValueChange={(next) => {
                      setMemberId(next?.memberId ?? '');
                      setRoleDraft('');
                      setStatusDraft('');
                      setReplacementId('');
                      setReason('');
                      setError(null);
                      setMessage(null);
                    }}
                  />
                </div>
                {member && (
                  <Link
                    className="inline-flex min-h-11 shrink-0 items-center self-start text-sm font-medium underline underline-offset-4 sm:self-auto"
                    to={`/administrare/membri/${member.memberId}`}
                    // Back from the member page lands here, on this Member.
                    state={{
                      from: {
                        to: `/administrare/roluri?${ROLE_PANEL_MEMBER_PARAM}=${member.memberId}`,
                        label: 'Înapoi la Roluri',
                      },
                    }}
                  >
                    Vezi detaliile membrului
                  </Link>
                )}
              </div>
            )}
            {member && !canEditMember && (
              // Only what the viewer can save (B57): no disabled fields.
              <p className="m-0 text-sm text-muted-foreground">
                {self
                  ? 'Nu îți poți schimba propriul rol sau status.'
                  : 'Nu poți modifica acest membru acum.'}
              </p>
            )}
            {member && canEditMember && (
              // Two field groups side by side, the reason under both, and
              // each save button under its own group (layout AD2).
              <div className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <SubHeading>
                    <label htmlFor={roleId}>Rol organizațional</label>
                  </SubHeading>
                  <NativeSelect
                    id={roleId}
                    value={nextRole}
                    disabled={change.isPending}
                    onChange={(event) => {
                      setRoleDraft(event.target.value);
                      setReplacementId('');
                    }}
                  >
                    {!roleOptions.some(([id]) => id === nextRole) && (
                      <NativeSelectOption value={nextRole}>
                        Alege un rol
                      </NativeSelectOption>
                    )}
                    {roleOptions.map(([id, role]) => (
                      <NativeSelectOption key={id} value={id}>
                        {role.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {nextRole === 'vot' && nextRole !== member.roleId && (
                    <p className="m-0 text-sm">
                      Confirmi Drept de Vot pentru acest membru. Decizia va fi
                      atribuită contului tău.
                    </p>
                  )}
                  {member.roleId === 'vot' &&
                    nextLevel !== undefined &&
                    nextLevel < (roles.data?.get('vot')?.level ?? -1) && (
                      <p className="m-0 text-sm">
                        Retragi Drept de Vot. Decizia va fi atribuită contului
                        tău.
                      </p>
                    )}
                  {roleDraft &&
                    roleDraft !== member.roleId &&
                    (groups.isPending || groupIds.isPending) && (
                      <p role="status" className="m-0 text-sm">
                        Se verifică Grupurile afectate…
                      </p>
                    )}
                  {roleDraft &&
                    roleDraft !== member.roleId &&
                    (groups.isError || groupIds.isError) && (
                      <p role="alert" className="m-0 text-sm">
                        Nu am putut verifica Grupurile afectate.
                      </p>
                    )}
                  {roleDraft &&
                    roleDraft !== member.roleId &&
                    groups.isSuccess &&
                    groupIds.isSuccess && (
                      <div className="text-sm">
                        <p className="m-0">
                          Grupuri părăsite după schimbare:{' '}
                          {leavingGroups.length === 0 ? 'niciunul' : ''}
                        </p>
                        {leavingGroups.length > 0 && (
                          <ul className="m-0 list-disc pl-5">
                            {leavingGroups.map((group) => (
                              <li key={group.id}>{group.name}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <SubHeading>
                    <label htmlFor={statusId}>Status</label>
                  </SubHeading>
                  <NativeSelect
                    id={statusId}
                    value={nextStatus}
                    disabled={change.isPending}
                    onChange={(event) => setStatusDraft(event.target.value)}
                  >
                    {statusOptions.map((status) => (
                      <NativeSelectOption key={status} value={status}>
                        {statusLabel(status)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {nextStatus === 'inactiv' && nextStatus !== member.status && (
                    <p className="m-0 text-sm">{DEACTIVATION_WARNING}</p>
                  )}
                </div>
                {guardedRank && (
                  <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
                    <SubHeading as="p" id={replacementHeadingId}>
                      Înlocuitor
                    </SubHeading>
                    <p className="m-0 text-sm">
                      <MemberName size="sm" {...identityOf(member)} /> este{' '}
                      {LAST_HOLDER[guardedRank]}. Alege cine preia rolul de{' '}
                      {roleName(guardedRank)}; cele două schimbări se salvează
                      împreună.
                    </p>
                    {/* On the grid of the two columns above: as wide as the Role select. */}
                    <div className="grid min-w-0 gap-x-6 sm:grid-cols-2">
                      <div className="min-w-0">
                        <MemberPicker
                          ariaLabelledBy={replacementHeadingId}
                          members={replacementOptions}
                          value={replacement ?? null}
                          placeholder="Alege înlocuitorul"
                          disabled={change.isPending}
                          onValueChange={(next) =>
                            setReplacementId(next?.memberId ?? '')
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
                  {/* Labelled in the sub-head style of the two groups above. */}
                  <SubHeading as="p">
                    <label htmlFor={reasonId}>Motiv (opțional)</label>
                  </SubHeading>
                  <textarea
                    id={reasonId}
                    className={control}
                    rows={2}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={change.isPending}
                  />
                </div>
                <div className="min-w-0">
                  <Button
                    type="button"
                    block
                    disabled={!canSaveRole}
                    onClick={() =>
                      roleGuard ? setConfirming('role') : void save(roleChange)
                    }
                  >
                    Salvează rolul
                  </Button>
                </div>
                <div className="min-w-0">
                  {statusGuard ? (
                    // The last holder leaving `activ`: the replacement dialog
                    // names both changes and repeats the warning.
                    <Button
                      type="button"
                      block
                      disabled={!canSaveStatus}
                      onClick={() => setConfirming('status')}
                    >
                      {nextStatus === 'inactiv'
                        ? 'Dezactivează'
                        : 'Salvează statusul'}
                    </Button>
                  ) : nextStatus === 'inactiv' &&
                    nextStatus !== member.status ? (
                    <DeactivateDialog
                      member={identityOf(member)}
                      disabled={!canSaveStatus}
                      onConfirm={() => save(statusChange)}
                    />
                  ) : (
                    <Button
                      type="button"
                      block
                      disabled={!canSaveStatus}
                      onClick={() => void save(statusChange)}
                    >
                      {nextStatus !== member.status && nextStatus === 'activ'
                        ? 'Reactivează'
                        : 'Salvează statusul'}
                    </Button>
                  )}
                </div>
                <ReplacementDialog
                  open={confirming !== null && moves.length > 0}
                  onOpenChange={(open) => {
                    if (!open) setConfirming(null);
                  }}
                  moves={moves}
                  note={
                    confirming === 'status' ? DEACTIVATION_WARNING : undefined
                  }
                  disabled={change.isPending}
                  onConfirm={() =>
                    save(confirming === 'status' ? statusChange : roleChange)
                  }
                />
              </div>
            )}
            {message && turn.current && (
              <p role="status" className="m-0">
                {message}
              </p>
            )}
            {error && (
              <p role="alert" className="m-0 text-destructive">
                {error}
              </p>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
