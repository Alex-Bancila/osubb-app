import { formatPoints } from '../../lib/format';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Trophy, XIcon } from 'lucide-react';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { GroupFilterCombobox } from '../../components/group/GroupFilterCombobox';
import { GroupOption, groupOptionLabel } from '../../components/ui/combobox';
import {
  useLeadershipLeaderboard,
  useLeadershipCup,
  useLeadershipFilters,
  type LeaderboardRow,
} from '../../queries/leadership';
import { LeadershipAccess } from './LeadershipAccess';

const columns: DataTableColumn<LeaderboardRow>[] = [
  {
    id: 'member',
    accessorFn: (row) => row.nickname || row.full_name,
    header: 'Membru',
    // The card carries "Vezi istoricul taskurilor" for leadership viewers.
    cell: ({ row }) => (
      <MemberName
        memberId={row.original.member_id}
        nickname={row.original.nickname}
        fullName={row.original.full_name}
      />
    ),
  },
  {
    accessorKey: 'points',
    header: 'Puncte',
    cell: ({ row }) => (
      <span className="font-semibold tabular-nums">
        {formatPoints(row.original.points)}
      </span>
    ),
  },
];
type FilterGroup = {
  id: number;
  name: string;
  path: number[];
  status: string;
};

// A searchable Group picker: `Name · Parent` tells two same-named teams apart,
// and choosing a parent Group counts every Group below it.
function GroupFilter({
  groups,
  value,
  onChange,
}: {
  groups: FilterGroup[];
  value: FilterGroup | null;
  onChange: (group: FilterGroup | null) => void;
}) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const label = (group: FilterGroup) =>
    groupOptionLabel(group, groupsById) +
    (group.status === 'archived' ? ' (arhivat)' : '');
  return (
    <div className="grid gap-1 text-sm font-medium">
      <span id="leadership-group-label">Grup</span>
      <GroupFilterCombobox
        ariaLabelledBy="leadership-group-label"
        groups={groups}
        groupsById={groupsById}
        value={value}
        onValueChange={onChange}
        placeholder="Toate grupurile"
        itemToStringLabel={label}
        renderItem={(group) => (
          <>
            <GroupOption group={group} groupsById={groupsById} />
            {group.status === 'archived' && (
              <span className="text-xs text-muted-foreground">arhivat</span>
            )}
          </>
        )}
      />
    </div>
  );
}

const selectStyle =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring';
function LeadershipContent() {
  const navigate = useNavigate();
  const [groupId, setGroupId] = useState<number>();
  const [campaignId, setCampaignId] = useState<number>();
  const options = useLeadershipFilters();
  const board = useLeadershipLeaderboard({ groupId, campaignId });
  const cup = useLeadershipCup(campaignId);
  const selectedGroup = options.data?.groups.find(
    (group) => group.id === groupId,
  );
  const selectedCampaign = options.data?.campaigns.find(
    (campaign) => campaign.id === campaignId,
  );
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">
          OSUBB · Conducere
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Clasament</h1>
        <p className="text-muted-foreground">
          Punctele taskurilor, pe membri și grupuri. Alege un membru pentru
          istoricul său.
        </p>
      </header>
      <section
        aria-label="Filtre clasament"
        className="space-y-3 rounded-xl border border-border bg-card p-4"
      >
        {options.isPending ? (
          <p role="status">Se încarcă filtrele…</p>
        ) : options.isError ? (
          <div role="alert">
            <p>Nu am putut încărca filtrele.</p>
            <Button variant="outline" onClick={() => options.refetch()}>
              Reîncarcă filtrele
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <GroupFilter
              groups={options.data.groups}
              value={selectedGroup ?? null}
              onChange={(group) => setGroupId(group?.id)}
            />
            <label className="grid gap-1 text-sm font-medium">
              Campanie
              <select
                className={selectStyle}
                value={campaignId ?? ''}
                onChange={(event) =>
                  setCampaignId(
                    event.target.value ? Number(event.target.value) : undefined,
                  )
                }
              >
                <option value="">Toate campaniile</option>
                {options.data.campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Grupul include toate subgrupurile sale și filtrează doar clasamentul
          membrilor. Campania filtrează și Cupa.
        </p>
        {(groupId || campaignId) && (
          <div
            role="group"
            className="flex flex-wrap gap-2"
            aria-label="Filtre active"
          >
            {groupId && (
              <Button
                variant="secondary"
                aria-label={`Elimină filtrul Grup: ${selectedGroup?.name ?? groupId}`}
                onClick={() => setGroupId(undefined)}
              >
                Grup: {selectedGroup?.name ?? `#${groupId}`}
                <XIcon aria-hidden="true" />
              </Button>
            )}
            {campaignId && (
              <Button
                variant="secondary"
                aria-label={`Elimină filtrul Campanie: ${selectedCampaign?.name ?? campaignId}`}
                onClick={() => setCampaignId(undefined)}
              >
                Campanie: {selectedCampaign?.name ?? `#${campaignId}`}
                <XIcon aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="members-title"
          className="min-w-0 rounded-xl border border-border bg-card p-4 md:p-6"
        >
          <h2 id="members-title" className="mb-4 text-xl font-semibold">
            Clasamentul membrilor
          </h2>
          {board.isPending ? (
            <p role="status">Se încarcă clasamentul…</p>
          ) : board.isError ? (
            <div role="alert">
              <p>Nu am putut încărca clasamentul.</p>
              <Button onClick={() => board.refetch()}>
                Reîncarcă clasamentul
              </Button>
            </div>
          ) : (
            <DataTable
              columns={columns}
              onRowClick={(row) => navigate(`/tracker/membru/${row.member_id}`)}
              rowClassName={() => 'cursor-pointer'}
              data={board.data}
              initialSorting={[{ id: 'points', desc: true }]}
              emptyTitle="Nu există puncte pentru filtrele alese"
              emptyDescription="Încearcă alt grup sau altă campanie."
            />
          )}
        </section>
        <section
          aria-labelledby="cup-title"
          className="min-w-0 rounded-xl border border-border bg-card p-4 md:p-6"
        >
          <div className="mb-2 flex items-center gap-2">
            <Trophy className="size-5 text-primary" aria-hidden="true" />
            <h2 id="cup-title" className="text-xl font-semibold">
              Cupa Departamentelor
            </h2>
          </div>
          <p className="mb-5 text-sm text-muted-foreground">
            Grupurile înscrise în competiție și punctele care le revin.
          </p>
          {cup.isPending ? (
            <p role="status">Se încarcă Cupa…</p>
          ) : cup.isError ? (
            <div role="alert">
              <p>Nu am putut încărca Cupa.</p>
              <Button onClick={() => cup.refetch()}>Reîncarcă Cupa</Button>
            </div>
          ) : !cup.data.length ? (
            <p>Nu există grupuri înscrise în Cupă.</p>
          ) : (
            <ol className="space-y-3">
              {cup.data.map((group) => (
                <li
                  key={group.group_id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold wrap-anywhere">{group.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {group.members} membri activi
                    </p>
                  </div>
                  <span className="shrink-0 font-bold tabular-nums">
                    {formatPoints(group.points)}{' '}
                    <span className="text-sm font-normal">pct.</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
export default function LeadershipScreen() {
  return (
    <LeadershipAccess>
      <LeadershipContent />
    </LeadershipAccess>
  );
}
