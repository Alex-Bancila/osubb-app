import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Network } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { cn } from 'cn';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { Panel, SegmentedToggle } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useCapabilities } from '../../lib/capabilities';
import { CommandError } from '../../lib/command-reasons';
import { useAuth } from '../../lib/auth';
import { minimumLevelText } from '../../lib/minimum-level';
import { useMyGroups, useRoles } from '../../queries/reference';
import {
  useAdminGroups,
  useAppointableMembers,
  useGroupCommand,
  useMyGroupRoles,
  type AdminGroup,
  type GroupCommand,
} from '../../queries/groups-admin';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import { GroupCreateDialog, GroupCreatedReceipt } from './GroupCreateDialog';
import { useAdministrareActionSlot } from './administrare-tabs';
import {
  buildTree,
  categoryLabel,
  expandableIds,
  groupRoleLabel,
  createdGroupManager,
  groupStatusLabel,
  leadsAny,
  ledTree,
  varies,
  visibleRows,
  type LedRow,
  type TreeRow,
} from './group-tree';
import { useGroupsView, type GroupsView } from './groups-view';

/* The name link fills the row's height (layout AD6), and the row itself opens
   the Group on a click, so the 20 px name is no longer the only target. */
const nameLinkClass =
  'inline-flex min-h-11 min-w-0 items-center wrap-break-word text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring';
const rowLinkClass = 'cursor-pointer';

/* A top-level Group carries the weight; a subgroup reads as subordinate. */
function nameWeight(depth: number) {
  return depth === 0 ? 'font-semibold' : 'font-normal';
}

function groupPath(id: number) {
  return `/administrare/grupuri/${id}`;
}

/** An archived Group is marked beside its name, not in a column of its own. */
function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return null;
  return <Badge variant="secondary">{groupStatusLabel(status)}</Badge>;
}

/**
 * The tree's node: a top-level Group is a full-strength dot in its colour, a
 * subgroup a ring of it (#921). 11 px, so the 1 px rail sits on a whole pixel
 * through its centre.
 */
function GroupNode({ color, depth }: { color: string | null; depth: number }) {
  const ink = color || 'var(--brand-red)';
  return (
    <span
      aria-hidden="true"
      data-slot="group-node"
      className={cn(
        'size-[11px] shrink-0 rounded-full',
        depth > 0 && 'border-[1.5px]',
      )}
      style={depth === 0 ? { backgroundColor: ink } : { borderColor: ink }}
    />
  );
}

/* The tree guide's geometry, from the cell's padding edge: the cell's 8 px
   padding, the 48 px chevron gutter when the tree folds, 20 px per level, and
   the node's 5 px to its centre line. Vertically the node sits on the name's
   first line — 8 px of padding plus half the 44 px line, 30 px down — so a
   name that wraps (or a Privat badge that drops below it at 375 px) never
   moves the node off its elbow. */
const INDENT_REM = 1.25;
function railLeft(level: number, gutter: boolean) {
  return `calc(${(gutter ? 3.5 : 0.5) + level * INDENT_REM}rem + 5px)`;
}

const railClass = 'pointer-events-none absolute w-px bg-(--ink-300)';

/**
 * The tree rail (#921): a vertical line from a parent's node through its
 * children, with an elbow into each child, so a subgroup is recognisable
 * without reading its indentation. Drawn against the cell (`relative`), full
 * height and across the row border, so the rail never breaks between rows.
 */
function TreeGuide({
  row,
  gutter,
  stem,
}: {
  row: TreeRow;
  gutter: boolean;
  /** Its children show below it: a rail leaves its node downwards. */
  stem: boolean;
}) {
  const lines: { key: string; style: CSSProperties; className: string }[] = [];
  row.continues.forEach((runsOn, level) => {
    if (runsOn)
      lines.push({
        key: `through-${level}`,
        style: { left: railLeft(level, gutter) },
        className: 'top-0 -bottom-px',
      });
  });
  if (row.depth > 0 && !row.last)
    lines.push({
      key: 'sibling',
      style: { left: railLeft(row.depth - 1, gutter) },
      className: 'top-0 -bottom-px',
    });
  if (stem)
    lines.push({
      key: 'stem',
      style: { left: railLeft(row.depth, gutter) },
      className: 'top-[38px] -bottom-px',
    });
  return (
    <span aria-hidden="true" data-slot="tree-guide">
      {lines.map((line) => (
        <span
          key={line.key}
          className={cn(railClass, line.className)}
          style={line.style}
        />
      ))}
      {row.depth > 0 && (
        <span
          data-slot="tree-elbow"
          className="pointer-events-none absolute top-0 h-[30.5px] w-3 rounded-bl-[6px] border-b border-l border-(--ink-300)"
          style={{ left: railLeft(row.depth - 1, gutter) }}
        />
      )}
    </span>
  );
}

/**
 * The name cell: the fold control in a gutter of its own (aligned on every
 * parent, whatever its depth), the rail, the node and the name. A subgroup's
 * name tells a screen reader whose subgroup it is.
 */
function TreeName({
  row,
  gutter,
  stem,
  toggle,
  link = true,
}: {
  row: TreeRow;
  gutter: boolean;
  stem: boolean;
  toggle?: { expanded: boolean; onToggle: () => void };
  /** False for a context parent in Conduse de mine: shown, not opened. */
  link?: boolean;
}) {
  const Icon = toggle?.expanded ? ChevronDown : ChevronRight;
  const subgroupOf = row.parentName && (
    <span className="sr-only">, subgrup al {row.parentName}</span>
  );
  return (
    <span className="flex min-w-0 items-start">
      <TreeGuide row={row} gutter={gutter} stem={stem} />
      {gutter &&
        (row.hasChildren && toggle ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="me-1 shrink-0"
            aria-expanded={toggle.expanded}
            aria-label={
              toggle.expanded
                ? `Restrânge subgrupurile ${row.group.name}`
                : `Extinde subgrupurile ${row.group.name}`
            }
            onClick={toggle.onToggle}
          >
            <Icon aria-hidden="true" />
          </Button>
        ) : (
          <span aria-hidden="true" className="me-1 inline-block size-11" />
        ))}
      <span
        aria-hidden="true"
        className="shrink-0"
        style={{ width: `${row.depth * INDENT_REM}rem` }}
      />
      <span className="flex h-11 shrink-0 items-center">
        <GroupNode color={row.group.color} depth={row.depth} />
      </span>
      <span className="ms-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {link ? (
          <Link
            to={groupPath(row.group.id)}
            className={cn(nameLinkClass, nameWeight(row.depth))}
          >
            {row.group.name}
            {subgroupOf}
          </Link>
        ) : (
          <span
            data-slot="tree-context-name"
            className={cn(
              'inline-flex min-h-11 min-w-0 items-center wrap-break-word',
              nameWeight(row.depth),
            )}
          >
            {row.group.name}
            {subgroupOf}
          </span>
        )}
        <PrivateGroupBadge isPrivate={row.group.is_private} />
        <StatusBadge status={row.group.status} />
      </span>
    </span>
  );
}

/* A subgroup's details step back with it (#921); an archived Group is muted
   whatever its depth. */
function rowTone(row: TreeRow) {
  return row.depth > 0 || row.group.status !== 'active'
    ? 'text-muted-foreground'
    : '';
}

function CategoryBadge({ row }: { row: TreeRow }) {
  return (
    <Badge
      variant="outline"
      className={cn(row.depth > 0 && 'text-muted-foreground')}
    >
      {categoryLabel(row.group.category)}
    </Badge>
  );
}

/* Tree order is the point of this table, so no column sorts: sorting by
   member count would scatter every Child Group away from its parent. A
   column shows only when its values differ across the Groups (relevance
   B48): a Nivel minim column that reads "Recrut" on every row says nothing. */
function detailColumns<Row extends TreeRow>(
  rows: readonly Row[],
): DataTableColumn<Row>[] {
  const columns: DataTableColumn<Row>[] = [];
  if (varies(rows, (row) => row.group.category))
    columns.push({
      id: 'category',
      accessorFn: (row) => categoryLabel(row.group.category),
      header: 'Categorie',
      enableSorting: false,
      cell: ({ row }) => <CategoryBadge row={row.original} />,
    });
  if (varies(rows, (row) => row.group.min_level))
    columns.push({
      id: 'min_level',
      accessorFn: (row) => minimumLevelText(row.group.min_level),
      header: 'Nivel minim',
      enableSorting: false,
    });
  return columns;
}

function treeColumns(
  rows: readonly TreeRow[],
  shown: readonly TreeRow[],
  expanded: ReadonlySet<number>,
  toggle: (id: number) => void,
): DataTableColumn<TreeRow>[] {
  const members = (row: TreeRow) => row.group.memberCount;
  const gutter = rows.some((row) => row.hasChildren);
  const next = new Map(shown.map((row, index) => [row, shown[index + 1]]));
  const columns: DataTableColumn<TreeRow>[] = [
    {
      id: 'name',
      accessorFn: (row) => row.group.name,
      header: 'Grup',
      enableSorting: false,
      cell: ({ row }) => (
        <TreeName
          row={row.original}
          gutter={gutter}
          stem={(next.get(row.original)?.depth ?? 0) > row.original.depth}
          toggle={{
            expanded: expanded.has(row.original.group.id),
            onToggle: () => toggle(row.original.group.id),
          }}
        />
      ),
    },
    ...detailColumns(rows),
  ];
  if (varies(rows, members))
    columns.push({
      id: 'members',
      accessorFn: members,
      header: 'Membri',
      enableSorting: false,
    });
  return columns;
}

/**
 * Conduse de mine: the led Groups in tree order, each with the viewer's
 * function — "moștenit" when it comes from a Group above (ruling R14) — and a
 * context parent greyed, without a link or a function.
 */
function ledColumns(rows: readonly LedRow[]): DataTableColumn<LedRow>[] {
  const next = new Map(rows.map((row, index) => [row, rows[index + 1]]));
  const led = rows.filter((row) => row.lead !== null);
  // The position as this Group names it (#962): a Responsible of a Department
  // that calls its Responsibles "Coordonator" reads "Coordonator".
  const lead = (row: LedRow) =>
    row.lead
      ? groupRoleLabel(
          row.lead.groupRole,
          row.group.manager_title,
          null,
          row.group.responsible_title,
        )
      : '';
  return [
    {
      id: 'name',
      accessorFn: (row) => row.group.name,
      header: 'Grup',
      enableSorting: false,
      cell: ({ row }) => (
        <TreeName
          row={row.original}
          gutter={false}
          stem={(next.get(row.original)?.depth ?? 0) > row.original.depth}
          link={row.original.lead !== null}
        />
      ),
    },
    {
      id: 'group_role',
      accessorFn: lead,
      header: 'Funcția ta',
      enableSorting: false,
      cell: ({ row }) => {
        const position = row.original.lead;
        if (!position) return null;
        return (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline">{lead(row.original)}</Badge>
            {/* Keyed on the position, not on the roster row: a Coordonator
                from above who is also a plain member here still inherits it
                (F-17). */}
            {position.inherited && (
              <span className="text-xs text-muted-foreground">moștenit</span>
            )}
          </span>
        );
      },
    },
    ...detailColumns(led),
  ];
}

/* Under 640 px the tree is the names: a long one wraps, and the detail
   columns wait for the Group page. The name cell anchors the rail and keeps
   its first line at the top, where the rail's elbow meets it. */
const treeColumnClass = {
  name: 'relative whitespace-normal [&:is(td)]:align-top',
  category: 'max-sm:hidden',
  min_level: 'max-sm:hidden',
  members: 'max-sm:hidden',
};

function ViewToggle({
  view,
  onChange,
}: {
  view: GroupsView;
  onChange: (view: GroupsView) => void;
}) {
  return (
    <SegmentedToggle
      label="Grupuri afișate"
      options={[
        { value: 'all', label: 'Toate' },
        { value: 'led', label: 'Conduse de mine' },
      ]}
      value={view}
      onChange={onChange}
      className="max-sm:w-full max-sm:*:flex-auto max-sm:*:px-3"
    />
  );
}

function countText(count: number) {
  return count === 1 ? '1 grup' : `${count} grupuri`;
}

function GroupTree({
  groups,
  viewToggle,
}: {
  groups: AdminGroup[];
  viewToggle?: ReactNode;
}) {
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
  const columns = treeColumns(rows, shown, expanded, toggle);
  const navigate = useNavigate();

  return (
    <Panel
      eyebrow="Grupuri"
      icon={Network}
      title="Structura grupurilor"
      control={
        <>
          {viewToggle}
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {countText(groups.length)}
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
        columnClassName={treeColumnClass}
        rowClassName={(row) => cn(rowLinkClass, rowTone(row))}
        onRowClick={(row) => void navigate(groupPath(row.group.id))}
      />
    </Panel>
  );
}

function LedGroups({
  rows,
  title,
  viewToggle,
}: {
  rows: LedRow[];
  title: string;
  viewToggle?: ReactNode;
}) {
  const columns = useMemo(() => ledColumns(rows), [rows]);
  const navigate = useNavigate();
  const count = rows.filter((row) => row.lead !== null).length;
  return (
    <Panel
      eyebrow="Grupuri"
      icon={Network}
      title={title}
      control={
        <>
          {viewToggle}
          {count > 0 && (
            <p role="status" className="m-0 text-sm text-muted-foreground">
              {countText(count)}
            </p>
          )}
        </>
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        columnClassName={treeColumnClass}
        emptyTitle="Nu ai nicio funcție într-un grup."
        emptyDescription="Grupurile în care ai o funcție apar aici."
        rowClassName={(row) =>
          row.lead ? cn(rowLinkClass, rowTone(row)) : 'text-muted-foreground'
        }
        onRowClick={(row) => {
          if (row.lead) void navigate(groupPath(row.group.id));
        }}
      />
    </Panel>
  );
}

/**
 * Administrare → Grupuri, scoped by authority (ADR-0009 §Management surface;
 * #825). BC and Moderator see the whole Group tree and create a top-level
 * Group from the page header; when they also hold a Group Role, a **Toate |
 * Conduse de mine** switch (`?vedere=conduse`, #921) narrows it to the Groups
 * they lead. A Group Manager or Responsible sees exactly those — including
 * the Child Groups they reach only through an ancestor (ruling R14) — and
 * never a Group they are only a Member of (relevance B47), so for them the
 * page is already Conduse de mine and needs no switch. The same Group screen
 * opens from either list, so there is one flow and one command set.
 */
export default function AdminGroupsTab() {
  const capabilities = useCapabilities();
  const createTopLevel = capabilities.data?.createTopLevelGroups === true;
  const groupsQuery = useAdminGroups();
  const myGroupsQuery = useMyGroupRoles();
  // The viewer's own roster rows: which position is held here, not above.
  // The led view waits for them, so no role is classed without them.
  const rosterQuery = useMyGroups();
  const rosterRows = rosterQuery.membershipRows;
  const rolesQuery = useRoles();
  const membersQuery = useAppointableMembers(createTopLevel);
  const command = useGroupCommand();
  const actorLevel = useAuth().claims?.member_level ?? 0;
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<ReactNode>(null);
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
  const mine = myGroupsQuery.data;
  const ledReady =
    mine !== undefined && !rosterQuery.isPending && !rosterQuery.isError;
  const led = useMemo(
    () => (mine && ledReady ? ledTree(groups, mine, rosterRows) : []),
    [groups, mine, ledReady, rosterRows],
  );
  // The switch is for BC and Moderator holding a Group Role: anyone else
  // sees one list here, so it would choose between the same rows.
  const canSwitch = createTopLevel && ledReady && leadsAny(mine);
  const [view, chooseView] = useGroupsView(canSwitch);
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
      setMessage(
        next.kind === 'create' ? (
          <GroupCreatedReceipt
            manager={createdGroupManager(next, membersQuery.data ?? [])}
          />
        ) : (
          'Grupul a fost creat.'
        ),
      );
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

  // A Manager's list is built from `my_groups()`; the Group rows only add
  // the tree's context and the Privat mark, so their failure hides nothing.
  const pending = createTopLevel
    ? groupsQuery.isPending
    : myGroupsQuery.isPending || rosterQuery.isPending || groupsQuery.isPending;
  const failed = createTopLevel
    ? groupsQuery.isError
    : myGroupsQuery.isError || rosterQuery.isError;
  const actionSlot = useAdministrareActionSlot();
  const title =
    createTopLevel && view === 'all'
      ? 'Structura grupurilor'
      : 'Grupurile mele';
  const retry = () =>
    void (createTopLevel
      ? groupsQuery.refetch()
      : Promise.all([myGroupsQuery.refetch(), rosterQuery.refetch()]));
  const viewToggle = canSwitch ? (
    <ViewToggle view={view} onChange={chooseView} />
  ) : undefined;

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
      ) : createTopLevel && view === 'all' ? (
        <GroupTree groups={groups} viewToggle={viewToggle} />
      ) : (
        <LedGroups rows={led} title={title} viewToggle={viewToggle} />
      )}
    </>
  );
}
