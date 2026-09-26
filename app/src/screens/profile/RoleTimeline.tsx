import { GraduationCap } from 'lucide-react';
import type { MyProfile } from '../../queries/profile';
import { useMyRoleHistory } from '../../queries/role-history';
import { useRoles } from '../../queries/reference';
import {
  buildRoleSegments,
  formatRoleDuration,
  formatSegmentLabel,
} from '../../lib/role-timeline';

/**
 * Role timeline card for the profile page.
 *
 * Shows the Member's own Role history as a vertical timeline, oldest first:
 * each Role held, from when to when, how long, and the current Role since its
 * start date — the LinkedIn-style ladder from Ruling R8.
 *
 * Non-critical: if the query is pending or errored, the section is simply
 * absent — no skeleton, no error banner. The profile page is usable without it.
 */
export default function RoleTimeline({ profile }: { profile: MyProfile }) {
  const historyQuery = useMyRoleHistory();
  const rolesQuery = useRoles();

  // Non-critical section: hide while loading or on error
  if (historyQuery.isPending || historyQuery.isError) return null;
  if (!rolesQuery.data) return null;

  const segments = buildRoleSegments(
    profile.joined_at,
    profile.role,
    historyQuery.data ?? [],
  );

  const rolesMap = rolesQuery.data;
  const resolveRoleName = (roleId: string) =>
    rolesMap.get(roleId)?.name ?? roleId;

  return (
    <section className="card p-6" data-testid="role-timeline-card">
      <div className="card-head">
        <h3 className="card-title flex items-center gap-2">
          <GraduationCap
            className="size-5 text-primary"
            aria-hidden="true"
          />
          <span>Parcursul organizațional</span>
        </h3>
      </div>

      <ol
        className="space-y-4 border-l border-border pl-4"
        aria-label="Parcursul organizațional"
      >
        {segments.map((segment, i) => {
          const roleName = resolveRoleName(segment.role);
          const label = formatSegmentLabel(
            roleName,
            segment,
            profile.joined_year,
          );
          const isCurrent = i === segments.length - 1;
          const duration =
            !isCurrent && segment.startDate && segment.endDate
              ? formatRoleDuration(segment.startDate, segment.endDate)
              : null;

          return (
            <li
              key={`${segment.role}-${i}`}
              className="relative text-sm"
            >
              {/* Timeline dot */}
              <span
                className={`absolute -left-[calc(1rem+0.3125rem)] top-1 size-2.5 rounded-full ${
                  isCurrent
                    ? 'bg-primary ring-2 ring-primary/20'
                    : 'bg-border'
                }`}
                aria-hidden="true"
              />

              <p
                className={`font-semibold ${
                  isCurrent ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {label}
              </p>

              {duration && !isCurrent && (
                <p className="text-xs text-muted-foreground">
                  {duration}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
