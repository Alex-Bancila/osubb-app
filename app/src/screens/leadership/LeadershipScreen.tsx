import { useState, type CSSProperties, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Award, ChevronRight, ListFilter, Trophy } from 'lucide-react';
import { cn } from 'cn';
import {
  EmptyState,
  ListRow,
  Page,
  PageHeader,
  Panel,
  SegmentedToggle,
  rowListClass,
  type SegmentedOption,
} from '../../components/layout';
import { MemberCard } from '../../components/member/MemberCard';
import { MemberName } from '../../components/member/MemberName';
import { memberDisplayName } from '../../components/member/member-identity';
import { ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { useAuth } from '../../lib/auth';
import { formatDayMonthYear, formatPoints } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import {
  withoutGroup,
  type WorkFilterLevels,
  type WorkFilterValue,
} from '../../lib/work-filter';
import {
  useLeaderboardIdentities,
  useLeadershipLeaderboard,
  useLeadershipCup,
  useLeadershipFilters,
  type CupRow,
  type LeaderboardIdentity,
  type LeaderboardRow,
} from '../../queries/leadership';
import { useGroups } from '../../queries/reference';
import { MemberGroups } from '../volunteers/MemberGroups';
import { LeadershipAccess } from './LeadershipAccess';
import { useClasamentView, type ClasamentView } from './clasament-view';

const trackerPath = (memberId: string) => `/tracker/membru/${memberId}`;

const VIEWS: ReadonlyArray<SegmentedOption<ClasamentView>> = [
  { value: 'members', label: 'Clasament' },
  { value: 'cup', label: 'Cupa Departamentelor' },
];

/**
 * The Work Filter levels each board reads: the members' board takes them all;
 * the Cup ranks Groups, so its view hides Grup principal and Subgrup (the URL
 * keeps them for the way back).
 */
const LEVELS: Record<ClasamentView, WorkFilterLevels> = {
  members: {},
  cup: { group: false },
};

const memberCount = (n: number) => `${n} ${n === 1 ? 'membru' : 'membri'}`;

/**
 * One Clasament row (R11, R27) on the shared `ListRow`: rank (the top three
 * in red), the Member's name button (avatar, Nickname) and their first Group
 * chip with "+n" — both open the Member Card, whose main link is "Vezi
 * trackerul" — then the points and the row's own link to the tracker. A click
 * anywhere else on the row opens the tracker too. The chip is the Member's
 * own Group: someone who earned points in the filtered Group without
 * belonging to it shows where they do belong (the ranking counts the Task's
 * Group, never the Member's).
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
    <li onClick={openFromRow} data-self={self || undefined}>
      <ListRow
        as="div"
        mine={self}
        className={cn(
          'cursor-pointer rounded-sm transition-colors max-sm:gap-2 max-sm:px-1',
          self ? 'hover:bg-primary/10' : 'hover:bg-muted/60',
        )}
        leading={
          <span
            className={cn(
              'text-lg font-extrabold tabular-nums',
              rank <= 3 ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <span className="sr-only">Locul </span>
            {rank}
          </span>
        }
        value={
          <span className="font-bold">
            {formatPoints(row.points)}{' '}
            <span className="text-xs font-medium text-muted-foreground">
              pct.
            </span>
          </span>
        }
        action={
          <Link
            to={trackerPath(row.member_id)}
            aria-label={`Vezi trackerul membrului ${name}`}
            className="inline-flex min-h-11 min-w-11 items-center justify-end gap-1 rounded-md text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-2"
          >
            <span className="hidden sm:inline">Vezi trackerul</span>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        }
      >
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
          {/* Under 640 px the row keeps rank, name, points and the chevron;
              the Groups stay one tap away, on the Member Card. */}
          {identity && (
            <span className="hidden min-w-0 sm:contents">
              <MemberGroups
                primaryGroup={identity.primaryGroup}
                otherMemberships={identity.otherMemberships}
                memberName={name}
                onOpen={onOpenCard}
              />
            </span>
          )}
        </div>
      </ListRow>
    </li>
  );
}

function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const viewerId = useAuth().session?.user.id;
  const identities = useLeaderboardIdentities(rows.map((row) => row.member_id));
  const [card, setCard] = useState<LeaderboardRow | null>(null);
  if (!rows.length)
    return (
      <EmptyState>
        <span className="block font-semibold text-foreground">
          Nu există puncte pentru filtrele alese
        </span>
        Încearcă alt grup, altă campanie sau altă perioadă.
      </EmptyState>
    );
  return (
    <>
      {identities.isError && (
        // A failed lookup is not "no Group": say so, and offer the read again.
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-sm bg-muted/60 p-3 text-sm"
        >
          <p className="m-0">Nu am putut încărca grupurile membrilor.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void identities.refetch()}
          >
            Reîncarcă grupurile
          </Button>
        </div>
      )}
      <ol aria-label="Clasamentul membrilor" className={rowListClass}>
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

/**
 * The Cup's rows (R27), Acasă's look: the competing Group's short tag in its
 * colour, its name over a bar scaled against the leader (no bar under zero —
 * the number is the honest part), then the points and the Group's member
 * count, which drops under the bar below 640 px. Name, tag and colour come
 * from the Group, so a new competing Group needs no code.
 */
function CupBoard({ rows }: { rows: CupRow[] }) {
  const groups = useGroups();
  // Wait for the Groups too, so no row is painted before its tag and colour.
  if (groups.isPending) return <Loading label="Se încarcă Cupa…" />;
  // A failed read is not "a Group you cannot see": say so, never '—' rows.
  if (groups.isError)
    return (
      <ErrorState
        error={groups.error}
        text="Nu am putut încărca grupurile Cupei."
        retryLabel="Reîncarcă grupurile"
        onRetry={() => void groups.refetch()}
      />
    );
  if (!rows.length)
    return <EmptyState>Nu există grupuri înscrise în Cupă.</EmptyState>;
  const max = Math.max(1, ...rows.map((row) => row.points ?? 0));
  return (
    <ol aria-label="Cupa Departamentelor" className={rowListClass}>
      {rows.map((row) => {
        const group =
          row.group_id === null ? undefined : groups.data?.get(row.group_id);
        const points = row.points ?? 0;
        const width = `${Math.round((Math.max(0, points) / max) * 100)}%`;
        const members = memberCount(row.members ?? 0);
        return (
          <ListRow
            key={row.group_id ?? row.name}
            value={
              <span className="flex items-baseline justify-end gap-4">
                <span className="font-bold">
                  {formatPoints(points)}{' '}
                  <span className="text-xs font-medium text-muted-foreground">
                    pct.
                  </span>
                </span>
                <span className="hidden w-20 text-xs text-muted-foreground sm:inline">
                  {members}
                </span>
              </span>
            }
          >
            <div
              className="flex min-w-0 items-center gap-3"
              style={
                {
                  '--dept': group?.color ?? 'var(--ink-400)',
                } as CSSProperties
              }
            >
              {/* A Group the viewer cannot read has no tag: '—' in the
                  neutral ink, never a raw id. The brand colours are chosen
                  for white paper, so the dark theme lightens the label. */}
              <span className="w-[4.5rem] shrink-0 truncate rounded-xs bg-[color-mix(in_srgb,var(--dept)_13%,transparent)] px-2 py-0.5 text-center text-[length:var(--fs-xs)] font-extrabold tracking-[0.04em] text-(--dept) dark:bg-[color-mix(in_srgb,var(--dept)_24%,transparent)] dark:text-[color-mix(in_srgb,var(--dept)_52%,white)]">
                {group?.short ?? '—'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm font-semibold">
                  {group?.name ?? row.name}
                </p>
                <div
                  aria-hidden="true"
                  className="mt-2 h-[7px] overflow-hidden rounded-full bg-(--surface-3)"
                >
                  <div
                    className="h-full rounded-full bg-(--dept) transition-[width]"
                    style={{ width }}
                  />
                </div>
                <p className="m-0 mt-1 text-xs text-muted-foreground tabular-nums sm:hidden">
                  {members}
                </p>
              </div>
            </div>
          </ListRow>
        );
      })}
    </ol>
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

/**
 * Clasament (R27): one board at a time, at full width. The segmented toggle
 * in the header chooses the members' Clasament or the Cupa Departamentelor
 * (`useClasamentView`); the Work Filter below applies to both, and only the
 * shown board is read.
 */
function LeadershipContent() {
  const [view, chooseView] = useClasamentView();
  const levels = LEVELS[view];
  const { value, params } = useWorkFilter(levels);
  const options = useLeadershipFilters();
  const board = useLeadershipLeaderboard(view === 'members' ? params : null);
  const cup = useLeadershipCup(
    view === 'cup' && params ? withoutGroup(params) : null,
  );
  return (
    <Page>
      <PageHeader
        eyebrow="Conducere"
        title="Clasament"
        description="Punctele taskurilor, pe membri și pe departamente."
        actions={
          <SegmentedToggle
            label="Vizualizare"
            options={VIEWS}
            value={view}
            onChange={chooseView}
            className="max-sm:w-full max-sm:*:flex-auto max-sm:*:px-3"
          />
        }
      />
      <Panel eyebrow="Filtre" icon={ListFilter} aria-label="Filtre clasament">
        {options.isPending ? (
          <Loading label="Se încarcă filtrele…" />
        ) : options.isError ? (
          <ErrorState
            error={options.error}
            text="Nu am putut încărca filtrele."
            retryLabel="Reîncarcă filtrele"
            onRetry={() => void options.refetch()}
          />
        ) : (
          <WorkFilter
            groups={options.data.groups}
            campaigns={options.data.campaigns}
            levels={levels}
          />
        )}
      </Panel>
      {view === 'members' ? (
        <Panel
          eyebrow="Clasament"
          icon={Trophy}
          title="Clasamentul membrilor"
          description={
            params && board.data ? memberCount(board.data.length) : null
          }
        >
          {!params ? (
            <EmptyState>{RANGE_FIRST}</EmptyState>
          ) : board.isPending ? (
            <Loading label="Se încarcă clasamentul…" />
          ) : board.isError ? (
            <ErrorState
              error={board.error}
              text="Nu am putut încărca clasamentul."
              retryLabel="Reîncarcă clasamentul"
              onRetry={() => void board.refetch()}
            />
          ) : (
            <Leaderboard rows={board.data} />
          )}
        </Panel>
      ) : (
        <Panel
          eyebrow="Cupa"
          icon={Award}
          title="Cupa Departamentelor"
          description={cupScope(
            value,
            options.data?.campaigns.find(
              (campaign) => campaign.id === value.campaignId,
            )?.name,
          )}
        >
          {!params ? (
            <EmptyState>{RANGE_FIRST}</EmptyState>
          ) : cup.isPending ? (
            <Loading label="Se încarcă Cupa…" />
          ) : cup.isError ? (
            <ErrorState
              error={cup.error}
              text="Nu am putut încărca Cupa."
              retryLabel="Reîncarcă Cupa"
              onRetry={() => void cup.refetch()}
            />
          ) : (
            <CupBoard rows={cup.data} />
          )}
        </Panel>
      )}
    </Page>
  );
}

export default function LeadershipScreen() {
  return (
    <LeadershipAccess>
      <LeadershipContent />
    </LeadershipAccess>
  );
}
