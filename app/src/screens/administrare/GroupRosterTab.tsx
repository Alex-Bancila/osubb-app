import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ListRow,
  Panel,
  rowListClass,
  SubHeading,
} from '../../components/layout';
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
import { groupRoleLabel, rosterBackState } from './group-tree';

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
            className="inline-flex min-h-11 min-w-0 items-center truncate font-medium underline underline-offset-4"
            to={`/administrare/membri/${row.original.memberId}`}
            // The member page's back link returns here, to the Roster
            // (navigation D4), not to a Membri tab the viewer may not open.
            state={rosterBackState(group.id)}
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
        groupRoleLabel(
          row.groupRole,
          group.manager_title,
          row.positionTitle,
          group.responsible_title,
        ),
      header: 'Funcție în grup',
      cell: ({ row }) =>
        // Automatic Membership (#929): in the Group by Role, never by hand.
        row.original.source === 'automatic' ? (
          <Badge variant="secondary">{AUTOMATIC_LABEL}</Badge>
        ) : (
          <Badge
            variant={
              row.original.groupRole === 'member' ? 'outline' : 'default'
            }
          >
            {groupRoleLabel(
              row.original.groupRole,
              group.manager_title,
              row.original.positionTitle,
              group.responsible_title,
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
      cell: ({ row }) => rosterAction(row.original),
    },
  ];

  function rosterAction(entry: RosterEntry) {
    // An automatic member follows their Role: nothing to remove (#929).
    if (entry.source !== 'roster') return null;
    // A position is ended by the authority that granted it, never by a
    // roster removal — so a Manager or Responsible is demoted first, and
    // the hint shows only to whoever may withdraw that position
    // (relevance B50): a Manager's by the level above, a Responsible's
    // by the Group's Managers.
    return entry.groupRole === 'member' ? (
      <RemoveMemberDialog
        entry={entry}
        group={group}
        busy={busy}
        error={error}
        onRemove={() =>
          onRun({
            kind: 'removeMember',
            groupId: group.id,
            memberId: entry.memberId,
          })
        }
      />
    ) : canWithdraw(entry.groupRole, authority) ? (
      <span className="text-sm text-muted-foreground">
        Retrage întâi funcția
      </span>
    ) : null;
  }
}

/** How a Member in the Group by Automatic Membership is marked (#929). */
const AUTOMATIC_LABEL = 'Automat';

/**
 * The membri de drept (#929, ruling R32): every active BC member and the
 * Moderator belong to every Group by their Role. They close the roster in
 * their own list, named and marked by Role, with nothing to remove — a Role,
 * not an Appointment, puts them here.
 */
function BoardMembers({
  group,
  entries,
}: {
  group: AdminGroup;
  entries: RosterEntry[];
}) {
  return (
    <section
      aria-labelledby="membri-de-drept"
      data-testid="board-members"
      className="flex flex-col gap-1 border-t border-(--border-soft) pt-4"
    >
      {/* The page header already counts them among the members. */}
      <SubHeading id="membri-de-drept" className="px-3">
        Biroul de Conducere · membri de drept
      </SubHeading>
      <p className="m-0 px-3 text-sm text-muted-foreground">
        Fac parte din fiecare grup prin rolul lor și nu primesc notificări de la
        grup.
      </p>
      <ul className={rowListClass}>
        {entries.map((entry) => (
          <ListRow
            key={entry.memberId}
            leading={
              <MemberAvatar name={entry.name} avatarColor={entry.avatarColor} />
            }
            value={<Badge variant="outline">{entry.roleLabel}</Badge>}
          >
            <Link
              className="inline-flex min-h-11 max-w-full items-center truncate text-sm font-medium underline underline-offset-4"
              to={`/administrare/membri/${entry.memberId}`}
              state={rosterBackState(group.id)}
            >
              {entry.name}
            </Link>
          </ListRow>
        ))}
      </ul>
    </section>
  );
}

/** Whether the viewer may end this Group Role (Roluri's own rule). */
function canWithdraw(
  groupRole: RosterEntry['groupRole'],
  authority: GroupAuthority,
) {
  if (groupRole === 'manager') return authority.appointManager;
  if (groupRole === 'responsible') return authority.manageGroup;
  return false;
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
  // The table lists the roster and the automatic members; the membri de drept
  // close the panel in their own list (#929).
  const listed = useMemo(
    () => roster.filter((entry) => entry.source !== 'board'),
    [roster],
  );
  const board = useMemo(
    () => roster.filter((entry) => entry.source === 'board'),
    [roster],
  );
  // Only a roster row keeps a Member out of the picker: a BC member may still
  // be added by hand, and then leaves the membri de drept for the table.
  const inGroup = useMemo(
    () =>
      new Set(
        roster
          .filter((entry) => entry.source === 'roster')
          .map((entry) => entry.memberId),
      ),
    [roster],
  );
  const candidates = useMemo(
    () => members.filter((member) => !inGroup.has(member.memberId)),
    [members, inGroup],
  );

  const columns = rosterColumns({ group, authority, busy, error, onRun });

  // The count is the page header's (relevance B51); this panel carries only
  // the action.
  return (
    <Panel
      aria-label="Roster"
      stack={4}
      control={
        authority.manageWork &&
        !group.automatic_membership && (
          <AddMemberDialog
            group={group}
            candidates={candidates}
            busy={busy}
            error={error}
            onAdd={(memberId) =>
              onRun({ kind: 'addMember', groupId: group.id, memberId })
            }
          />
        )
      }
    >
      <DataTable
        columns={columns}
        data={listed}
        initialSorting={[{ id: 'name', desc: false }]}
        // Under 640 px the name, the function and the action fit; the
        // OSUBB Role waits for the member page.
        columnClassName={{ role: 'max-sm:hidden' }}
        emptyTitle={
          group.automatic_membership
            ? 'Membrii acestui grup se adaugă automat, după nivel.'
            : 'Grupul nu are încă membri adăugați.'
        }
      />
      {board.length > 0 && <BoardMembers group={group} entries={board} />}
    </Panel>
  );
}
