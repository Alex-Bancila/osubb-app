import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { cn } from 'cn';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import {
  focusRingClass,
  PageGrid,
  Panel,
  SegmentedToggle,
} from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { memberDisplayName } from '../../components/member/member-identity';
import { ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { useCapabilities } from '../../lib/capabilities';
import {
  useAppointableMembers,
  type AppointableMember,
} from '../../queries/groups-admin';
import { useUninvitedMembers } from '../../queries/volunteer-import';
import { normalizeSearch, statusLabel } from '../volunteers/directory-filters';
import { MemberCount } from '../volunteers/MemberCount';
import { CsvImportDialog } from './CsvImportDialog';
import { InviteMemberDialog, type InvitedMember } from './InviteMemberDialog';
import { UninvitedGrid } from './UninvitedGrid';

type MembersView = 'all' | 'uninvited';

/** "De invitat" lives in the URL (`?vedere=de-invitat`), so a reload keeps it. */
const VIEW_PARAM = 'vedere';
const UNINVITED = 'de-invitat';

/** The Member's page in Administrare (#103). */
function memberPagePath(memberId: string) {
  return `/administrare/membri/${encodeURIComponent(memberId)}`;
}

/**
 * The name column. `invited` names the Members invited from this page in
 * this visit (#931): their row says so until the page is left, since whether
 * they signed in yet is only on their own page (`reinvite-member`).
 */
function nameColumn(
  invited: ReadonlySet<string>,
): DataTableColumn<AppointableMember> {
  return {
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
      <div className="grid min-w-0 justify-items-start">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
          <MemberName
            memberId={row.original.memberId}
            nickname={row.original.nickname}
            fullName={row.original.name}
            avatarColor={row.original.avatarColor}
            showFullName
            size="sm"
          />
          {invited.has(row.original.memberId) && (
            <Badge variant="outline">Invitație trimisă</Badge>
          )}
        </span>
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
}

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
  invited: ReadonlySet<string>,
): DataTableColumn<AppointableMember>[] {
  const name = nameColumn(invited);
  return members.some((member) => member.status !== 'activ')
    ? [name, roleColumn, statusColumn]
    : [name, roleColumn];
}

/** Voluntari's count, in its place under the search, following it (#1018). */
function memberCount(shown: number, total: number) {
  return <MemberCount shown={shown} total={total} />;
}

/** Rol and Status fold under the name on a phone (layout AD1). */
const columnClassName = {
  name: 'min-w-40 whitespace-normal',
  role: 'max-sm:hidden',
  status: 'max-sm:hidden',
};

function MembersPanel({ provision }: { provision: boolean }) {
  const members = useAppointableMembers();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Only whoever may provision sees the import's list (#992).
  const uninvited = useUninvitedMembers(provision);
  const view: MembersView =
    provision && params.get(VIEW_PARAM) === UNINVITED ? 'uninvited' : 'all';
  const [visited, setVisited] = useState(false);
  const gridMounted = visited || view === 'uninvited';
  if (view === 'uninvited' && !visited) setVisited(true);
  const setView = (next: MembersView) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next === 'uninvited') copy.set(VIEW_PARAM, UNINVITED);
        else copy.delete(VIEW_PARAM);
        return copy;
      },
      { replace: true },
    );
  const [invited, setInvited] = useState<InvitedMember[]>([]);
  const invitedIds = useMemo(
    () => new Set(invited.map((member) => member.userId)),
    [invited],
  );
  const data = useMemo(() => members.data ?? [], [members.data]);
  const columns = useMemo(
    () => memberColumns(data, invitedIds),
    [data, invitedIds],
  );
  const latest = invited.at(-1);
  return (
    <Panel
      title="Membri"
      control={
        provision && (
          // The two ways a Member comes in, as one pair (#949): two equal
          // columns, so they match in size at every width.
          <div
            role="group"
            aria-label="Adaugă membri"
            className="grid grid-cols-2 gap-2"
          >
            <InviteMemberDialog
              onInvited={(member) =>
                setInvited((current) => [...current, member])
              }
            />
            <CsvImportDialog onShowUninvited={() => setView('uninvited')} />
          </div>
        )
      }
      stack={latest || provision ? 3 : undefined}
    >
      {provision && (
        <SegmentedToggle
          label="Vizualizare"
          className="self-start"
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: 'Toți' },
            {
              value: 'uninvited',
              label:
                uninvited.data && uninvited.data.length > 0
                  ? `De invitat (${uninvited.data.length})`
                  : 'De invitat',
            },
          ]}
        />
      )}
      {latest && (
        <p role="status" className="text-sm">
          {/* No name here: a Member's name renders through MemberName, and
              the row's badge already points at the new Member. */}
          Invitația a fost trimisă la {latest.email}. Membrul apare în listă cu
          „Invitație trimisă”; intră în aplicație când deschide linkul din
          email.
        </p>
      )}
      {/* Mounted from the first visit on and only hidden after, so a sending
          run keeps its progress while BC looks at "Toți". */}
      {gridMounted && (
        <div hidden={view !== 'uninvited'} className="min-w-0">
          <UninvitedGrid />
        </div>
      )}
      {view === 'uninvited' ? null : members.isPending ? (
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
          summary={memberCount}
        />
      )}
    </Panel>
  );
}

/**
 * Administrare → Membri (#825): every Member, each opening their page (#103),
 * and — for whoever may provision accounts — "Invită membru" (#931) and
 * "Import CSV" side by side in the panel's header (#949). Mounted behind
 * `manageRoles` or `provisionMembers`; the server decides every read again.
 */
export default function AdminMembersTab() {
  const capabilities = useCapabilities();
  const provision = capabilities.data?.provisionMembers === true;
  // The page decides which panels exist before the grid renders (R27).
  return (
    <PageGrid columns={1}>
      <MembersPanel provision={provision} />
    </PageGrid>
  );
}
