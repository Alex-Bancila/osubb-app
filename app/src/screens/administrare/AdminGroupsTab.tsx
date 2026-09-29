import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Network } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useCapabilities } from '../../lib/capabilities';
import { CommandError } from '../../lib/command-reasons';
import { useAuth } from '../../lib/auth';
import { minimumLevelText } from '../../lib/minimum-level';
import {
  useMyGroups,
  useRoles,
  type GroupMemberRow,
} from '../../queries/reference';
import type { MyGroup } from '../../queries/my-groups';
import {
  useAdminGroups,
  useAppointableMembers,
  useGroupCommand,
  useMyGroupRoles,
  type AdminGroup,
  type GroupCommand,
} from '../../queries/groups-admin';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import { GroupCreateDialog } from './GroupCreateDialog';
import { useAdministrareActionSlot } from './administrare-tabs';
import {
  buildTree,
  categoryLabel,
  expandableIds,
  groupRoleLabel,
  groupStatusLabel,
  inheritsGroupRole,
  varies,
  visibleRows,
  type TreeRow,
} from './group-tree';

/* The name link fills the row's height (layout AD6), and the row itself opens
   the Group on a click, so the 20 px name is no longer the only target. */
const nameLinkClass =
  'inline-flex min-h-11 min-w-0 items-center font-medium wrap-break-word text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring';
const rowLinkClass = 'cursor-pointer';

function groupPath(id: number) {
  return `/administrare/grupuri/${id}`;
}

/** An archived Group is marked beside its name, not in a column of its own. */
function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return null;
  return <Badge variant="secondary">{groupStatusLabel(status)}</Badge>;
}

function GroupDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? 'var(--brand-red)' }}
    />
  );
}

function TreeName({
  row,
  expanded,
  onToggle,
}: {
  row: TreeRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <span
      className="flex min-w-0 items-center gap-1"
      style={{ paddingInlineStart: `${row.depth * 1.25}rem` }}
    >
      {row.hasChildren ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `Restrânge subgrupurile ${row.group.name}`
              : `Extinde subgrupurile ${row.group.name}`
          }
          onClick={onToggle}
        >
          <Icon aria-hidden="true" />
        </Button>
      ) : (
        <span aria-hidden="true" className="inline-block size-11" />
      )}
      <GroupDot color={row.group.color} />
      <Link to={groupPath(row.group.id)} className={nameLinkClass}>
        {row.group.name}
      </Link>
      <PrivateGroupBadge isPrivate={row.group.is_private} />
      <StatusBadge status={row.group.status} />
    </span>
  );
}

/* Tree order is the point of this table, so no column sorts: sorting by
   member count would scatter every Child Group away from its parent. A
   column shows only when its values differ across the Groups (relevance
   B48): a Nivel minim column that reads "Recrut" on every row says nothing. */
function treeColumns(
  rows: readonly TreeRow[],
  expanded: ReadonlySet<number>,
  toggle: (id: number) => void,
): DataTableColumn<TreeRow>[] {
  const members = (row: TreeRow) =>
    row.group.automatic_membership ? 'Automat' : row.group.memberCount;
  const columns: DataTableColumn<TreeRow>[] = [
    {
      id: 'name',
      accessorFn: (row) => row.group.name,
      header: 'Grup',
      enableSorting: false,
      cell: ({ row }) => (
        <TreeName
          row={row.original}
          expanded={expanded.has(row.original.group.id)}
          onToggle={() => toggle(row.original.group.id)}
        />
      ),
    },
  ];
  if (varies(rows, (row) => row.group.category))
    columns.push({
      id: 'category',
      accessorFn: (row) => categoryLabel(row.group.category),
      header: 'Categorie',
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant="outline">
          {categoryLabel(row.original.group.category)}
        </Badge>
      ),
    });
  if (varies(rows, (row) => row.group.min_level))
    columns.push({
      id: 'min_level',
      accessorFn: (row) => minimumLevelText(row.group.min_level),
      header: 'Nivel minim',
      enableSorting: false,
    });
  if (varies(rows, members))
    columns.push({
      id: 'members',
      accessorFn: members,
      header: 'Membri',
      enableSorting: false,
    });
  return columns;
}

/* `my_groups()` carries no privacy column, so the Private Group mark comes
   from the Group rows the caller can read (`groups_read`, the same filter). */
function myGroupColumns(
  groups: readonly MyGroup[],
  privateIds: ReadonlySet<number>,
  rosterRows: readonly GroupMemberRow[] | undefined,
): DataTableColumn<MyGroup>[] {
  const columns: DataTableColumn<MyGroup>[] = [
    {
      id: 'name',
      accessorFn: (row) => row.name,
      header: 'Grup',
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <GroupDot color={row.original.color} />
          <Link to={groupPath(row.original.id)} className={nameLinkClass}>
            {row.original.name}
          </Link>
          <PrivateGroupBadge isPrivate={privateIds.has(row.original.id)} />
          <StatusBadge status={row.original.status} />
        </span>
      ),
      sortFn: (left, right) =>
        left.original.name.localeCompare(right.original.name, 'ro'),
    },
  ];
  // Only the columns whose values differ (relevance B48); the viewer's own
  // function always shows, since it is why the Group is listed.
  if (varies(groups, (row) => row.category))
    columns.push({
      id: 'category',
      accessorFn: (row) => categoryLabel(row.category),
      header: 'Categorie',
    });
  columns.push({
    id: 'group_role',
    accessorFn: (row) => groupRoleLabel(row.group_role),
    header: 'Funcția ta',
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {groupRoleLabel(row.original.group_role)}
        </Badge>
        {/* Keyed on the position, not on the roster row: a Coordonator
            from above who is also a plain member here still inherits it
            (F-17). */}
        {inheritsGroupRole(row.original, rosterRows) && (
          <span className="text-xs text-muted-foreground">
            din grupul de deasupra
          </span>
        )}
      </span>
    ),
  });
  if (varies(groups, (row) => row.min_level))
    columns.push({
      id: 'min_level',
      accessorFn: (row) => minimumLevelText(row.min_level),
      header: 'Nivel minim',
      // Ladder order, not alphabetical: BC ranks above Recrut.
      sortFn: (left, right) =>
        left.original.min_level - right.original.min_level,
    });
  return columns;
}

function GroupTree({ groups }: { groups: AdminGroup[] }) {
  const rows = useMemo(() => buildTree(groups), [groups]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );
  const expandable = useMemo(() => expandableIds(rows), [rows]);
  const shown = useMemo(() => visibleRows(rows, expanded), [rows, expanded]);
  const toggle = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allOpen = expandable.length > 0 && expanded.size === expandable.length;
  const columns = treeColumns(rows, expanded, toggle);
  const navigate = useNavigate();

  return (
    <Panel
      eyebrow="Grupuri"
      icon={Network}
      title="Structura grupurilor"
      control={
        <>
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {groups.length === 1 ? '1 grup' : `${groups.length} grupuri`}
          </p>
          {expandable.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() =>
                setExpanded(allOpen ? new Set<number>() : new Set(expandable))
              }
            >
              {allOpen ? 'Restrânge tot' : 'Extinde tot'}
            </Button>
          )}
        </>
      }
    >
      <DataTable
        columns={columns}
        data={shown}
        emptyTitle="Niciun grup."
        // Under 640 px the tree is the names: a long one wraps, and the
        // detail columns wait for the Group page.
        columnClassName={{
          name: 'whitespace-normal',
          category: 'max-sm:hidden',
          min_level: 'max-sm:hidden',
          members: 'max-sm:hidden',
        }}
        rowClassName={(row) =>
          row.group.status === 'active'
            ? rowLinkClass
            : `${rowLinkClass} text-muted-foreground`
        }
        onRowClick={(row) => void navigate(groupPath(row.group.id))}
      />
    </Panel>
  );
}

function MyGroupsTable({
  groups,
  privateIds,
  rosterRows,
}: {
  groups: MyGroup[];
  privateIds: ReadonlySet<number>;
  rosterRows: readonly GroupMemberRow[] | undefined;
}) {
  const columns = useMemo(
    () => myGroupColumns(groups, privateIds, rosterRows),
    [groups, privateIds, rosterRows],
  );
  const navigate = useNavigate();
  return (
    <DataTable
      columns={columns}
      data={groups}
      initialSorting={[{ id: 'name', desc: false }]}
      columnClassName={{ name: 'whitespace-normal' }}
      emptyTitle="Nu ai nicio funcție într-un grup."
      emptyDescription="Grupurile în care ai o funcție apar aici."
      rowClassName={() => rowLinkClass}
      onRowClick={(row) => void navigate(groupPath(row.id))}
    />
  );
}

/**
 * Administrare → Grupuri, scoped by authority (ADR-0009 §Management surface;
 * #825). BC and Moderator see the whole Group tree and create a top-level
 * Group from the page header; a Group Manager or Responsible sees the Groups
 * they hold a position in — including the Child Groups they reach only
 * through an ancestor (ruling R14) — and never a Group they are only a
 * Member of (relevance B47): that one has nothing here to manage. The same
 * Group screen opens from either list, so there is one flow and one command
 * set.
 */
export default function AdminGroupsTab() {
  const capabilities = useCapabilities();
  const createTopLevel = capabilities.data?.createTopLevelGroups === true;
  const groupsQuery = useAdminGroups();
  const myGroupsQuery = useMyGroupRoles();
  // The viewer's own roster rows: which position is held here, not above.
  const rosterRows = useMyGroups().membershipRows;
  const rolesQuery = useRoles();
  const membersQuery = useAppointableMembers(createTopLevel);
  const command = useGroupCommand();
  const actorLevel = useAuth().claims?.member_level ?? 0;
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const activeGroups = useMemo(
    () => groups.filter((group) => group.status === 'active'),
    [groups],
  );
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.id, { name: group.name }])),
    [groups],
  );
  // A Group Role, held here or inherited from above; plain membership is not
  // one (relevance B47).
  const withRole = useMemo(
    () =>
      (myGroupsQuery.data ?? []).filter(
        (group) => group.group_role !== 'member',
      ),
    [myGroupsQuery.data],
  );
  const privateIds = useMemo(
    () => new Set(groups.filter((group) => group.is_private).map((g) => g.id)),
    [groups],
  );
  const levels = useMemo(
    () => [
      ...new Set([...(rolesQuery.data?.values() ?? [])].map((r) => r.level)),
    ],
    [rolesQuery.data],
  );

  async function run(
    next: GroupCommand,
    onFailure?: (failure: unknown) => void,
  ): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setError(null);
    setMessage(null);
    try {
      await command.mutateAsync(next);
      setMessage('Grupul a fost creat.');
      return true;
    } catch (failure) {
      if (onFailure) onFailure(failure);
      else
        setError(
          failure instanceof CommandError
            ? failure.message
            : 'Nu am putut crea grupul. Reîncearcă.',
        );
      return false;
    } finally {
      submitting.current = false;
    }
  }

  const pending = createTopLevel
    ? groupsQuery.isPending
    : myGroupsQuery.isPending;
  const failed = createTopLevel ? groupsQuery.isError : myGroupsQuery.isError;
  const actionSlot = useAdministrareActionSlot();
  const title = createTopLevel ? 'Structura grupurilor' : 'Grupurile mele';
  const retry = () =>
    void (createTopLevel ? groupsQuery.refetch() : myGroupsQuery.refetch());

  return (
    <>
      {createTopLevel &&
        actionSlot &&
        createPortal(
          <GroupCreateDialog
            trigger="Creează Grup"
            title="Grup nou"
            parent={null}
            groups={activeGroups}
            groupsById={groupsById}
            levels={levels}
            actorLevel={actorLevel}
            members={membersQuery.data ?? []}
            disabled={command.isPending}
            choosePrivate={createTopLevel}
            onCreate={run}
          />,
          actionSlot,
        )}

      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      {pending ? (
        <Panel eyebrow="Grupuri" icon={Network} title={title}>
          <Loading label="Se încarcă grupurile…" />
        </Panel>
      ) : failed ? (
        <Panel eyebrow="Grupuri" icon={Network} title={title}>
          <ErrorState text="Nu am putut încărca grupurile." onRetry={retry} />
        </Panel>
      ) : createTopLevel ? (
        <GroupTree groups={groups} />
      ) : (
        <Panel eyebrow="Grupuri" icon={Network} title={title}>
          <MyGroupsTable
            groups={withRole}
            privateIds={privateIds}
            rosterRows={rosterRows}
          />
        </Panel>
      )}
    </>
  );
}
