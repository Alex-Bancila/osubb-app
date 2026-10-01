import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Tabs } from '@base-ui/react/tabs';
import type { UseQueryResult } from '@tanstack/react-query';
import { ClipboardPlus, ListTodo } from 'lucide-react';
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
  EmptyState,
  Page,
  PageHeader,
  SegmentedToggle,
  tabClass,
  tabListClass,
  useActiveTabInView,
} from '../../components/layout';
import { useAuth } from '../../lib/auth';
import { submitsWorkRequests, useCapability } from '../../lib/capabilities';
import { ErrorState, Loading } from '../../components/states';
import { parsePositiveInt } from '../../lib/ids';
import { RequestsView } from '../requests/RequestsView';
import { AvailableOpportunities } from './AvailableOpportunities';
import { TaskDetailsSheet } from './TaskDetailsSheet';
import { ManagerTaskList } from './ManagerTaskList';
import { AddCompletedTaskControl } from './AddCompletedTaskControl';
import { NewTaskControl } from './NewTaskControl';
import { TaskCardGrid } from './TaskCardGrid';
import { PersonalScoreHeader } from './PersonalScoreHeader';
import type { TaskPresentationRow } from './task-presentation';
import { TaskActionSuccess } from './TaskActionSuccess';
import type { OnGaveUp } from './give-up-receipt';

/** The loading and retry states every Tracker list shares. */
function TaskQueryStates<Row>({
  query,
  children,
}: {
  query: UseQueryResult<Row[], Error>;
  children: (rows: Row[]) => ReactNode;
}) {
  if (query.isPending) return <Loading label="Se încarcă taskurile…" />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        text="Nu am putut încărca taskurile."
        onRetry={() => void query.refetch()}
      />
    );
  return children(query.data);
}

function TaskQueryPanel({
  query,
  empty,
  manager = false,
  now,
  onOpenTask,
  highlightedId = null,
  onGaveUp,
}: {
  query: UseQueryResult<TaskPresentationRow[], Error>;
  empty: string;
  manager?: boolean;
  now: Date;
  onOpenTask: (id: number) => void;
  highlightedId?: number | null;
  onGaveUp?: OnGaveUp;
}) {
  return (
    <TaskQueryStates query={query}>
      {(rows) =>
        !rows.length ? (
          <EmptyState bare>{empty}</EmptyState>
        ) : manager ? (
          <ManagerTaskList rows={rows} now={now} onOpenTask={onOpenTask} />
        ) : (
          <TaskCardGrid
            rows={rows}
            now={now}
            onOpenTask={onOpenTask}
            highlightedId={highlightedId}
            onGaveUp={onGaveUp}
          />
        )
      }
    </TaskQueryStates>
  );
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
 * Taskuri's two views (#973): the Task Tracker, and **Cereri** — the
 * Completed-work Requests — at `?vedere=cereri`.
 */
type TrackerView = 'taskuri' | 'cereri';

const VIEW_KEY = 'vedere';
const REQUESTS_VIEW = 'cereri';

/** "1 cerere de decis", "3 cereri de decis", "20 de cereri de decis". */
function decisionsLabel(count: number): string {
  if (count === 1) return '1 cerere de decis';
  const lastTwo = count % 100;
  const de = count >= 20 && (lastTwo === 0 || lastTwo >= 20);
  return `${new Intl.NumberFormat('ro-RO').format(count)} ${de ? 'de ' : ''}cereri de decis`;
}

export default function TrackerScreen() {
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
  // such. The read stays for the count on the segment.
  const filesRequests = submitsWorkRequests(claims);
  const decisions = usePendingDecisions();
  const toDecide = decisions.data?.length ?? 0;
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
  // `null` until the page has chosen its opening tab; a click sets it.
  const [tab, setTab] = useState<TrackerTab | null>(null);
  // The deep links (#685, #822, #846): `/tracker?task=<id>` lands on the
  // Task, `/tracker?lista=<tab>` opens that tab. `task` wins over `lista`.
  const [params, setParams] = useSearchParams();
  // `?vedere=cereri` (#973) shows Cereri; anything else the Tracker.
  const view: TrackerView =
    params.get(VIEW_KEY) === REQUESTS_VIEW ? 'cereri' : 'taskuri';
  // A history entry per choice, so Back returns to the Tracker; every other
  // parameter is kept.
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
  const tabStrip = useRef<HTMLDivElement>(null);
  // The strip mounts afresh on the way back from Cereri: centre it again then.
  useActiveTabInView(tabStrip, view === 'taskuri' ? selected : null);
  return (
    <Page>
      <PageHeader
        title="Taskuri"
        description={
          view === 'taskuri'
            ? 'Lucrul tău și oportunitățile din OSUBB.'
            : filesRequests
              ? 'Descrie contribuția, iar coordonatorii grupului o vor evalua.'
              : 'Cererile de activitate realizată pe care le poți aproba sau respinge.'
        }
        actions={
          <>
            <SegmentedToggle
              label="Secțiune"
              options={[
                { value: 'taskuri', label: 'Taskuri', icon: ListTodo },
                {
                  value: 'cereri',
                  label: (
                    <>
                      Cereri
                      {toDecide > 0 && (
                        // Solid, so the count stays legible on the inked
                        // segment as well as on the track.
                        <Badge
                          variant="destructive"
                          className="min-w-5 bg-destructive text-(--surface) dark:bg-destructive"
                        >
                          <span aria-hidden="true">{toDecide}</span>
                          <span className="sr-only">
                            , {decisionsLabel(toDecide)}
                          </span>
                        </Badge>
                      )}
                    </>
                  ),
                  icon: ClipboardPlus,
                },
              ]}
              value={view}
              onChange={chooseView}
            />
            {view === 'taskuri' && (
              <>
                <NewTaskControl
                  onCreated={(id) => {
                    setCreated({ id, notice: 'Taskul a fost creat.' });
                    setDetailId(id);
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
            )}
          </>
        }
      />
      {view === 'cereri' ? (
        <RequestsView />
      ) : (
        <>
          {management.isError && (
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
          {leadership.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              Se verifică accesul la toate taskurile…
            </p>
          )}
          {leadership.isError && (
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
          <Tabs.Root
            // The tab strip has no margin of its own: this stack spaces it (#841).
            className="flex flex-col gap-6"
            value={selected}
            onValueChange={(value) => {
              if (isTrackerTab(value)) setTab(value);
              setGaveUp(null);
            }}
          >
            <Tabs.List
              ref={tabStrip}
              aria-label="Liste de taskuri"
              className={tabListClass}
            >
              <Tabs.Tab value="mine" className={tabClass}>
                Taskurile mele
              </Tabs.Tab>
              <Tabs.Tab value="available" className={tabClass}>
                Disponibile
              </Tabs.Tab>
              {management.data && (
                <Tabs.Tab value="managed" className={tabClass}>
                  De gestionat
                </Tabs.Tab>
              )}
              {showAll && (
                <Tabs.Tab value="all" className={tabClass}>
                  Toate
                </Tabs.Tab>
              )}
            </Tabs.List>
            <Tabs.Panel value="mine" className="space-y-6">
              {!leader && <PersonalScoreHeader />}
              {gaveUp !== null && (
                <TaskActionSuccess key={gaveUp.id}>
                  {gaveUp.receipt}
                </TaskActionSuccess>
              )}
              <TaskQueryPanel
                query={mine}
                onGaveUp={(id, receipt) => setGaveUp({ id, receipt })}
                empty="Nu ai niciun task atribuit încă."
                now={now}
                onOpenTask={setDetailId}
                highlightedId={highlightedId}
              />
            </Tabs.Panel>
            <Tabs.Panel value="available">
              <TaskQueryStates query={available}>
                {(opportunities) => (
                  <AvailableOpportunities
                    opportunities={opportunities}
                    now={now}
                    onOpenTask={setDetailId}
                  />
                )}
              </TaskQueryStates>
            </Tabs.Panel>
            {management.data && (
              <Tabs.Panel value="managed">
                <TaskQueryPanel
                  query={managed}
                  empty="Nu ai taskuri de gestionat acum."
                  manager
                  now={now}
                  onOpenTask={setDetailId}
                />
              </Tabs.Panel>
            )}
            {showAll && (
              <Tabs.Panel value="all">
                <TaskQueryPanel
                  query={all}
                  empty="Nu există taskuri vizibile."
                  manager
                  now={now}
                  onOpenTask={setDetailId}
                />
              </Tabs.Panel>
            )}
          </Tabs.Root>
        </>
      )}
      <TaskDetailsSheet
        key={detailId}
        taskId={detailId}
        managedTaskIds={managedTaskIds}
        notice={
          detailId !== null && detailId === created?.id ? created.notice : null
        }
        onClose={() => {
          setDetailId(null);
          setCreated(null);
        }}
      />
    </Page>
  );
}
