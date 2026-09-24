import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronRight, Trophy } from 'lucide-react';
import { cn } from 'cn';
import { MemberCard } from '../../components/member/MemberCard';
import { MemberName } from '../../components/member/MemberName';
import { memberDisplayName } from '../../components/member/member-identity';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { useAuth } from '../../lib/auth';
import { formatDayMonthYear, formatPoints } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import { withoutGroup, type WorkFilterValue } from '../../lib/work-filter';
import {
  useLeaderboardIdentities,
  useLeadershipLeaderboard,
  useLeadershipCup,
  useLeadershipFilters,
  type LeaderboardIdentity,
  type LeaderboardRow,
} from '../../queries/leadership';
import { MemberGroups } from '../volunteers/MemberGroups';
import { LeadershipAccess } from './LeadershipAccess';

const trackerPath = (memberId: string) => `/tracker/membru/${memberId}`;

/**
 * One Clasament row (R11), Voluntari-style: rank, the Member's name button
 * (avatar, Nickname) and their first Department chip with "+n" — both open
 * the Member Card, whose main link is "Vezi trackerul" — then the points and
 * the row's own link to the tracker. A click anywhere else on the row opens
 * the tracker too. The chip is the Member's own Group: someone who earned
 * points in the filtered Group without belonging to it shows where they do
 * belong (the ranking counts the Task's Group, never the Member's).
 */
function BoardRow({
  row,
  position,
  identity,
  self,
  onOpenCard,
}: {
  row: LeaderboardRow;
  position: number;
  identity: LeaderboardIdentity | undefined;
  self: boolean;
  onOpenCard: () => void;
}) {
  const navigate = useNavigate();
  const name = memberDisplayName(row.nickname, row.full_name);
  const rank = row.rank ?? position;
  function openFromRow(event: MouseEvent<HTMLLIElement>) {
    // React bubbles clicks from a portal (the Member Card) through the row:
    // only clicks on the row's own DOM, outside its controls, open it.
    if (
      !(event.target instanceof Element) ||
      !event.currentTarget.contains(event.target) ||
      event.target.closest('a,button')
    )
      return;
    void navigate(trackerPath(row.member_id));
  }
  return (
    <li
      onClick={openFromRow}
      data-self={self || undefined}
      className={cn(
        'grid cursor-pointer grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto_auto] sm:px-3',
        self && 'bg-primary/5 ring-1 ring-primary/30 hover:bg-primary/10',
      )}
    >
      <span
        className={cn(
          'text-center text-lg font-extrabold tabular-nums',
          rank <= 3 ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        <span className="sr-only">Locul </span>
        {rank}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <MemberName
            memberId={row.member_id}
            nickname={row.nickname}
            fullName={row.full_name}
            avatarColor={identity?.avatarColor}
          />
          {self && (
            <Badge variant="secondary" className="shrink-0">
              tu
            </Badge>
          )}
        </span>
        {identity && (
          <MemberGroups
            primaryGroup={identity.primaryGroup}
            otherMemberships={identity.otherMemberships}
            memberName={name}
            onOpen={onOpenCard}
          />
        )}
      </div>
      <span className="text-right font-bold whitespace-nowrap tabular-nums">
        {formatPoints(row.points)}{' '}
        <span className="text-xs font-medium text-muted-foreground">pct.</span>
      </span>
      <Link
        to={trackerPath(row.member_id)}
        aria-label={`Vezi trackerul membrului ${name}`}
        className="col-start-3 inline-flex min-h-11 min-w-11 items-center justify-end gap-1 justify-self-end rounded-md text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:col-start-4 sm:row-start-1 sm:px-2"
      >
        <span className="hidden sm:inline">Vezi trackerul</span>
        <ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    </li>
  );
}

function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const viewerId = useAuth().session?.user.id;
  const identities = useLeaderboardIdentities(rows.map((row) => row.member_id));
  const [card, setCard] = useState<LeaderboardRow | null>(null);
  if (!rows.length)
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="font-semibold">Nu există puncte pentru filtrele alese</p>
        <p className="text-sm text-muted-foreground">
          Încearcă alt grup, altă campanie sau altă perioadă.
        </p>
      </div>
    );
  return (
    <>
      {identities.isError && (
        // A failed lookup is not "no Group": say so, and offer the read again.
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 p-3 text-sm"
        >
          <p>Nu am putut încărca grupurile membrilor.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void identities.refetch()}
          >
            Reîncarcă grupurile
          </Button>
        </div>
      )}
      <ol aria-labelledby="members-title" className="space-y-1">
        {rows.map((row, index) => (
          <BoardRow
            key={row.member_id}
            row={row}
            position={index + 1}
            identity={identities.data?.[row.member_id]}
            self={row.member_id === viewerId}
            onOpenCard={() => setCard(row)}
          />
        ))}
      </ol>
      {card && (
        <MemberCard
          open
          onOpenChange={(open) => {
            if (!open) setCard(null);
          }}
          memberId={card.member_id}
          nickname={card.nickname}
          fullName={card.full_name}
          avatarColor={identities.data?.[card.member_id]?.avatarColor}
        />
      )}
    </>
  );
}

/** What the Cup counts under the current filter: its Campaign and range. */
function cupScope(
  value: WorkFilterValue,
  campaignName: string | undefined,
): string {
  const campaign =
    value.campaignId === undefined
      ? 'Toate campaniile'
      : `Campania ${campaignName ?? `#${value.campaignId}`}`;
  const from = value.from && formatDayMonthYear(value.from);
  const to = value.to && formatDayMonthYear(value.to);
  const period =
    from && to
      ? `puncte acordate între ${from} și ${to}`
      : from
        ? `puncte acordate din ${from}`
        : to
          ? `puncte acordate până la ${to}`
          : 'toată perioada';
  return `${campaign} · ${period}`;
}

// An inverted range sends nothing (#678): the reads wait for a valid one.
const RANGE_FIRST = 'Corectează perioada din filtre ca să vezi rezultatele.';

function LeadershipContent() {
  const { value, params } = useWorkFilter();
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
          Punctele taskurilor, pe membri și grupuri. Un membru apare sub grupul
          în care a lucrat taskul, chiar dacă nu îi aparține. Alege un rând
          pentru trackerul membrului.
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
            <Leaderboard rows={board.data} />
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
          <p className="text-sm text-muted-foreground">
            Grupurile înscrise în competiție și punctele care le revin.
          </p>
          <p className="mb-5 text-sm font-medium">
            {cupScope(
              value,
              options.data?.campaigns.find(
                (campaign) => campaign.id === value.campaignId,
              )?.name,
            )}
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
