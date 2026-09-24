import { formatPoints } from '../../lib/format';
import { useNavigate } from 'react-router';
import { Trophy } from 'lucide-react';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { useWorkFilter } from '../../lib/use-work-filter';
import { withoutGroup } from '../../lib/work-filter';
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
// An inverted range sends nothing (#678): the reads wait for a valid one.
const RANGE_FIRST = 'Corectează perioada din filtre ca să vezi rezultatele.';

function LeadershipContent() {
  const navigate = useNavigate();
  const { params } = useWorkFilter();
  const options = useLeadershipFilters();
  const board = useLeadershipLeaderboard(params);
  const cup = useLeadershipCup(params && withoutGroup(params));
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
          <WorkFilter
            groups={options.data.groups}
            campaigns={options.data.campaigns}
            hint="Grupul include toate subgrupurile sale și filtrează doar clasamentul membrilor. Campania și perioada, după data acordării punctelor, filtrează și Cupa."
          />
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
          {!params ? (
            <p>{RANGE_FIRST}</p>
          ) : board.isPending ? (
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
          {!params ? (
            <p>{RANGE_FIRST}</p>
          ) : cup.isPending ? (
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
