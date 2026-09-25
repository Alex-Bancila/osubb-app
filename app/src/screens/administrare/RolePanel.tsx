import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { commandErrorMessage } from '../../lib/command-reasons';
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

type MemberRole = Database['public']['Enums']['member_role'];
type MemberStatus = Database['public']['Enums']['member_status'];
const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2';
/** `member_status` enum values, in the reference list's canonical order. */
const statusOptions = Object.keys(statusLabels);

/** A refused change, in the shared copy of `command-reasons.ts`. */
function changeError(error: unknown) {
  return commandErrorMessage(
    error,
    'Nu am putut salva modificarea. Încearcă din nou.',
  );
}

/** The Role and Status management surface; the server capability gates mount. */
export function RolePanel() {
  const { session } = useAuth();
  const members = useAppointableMembers();
  const roles = useRoles();
  const groups = useAdminGroups();
  const change = useMemberChange();
  const [memberId, setMemberId] = useState('');
  const [roleDraft, setRoleDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const groupIds = useMemberGroupIds(memberId || null);
  const member = members.data?.find((row) => row.memberId === memberId);
  const actor = members.data?.find((row) => row.memberId === session?.user.id);
  const actorRole = actor?.roleId;
  const self = memberId !== '' && memberId === session?.user.id;
  const protectedMember =
    member?.roleId === 'bc' || member?.roleId === 'moderator';
  const canEditMember = Boolean(
    member &&
    actor?.status === 'activ' &&
    !self &&
    (actorRole === 'moderator' || (actorRole === 'bc' && !protectedMember)),
  );
  const roleOptions = useMemo(
    () =>
      [...(roles.data?.entries() ?? [])]
        .filter(([id]) => id !== 'responsabil')
        .sort((a, b) => a[1].level - b[1].level),
    [roles.data],
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
    (actorRole === 'moderator' ||
      (nextRole !== 'bc' && nextRole !== 'moderator')) &&
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

  return (
    <section
      aria-labelledby="roles-title"
      className="space-y-4 rounded-xl border bg-card p-4 md:p-5"
    >
      <div>
        <h2 id="roles-title" className="text-xl font-semibold">
          Roluri și status
        </h2>
        <p className="text-sm text-muted-foreground">
          Schimbările sunt înregistrate cu autorul lor. Rolul organizațional
          este separat de rolul într-un Grup.
        </p>
      </div>
      {members.isPending || roles.isPending ? (
        <p role="status">Se încarcă membrii și rolurile…</p>
      ) : members.isError || roles.isError ? (
        <p role="alert">Nu am putut încărca membrii și rolurile.</p>
      ) : (
        <>
          <label className="block max-w-xl space-y-1">
            <span>Membru</span>
            <select
              className={control}
              value={memberId}
              disabled={change.isPending}
              onChange={(event) => {
                setMemberId(event.target.value);
                setRoleDraft('');
                setStatusDraft('');
                setReason('');
                setError(null);
                setMessage(null);
              }}
            >
              <option value="">Alege un membru</option>
              {members.data?.map((row) => (
                <option key={row.memberId} value={row.memberId}>
                  {row.name} · {row.roleLabel}
                </option>
              ))}
            </select>
          </label>
          {member && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-lg border p-4">
                <h3 className="font-semibold">Rol organizațional</h3>
                <p className="text-sm text-muted-foreground">
                  Rol actual: {member.roleLabel}
                </p>
                <label className="block space-y-1">
                  <span>Rol organizațional</span>
                  <select
                    className={control}
                    value={nextRole}
                    disabled={!canEditMember || change.isPending}
                    onChange={(event) => setRoleDraft(event.target.value)}
                  >
                    {!roleOptions.some(([id]) => id === nextRole) && (
                      <option value={nextRole}>Alege un rol</option>
                    )}
                    {roleOptions.map(([id, role]) => (
                      <option
                        key={id}
                        value={id}
                        disabled={
                          actorRole !== 'moderator' &&
                          (id === 'bc' || id === 'moderator')
                        }
                      >
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                {nextRole === 'vot' && nextRole !== member.roleId && (
                  <p className="text-sm">
                    Confirmi Drept de Vot pentru acest membru. Decizia va fi
                    atribuită contului tău.
                  </p>
                )}
                {member.roleId === 'vot' &&
                  nextLevel !== undefined &&
                  nextLevel < (roles.data?.get('vot')?.level ?? -1) && (
                    <p className="text-sm">
                      Retragi Drept de Vot. Decizia va fi atribuită contului
                      tău.
                    </p>
                  )}
                {roleDraft &&
                  roleDraft !== member.roleId &&
                  (groups.isPending || groupIds.isPending) && (
                    <p role="status" className="text-sm">
                      Se verifică Grupurile afectate…
                    </p>
                  )}
                {roleDraft &&
                  roleDraft !== member.roleId &&
                  (groups.isError || groupIds.isError) && (
                    <p role="alert" className="text-sm">
                      Nu am putut verifica Grupurile afectate.
                    </p>
                  )}
                {roleDraft &&
                  roleDraft !== member.roleId &&
                  groups.isSuccess &&
                  groupIds.isSuccess && (
                    <div className="text-sm">
                      <p>
                        Grupuri părăsite după schimbare:{' '}
                        {leavingGroups.length === 0 ? 'niciunul' : ''}
                      </p>
                      {leavingGroups.length > 0 && (
                        <ul className="list-disc pl-5">
                          {leavingGroups.map((group) => (
                            <li key={group.id}>{group.name}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                <Button
                  type="button"
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
              <div className="space-y-3 rounded-lg border p-4">
                <h3 className="font-semibold">Status</h3>
                <p className="text-sm text-muted-foreground">
                  Status actual: {statusLabel(member.status)}
                </p>
                <label className="block space-y-1">
                  <span>Status</span>
                  <select
                    className={control}
                    value={nextStatus}
                    disabled={!canEditMember || change.isPending}
                    onChange={(event) => setStatusDraft(event.target.value)}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
                {nextStatus === 'inactiv' && nextStatus !== member.status && (
                  <p className="text-sm">
                    Dezactivarea revocă sesiunile de reîmprospătare. Un token
                    deja emis poate rămâne valabil cel mult o oră.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
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
          {member && (
            <label className="block max-w-xl space-y-1">
              <span>Motiv (opțional)</span>
              <textarea
                className={control}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={!canEditMember || change.isPending}
              />
            </label>
          )}
          {member && !canEditMember && (
            <p className="text-sm text-muted-foreground">
              {self
                ? 'Nu îți poți schimba propriul rol sau status.'
                : 'Numai un Moderator poate modifica un membru BC sau Moderator.'}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
