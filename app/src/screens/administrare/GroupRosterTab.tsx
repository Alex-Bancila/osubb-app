import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { MemberAvatar } from '../../components/ui/combobox';
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
  GroupCommand,
  RosterEntry,
} from '../../queries/groups-admin';
import { statusLabel } from '../volunteers/directory-filters';
import { MemberPicker } from './MemberPicker';
import { groupRoleLabel } from './group-tree';

/** Appointment: a Group Manager or Responsible adds a Member (ADR-0009). */
function AddMemberDialog({
  group,
  candidates,
  busy,
  error,
  onAdd,
}: {
  group: AdminGroup;
  candidates: AppointableMember[];
  busy: boolean;
  error: string | null;
  onAdd: (memberId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState<AppointableMember | null>(null);
  const [attempted, setAttempted] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) {
          setMember(null);
          setAttempted(false);
        }
      }}
    >
      <Button
        type="button"
        disabled={busy}
        onClick={() => {
          setMember(null);
          setAttempted(false);
          setOpen(true);
        }}
      >
        Adaugă un membru
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adaugă un membru în {group.name}</DialogTitle>
          <DialogDescription>
            Membrul intră în grup imediat și primește o notificare.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <span id="roster-add-member" className="text-sm font-medium">
            Membru
          </span>
          <MemberPicker
            ariaLabelledBy="roster-add-member"
            members={candidates}
            value={member}
            onValueChange={setMember}
            disabled={busy}
          />
        </div>
        {attempted && error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
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
            disabled={busy || !member}
            onClick={async () => {
              if (!member) return;
              setAttempted(true);
              if (await onAdd(member.memberId)) setOpen(false);
            }}
          >
            Adaugă
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberDialog({
  entry,
  group,
  busy,
  error,
  onRemove,
}: {
  entry: RosterEntry;
  group: AdminGroup;
  busy: boolean;
  error: string | null;
  onRemove: () => Promise<boolean>;
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
        aria-label={`Scoate pe ${entry.name} din grup`}
        onClick={() => {
          setAttempted(false);
          setOpen(true);
        }}
      >
        Scoate
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scoate pe {entry.name}</DialogTitle>
          <DialogDescription>
            {entry.name} nu va mai face parte din {group.name} și va primi o
            notificare.
          </DialogDescription>
        </DialogHeader>
        {attempted && error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
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
              if (await onRemove()) setOpen(false);
            }}
          >
            Scoate din grup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function rosterColumns({
  group,
  authority,
  busy,
  error,
  onRun,
}: {
  group: AdminGroup;
  authority: GroupAuthority;
  busy: boolean;
  error: string | null;
  onRun: (command: GroupCommand) => Promise<boolean>;
}): DataTableColumn<RosterEntry>[] {
  const columns: DataTableColumn<RosterEntry>[] = [
    {
      id: 'name',
      accessorFn: (row) => row.name,
      header: 'Nume',
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <MemberAvatar
            name={row.original.name}
            avatarColor={row.original.avatarColor}
          />
          <Link
            className="truncate font-medium underline"
            to={`/administrare/membri/${row.original.memberId}`}
          >
            {row.original.name}
          </Link>
        </span>
      ),
      sortFn: (left, right) =>
        left.original.name.localeCompare(right.original.name, 'ro'),
    },
    {
      id: 'group_role',
      accessorFn: (row) =>
        groupRoleLabel(row.groupRole, group.manager_title, row.positionTitle),
      header: 'Funcție în grup',
      cell: ({ row }) => (
        <Badge
          variant={row.original.groupRole === 'member' ? 'outline' : 'default'}
        >
          {groupRoleLabel(
            row.original.groupRole,
            group.manager_title,
            row.original.positionTitle,
          )}
        </Badge>
      ),
    },
    { id: 'role', accessorFn: (row) => row.roleLabel, header: 'Rol OSUBB' },
    {
      id: 'status',
      accessorFn: (row) => statusLabel(row.status),
      header: 'Statut',
    },
  ];
  if (!authority.manageWork) return columns;
  return [
    ...columns,
    {
      id: 'actions',
      header: 'Acțiuni',
      enableSorting: false,
      cell: ({ row }) =>
        // A position is ended by the authority that granted it, never by a
        // roster removal — so a Manager or Responsible is demoted first.
        row.original.groupRole === 'member' ? (
          <RemoveMemberDialog
            entry={row.original}
            group={group}
            busy={busy}
            error={error}
            onRemove={() =>
              onRun({
                kind: 'removeMember',
                groupId: group.id,
                memberId: row.original.memberId,
              })
            }
          />
        ) : (
          <span className="text-sm text-muted-foreground">
            Retrage întâi funcția
          </span>
        ),
    },
  ];
}

/**
 * The Group's roster: who is in it, under what position, and what their
 * Membership Status is (ruling R22). Deactivating a Member never edits a
 * roster, so an inactive Member stays visible here until a Manager decides.
 */
export function GroupRosterTab({
  group,
  roster,
  members,
  authority,
  busy,
  error,
  onRun,
}: {
  group: AdminGroup;
  roster: RosterEntry[];
  members: AppointableMember[];
  authority: GroupAuthority;
  busy: boolean;
  error: string | null;
  onRun: (command: GroupCommand) => Promise<boolean>;
}) {
  const inGroup = useMemo(
    () => new Set(roster.map((entry) => entry.memberId)),
    [roster],
  );
  const candidates = useMemo(
    () => members.filter((member) => !inGroup.has(member.memberId)),
    [members, inGroup],
  );

  const columns = rosterColumns({ group, authority, busy, error, onRun });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {group.automatic_membership
            ? 'Membrii acestui grup se adaugă automat, după nivel.'
            : roster.length === 1
              ? '1 membru'
              : `${roster.length} membri`}
        </p>
        {authority.manageWork && !group.automatic_membership && (
          <AddMemberDialog
            group={group}
            candidates={candidates}
            busy={busy}
            error={error}
            onAdd={(memberId) =>
              onRun({ kind: 'addMember', groupId: group.id, memberId })
            }
          />
        )}
      </div>
      <DataTable
        columns={columns}
        data={roster}
        initialSorting={[{ id: 'name', desc: false }]}
        emptyTitle="Grupul nu are încă membri."
      />
    </div>
  );
}
