import { useEffect, useMemo, useRef, useState } from 'react';
import {
  skipToken,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { readAllRows } from './read-all';
import type { WorkFilterParams, WorkItem } from '../lib/work-filter';
import type {
  FinishedState,
  ManagerTaskSort,
} from '../screens/tracker/manager-task-list';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';
import { useCampaigns } from './campaigns';
import { keys } from './keys';
import { useGroups } from './reference';

/**
 * The Tracker's Task lists (#1053, spec 2026-10-14; the Member's own since
 * ruling R55): De gestionat (`managed`), Toate (`all`), Taskurile mele
 * (`mine`) and Disponibile (`available`). The server decides a list's
 * authority once per Group (`private.task_list_scope`) and `task_list`
 * returns a page of ready rows in one request, so nothing here reads an
 * archive whole:
 *
 * - the **open** Tasks of a list (De făcut, În lucru, În verificare) are read
 *   whole — they are bounded by what the organization is doing now;
 * - the **finished** ones are read 50 at a time, with the Work Filter, the
 *   state, the title search and Grupuri preferate applied by the server;
 *   Disponibile has none;
 * - what the list holds (which Groups, Campaigns and states) comes from
 *   `task_list_summary`, never from the rows.
 */
export type TaskListName = 'managed' | 'all' | 'mine' | 'available';

/** The lists with a finished part: every one but Disponibile. */
export type FinishedListName = Exclude<TaskListName, 'available'>;

export type { FinishedState };

/** What narrows the finished part of a list; every key is optional. */
export type FinishedFilters = WorkFilterParams & {
  p_state?: FinishedState;
  /** The title search; the server folds case and diacritics. */
  p_search?: string;
  /** R43: without the Groups the Member unselected. */
  p_preferred?: boolean;
  p_sort?: ManagerTaskSort;
};

/** How many finished Tasks one page holds. */
export const FINISHED_PAGE = 50;
/** PostgREST returns at most this many rows per request (`max_rows`). */
const WHOLE_PAGE = 500;

type TaskStatus = Database['public']['Enums']['task_status'];

/**
 * One `task_list` row. Written out because the generated type of a
 * table-returning function marks every column as never null.
 */
export type TaskListRpcRow = {
  id: number;
  group_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  deadline: string | null;
  completed_at: string | null;
  review_round: number;
  assignment_mode: string | null;
  audience: string | null;
  min_level: number;
  kind: string;
  parent_task_id: number | null;
  campaign_id: number | null;
  duplicated_from_task_id: number | null;
  queue_closed_at: string | null;
  links: TaskPresentationRow['links'];
  assignments: NonNullable<TaskPresentationRow['assignments']>;
  evaluations: NonNullable<TaskPresentationRow['evaluations']>;
  submission: NonNullable<TaskPresentationRow['submission']>;
  executor: {
    member_id: string;
    full_name: string | null;
    nickname: string | null;
    is_current: boolean;
  } | null;
  /** The status of the caller's newest Candidature on the Task, or null. */
  my_candidature: string | null;
  total: number;
};

/** One `task_list_summary` row: Tasks counted by what a filter can choose. */
export type TaskListSummaryRow = {
  group_id: number;
  campaign_id: number | null;
  status: TaskStatus;
  /** Completed after the deadline. */
  late: boolean;
  /** Carries a deadline. */
  dated: boolean;
  tasks: number;
};

/**
 * A server row as the Tracker's cards read a Task: the Task, its history, and
 * its Executor under `visibleExecutor`. The Group and Campaign labels are
 * joined by `withLabels`; the caller's Candidature is Disponibile's to read
 * before the rows are mapped.
 */
export function taskListRow(row: TaskListRpcRow): TaskPresentationRow {
  const {
    executor,
    total: _total,
    my_candidature: _candidature,
    ...task
  } = row;
  return {
    ...task,
    visibleExecutor: executor
      ? {
          memberId: executor.member_id,
          fullName: executor.full_name?.trim() || null,
          nickname: executor.nickname?.trim() || null,
          isCurrent: executor.is_current,
        }
      : null,
  };
}

/** The part of a Group a Task row shows. */
type GroupLabel = NonNullable<TaskPresentationRow['group']> & { id: number };

/**
 * Joins the Group and the Campaign of each row from the reads the Member
 * already has through RLS. A Group or Campaign they may not read stays
 * `null`, exactly as a PostgREST embed would leave it — never an id. What a
 * row carries beyond the Task (an Opportunity's flags) goes through.
 */
export function withLabels<Row extends TaskPresentationRow>(
  rows: readonly Row[],
  groups: ReadonlyMap<number, GroupLabel> | undefined,
  campaigns: readonly { id: number; name: string }[] | undefined,
): Row[] {
  const campaignNames = new Map(
    (campaigns ?? []).map((campaign) => [campaign.id, campaign.name]),
  );
  return rows.map((row) => {
    const group = groups?.get(row.group_id);
    const campaign =
      row.campaign_id === null ? undefined : campaignNames.get(row.campaign_id);
    return {
      ...row,
      group: group
        ? {
            name: group.name,
            short: group.short,
            color: group.color,
            category: group.category,
            path: group.path,
            is_organization: group.is_organization,
            is_private: group.is_private === true,
          }
        : null,
      campaign: campaign === undefined ? null : { name: campaign },
    };
  });
}

type TaskListArgs = Database['public']['Functions']['task_list']['Args'];

async function readTaskList(args: TaskListArgs): Promise<TaskListRpcRow[]> {
  const { data, error } = await supabase.rpc('task_list', args);
  if (error) throw error;
  return (data ?? []) as unknown as TaskListRpcRow[];
}

/**
 * Every server row the arguments match, 500 a request until a short page,
 * as sent: what Disponibile reads its Candidatures from.
 */
export async function readWholeTaskRows(
  args: Omit<TaskListArgs, 'p_limit' | 'p_offset'>,
): Promise<TaskListRpcRow[]> {
  const rows: TaskListRpcRow[] = [];
  for (let offset = 0; ; offset += WHOLE_PAGE) {
    const page = await readTaskList({
      ...args,
      p_limit: WHOLE_PAGE,
      p_offset: offset,
    });
    rows.push(...page);
    if (page.length < WHOLE_PAGE) return rows;
  }
}

/** Every row the arguments match, as the cards read them. */
async function readWholeTaskList(
  args: Omit<TaskListArgs, 'p_limit' | 'p_offset'>,
): Promise<TaskPresentationRow[]> {
  return (await readWholeTaskRows(args)).map(taskListRow);
}

/** The open Tasks of a list, whole: one request unless there are over 500. */
export function fetchOpenTasks(
  list: TaskListName,
): Promise<TaskPresentationRow[]> {
  return readWholeTaskList({ p_list: list, p_finished: false });
}

/**
 * Every Task of a list, open or finished, whose deadline is in
 * `[from, to)`: the Calendar's month.
 */
export function fetchTasksInRange(
  list: FinishedListName,
  range: { from: string; to: string },
): Promise<TaskPresentationRow[]> {
  return readWholeTaskList({
    p_list: list,
    p_from: range.from,
    p_to: range.to,
  });
}

export type FinishedTasksPage = { rows: TaskPresentationRow[]; total: number };

/** One page of a list's finished Tasks, and how many the filters match. */
export async function fetchFinishedPage(
  list: FinishedListName,
  filters: FinishedFilters,
  offset: number,
): Promise<FinishedTasksPage> {
  const page = await readTaskList({
    p_list: list,
    p_finished: true,
    ...filters,
    p_limit: FINISHED_PAGE,
    p_offset: offset,
  });
  return { rows: page.map(taskListRow), total: page[0]?.total ?? 0 };
}

export async function fetchTaskListSummary(
  list: TaskListName,
): Promise<TaskListSummaryRow[]> {
  // One row per Group, Campaign, state, lateness and date: it grows with
  // every Campaign. Ordered by that whole key, as the server groups it.
  const rows = await readAllRows((from, to) =>
    supabase
      .rpc('task_list_summary', { p_list: list })
      .order('group_id')
      .order('campaign_id')
      .order('status')
      .order('late')
      .order('dated')
      .range(from, to),
  );
  return rows as unknown as TaskListSummaryRow[];
}

/**
 * Rule W's items for the summary rows a page can show: one per Group and
 * Campaign, since the Work Filter only asks which of them own work.
 */
export function summaryWork(
  summary: readonly TaskListSummaryRow[],
  keep: (row: TaskListSummaryRow) => boolean = () => true,
): WorkItem[] {
  const seen = new Set<string>();
  const work: WorkItem[] = [];
  for (const row of summary) {
    const key = `${row.group_id}/${row.campaign_id ?? ''}`;
    if (!keep(row) || seen.has(key)) continue;
    seen.add(key);
    work.push({ group_id: row.group_id, campaign_id: row.campaign_id });
  }
  return work;
}

export async function fetchTaskManageCapability(
  taskId: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_manage_task', {
    p_task_id: taskId,
  });
  if (error) throw error;
  return data === true;
}

/** Whether the viewer may read one Task: its row through `tasks_read`. */
export async function fetchTaskReadable(taskId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * How an Assignment ends when its Member stops holding the Task without the
 * work being decided: the Task is no longer theirs (Audit D-3), exactly as
 * the `mine` list leaves it out.
 */
const LEFT_ASSIGNMENT: ReadonlySet<string> = new Set([
  'gave_up',
  'replaced',
  'task_updated',
  'group_changed',
]);

/**
 * Whether one Task is in Taskurile mele, open or finished: the Member's
 * newest own Assignment on it, through RLS, did not end in leaving it. Where
 * a `?task=` link lands when the open rows do not hold the Task.
 */
export async function fetchTaskIsMine(
  taskId: number,
  memberId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('task_assignments')
    .select('end_reason')
    .eq('task_id', taskId)
    .eq('member_id', memberId)
    .order('assigned_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data !== null && !LEFT_ASSIGNMENT.has(data.end_reason ?? '');
}

/**
 * What a list read answers with: the part of a query result every reader of
 * these lists uses, so a read joined from two requests can stand in for one.
 */
export type ListRead<Row> = {
  data: Row[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => unknown;
};

/**
 * A list read with its Group and Campaign labels joined in. The labels are
 * the app's shared reads (five minutes fresh), so a list costs one request.
 * It waits for them rather than flash "Origine indisponibilă"; if they fail,
 * the Tasks still show, unlabelled, as when RLS withholds a Group.
 *
 * It waits only until they first answer. A failed label read that is retried
 * has neither data nor an error while it runs; the rows already on screen
 * stay, unlabelled, until it lands, instead of going back to loading.
 */
function useLabelled<Row extends TaskPresentationRow>(
  rows: readonly Row[] | undefined,
): Row[] | undefined {
  const groups = useGroups();
  const campaigns = useCampaigns();
  const answered =
    (groups.data !== undefined || groups.isError) &&
    (campaigns.data !== undefined || campaigns.isError);
  const [answeredOnce, setAnsweredOnce] = useState(false);
  if (answered && !answeredOnce) setAnsweredOnce(true);
  const ready = answered || answeredOnce;
  return useMemo(
    () =>
      rows && ready ? withLabels(rows, groups.data, campaigns.data) : undefined,
    [rows, ready, groups.data, campaigns.data],
  );
}

/**
 * A whole-list query as every reader of these lists takes it: labelled
 * (`useLabelled`), and pending until the labels first answer too.
 */
export function useLabelledRead<Row extends TaskPresentationRow>(query: {
  data: readonly Row[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => unknown;
}): ListRead<Row> {
  const data = useLabelled(query.data);
  return {
    data,
    isPending: query.isPending || (!query.isError && data === undefined),
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Where each list's open Tasks are cached. */
const OPEN_KEYS = {
  managed: keys.tasks.managed,
  all: keys.tasks.leadership,
  mine: keys.tasks.mine,
} as const;

function useOpenTasks(
  list: FinishedListName,
  enabled: boolean,
): ListRead<TaskPresentationRow> {
  const memberId = useAuth().session?.user.id;
  const query = useQuery({
    queryKey: OPEN_KEYS[list](memberId),
    queryFn: memberId && enabled ? () => fetchOpenTasks(list) : skipToken,
  });
  return useLabelledRead(query);
}

/** The open Tasks the Member manages (De gestionat, Acasă's De evaluat). */
export function useManagedTasks(enabled: boolean) {
  return useOpenTasks('managed', enabled);
}

/** The open Tasks the Member reads (Toate, shown below BC). */
export function useAllTasks(enabled: boolean) {
  return useOpenTasks('all', enabled);
}

/**
 * Taskurile mele's open Tasks (ruling R55): the Tasks the Member holds now,
 * whole and labelled. That is all Acasă's tiles and **Urmează** need; the
 * finished ones are read by the page (`useFinishedTasks('mine', …)`), and
 * what the list holds by `useTaskListSummary('mine', …)`.
 */
export function useMyTasks() {
  return useOpenTasks('mine', true);
}

/**
 * The infinite query of a list's finished Tasks. The next page starts after
 * the rows already read, and there is none once they reach `total` or a page
 * comes back empty.
 */
export function finishedTasksQueryOptions(
  list: FinishedListName,
  filters: FinishedFilters,
  memberId: string | undefined,
) {
  return {
    queryKey: keys.tasks.finished(memberId, list, filters),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchFinishedPage(list, filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: FinishedTasksPage,
      pages: readonly FinishedTasksPage[],
    ) => {
      const read = pages.reduce((count, page) => count + page.rows.length, 0);
      return lastPage.rows.length > 0 && read < lastPage.total
        ? read
        : undefined;
    },
  } as const;
}

export type FinishedTasks = {
  /** The finished Tasks read so far, each once, in the server's order. */
  rows: TaskPresentationRow[];
  /** How many the filters match; undefined until the first page lands. */
  total: number | undefined;
  /** The first page is on its way. */
  isPending: boolean;
  /** The first page failed. */
  isError: boolean;
  error: Error | null;
  hasMore: boolean;
  /** The next page is on its way. */
  isLoadingMore: boolean;
  /**
   * Any read of the list is on its way: the first page, the first page read
   * again after a change, or the next page. No next page is asked meanwhile.
   */
  isFetching: boolean;
  /** A later page failed; the rows read so far stay. */
  moreFailed: boolean;
  /** Asks for the next page, unless a read is on its way. */
  loadMore: () => void;
  refetch: () => void;
};

/**
 * The finished Tasks of a list under `filters`, read by the page; `null`
 * filters (an inverted date range, or a state no finished Task has) ask
 * nothing and answer an empty, settled list.
 */
export function useFinishedTasks(
  list: FinishedListName,
  filters: FinishedFilters | null,
  enabled: boolean,
): FinishedTasks {
  const memberId = useAuth().session?.user.id;
  const asked = Boolean(memberId && enabled && filters);
  const query = useInfiniteQuery({
    ...finishedTasksQueryOptions(list, filters ?? {}, memberId),
    enabled: asked,
  });
  const read = useMemo(() => {
    // A Task that finished between two pages shifts the next one: keep the
    // first appearance of each id.
    const seen = new Set<number>();
    const rows: TaskPresentationRow[] = [];
    for (const page of query.data?.pages ?? [])
      for (const row of page.rows)
        if (!seen.has(row.id)) {
          seen.add(row.id);
          rows.push(row);
        }
    return rows;
  }, [query.data]);
  // No page yet is "on its way", never "none": an empty list is only what a
  // page that has landed says.
  const labelled = useLabelled(asked && query.data ? read : undefined);
  const firstFailed = query.isError && query.data === undefined;
  return {
    rows: labelled ?? [],
    total: asked ? query.data?.pages[0]?.total : 0,
    isPending: asked && !firstFailed && labelled === undefined,
    isError: asked && firstFailed,
    error: firstFailed ? query.error : null,
    hasMore: asked && query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    isFetching: asked && query.isFetching,
    moreFailed: query.isFetchNextPageError,
    loadMore: () => {
      // After a change the list keeps its first page and reads it again
      // (live-changes.ts). A next page asked meanwhile would cancel that read
      // and land on top of the old first page; `cancelRefetch: false` also
      // covers a call made from a render before that read began.
      if (query.hasNextPage && !query.isFetching)
        void query.fetchNextPage({ cancelRefetch: false });
    },
    refetch: () => void query.refetch(),
  };
}

/**
 * Asks once, as soon as `enabled`, for the first page of a list's finished
 * part under `filters`, before the list is drawn: the Tracker opens on De
 * gestionat only once its open Tasks have landed, and the list then finds
 * this page read or on its way, under the same key. `filters` must be what
 * the list will open with (`finishedListFilters`); a filter changed later
 * is the list's own read, never asked here.
 */
export function usePrefetchFinishedTasks(
  list: FinishedListName,
  filters: FinishedFilters | null,
  enabled: boolean,
): void {
  const queryClient = useQueryClient();
  const memberId = useAuth().session?.user.id;
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !enabled || !memberId) return;
    asked.current = true;
    if (filters)
      void queryClient.prefetchInfiniteQuery(
        finishedTasksQueryOptions(list, filters, memberId),
      );
  }, [queryClient, list, filters, enabled, memberId]);
}

/** What a list holds; nothing is asked while `enabled` is false. */
export function useTaskListSummary(list: TaskListName, enabled: boolean) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.summary(memberId, list),
    queryFn: memberId && enabled ? () => fetchTaskListSummary(list) : skipToken,
  });
}

/**
 * The managed Tasks, open or finished, with a deadline in the range: the
 * Calendar's **Taskurile gestionate** for the month it shows. A `null` range
 * asks nothing.
 */
export function useManagedTasksInRange(
  range: { from: string; to: string } | null,
  enabled: boolean,
): ListRead<TaskPresentationRow> {
  const memberId = useAuth().session?.user.id;
  const query = useQuery({
    queryKey: keys.tasks.managedRange(memberId, range),
    queryFn:
      memberId && enabled && range
        ? () => fetchTasksInRange('managed', range)
        : skipToken,
  });
  return useLabelledRead(query);
}

/**
 * The Member's own Tasks (Taskurile mele's), open or finished, with a
 * deadline in the range: the Calendar's month, never the whole list
 * (ruling R55). A `null` range asks nothing.
 */
export function useMyTasksInRange(
  range: { from: string; to: string } | null,
): ListRead<TaskPresentationRow> {
  const memberId = useAuth().session?.user.id;
  const query = useQuery({
    queryKey: keys.tasks.mineRange(memberId, range),
    queryFn:
      memberId && range ? () => fetchTasksInRange('mine', range) : skipToken,
  });
  return useLabelledRead(query);
}

/**
 * Whether one Task is the Member's, finished or not (`fetchTaskIsMine`):
 * where a `?task=` link lands when Taskurile mele's open rows do not hold
 * it. Nothing is asked for a `null` Task or while `enabled` is false.
 */
export function useTaskIsMine(taskId: number | null, enabled = true) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.isMine(taskId, memberId),
    queryFn:
      memberId && enabled && taskId !== null
        ? () => fetchTaskIsMine(taskId, memberId)
        : skipToken,
  });
}

/**
 * Whether the viewer reads one Task — where a `?task=` link lands for a
 * Member whose Toate holds every Task they read. Nothing is asked for a
 * `null` Task or while `enabled` is false.
 */
export function useTaskReadable(taskId: number | null, enabled = true) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.readable(taskId, memberId),
    queryFn:
      memberId && enabled && taskId !== null
        ? () => fetchTaskReadable(taskId)
        : skipToken,
  });
}

/**
 * `can_manage_task` for one Task, as the viewer: the details sheet's manager
 * controls and where a `?task=` link lands. Nothing is asked for a `null`
 * Task or while `enabled` is false.
 */
export function useTaskManageCapability(taskId: number | null, enabled = true) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.manageCapability(taskId, memberId),
    queryFn:
      memberId && enabled && taskId !== null
        ? () => fetchTaskManageCapability(taskId)
        : skipToken,
  });
}
