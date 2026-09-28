import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { cn } from 'cn';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { focusRingClass, PageGrid, Panel } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { memberDisplayName } from '../../components/member/member-identity';
import { ErrorState, Loading } from '../../components/states';
import { useCapabilities } from '../../lib/capabilities';
import {
  useAppointableMembers,
  type AppointableMember,
} from '../../queries/groups-admin';
import { normalizeSearch, statusLabel } from '../volunteers/directory-filters';
import { CsvImportPanel } from './CsvImportPanel';

/** The Member's page in Administrare (#103). */
function memberPagePath(memberId: string) {
  return `/administrare/membri/${encodeURIComponent(memberId)}`;
}

const nameColumn: DataTableColumn<AppointableMember> = {
  id: 'name',
  accessorFn: (row) => memberDisplayName(row.nickname, row.name),
  header: 'Membru',
  // Case- and diacritic-blind, so "stefan" finds "Ștefan".
  filterFn: (row, _columnId, value: string) =>
    normalizeSearch(
      `${memberDisplayName(row.original.nickname, row.original.name)} ${row.original.name}`,
    ).includes(normalizeSearch(value.trim())),
  sortFn: (left, right) =>
    memberDisplayName(left.original.nickname, left.original.name).localeCompare(
      memberDisplayName(right.original.nickname, right.original.name),
      'ro',
    ),
  cell: ({ row }) => (
    <div className="grid min-w-0 justify-items-start">
      <MemberName
        memberId={row.original.memberId}
        nickname={row.original.nickname}
        fullName={row.original.name}
        avatarColor={row.original.avatarColor}
        showFullName
        size="sm"
      />
      {/* Under `sm` the Rol and Status columns fold in here, under the
          name (AD1); a status is named only when it is not "Activ". */}
      <span className="-mt-1 pl-7.5 text-xs text-muted-foreground sm:hidden">
        {row.original.roleLabel}
        {row.original.status !== 'activ' &&
          ` · ${statusLabel(row.original.status)}`}
      </span>
      {/* The row click is the pointer's way in; this link is the keyboard's.
          It shows only when focused, so the row keeps one visible
          affordance (B62). */}
      <Link
        to={memberPagePath(row.original.memberId)}
        aria-label={`Deschide pagina membrului ${memberDisplayName(row.original.nickname, row.original.name)}`}
        className={cn(
          'sr-only rounded-sm text-sm font-medium underline underline-offset-4 focus-visible:not-sr-only focus-visible:inline-flex focus-visible:min-h-11 focus-visible:items-center focus-visible:pl-7.5',
          focusRingClass,
        )}
      >
        Deschide pagina membrului
      </Link>
    </div>
  ),
};

const roleColumn: DataTableColumn<AppointableMember> = {
  id: 'role',
  accessorFn: (row) => row.roleLabel,
  header: 'Rol',
  // By rank, not alphabet (Audit D-13): Recrut … BC, then the name.
  sortFn: (left, right) =>
    left.original.level - right.original.level ||
    memberDisplayName(left.original.nickname, left.original.name).localeCompare(
      memberDisplayName(right.original.nickname, right.original.name),
      'ro',
    ),
};

const statusColumn: DataTableColumn<AppointableMember> = {
  id: 'status',
  accessorFn: (row) => statusLabel(row.status),
  header: 'Status',
};

/**
 * One visible affordance per row: the row opens the member page, the name the
 * Member Card (B62); a focus-only link opens the page from the keyboard. Status only when a Member who is not active is listed —
 * a column of "Activ" says nothing.
 */
function memberColumns(
  members: readonly AppointableMember[],
): DataTableColumn<AppointableMember>[] {
  return members.some((member) => member.status !== 'activ')
    ? [nameColumn, roleColumn, statusColumn]
    : [nameColumn, roleColumn];
}

/** Rol and Status fold under the name on a phone (layout AD1). */
const columnClassName = {
  name: 'min-w-40 whitespace-normal',
  role: 'max-sm:hidden',
  status: 'max-sm:hidden',
};

function MembersPanel() {
  const members = useAppointableMembers();
  const navigate = useNavigate();
  const data = useMemo(() => members.data ?? [], [members.data]);
  const columns = useMemo(() => memberColumns(data), [data]);
  return (
    <Panel eyebrow="Membri" icon={Users} title="Membri">
      {members.isPending ? (
        <Loading label="Se încarcă membrii…" />
      ) : members.isError ? (
        <ErrorState
          text="Nu am putut încărca membrii."
          onRetry={() => void members.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          filters={[{ columnId: 'name', label: 'Caută un membru' }]}
          initialSorting={[{ id: 'name', desc: false }]}
          emptyTitle="Niciun membru găsit."
          columnClassName={columnClassName}
          onRowClick={(row) => void navigate(memberPagePath(row.memberId))}
        />
      )}
    </Panel>
  );
}

/**
 * Administrare → Membri (#825): every Member, each opening their page (#103),
 * and — for whoever may provision accounts — the CSV import. Mounted behind
 * `manageRoles` or `provisionMembers`; the server decides every read again.
 */
export default function AdminMembersTab() {
  const capabilities = useCapabilities();
  const provision = capabilities.data?.provisionMembers === true;
  // The page decides which panels exist before the grid renders (R27).
  return (
    <PageGrid columns={1}>
      <MembersPanel />
      {provision && <CsvImportPanel />}
    </PageGrid>
  );
}
