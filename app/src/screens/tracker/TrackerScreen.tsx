import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Tabs } from '@base-ui/react/tabs';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  ClipboardList,
  ClipboardPlus,
  Hand,
  Layers,
  UserRound,
} from 'lucide-react';
import { cn } from 'cn';
import { useMyTasks } from '../../queries/tasks';
import { useTaskOpportunities } from '../../queries/task-opportunities';
import {
  useTaskManagement,
  useTaskLeadership,
  useManagedTasks,
  useAllTasks,
} from '../../queries/task-tabs';
import { usePendingDecisions } from '../../queries/request-decisions';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  FabActions,
  tabListClass,
  tabThumbClass,
  focusRingClass,
  Page,
  PageHeader,
} from '../../components/layout';
import { useAuth } from '../../lib/auth';
import { useCapability } from '../../lib/capabilities';
import { ErrorState, Loading } from '../../components/states';
import { parsePositiveInt } from '../../lib/ids';
import { RequestsView } from '../requests/RequestsView';
import { AvailableOpportunities } from './AvailableOpportunities';
import { TaskDetailsSheet } from './TaskDetailsSheet';
import { ManagerTaskList } from './ManagerTaskList';
import { AddCompletedTaskControl } from './AddCompletedTaskControl';
import { NewTaskControl } from './NewTaskControl';
import { MyTaskList } from './MyTaskList';
import { trackerListClass, TrackerWorkFilter } from './TrackerWorkFilter';
import { useTitleSearch, type TitleSearch } from './use-title-search';
import { PersonalScoreHeader } from './PersonalScoreHeader';
import { PreferredGroupsScope } from '../../components/preferred-groups/PreferredGroupsScope';
import { TaskActionSuccess } from './TaskActionSuccess';

const NO_ROWS: readonly never[] = [];

/**
 * The loading and retry states every Tracker list shares. The toolbar keeps
 * its row meanwhile, its search disabled, so nothing moves when the list
 * lands; `header` is what a list shows between the toolbar and its Tasks.
 */
function TaskQueryStates<Row>({
  query,
  search,
  preferredNotice,
  header,
  children,
}: {
  query: UseQueryResult<Row[], Error>;
  search: TitleSearch;
  preferredNotice?: boolean;
  header?: ReactNode;
  children: (rows: Row[]) => ReactNode;
}) {
  if (query.isPending || query.isError)
    return (
      <div className={trackerListClass}>
        <TrackerWorkFilter
          rows={NO_ROWS}
          search={search}
          disabled
          preferredNotice={preferredNotice}
        />
        {header}
        {query.isPending ? (
          <Loading label="Se încarcă taskurile…" />
        ) : (
          <ErrorState
            error={query.error}
            text="Nu am putut încărca taskurile."
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    );
  return children(query.data);
}

/** `?task=<id>`: a positive whole Task id, or nothing. */
function linkedTaskId(value: string | null): number | null {
  return parsePositiveInt(value);
}

type TrackerTab = 'mine' | 'available' | 'managed' | 'all';

const TRACKER_TABS: readonly unknown[] = [
  'mine',
  'available',
  'managed',
  'all',
];

/**
 * Taskuri's one navigation: the four Task lists and Cereri as Base UI `Tabs`
 * drawn like `SegmentedToggle` — a 44 px track the width of the content, 36 px
 * segments whose hit area reaches 4 px above and below, and the chosen one
 * inked on a thumb that slides to it (`Tabs.Indicator`). The track and the
 * thumb are the app's (`tabListClass`, `tabThumbClass`).
 */
const navListClass = tabListClass;

const navThumbClass = tabThumbClass;

/**
 * One segment. The chosen one inks itself too, once the thumb has arrived
 * (the 200 ms delay), so it is inked even where the thumb has not measured:
 * the first paint, a hidden page, jsdom.
 */
const navTabClass = cn(
  'relative z-1 inline-flex min-h-[36px] min-w-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-bold whitespace-nowrap text-muted-foreground [transition:color_200ms] after:absolute after:inset-x-0 after:-inset-y-1 hover:text-foreground motion-reduce:transition-none aria-selected:bg-(--text) aria-selected:text-(--surface) aria-selected:[transition:color_200ms,background-color_0s_200ms] aria-selected:hover:text-(--surface) motion-reduce:aria-selected:transition-none [&_svg]:size-4 [&_svg]:shrink-0',
  focusRingClass,
);

/**
 * Where the segments spell their names. Below it only the chosen one does,
 * taking the width the others leave — they are their icons, 44 px each, the
 * name kept for a screen reader — so five fit at 360 px without scrolling
 * sideways, and a count rides its icon's corner. From it up every segment is
 * icon and name, as wide as its name needs. Five names need `md`.
 */
const NAV_LABELS_FROM = {
  sm: {
    tab: 'max-sm:flex-none max-sm:aria-selected:flex-1 sm:flex-auto sm:px-4',
    label: 'max-sm:in-[[aria-selected=false]]:sr-only',
    badge:
      'max-sm:in-[[aria-selected=false]]:absolute max-sm:in-[[aria-selected=false]]:top-0 max-sm:in-[[aria-selected=false]]:right-0.5 max-sm:in-[[aria-selected=false]]:h-4 max-sm:in-[[aria-selected=false]]:min-w-4 max-sm:in-[[aria-selected=false]]:px-1 max-sm:in-[[aria-selected=false]]:text-[10px] max-sm:in-[[aria-selected=false]]:ring-2 max-sm:in-[[aria-selected=false]]:ring-(--surface-3)',
  },
  md: {
    tab: 'max-md:flex-none max-md:aria-selected:flex-1 md:flex-auto md:px-4',
    label: 'max-md:in-[[aria-selected=false]]:sr-only',
    badge:
      'max-md:in-[[aria-selected=false]]:absolute max-md:in-[[aria-selected=false]]:top-0 max-md:in-[[aria-selected=false]]:right-0.5 max-md:in-[[aria-selected=false]]:h-4 max-md:in-[[aria-selected=false]]:min-w-4 max-md:in-[[aria-selected=false]]:px-1 max-md:in-[[aria-selected=false]]:text-[10px] max-md:in-[[aria-selected=false]]:ring-2 max-md:in-[[aria-selected=false]]:ring-(--surface-3)',
  },
} as const;

function isTrackerTab(value: unknown): value is TrackerTab {
  return TRACKER_TABS.includes(value);
}

/**
 * `?lista=`: the tab a link asks for (#846, D9) — De gestionat from a Group's
 * "Vezi taskurile neterminate" (#853), Disponibile from Acasă (#859). A tab
 * the viewer does not have is ignored.
 */
const LIST_PARAM = new Map<string, TrackerTab>([
  ['gestionat', 'managed'],
  ['toate', 'all'],
  ['disponibile', 'available'],
]);

/**
 * From BC (level 6) De gestionat already holds every Task, so Toate would be
 * the same list twice (B16): it is shown only below that, to BCE today.
 */
const MANAGES_ALL_LEVEL = 6;

type TaskList = {
  isError: boolean;
  data?: readonly { id: number }[] | undefined;
};

/**
 * Asks `test` of a list: `undefined` while the answer is unknown (the tab's
 * access or its list is still loading). A list that failed, or a tab the
 * viewer does not have, answers `false`.
 */
function ask(
  list: TaskList,
  shown: boolean | undefined,
  test: (rows: readonly { id: number }[]) => boolean,
): boolean | undefined {
  if (shown === undefined) return undefined;
  if (!shown || list.isError) return false;
  return list.data === undefined ? undefined : test(list.data);
}

const nonEmpty = (rows: readonly { id: number }[]) => rows.length > 0;

const HIGHLIGHT_MS = 4000;

/**
 * Taskuri's two views (#973): the Task lists, and **Cereri** — the
 * Completed-work Requests — at `?vedere=cereri`, the last tab of the one
 * navigation.
 */
type TrackerView = 'taskuri' | 'cereri';

const VIEW_KEY = 'vedere';
const REQUESTS_VIEW = 'cereri';
/** The Cereri tab's value, beside the `TrackerTab` ones. */
const REQUESTS_TAB = 'cereri';

/** "1 cerere de decis", "3 cereri de decis", "20 de cereri de decis". */
function decisionsLabel(count: number): string {
  if (count === 1) return '1 cerere de decis';
  const lastTwo = count % 100;
  const de = count >= 20 && (lastTwo === 0 || lastTwo >= 20);
  return `${new Intl.NumberFormat('ro-RO').format(count)} ${de ? 'de ' : ''}cereri de decis`;
}

/**
 * Taskuri opens on the member's Grupuri preferate (R43): Disponibile, De
 * gestionat and Toate leave the unselected Groups out until the star is released,
 * for this visit. Taskurile mele is the member's own work and is never
 * filtered by them: only its own search and Work Filter narrow it.
 */
export default function TrackerScreen() {
  return (
    <PreferredGroupsScope>
      <TrackerContent />
    </PreferredGroupsScope>
  );
}

function TrackerContent() {
  const mine = useMyTasks();
  const available = useTaskOpportunities();
  const management = useTaskManagement();
  const managed = useManagedTasks(management.data === true);
  const leadership = useTaskLeadership();
  const { claims } = useAuth();
  const level = claims?.member_level ?? 0;
  const showAll = leadership.data === true && level < MANAGES_ALL_LEVEL;
  const all = useAllTasks(showAll);
  // Leadership does not work by points (R27): no Personal Score above
  // Taskurile mele, the same test as Acasă (B15).
  const leader = useCapability('seeLeadership').data === true;
  // Cereri is every Member's (#979): a volunteer files there, leadership
  // and the Group Managers decide there, and an empty queue is shown as
  // such. The read stays for the count on the tab.
  const decisions = usePendingDecisions();
  const toDecide = decisions.data?.length ?? 0;
  // One search text for the four lists: it stays when the tab changes.
  const search = useTitleSearch();
  const [detailId, setDetailId] = useState<number | null>(null);
  // The Task this page just created or added, and what its details say (#915).
  const [created, setCreated] = useState<{
    id: number;
    notice: string;
  } | null>(null);
  // The give-up receipt lives on the list: the card leaves it (Audit D-3).
  // Keyed by the Task, so a second give-up announces itself afresh.
  const [gaveUp, setGaveUp] = useState<{
    id: number;
    receipt: string;
  } | null>(null);
  // A Task deleted for good (#1017): its sheet closes, the list says so.
  const [deleted, setDeleted] = useState<{
    id: number;
    receipt: string;
  } | null>(null);
  // Several Tasks created at once (spec 2026-10-11): the list says so; no
  // details sheet opens. Keyed so a second batch announces itself afresh.
  const [createdMany, setCreatedMany] = useState<{
    key: number;
    receipt: string;
  } | null>(null);
  // `null` until the page has chosen its opening tab; a click sets it.
  const [tab, setTab] = useState<TrackerTab | null>(null);
  // The deep links (#685, #822, #846): `/tracker?task=<id>` lands on the
  // Task, `/tracker?lista=<tab>` opens that tab. `task` wins over `lista`.
  const [params, setParams] = useSearchParams();
  // `?vedere=cereri` (#973) shows Cereri; anything else a Task list.
  const view: TrackerView =
    params.get(VIEW_KEY) === REQUESTS_VIEW ? 'cereri' : 'taskuri';
  // A history entry per change of view, so Back returns to the Task lists;
  // every other parameter is kept.
  function chooseView(next: TrackerView) {
    setParams((current) => {
      const nextParams = new URLSearchParams(current);
      if (next === 'cereri') nextParams.set(VIEW_KEY, REQUESTS_VIEW);
      else nextParams.delete(VIEW_KEY);
      return nextParams;
    });
  }
  const linkedId = linkedTaskId(params.get('task'));
  const listParam = LIST_PARAM.get(params.get('lista') ?? '') ?? null;
  const link = `${linkedId ?? ''}|${listParam ?? ''}`;
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [expiredFor, setExpiredFor] = useState<number | null>(null);
  // Counts link changes, so a later link back to the same card lands afresh.
  const [linkVisit, setLinkVisit] = useState(0);
  if (link !== linkFor) {
    // A new link: choose the tab afresh and allow a fresh highlight.
    setLinkFor(link);
    setExpiredFor(null);
    setLinkVisit((visit) => visit + 1);
    setTab(null);
  }
  const managedShown = management.isError
    ? false
    : (management.data ?? undefined);
  const allShown =
    level >= MANAGES_ALL_LEVEL || leadership.isError
      ? false
      : leadership.data === undefined
        ? undefined
        : showAll;

  // Where `?task=` lands, once every list that could hold it has answered:
  // a Task of mine is highlighted on Taskurile mele; any other Task opens its
  // details sheet on De gestionat, else Toate, else Disponibile — whichever
  // holds it (D2) — or on the opening tab with the sheet's unavailable state.
  // A failed Taskurile mele read never routes a Task of mine elsewhere.
  const holdsLinked = (rows: readonly { id: number }[]) =>
    rows.some((task) => task.id === linkedId);
  let landing: { tab: TrackerTab | null; open: boolean } | undefined;
  if (linkedId !== null) {
    const inMine = mine.isError ? true : ask(mine, true, holdsLinked);
    const inManaged = ask(managed, managedShown, holdsLinked);
    const inAll = ask(all, allShown, holdsLinked);
    const inAvailable = ask(available, true, holdsLinked);
    if (inMine) landing = { tab: 'mine', open: false };
    else if (inMine === false && inManaged)
      landing = { tab: 'managed', open: true };
    else if (
      inMine === false &&
      inManaged === false &&
      inAll !== undefined &&
      inAvailable !== undefined
    )
      landing = {
        tab: inAll ? 'all' : inAvailable ? 'available' : null,
        open: true,
      };
  }
  const [landedVisit, setLandedVisit] = useState<number | null>(null);
  if (landing && landedVisit !== linkVisit) {
    setLandedVisit(linkVisit);
    if (landing.tab) setTab(landing.tab);
    if (landing.open) setDetailId(linkedId);
  }

  // The opening tab (B17): `?lista=` when the viewer has that tab, else the
  // first list with something in it — Taskurile mele, De gestionat,
  // Disponibile — else Taskurile mele. A failed Taskurile mele read opens it,
  // so its retry is what the Member sees.
  const firstNonEmpty = (): TrackerTab | undefined => {
    if (mine.isError) return 'mine';
    const order: [TrackerTab, TaskList, boolean | undefined][] = [
      ['mine', mine, true],
      ['managed', managed, managedShown],
      ['available', available, true],
    ];
    for (const [value, list, shown] of order) {
      const has = ask(list, shown, nonEmpty);
      if (has === undefined) return undefined;
      if (has) return value;
    }
    return 'mine';
  };
  const listShown =
    listParam === 'managed'
      ? managedShown
      : listParam === 'all'
        ? allShown
        : true;
  const opening =
    listParam && listShown
      ? listParam
      : listParam && listShown === undefined
        ? undefined
        : firstNonEmpty();
  if (
    tab === null &&
    opening !== undefined &&
    (linkedId === null || landedVisit === linkVisit)
  )
    setTab(opening);

  // The card is highlighted once the list has loaded with it in it, until
  // the highlight expires. An id that is not one of mine leaves the plain list.
  const highlightTarget =
    linkedId !== null && mine.data?.some((task) => task.id === linkedId)
      ? linkedId
      : null;
  const highlightedId = highlightTarget !== expiredFor ? highlightTarget : null;
  const landed = useRef<string | null>(null);
  useEffect(() => {
    // Once per link: a refetch must not pull the page back, but every new
    // link lands, even on a card an earlier link landed on.
    const visit = `${linkVisit}:${highlightTarget}`;
    if (highlightTarget === null || landed.current === visit) return;
    landed.current = visit;
    const card = document.getElementById(`task-${highlightTarget}`);
    card?.scrollIntoView({ block: 'center' });
    const title = card?.querySelector<HTMLElement>('[data-slot="task-title"]');
    (title?.querySelector<HTMLElement>('button') ?? title)?.focus({
      preventScroll: true,
    });
  }, [highlightTarget, linkVisit]);
  useEffect(() => {
    if (highlightedId === null) return;
    const timer = window.setTimeout(
      () => setExpiredFor(highlightedId),
      HIGHLIGHT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [highlightedId]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const managedTaskIds = new Set((managed.data ?? []).map((task) => task.id));
  const current = tab ?? 'mine';
  const selected =
    (current === 'managed' && !management.data) ||
    (current === 'all' && !showAll)
      ? 'mine'
      : current;
  const nav =
    NAV_LABELS_FROM[
      3 + Number(Boolean(management.data)) + Number(showAll) >= 5 ? 'md' : 'sm'
    ];
  const tabClass = cn(navTabClass, nav.tab);
  const labelClass = cn('min-w-0 truncate', nav.label);
  // Between the toolbar and the cards of Taskurile mele, loading or loaded.
  const mineHeader = (
    <>
      {!leader && <PersonalScoreHeader />}
      {gaveUp !== null && (
        <TaskActionSuccess key={gaveUp.id}>{gaveUp.receipt}</TaskActionSuccess>
      )}
    </>
  );
  return (
    <Page>
      <FabActions>
        <PageHeader
          title="Taskuri"
          actions={
            view === 'taskuri' && (
              <>
                <NewTaskControl
                  onCreated={({ ids }) => {
                    const [only] = ids;
                    if (ids.length === 1 && only !== undefined) {
                      setCreated({ id: only, notice: 'Taskul a fost creat.' });
                      setDetailId(only);
                      return;
                    }
                    setCreatedMany({
                      key: Date.now(),
                      receipt: `${ids.length} taskuri create.`,
                    });
                  }}
                />
                <AddCompletedTaskControl
                  onAdded={({ id }) => {
                    setCreated({
                      id,
                      notice:
                        'Taskul finalizat a fost adăugat. Punctele au fost acordate.',
                    });
                    setDetailId(id);
                  }}
                />
              </>
            )
          }
        />
        {view === 'taskuri' && management.isError && (
          <div role="alert" className="text-sm">
            <p>Nu am putut verifica accesul la taskurile de gestionat.</p>
            <Button
              variant="outline"
              className="min-h-11 min-w-11"
              onClick={() => management.refetch()}
            >
              Reîncarcă accesul
            </Button>
          </div>
        )}
        {/* The access checks are silent while they run: a line of text
            here would push the lists down as it left. Only a failure
            speaks, with its retry. */}
        {view === 'taskuri' && leadership.isError && (
          <div role="alert" className="space-y-3 text-sm">
            <p>Nu am putut verifica accesul la toate taskurile.</p>
            <Button
              variant="outline"
              className="min-h-11 min-w-11"
              onClick={() => leadership.refetch()}
            >
              Reîncarcă accesul complet
            </Button>
          </div>
        )}
        {view === 'taskuri' && deleted !== null && (
          <TaskActionSuccess key={deleted.id}>
            {deleted.receipt}
          </TaskActionSuccess>
        )}
        {view === 'taskuri' && createdMany !== null && (
          <TaskActionSuccess key={createdMany.key}>
            {createdMany.receipt}
          </TaskActionSuccess>
        )}
        <Tabs.Root
          // The nav has no margin of its own: this stack spaces it (#841).
          className="flex flex-col gap-4"
          value={view === 'cereri' ? REQUESTS_TAB : selected}
          onValueChange={(value) => {
            if (value === REQUESTS_TAB) chooseView('cereri');
            else if (isTrackerTab(value)) {
              setTab(value);
              if (view === 'cereri') chooseView('taskuri');
            }
            setGaveUp(null);
            setDeleted(null);
          }}
        >
          <Tabs.List aria-label="Taskuri și cereri" className={navListClass}>
            <Tabs.Indicator
              data-slot="tracker-nav-thumb"
              className={navThumbClass}
            />
            <Tabs.Tab value="mine" className={tabClass}>
              <UserRound aria-hidden="true" />
              <span className={labelClass}>Taskurile mele</span>
            </Tabs.Tab>
            <Tabs.Tab value="available" className={tabClass}>
              <Hand aria-hidden="true" />
              <span className={labelClass}>Disponibile</span>
            </Tabs.Tab>
            {management.data && (
              <Tabs.Tab value="managed" className={tabClass}>
                <ClipboardList aria-hidden="true" />
                <span className={labelClass}>De gestionat</span>
              </Tabs.Tab>
            )}
            {showAll && (
              <Tabs.Tab value="all" className={tabClass}>
                <Layers aria-hidden="true" />
                <span className={labelClass}>Toate</span>
              </Tabs.Tab>
            )}
            <Tabs.Tab value={REQUESTS_TAB} className={tabClass}>
              <ClipboardPlus aria-hidden="true" />
              <span className={labelClass}>Cereri</span>
              {toDecide > 0 && (
                // Solid, so the count stays legible on the inked segment as
                // well as on the track.
                <Badge
                  variant="destructive"
                  className={cn(
                    'min-w-5 bg-destructive text-(--surface) dark:bg-destructive',
                    nav.badge,
                  )}
                >
                  <span aria-hidden="true">{toDecide}</span>
                  <span className="sr-only">, {decisionsLabel(toDecide)}</span>
                </Badge>
              )}
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="mine" className="motion-enter">
            <TaskQueryStates
              query={mine}
              search={search}
              preferredNotice={false}
              header={mineHeader}
            >
              {(rows) => (
                <MyTaskList
                  rows={rows}
                  now={now}
                  search={search}
                  header={mineHeader}
                  onOpenTask={setDetailId}
                  linkedId={highlightTarget}
                  highlightedId={highlightedId}
                  onGaveUp={(id, receipt) => setGaveUp({ id, receipt })}
                />
              )}
            </TaskQueryStates>
          </Tabs.Panel>
          <Tabs.Panel value="available" className="motion-enter">
            <TaskQueryStates query={available} search={search}>
              {(opportunities) => (
                <AvailableOpportunities
                  opportunities={opportunities}
                  now={now}
                  search={search}
                  onOpenTask={setDetailId}
                />
              )}
            </TaskQueryStates>
          </Tabs.Panel>
          {management.data && (
            <Tabs.Panel value="managed" className="motion-enter">
              <TaskQueryStates query={managed} search={search}>
                {(rows) => (
                  <ManagerTaskList
                    rows={rows}
                    now={now}
                    search={search}
                    empty="Nu ai taskuri de gestionat acum."
                    onOpenTask={setDetailId}
                  />
                )}
              </TaskQueryStates>
            </Tabs.Panel>
          )}
          {showAll && (
            <Tabs.Panel value="all" className="motion-enter">
              <TaskQueryStates query={all} search={search}>
                {(rows) => (
                  <ManagerTaskList
                    rows={rows}
                    now={now}
                    search={search}
                    empty="Nu există taskuri vizibile."
                    onOpenTask={setDetailId}
                  />
                )}
              </TaskQueryStates>
            </Tabs.Panel>
          )}
          {/* Cereri is other content: no toolbar, its own blocks 24 px apart. */}
          <Tabs.Panel
            value={REQUESTS_TAB}
            className="flex motion-enter flex-col gap-6"
          >
            <RequestsView />
          </Tabs.Panel>
        </Tabs.Root>
        <TaskDetailsSheet
          key={detailId}
          taskId={detailId}
          managedTaskIds={managedTaskIds}
          notice={
            detailId !== null && detailId === created?.id
              ? created.notice
              : null
          }
          onClose={() => {
            setDetailId(null);
            setCreated(null);
          }}
          onDeleted={(receipt) => {
            setDeleted({ id: detailId ?? 0, receipt });
            setGaveUp(null);
            setDetailId(null);
            setCreated(null);
          }}
        />
      </FabActions>
    </Page>
  );
}
