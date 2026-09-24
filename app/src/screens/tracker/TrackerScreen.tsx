import { useEffect, useRef, useState } from 'react';
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
import { useTaskProgress } from '../../queries/task-progress';
import { useAuth } from '../../lib/auth';
import { Button } from '../../components/ui/button';
import { Empty, EmptyHeader, EmptyTitle } from '../../components/ui/empty';
import { TaskDetailsSheet } from './TaskDetailsSheet';
import { ManagerTaskTable } from './ManagerTaskTable';
import { NewTaskControl } from './NewTaskControl';
import { TaskCard } from './TaskCard';
import { PersonalScoreHeader } from './PersonalScoreHeader';
import {
  toTaskPresentation,
  type TaskPresentationRow,
} from './task-presentation';

function TaskQueryPanel({
  query,
  empty,
  manager = false,
  available = false,
  now,
  onOpenTask,
  highlightedId = null,
}: {
  query: UseQueryResult<TaskPresentationRow[], Error>;
  empty: string;
  manager?: boolean;
  available?: boolean;
  now: Date;
  onOpenTask: (id: number) => void;
  highlightedId?: number | null;
}) {
  const progress = useTaskProgress();
  const { session } = useAuth();
  if (query.isPending) return <p role="status">Se încarcă taskurile…</p>;
  if (query.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>Nu am putut încărca taskurile.</p>
        <Button
          variant="outline"
          className="min-h-11 min-w-11"
          onClick={() => query.refetch()}
        >
          Încearcă din nou
        </Button>
      </div>
    );
  if (!query.data.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{empty}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  if (manager)
    return (
      <ManagerTaskTable
        tasks={query.data.map((row) => toTaskPresentation(row, now))}
        onOpenTask={onOpenTask}
      />
    );
  return (
    <ul
      data-slot="task-card-grid"
      className="grid min-w-0 grid-cols-1 items-stretch gap-4 p-0"
    >
      {query.data.map((row) => (
        <li key={row.id} data-slot="task-card-row" className="h-full min-w-0">
          <TaskCard
            task={toTaskPresentation(row, now)}
            allowInterest={available}
            onOpenTask={onOpenTask}
            memberId={session?.user.id}
            pending={
              progress.isPending && progress.variables?.taskId === row.id
            }
            onProgress={(input) => progress.mutateAsync(input)}
            highlighted={row.id === highlightedId}
          />
        </li>
      ))}
    </ul>
  );
}
/** `?task=<id>`: a positive whole Task id, or nothing. */
function linkedTaskId(value: string | null): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
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
  // opens Taskurile mele on that card. Only `task` is read here.
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
  const tabClass =
    'min-h-11 min-w-11 rounded-md px-3 py-2 text-sm font-medium data-active:bg-primary data-active:text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring';
  return (
    <section className="w-full" aria-labelledby="tracker-title">
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 id="tracker-title" className="text-2xl font-semibold">
              Taskuri
            </h1>
            <p className="text-muted-foreground">
              Lucrul tău și oportunitățile din OSUBB.
            </p>
          </div>
          <NewTaskControl
            onCreated={(id) => {
              setCreatedId(id);
              setDetailId(id);
            }}
          />
        </header>
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
          <Tabs.List
            aria-label="Liste de taskuri"
            className="mb-5 flex flex-wrap gap-2"
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
          <Tabs.Panel value="mine" className="space-y-5">
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
            <TaskQueryPanel
              query={available}
              empty="Nu sunt oportunități disponibile acum."
              available
              now={now}
              onOpenTask={setDetailId}
            />
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
      </div>
    </section>
  );
}
