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
  Page,
  PageGrid,
  PageHeader,
  SegmentedToggle,
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
import {
  activeFilterCount,
  emptyFilters,
  matchesFilters,
  statusLabel,
  type DirectoryFilters,
} from './directory-filters';

type View = 'list' | 'grid';

/** The name the directory shows and sorts by: the Nickname, else the full name. */
function shownName(member: DirectoryMember) {
  return member.nickname ?? member.name;
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

function columnsFor(
  withContact: boolean,
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
      accessorKey: 'points',
      header: 'Puncte din taskuri',
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatPoints(row.original.points)}
        </span>
      ),
      sortFn: (left, right) => left.original.points - right.original.points,
    },
    {
      id: 'status',
      accessorFn: (row) => statusLabel(row.status),
      header: 'Statut',
    },
  ];
  if (!withContact) return columns;
  return [
    ...columns,
    {
      id: 'email',
      accessorFn: (row) => row.contact?.email ?? '—',
      header: 'Email',
    },
    {
      id: 'phone',
      accessorFn: (row) => row.contact?.phone ?? '—',
      header: 'Telefon',
    },
  ];
}

function DirectoryCard({
  member,
  onOpen,
}: {
  member: DirectoryMember;
  onOpen: () => void;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-(--sh-sm)">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <DirectoryName member={member} />
          <p className="text-sm text-muted-foreground">
            {member.role} · {statusLabel(member.status)}
          </p>
        </div>
        <p className="shrink-0 text-right">
          <span className="block font-bold tabular-nums">
            {formatPoints(member.points)}
          </span>
          <span className="text-xs text-muted-foreground">puncte</span>
        </p>
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
  const members = query.data ?? [];
  const visible = members.filter((member) => matchesFilters(member, filters));
  // Contact columns appear only when the protected view supplied contact rows.
  const withContact = members.some((member) => member.contact);
  const emptyTitle = members.length
    ? 'Niciun membru nu corespunde filtrelor.'
    : 'Niciun membru disponibil.';
  return (
    <Page>
      <PageHeader
        eyebrow="Conducere"
        title="Membri OSUBB"
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
          {view === 'list' ? (
            <DataTable
              columns={columnsFor(withContact, openProfile)}
              data={visible}
              initialSorting={[{ id: 'name', desc: false }]}
              emptyTitle={emptyTitle}
            />
          ) : visible.length ? (
            <PageGrid as="ul" columns="collection">
              {visible.map((member) => (
                <DirectoryCard
                  key={member.id}
                  member={member}
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
