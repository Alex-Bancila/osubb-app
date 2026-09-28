import { useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { MemberCard } from '../../components/member/MemberCard';
import { MemberName } from '../../components/member/MemberName';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import {
  EmptyState,
  ListRow,
  Page,
  PageGrid,
  PageHeader,
  SegmentedToggle,
  rowListClass,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { formatPoints } from '../../lib/format';
import {
  useMemberDirectory,
  type DirectoryMember,
} from '../../queries/member-directory';
import {
  DirectoryFilterBar,
  DirectoryFilterButton,
} from './DirectoryFilterBar';
import { MemberGroups } from './MemberGroups';
import { useMinWidth } from './use-min-width';
import {
  activeFilterCount,
  directoryColumns,
  emptyFilters,
  matchesFilters,
  statusLabel,
  type DirectoryColumns,
  type DirectoryFilters,
} from './directory-filters';

type View = 'list' | 'grid';

/** The name the directory shows and sorts by: the Nickname, else the full name. */
function shownName(member: DirectoryMember) {
  return member.nickname ?? member.name;
}

/** Cards and phone rows start as the table does: by the shown name. */
function byShownName(members: readonly DirectoryMember[]) {
  return [...members].sort((left, right) =>
    shownName(left).localeCompare(shownName(right), 'ro'),
  );
}

function DirectoryName({ member }: { member: DirectoryMember }) {
  return (
    <MemberName
      memberId={member.id}
      nickname={member.nickname}
      fullName={member.name}
      avatarColor={member.avatarColor}
      showFullName
    />
  );
}

/** A member's Task points; BC and the Moderator have none (ruling 1). */
function Points({ points }: { points: number | null }) {
  if (points === null)
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">fără puncte</span>
      </span>
    );
  return <span className="tabular-nums">{formatPoints(points)}</span>;
}

/** The email, and the phone under it when there is one. */
function Contact({ member }: { member: DirectoryMember }) {
  const email = member.contact?.email;
  const phone = member.contact?.phone;
  if (!email && !phone) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="grid">
      {email && <span>{email}</span>}
      {phone && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {phone}
        </span>
      )}
    </span>
  );
}

// The name never truncates (V1); Grupuri and Contact give way first.
const columnClassName = {
  name: 'min-w-48',
  groups: 'max-md:hidden',
  contact: 'max-lg:hidden',
};

function columnsFor(
  { withStatus, withContact }: DirectoryColumns,
  open: (member: DirectoryMember) => void,
): DataTableColumn<DirectoryMember>[] {
  const text = (value: unknown) => String(value ?? '');
  const columns: DataTableColumn<DirectoryMember>[] = [
    {
      accessorKey: 'name',
      header: 'Nume',
      cell: ({ row }) => <DirectoryName member={row.original} />,
      sortFn: (left, right) =>
        shownName(left.original).localeCompare(shownName(right.original), 'ro'),
    },
    {
      accessorKey: 'role',
      header: 'Rol',
      // Seniority, not the alphabet.
      sortFn: (left, right) =>
        left.original.roleLevel - right.original.roleLevel,
    },
    {
      id: 'groups',
      accessorFn: (row) => row.groups.map((group) => group.label).join(', '),
      header: 'Grupuri',
      cell: ({ row }) => (
        <MemberGroups
          primaryGroup={row.original.primaryGroup}
          otherMemberships={row.original.otherMemberships}
          memberName={shownName(row.original)}
          onOpen={() => open(row.original)}
        />
      ),
      sortFn: (left, right, columnId) =>
        text(left.getValue(columnId)).localeCompare(
          text(right.getValue(columnId)),
          'ro',
        ),
    },
    {
      id: 'points',
      // `undefined` sorts last both ways: BC and the Moderator have no points.
      accessorFn: (row) => row.points ?? undefined,
      sortUndefined: 'last',
      header: 'Puncte',
      cell: ({ row }) => <Points points={row.original.points} />,
      sortFn: (left, right) =>
        (left.original.points ?? 0) - (right.original.points ?? 0),
    },
  ];
  if (withStatus)
    columns.push({
      id: 'status',
      accessorFn: (row) => statusLabel(row.status),
      header: 'Statut',
    });
  if (withContact)
    columns.push({
      id: 'contact',
      accessorFn: (row) => row.contact?.email ?? '',
      header: 'Contact',
      cell: ({ row }) => <Contact member={row.original} />,
    });
  return columns;
}

/** The Role, and the status only when the list has more than one. */
function roleLine(member: DirectoryMember, withStatus: boolean) {
  return withStatus
    ? `${member.role} · ${statusLabel(member.status)}`
    : member.role;
}

/** Points with their noun under them; nothing for BC and the Moderator. */
function PointsFigure({ points }: { points: number | null }) {
  if (points === null) return null;
  return (
    <p className="m-0 shrink-0 text-right">
      <span className="block font-bold tabular-nums">
        {formatPoints(points)}
      </span>
      <span className="text-xs text-muted-foreground">puncte</span>
    </p>
  );
}

function DirectoryCard({
  member,
  withStatus,
  onOpen,
}: {
  member: DirectoryMember;
  withStatus: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-(--sh-sm)">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <DirectoryName member={member} />
          <p className="text-sm text-muted-foreground">
            {roleLine(member, withStatus)}
          </p>
        </div>
        <PointsFigure points={member.points} />
      </div>
      <MemberGroups
        primaryGroup={member.primaryGroup}
        otherMemberships={member.otherMemberships}
        memberName={shownName(member)}
        onOpen={onOpen}
      />
      {member.contact?.email && (
        <p className="truncate text-sm text-muted-foreground">
          {member.contact.email}
        </p>
      )}
    </li>
  );
}

/**
 * The list view under `md` (V1): one `ListRow` per member, name first and
 * whole, the Role under it and the points on the right — no table to scroll
 * sideways. Sorted by the shown name, as the table starts.
 */
function DirectoryRows({
  members,
  withStatus,
}: {
  members: readonly DirectoryMember[];
  withStatus: boolean;
}) {
  const sorted = byShownName(members);
  return (
    <ul className={rowListClass} aria-label="Membri">
      {sorted.map((member) => (
        <ListRow
          key={member.id}
          value={
            member.points === null ? null : (
              <PointsFigure points={member.points} />
            )
          }
        >
          <DirectoryName member={member} />
          {/* Under the name, past the 28 px avatar and its 8 px gap. */}
          <p className="m-0 -mt-1 truncate pl-9 text-sm text-muted-foreground">
            {roleLine(member, withStatus)}
          </p>
        </ListRow>
      ))}
    </ul>
  );
}

export default function VolunteersScreen() {
  const query = useMemberDirectory();
  const [filters, setFilters] = useState<DirectoryFilters>(emptyFilters);
  const [view, setView] = useState<View>('list');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<DirectoryMember | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const openProfile = (member: DirectoryMember) => {
    setSelected(member);
    setProfileOpen(true);
  };
  const wide = useMinWidth('48rem');
  const members = query.data ?? [];
  const visible = members.filter((member) => matchesFilters(member, filters));
  // Read from the whole directory, so a filter never makes a column jump.
  const optional = directoryColumns(members);
  const emptyTitle = members.length
    ? 'Niciun membru nu corespunde filtrelor.'
    : 'Niciun membru disponibil.';
  return (
    <Page>
      <PageHeader
        eyebrow="Conducere"
        title="Voluntari"
        description="Caută un membru și vezi rolul, grupurile și punctele sale din taskuri."
        actions={
          !query.isPending &&
          !query.isError && (
            <DirectoryFilterButton
              count={activeFilterCount(filters)}
              onOpen={() => setFilterOpen(true)}
            />
          )
        }
      />
      {query.isPending ? (
        <Loading label="Se încarcă membrii…" />
      ) : query.isError ? (
        <ErrorState
          error={query.error}
          text="Nu am putut încărca membrii."
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <DirectoryFilterBar
            members={members}
            filters={filters}
            onChange={setFilters}
            open={filterOpen}
            onOpenChange={setFilterOpen}
            trailing={
              <SegmentedToggle
                label="Afișare"
                className="ml-auto"
                value={view}
                onChange={setView}
                options={[
                  { value: 'list', label: 'Listă', icon: List },
                  { value: 'grid', label: 'Carduri', icon: LayoutGrid },
                ]}
              />
            }
          />
          <p role="status" className="text-sm text-muted-foreground">
            {visible.length === members.length
              ? `${members.length} membri`
              : `${visible.length} din ${members.length} membri`}
          </p>
          {view === 'list' && wide ? (
            <DataTable
              columns={columnsFor(optional, openProfile)}
              columnClassName={columnClassName}
              data={visible}
              initialSorting={[{ id: 'name', desc: false }]}
              emptyTitle={emptyTitle}
            />
          ) : view === 'list' && visible.length ? (
            <DirectoryRows members={visible} withStatus={optional.withStatus} />
          ) : visible.length ? (
            <PageGrid as="ul" columns="collection" equalHeights>
              {byShownName(visible).map((member) => (
                <DirectoryCard
                  key={member.id}
                  member={member}
                  withStatus={optional.withStatus}
                  onOpen={() => openProfile(member)}
                />
              ))}
            </PageGrid>
          ) : (
            <EmptyState bare>{emptyTitle}</EmptyState>
          )}
        </>
      )}
      {selected && (
        <MemberCard
          open={profileOpen}
          onOpenChange={setProfileOpen}
          memberId={selected.id}
          nickname={selected.nickname}
          fullName={selected.name}
          avatarColor={selected.avatarColor}
        />
      )}
    </Page>
  );
}
