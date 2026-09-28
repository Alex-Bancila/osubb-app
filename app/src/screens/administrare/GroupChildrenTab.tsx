import { useState } from 'react';
import { Link } from 'react-router';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import {
  EmptyState,
  ListRow,
  Panel,
  rowListClass,
} from '../../components/layout';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import type {
  AdminGroup,
  AppointableMember,
  GroupAuthority,
  RunGroupCommand,
} from '../../queries/groups-admin';
import { GroupCreateDialog } from './GroupCreateDialog';
import {
  categoryLabel,
  groupStatusLabel,
  unfinishedTasksPath,
  varies,
} from './group-tree';

function ArchiveChildDialog({
  child,
  busy,
  error,
  onArchive,
}: {
  child: AdminGroup;
  busy: boolean;
  error: string | null;
  onArchive: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) setAttempted(false);
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        aria-label={`Arhivează ${child.name}`}
        onClick={() => {
          setAttempted(false);
          setOpen(true);
        }}
      >
        Arhivează
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arhivează {child.name}</DialogTitle>
          <DialogDescription>
            Subgrupul nu mai poate primi taskuri, evenimente sau membri noi.
            Istoricul rămâne.
          </DialogDescription>
        </DialogHeader>
        {attempted && error && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            <Link
              to={unfinishedTasksPath(child)}
              className="inline-flex min-h-11 items-center underline"
            >
              Vezi taskurile neterminate
            </Link>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Renunță
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setAttempted(true);
              if (await onArchive()) setOpen(false);
            }}
          >
            Arhivează
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  busy: boolean;
  error: string | null;
  onRun: RunGroupCommand;
}) {
  // A category badge says something only when the children differ in it
  // (relevance B48).
  const showCategory = varies(childGroups, (child) => child.category);
  return (
    <Panel
      title="Subgrupuri"
      flush={childGroups.length > 0}
      control={
        authority.manageGroup &&
        group.status === 'active' && (
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
        )
      }
    >
      {childGroups.length === 0 ? (
        <EmptyState>Grupul nu are subgrupuri.</EmptyState>
      ) : (
        <ul className={rowListClass} aria-label="Subgrupuri">
          {childGroups.map((child) => (
            <ListRow
              key={child.id}
              action={
                child.status === 'active' &&
                authorityFor(child).archive && (
                  <ArchiveChildDialog
                    child={child}
                    busy={busy}
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
                  style={{ backgroundColor: child.color ?? 'var(--brand-red)' }}
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
  );
}
