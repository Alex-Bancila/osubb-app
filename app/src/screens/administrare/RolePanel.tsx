import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { UserCog } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { Panel, SubHeading } from '../../components/layout';
import { Button } from '../../components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
import { useAuth } from '../../lib/auth';
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

type MemberRole = Database['public']['Enums']['member_role'];
type MemberStatus = Database['public']['Enums']['member_status'];
const control =
  'min-h-11 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm dark:border-input dark:bg-input/30';
/** Ranks only the Moderator may give, and whose holders only it may change. */
const PROTECTED_ROLES: ReadonlySet<string> = new Set(['bc', 'moderator']);
/** `member_status` enum values, in the reference list's canonical order. */
const statusOptions = Object.keys(statusLabels);

/** A refused change, in the shared copy of `command-reasons.ts`. */
function changeError(error: unknown) {
  return commandErrorMessage(
    error,
    'Nu am putut salva modificarea. Încearcă din nou.',
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
  const [reason, setReason] = useState(
    requested && !selectedMemberId
      ? reasonParam.trim().slice(0, REASON_MAX)
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const groupIds = useMemberGroupIds(memberId || null);
  const member = members.data?.find((row) => row.memberId === memberId);
  const actor = members.data?.find((row) => row.memberId === session?.user.id);
  const actorRole = actor?.roleId;
  const self = memberId !== '' && memberId === session?.user.id;
  const protectedMember = PROTECTED_ROLES.has(member?.roleId ?? '');
  const canEditMember = Boolean(
    member &&
    actor?.status === 'activ' &&
    !self &&
    (actorRole === 'moderator' || (actorRole === 'bc' && !protectedMember)),
  );
  // Only what the viewer can save (B57): a BC's lists stop at BCE and never
  // name a BC or Moderator holder; the Moderator sees every rank and member.
  const moderator = actorRole === 'moderator';
  const roleOptions = useMemo(
    () =>
      [...(roles.data?.entries() ?? [])]
        .filter(
          ([id]) =>
            id !== 'responsabil' && (moderator || !PROTECTED_ROLES.has(id)),
        )
        .sort((a, b) => a[1].level - b[1].level),
    [roles.data, moderator],
  );
  const pickable = useMemo(
    () =>
      (members.data ?? [])
        .filter((row) => moderator || !PROTECTED_ROLES.has(row.roleId ?? ''))
        .sort((a, b) => a.name.localeCompare(b.name, 'ro')),
    [members.data, moderator],
  );
  const nextRole = roleDraft || member?.roleId || '';
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
  const nextStatus = statusDraft || member?.status || '';
  const canSaveRole =
    canEditMember &&
    nextRole !== member?.roleId &&
    roleOptions.some(([id]) => id === nextRole) &&
    (moderator || !PROTECTED_ROLES.has(nextRole)) &&
    groups.isSuccess &&
    groupIds.isSuccess &&
    !change.isPending;
  const canSaveStatus =
    canEditMember &&
    nextStatus !== member?.status &&
    statusOptions.includes(nextStatus) &&
    !change.isPending;

  async function save(next: MemberChange) {
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
      setReason('');
      setRoleDraft('');
      setStatusDraft('');
    } catch (failure) {
      setError(changeError(failure));
    }
  }

  const pickerId = useId();
  const roleId = useId();
  const statusId = useId();
  const reasonId = useId();

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
                  : protectedMember && !moderator
                    ? 'Numai un Moderator poate modifica un membru BC sau Moderator.'
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
                    onChange={(event) => setRoleDraft(event.target.value)}
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
                    <p className="m-0 text-sm">
                      Dezactivarea revocă sesiunile de reîmprospătare. Un token
                      deja emis poate rămâne valabil cel mult o oră.
                    </p>
                  )}
                </div>
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
                      void save({
                        kind: 'role',
                        memberId,
                        role: nextRole as MemberRole,
                        reason: reason.trim() || null,
                      })
                    }
                  >
                    Salvează rolul
                  </Button>
                </div>
                <div className="min-w-0">
                  <Button
                    type="button"
                    block
                    disabled={!canSaveStatus}
                    onClick={() =>
                      void save({
                        kind: 'status',
                        memberId,
                        status: nextStatus as MemberStatus,
                        reason: reason.trim() || null,
                      })
                    }
                  >
                    {nextStatus === member.status
                      ? 'Salvează statusul'
                      : nextStatus === 'inactiv'
                        ? 'Dezactivează'
                        : nextStatus === 'activ'
                          ? 'Reactivează'
                          : 'Salvează statusul'}
                  </Button>
                </div>
              </div>
            )}
            {message && (
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
