import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Tabs } from '@base-ui/react/tabs';
import type { UseQueryResult } from '@tanstack/react-query';
import { useMyTasks } from '../../queries/tasks';
import { useTaskOpportunities } from '../../queries/task-opportunities';
import {
  useTaskManagement,
  useTaskLeadership,
  useManagedTasks,
  useAllTasks,
} from '../../queries/task-tabs';
import { Button } from '../../components/ui/button';
import {
  EmptyState,
  Page,
  PageHeader,
  tabClass,
  tabListClass,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { parsePositiveInt } from '../../lib/ids';
import { AvailableOpportunities } from './AvailableOpportunities';
import { TaskDetailsSheet } from './TaskDetailsSheet';
import { ManagerTaskList } from './ManagerTaskList';
import { NewTaskControl } from './NewTaskControl';
import { TaskCardGrid } from './TaskCardGrid';
import { PersonalScoreHeader } from './PersonalScoreHeader';
import type { TaskPresentationRow } from './task-presentation';

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
}: {
  query: UseQueryResult<TaskPresentationRow[], Error>;
  empty: string;
  manager?: boolean;
  now: Date;
  onOpenTask: (id: number) => void;
  highlightedId?: number | null;
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

const HIGHLIGHT_MS = 4000;

export default function TrackerScreen() {
  const mine = useMyTasks();
  const available = useTaskOpportunities();
  const management = useTaskManagement();
  const managed = useManagedTasks(management.data === true);
  const leadership = useTaskLeadership();
  const all = useAllTasks(leadership.data === true);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [tab, setTab] = useState('mine');
  // The deep link Acasă and the notifications use (#685): `/tracker?task=<id>`
  // opens Taskurile mele on that card, or De gestionat with the Task's sheet
  // when it is not mine but I manage it (#822). Only `task` is read here.
  const [params] = useSearchParams();
  const linkedId = linkedTaskId(params.get('task'));
  const [linkFor, setLinkFor] = useState<number | null>(null);
  const [expiredFor, setExpiredFor] = useState<number | null>(null);
  // Counts link changes, so a later link back to the same card lands afresh.
  const [linkVisit, setLinkVisit] = useState(0);
  if (linkedId !== linkFor) {
    // A new link: open Taskurile mele and allow a fresh highlight.
    setLinkFor(linkedId);
    setExpiredFor(null);
    setLinkVisit((visit) => visit + 1);
    if (linkedId !== null) setTab('mine');
  }
  // A Task that is not one of mine but is in De gestionat (Acasă's De evaluat,
  // #822) opens De gestionat and that Task's details sheet — where the
  // Evaluation control is — once per link, after both lists have loaded (a
  // failed Taskurile mele read never routes a Task of mine to De gestionat).
  const managedLanding =
    linkedId !== null &&
    mine.isSuccess &&
    !mine.data.some((task) => task.id === linkedId) &&
    managed.data?.some((task) => task.id === linkedId)
      ? linkedId
      : null;
  const [openedVisit, setOpenedVisit] = useState<number | null>(null);
  if (managedLanding !== null && openedVisit !== linkVisit) {
    setOpenedVisit(linkVisit);
    setTab('managed');
    setDetailId(managedLanding);
  }
  // The card is highlighted once the list has loaded with it in it, until
  // the highlight expires. An id that is not one of mine leaves the plain list.
  const landing =
    linkedId !== null && mine.data?.some((task) => task.id === linkedId)
      ? linkedId
      : null;
  const highlightedId = landing !== expiredFor ? landing : null;
  const landed = useRef<string | null>(null);
  useEffect(() => {
    // Once per link: a refetch must not pull the page back, but every new
    // link lands, even on a card an earlier link landed on.
    const visit = `${linkVisit}:${landing}`;
    if (landing === null || landed.current === visit) return;
    landed.current = visit;
    const card = document.getElementById(`task-${landing}`);
    card?.scrollIntoView({ block: 'center' });
    const title = card?.querySelector<HTMLElement>('[data-slot="task-title"]');
    (title?.querySelector<HTMLElement>('button') ?? title)?.focus({
      preventScroll: true,
    });
  }, [landing, linkVisit]);
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
  const showAll = leadership.data === true;
  const managedTaskIds = new Set((managed.data ?? []).map((task) => task.id));
  const selected =
    (tab === 'managed' && !management.data) || (tab === 'all' && !showAll)
      ? 'mine'
      : tab;
  return (
    <Page>
      <PageHeader
        title="Taskuri"
        description="Lucrul tău și oportunitățile din OSUBB."
        actions={
          <NewTaskControl
            onCreated={(id) => {
              setCreatedId(id);
              setDetailId(id);
            }}
          />
        }
      />
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
        value={selected}
        onValueChange={(value) => {
          if (typeof value === 'string') setTab(value);
        }}
      >
        <Tabs.List aria-label="Liste de taskuri" className={tabListClass}>
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
          <PersonalScoreHeader />
          <TaskQueryPanel
            query={mine}
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
      <TaskDetailsSheet
        key={detailId}
        taskId={detailId}
        managedTaskIds={managedTaskIds}
        notice={
          detailId !== null && detailId === createdId
            ? 'Taskul a fost creat.'
            : null
        }
        onClose={() => {
          setDetailId(null);
          setCreatedId(null);
        }}
      />
    </Page>
  );
}
