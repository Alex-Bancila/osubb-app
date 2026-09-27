import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { PageGrid, Panel } from '../../components/layout';
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

const columns: DataTableColumn<AppointableMember>[] = [
  {
    id: 'name',
    accessorFn: (row) => memberDisplayName(row.nickname, row.name),
    header: 'Membru',
    // Case- and diacritic-blind, so "stefan" finds "Ștefan".
    filterFn: (row, _columnId, value: string) =>
      normalizeSearch(
        `${memberDisplayName(row.original.nickname, row.original.name)} ${row.original.name}`,
      ).includes(normalizeSearch(value.trim())),
    sortFn: (left, right) =>
      memberDisplayName(
        left.original.nickname,
        left.original.name,
      ).localeCompare(
        memberDisplayName(right.original.nickname, right.original.name),
        'ro',
      ),
    cell: ({ row }) => (
      <MemberName
        memberId={row.original.memberId}
        nickname={row.original.nickname}
        fullName={row.original.name}
        avatarColor={row.original.avatarColor}
        showFullName
        size="sm"
      />
    ),
  },
  {
    id: 'role',
    accessorFn: (row) => row.roleLabel,
    header: 'Rol',
  },
  {
    id: 'status',
    accessorFn: (row) => statusLabel(row.status),
    header: 'Status',
  },
  {
    id: 'page',
    header: 'Pagina membrului',
    enableSorting: false,
    cell: ({ row }) => (
      <Link
        to={memberPagePath(row.original.memberId)}
        aria-label={`Pagina membrului: ${memberDisplayName(row.original.nickname, row.original.name)}`}
        className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
      >
        Pagina membrului
      </Link>
    ),
  },
];

function MembersPanel() {
  const members = useAppointableMembers();
  const navigate = useNavigate();
  const data = useMemo(() => members.data ?? [], [members.data]);
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
