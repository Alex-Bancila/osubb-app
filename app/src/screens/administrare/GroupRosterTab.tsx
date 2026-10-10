import { useMemo, useRef, useState } from 'react';
import { UserMinus } from 'lucide-react';
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
import { Empty, EmptyHeader, EmptyTitle } from '../../components/ui/empty';
import { ActionMenu } from '../../components/ui/menu';
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
import { useMinWidth } from '../volunteers/use-min-width';
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

/**
 * Taking a Member off the roster asks first. In the table the row has room
 * for the "Scoate" button; in the list (`menu`) it waits behind the row's
 * "⋯", and focus goes back to that button when the pop-up closes.
 */
function RemoveMemberDialog({
  entry,
  group,
  busy,
  error,
  menu = false,
  onRemove,
}: {
  entry: RosterEntry;
  group: AdminGroup;
  busy: boolean;
  error: string | null;
  /** Open from a "⋯" menu rather than from a button of its own. */
  menu?: boolean;
  onRemove: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);
  const ask = () => {
    setAttempted(false);
    setOpen(true);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) setAttempted(false);
      }}
    >
      {menu ? (
        <span ref={holder} className="inline-flex">
          <ActionMenu
            label={`Acțiuni pentru ${entry.name}`}
            items={[
              {
                label: 'Scoate din grup',
                icon: UserMinus,
                destructive: true,
                disabled: busy,
                onSelect: ask,
              },
            ]}
          />
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          aria-label={`Scoate pe ${entry.name} din grup`}
          onClick={ask}
        >
          Scoate
        </Button>
      )}
      <DialogContent
        // The menu that opened it is gone by now: hand focus to its button.
        finalFocus={
          menu
            ? () => holder.current?.querySelector<HTMLElement>('button') ?? true
            : undefined
        }
      >
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

/** How a Member in the Group by Automatic Membership is marked (#929). */
const AUTOMATIC_LABEL = 'Automat';

/**
 * The viewport from which the roster is a table (Tailwind's `xl`): Nume,
 * Funcție în grup, Rol OSUBB, Statut and Acțiuni need about 880 px side by
 * side, and beside the sidebar the panel only has that from 1280 px. Under it
 * each Member is a list row, so the roster never scrolls sideways.
 */
const TABLE_FROM = '80rem';

/** A Member's name: the way to their page, in the text colour. */
const nameLinkClass =
  'flex min-h-11 min-w-0 items-center font-semibold text-foreground no-underline underline-offset-4 hover:underline';

type RowContext = {
  group: AdminGroup;
  authority: GroupAuthority;
  busy: boolean;
  error: string | null;
  onRun: (command: GroupCommand) => Promise<boolean>;
};

function MemberLink({
  entry,
  group,
}: {
  entry: RosterEntry;
  group: AdminGroup;
}) {
  return (
    <Link
      className={nameLinkClass}
      to={`/administrare/membri/${entry.memberId}`}
      // The member page's back link returns here, to the Group's Membri tab
      // (navigation D4), not to a Membri tab the viewer may not open.
      state={rosterBackState(group.id)}
    >
      <span className="truncate">{entry.name}</span>
    </Link>
  );
}

/** The Member's function in the Group, as a chip. */
function FunctionBadge({
  entry,
  group,
}: {
  entry: RosterEntry;
  group: AdminGroup;
}) {
  // Automatic Membership (#929): in the Group by Role, never by hand.
  if (entry.source === 'automatic')
    return <Badge variant="secondary">{AUTOMATIC_LABEL}</Badge>;
  return (
    <Badge variant={entry.groupRole === 'member' ? 'outline' : 'default'}>
      {groupRoleLabel(
        entry.groupRole,
        group.manager_title,
        entry.positionTitle,
        group.responsible_title,
      )}
    </Badge>
  );
}

/**
 * What the viewer may do about a row: remove an ordinary Member, or read why
 * not. A position is ended by the authority that granted it, never by a
 * roster removal — so a Manager or Responsible is demoted first, and the hint
 * shows only to whoever may withdraw that position (relevance B50): a
 * Manager's by the level above, a Responsible's by the Group's Managers.
 */
function rowAction(
  entry: RosterEntry,
  { authority }: Pick<RowContext, 'authority'>,
): 'remove' | 'withdraw-first' | null {
  if (!authority.manageWork) return null;
  // An automatic member follows their Role: nothing to remove (#929).
  if (entry.source !== 'roster') return null;
  if (entry.groupRole === 'member') return 'remove';
  return canWithdraw(entry.groupRole, authority) ? 'withdraw-first' : null;
}

const WITHDRAW_FIRST = 'Retrage întâi funcția';

function RemoveControl({
  entry,
  context: { group, busy, error, onRun },
  menu,
}: {
  entry: RosterEntry;
  context: RowContext;
  menu?: boolean;
}) {
  return (
    <RemoveMemberDialog
      entry={entry}
      group={group}
      busy={busy}
      error={error}
      menu={menu}
      onRemove={() =>
        onRun({
          kind: 'removeMember',
          groupId: group.id,
          memberId: entry.memberId,
        })
      }
    />
  );
}

function rosterColumns(context: RowContext): DataTableColumn<RosterEntry>[] {
  const { group, authority } = context;
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
          <MemberLink entry={row.original} group={group} />
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
      cell: ({ row }) => <FunctionBadge entry={row.original} group={group} />,
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
      cell: ({ row }) => {
        const action = rowAction(row.original, context);
        return action === 'remove' ? (
          <RemoveControl entry={row.original} context={context} />
        ) : action === 'withdraw-first' ? (
          <span className="text-sm text-muted-foreground">
            {WITHDRAW_FIRST}
          </span>
        ) : null;
      },
    },
  ];
}

/**
 * The roster under `TABLE_FROM`: one row a Member — avatar and name, the
 * function in the Group as a chip beside it, the OSUBB Role and the
 * Membership Status on a muted line under them, and the removal behind "⋯".
 * In name order, as the table opens.
 */
function RosterList({
  entries,
  context,
  emptyTitle,
}: {
  entries: RosterEntry[];
  context: RowContext;
  emptyTitle: string;
}) {
  const { group } = context;
  const sorted = useMemo(
    () =>
      [...entries].sort((left, right) =>
        left.name.localeCompare(right.name, 'ro'),
      ),
    [entries],
  );
  if (sorted.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  return (
    <ul className={rowListClass}>
      {sorted.map((entry) => {
        const action = rowAction(entry, context);
        return (
          <ListRow
            key={entry.memberId}
            leading={
              <MemberAvatar name={entry.name} avatarColor={entry.avatarColor} />
            }
            action={
              action === 'remove' && (
                <RemoveControl entry={entry} context={context} menu />
              )
            }
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2">
              <MemberLink entry={entry} group={group} />
              <FunctionBadge entry={entry} group={group} />
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              {entry.roleLabel} · {statusLabel(entry.status)}
              {action === 'withdraw-first' && ` · ${WITHDRAW_FIRST}`}
            </p>
          </ListRow>
        );
      })}
    </ul>
  );
}

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
      <SubHeading id="membri-de-drept" variant="label" className="px-3">
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
            <MemberLink entry={entry} group={group} />
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
 * The Group's **Membri** tab — its roster: who is in it, under what position,
 * and what their Membership Status is (ruling R22). Deactivating a Member
 * never edits a roster, so an inactive Member stays visible here until a
 * Manager decides. A table from `TABLE_FROM`, where its columns fit and sort;
 * a list of rows under it — it never scrolls sideways.
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

  const context: RowContext = { group, authority, busy, error, onRun };
  const table = useMinWidth(TABLE_FROM);
  const emptyTitle = group.automatic_membership
    ? 'Membrii acestui grup se adaugă automat, după nivel.'
    : 'Grupul nu are încă membri adăugați.';

  // The count is the page header's (relevance B51); this panel carries only
  // the action.
  return (
    <Panel
      // Not "Membri": the tab's own region around this panel has that name.
      aria-label="Membrii grupului"
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
      {table ? (
        <DataTable
          columns={rosterColumns(context)}
          data={listed}
          initialSorting={[{ id: 'name', desc: false }]}
          // The name takes the room the other columns leave and shortens
          // with "…" rather than push the table past its box.
          columnClassName={{ name: 'w-full max-w-0' }}
          emptyTitle={emptyTitle}
        />
      ) : (
        <RosterList
          entries={listed}
          context={context}
          emptyTitle={emptyTitle}
        />
      )}
      {board.length > 0 && <BoardMembers group={group} entries={board} />}
    </Panel>
  );
}
