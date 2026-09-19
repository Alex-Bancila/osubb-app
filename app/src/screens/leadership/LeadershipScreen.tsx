import { formatPoints } from '../../lib/format';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Trophy } from 'lucide-react';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { Button } from '../../components/ui/button';
import {
  useLeadershipLeaderboard,
  useLeadershipCup,
  useLeadershipFilters,
  type LeaderboardRow,
} from '../../queries/leadership';
import { LeadershipAccess } from './LeadershipAccess';

const columns: DataTableColumn<LeaderboardRow>[] = [
  {
    accessorKey: 'full_name',
    header: 'Membru',
    cell: ({ row }) => (
      <Link
        className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
        to={`/tracker/membru/${row.original.member_id}`}
      >
        {row.original.full_name}
      </Link>
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
            <label className="grid gap-1 text-sm font-medium">
              Grup
              <select
                className={selectStyle}
                value={groupId ?? ''}
                onChange={(event) =>
                  setGroupId(
                    event.target.value ? Number(event.target.value) : undefined,
                  )
                }
              >
                <option value="">Toate grupurile</option>
                {options.data.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {'— '.repeat(Math.max(0, group.path.length - 1))}
                    {group.name}
                    {group.status === 'archived' ? ' (arhivat)' : ''}
                  </option>
                ))}
              </select>
            </label>
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
          <div className="flex flex-wrap gap-2" aria-label="Filtre active">
            {groupId && (
              <Button variant="secondary" onClick={() => setGroupId(undefined)}>
                Grup: {selectedGroup?.name ?? `#${groupId}`} · Elimină
              </Button>
            )}
            {campaignId && (
              <Button
                variant="secondary"
                onClick={() => setCampaignId(undefined)}
              >
                Campanie: {selectedCampaign?.name ?? `#${campaignId}`} · Elimină
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
