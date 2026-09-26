import { GraduationCap } from 'lucide-react';
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
import { useMyRoleHistory } from '../../queries/role-history';

/**
 * The Member's own Role timeline on Profil (#633, ruling R8): each Role held,
 * oldest first, from when to when and for how long, and the current Role
 * "din <dată>". A change a BC or Moderator made names them with `MemberName`
 * (#676); one the promotion job made says so.
 *
 * Self-contained and non-critical: while the history loads or if it fails,
 * the section is absent and the rest of the profile is unaffected.
 */
export function RoleTimeline({ profile }: { profile: MyProfile }) {
  const historyQuery = useMyRoleHistory();
  const rolesQuery = useRoles();
  const rows = historyQuery.data ?? [];
  const actorIds = rows.flatMap((row) =>
    row.actor_kind === 'human' && row.changed_by ? [row.changed_by] : [],
  );
  const actorsQuery = useMemberIdentities(actorIds);

  if (historyQuery.isPending || historyQuery.isError) return null;

  const segments = buildRoleSegments(profile.joined_at, profile.role, rows);
  const roleName = (role: string) => rolesQuery.data?.get(role)?.name ?? role;
  const undated = segments.length === 1 && !segments[0]?.startDate;

  return (
    <section className="card p-6" data-testid="role-timeline-card">
      <div className="card-head">
        <h3 className="card-title flex items-center gap-2">
          <GraduationCap className="size-5 text-primary" aria-hidden="true" />
          <span>Parcursul organizațional</span>
        </h3>
      </div>

      <ol
        className="space-y-4 border-l border-border pl-4"
        aria-label="Parcursul organizațional"
      >
        {segments.map((segment, i) => {
          const isCurrent = segment.endDate === null;
          const period = formatSegmentPeriod(segment);
          const duration = formatRoleDuration(
            segment.startDate,
            segment.endDate,
          );
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
              {undated && profile.joined_year && (
                <p className="text-xs text-muted-foreground">
                  Membru din {profile.joined_year}
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
    </section>
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
