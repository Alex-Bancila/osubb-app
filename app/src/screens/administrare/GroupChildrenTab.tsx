import { Link } from 'react-router';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import {
  EmptyState,
  ListRow,
  Panel,
  rowListClass,
} from '../../components/layout';
import { Badge } from '../../components/ui/badge';
import type {
  AdminGroup,
  AppointableMember,
  GroupAuthority,
  RunGroupCommand,
} from '../../queries/groups-admin';
import { GroupArchiveDialog } from './GroupArchiveDialog';
import { GroupCreateDialog } from './GroupCreateDialog';
import { categoryLabel, groupStatusLabel, varies } from './group-tree';

/**
 * The Groups directly below this one. A Group's parent is fixed at creation
 * (ruling R20), so a Child Group is created here and archived here — it is
 * never moved anywhere else.
 */
export function GroupChildrenTab({
  group,
  childGroups,
  members,
  levels,
  actorLevel,
  authority,
  authorityFor,
  isProtected = () => false,
  busy,
  error,
  onRun,
}: {
  group: AdminGroup;
  childGroups: AdminGroup[];
  members: AppointableMember[];
  levels: number[];
  actorLevel: number;
  authority: GroupAuthority;
  authorityFor: (child: AdminGroup) => GroupAuthority;
  /**
   * `archive_group` refuses the Child Group (#1129, `PT409 group_protected`):
   * an Automatic-Membership Group, the board or AG Group named in Setări, or a
   * Group above one — so its Arhivează is not offered.
   */
  isProtected?: (child: AdminGroup) => boolean;
  busy: boolean;
  error: string | null;
  onRun: RunGroupCommand;
}) {
  // A category badge says something only when the children differ in it
  // (relevance B48).
  const showCategory = varies(childGroups, (child) => child.category);
  return (
    <>
      {/* The page's plus button; the tab already says Subgrupuri. */}
      {authority.manageGroup && group.status === 'active' && (
        <GroupCreateDialog
          trigger="Subgrup nou"
          title={`Subgrup al ${group.name}`}
          parent={group}
          groups={[]}
          groupsById={new Map()}
          levels={levels}
          actorLevel={actorLevel}
          members={members}
          disabled={busy}
          choosePrivate={authority.editStructure}
          onCreate={onRun}
        />
      )}
      {/* Not "Subgrupuri": the tab's own region around it has that name. */}
      <Panel aria-label="Subgrupurile grupului" flush={childGroups.length > 0}>
        {childGroups.length === 0 ? (
          <EmptyState>Grupul nu are subgrupuri.</EmptyState>
        ) : (
          <ul className={rowListClass} aria-label="Subgrupuri">
            {childGroups.map((child) => (
              <ListRow
                key={child.id}
                action={
                  child.status === 'active' &&
                  authorityFor(child).archive &&
                  !isProtected(child) && (
                    <GroupArchiveDialog
                      group={child}
                      variant="child"
                      disabled={busy}
                      error={error}
                      onArchive={() =>
                        onRun({ kind: 'archive', groupId: child.id })
                      }
                    />
                  )
                }
              >
                <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: child.color ?? 'var(--brand-red)',
                    }}
                  />
                  <Link
                    to={`/administrare/grupuri/${child.id}`}
                    className="inline-flex min-h-11 min-w-0 items-center truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {child.name}
                  </Link>
                  {showCategory && (
                    <Badge variant="outline">
                      {categoryLabel(child.category)}
                    </Badge>
                  )}
                  <PrivateGroupBadge isPrivate={child.is_private} />
                  {child.status !== 'active' && (
                    <Badge variant="secondary">
                      {groupStatusLabel(child.status)}
                    </Badge>
                  )}
                </span>
              </ListRow>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
