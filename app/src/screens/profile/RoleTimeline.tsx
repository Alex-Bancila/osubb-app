import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorState, Loading } from '../../components/states';
import type { MemberIdentity } from '../../components/member/member-identity';
import { MemberName } from '../../components/member/MemberName';
import {
  buildRoleSegments,
  formatRoleDuration,
  formatSegmentPeriod,
  type RoleChangeActor,
} from '../../lib/role-timeline';
import { useMemberIdentities } from '../../queries/member-identities';
import type { MyProfile } from '../../queries/profile';
import { useRoles } from '../../queries/reference';
import {
  useMemberRoleHistory,
  useMyRoleHistory,
  type RoleHistoryRow,
} from '../../queries/role-history';

/**
 * The Member's own Role timeline on Profil (#633, ruling R8): each Role held,
 * oldest first, from when to when and for how long, and the current Role
 * "din <dată>". A change a BC or Moderator made names them with `MemberName`
 * (#676); one the promotion job made says so.
 *
 * The body of Profil's **Parcursul organizațional** panel (#824): the page
 * owns the panel and its header, so this never renders `null` inside the
 * grid — while the history loads it shows `Loading`, and if it fails an
 * `ErrorState` with a retry, in the box. The rest of the profile is
 * unaffected either way.
 */
export function RoleTimeline({ profile }: { profile: MyProfile }) {
  const historyQuery = useMyRoleHistory();
  return (
    <TimelineBody
      historyQuery={historyQuery}
      joinedAt={profile.joined_at}
      role={profile.role}
      label="Parcursul organizațional"
    />
  );
}

/**
 * Another Member's Role timeline, the body of the **Istoric roluri** panel on
 * their Administrare page (#932). Mounted for BC and the Moderator only —
 * `role_history_read` answers another Member's rows to level 6 and up — and
 * drawn even with a single Role, unlike Profil: BC opens the page to check it.
 */
export function MemberRoleTimeline({
  memberId,
  joinedAt,
  role,
}: {
  memberId: string;
  joinedAt: string | null;
  role: string;
}) {
  const historyQuery = useMemberRoleHistory(memberId);
  return (
    <TimelineBody
      historyQuery={historyQuery}
      joinedAt={joinedAt}
      role={role}
      label="Istoric roluri"
    />
  );
}

function TimelineBody({
  historyQuery,
  joinedAt,
  role,
  label,
}: {
  historyQuery: UseQueryResult<RoleHistoryRow[]>;
  joinedAt: string | null;
  role: string;
  label: string;
}) {
  const rolesQuery = useRoles();
  const rows = historyQuery.data ?? [];
  const actorIds = rows.flatMap((row) =>
    row.actor_kind === 'human' && row.changed_by ? [row.changed_by] : [],
  );
  const actorsQuery = useMemberIdentities(actorIds);

  if (historyQuery.isError) {
    return (
      <ErrorState
        text="Nu am putut încărca parcursul organizațional."
        error={historyQuery.error}
        onRetry={() => void historyQuery.refetch()}
      />
    );
  }
  if (historyQuery.isPending) {
    return <Loading label="Se încarcă parcursul…" />;
  }

  const segments = buildRoleSegments(joinedAt, role, rows);
  const roleName = (key: string) => rolesQuery.data?.get(key)?.name ?? key;

  return (
    <ol className="space-y-4 border-l border-border pl-4" aria-label={label}>
      {segments.map((segment, i) => {
        const isCurrent = segment.endDate === null;
        const period = formatSegmentPeriod(segment);
        const duration = formatRoleDuration(segment.startDate, segment.endDate);
        return (
          <li key={i} className="relative text-sm">
            <span
              className={`absolute -left-[calc(1rem+0.3125rem)] top-1 size-2.5 rounded-full ${
                isCurrent ? 'bg-primary ring-2 ring-primary/20' : 'bg-border'
              }`}
              aria-hidden="true"
            />
            <p
              className={`font-semibold ${
                isCurrent ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {roleName(segment.role)}
            </p>
            {period && (
              <p className="text-xs text-muted-foreground">
                {period}
                {duration && ` · ${duration}`}
              </p>
            )}
            {segment.openedBy && (
              <ChangeActor
                actor={segment.openedBy}
                identity={
                  segment.openedBy.memberId
                    ? actorsQuery.data?.get(segment.openedBy.memberId)
                    : undefined
                }
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Who opened a segment: the promotion job, or the BC/Moderator by name. */
function ChangeActor({
  actor,
  identity,
}: {
  actor: RoleChangeActor;
  identity: MemberIdentity | undefined;
}) {
  if (actor.kind !== 'human') {
    return <p className="text-xs text-muted-foreground">Schimbare automată</p>;
  }
  // A decider the directory no longer answers for (deactivated) stays unnamed.
  if (!identity) {
    return <p className="text-xs text-muted-foreground">Decis de conducere</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span>Decis de</span> <MemberName size="sm" {...identity} />
    </div>
  );
}
