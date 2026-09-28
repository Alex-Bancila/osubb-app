import { useMemo } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type {
  WorkFilterCampaign,
  WorkFilterGroup,
  WorkItem,
} from '../lib/work-filter';
import { usePendingCandidatureTasks } from './calendar-tasks';
import { keys } from './keys';
import { useManagedTasks, useTaskManagement } from './task-tabs';
import { useMyTasks } from './tasks';

export type WorkFilterOptions = {
  groups: WorkFilterGroup[];
  campaigns: WorkFilterCampaign[];
};

async function pages<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await read(offset, offset + 499);
    if (page.error) throw page.error;
    if (!page.data) throw new Error('Missing Work Filter options');
    rows.push(...page.data);
    if (page.data.length < 500) return rows;
  }
}

/**
 * The Work Filter's choices (#678): every Group and Campaign the caller may
 * read, through their own RLS, paged. No category is excluded — the filter
 * offers Groups by the tree, not by kind.
 */
export async function fetchWorkFilterOptions(): Promise<WorkFilterOptions> {
  const [groups, campaigns] = await Promise.all([
    pages<WorkFilterGroup>((from, to) =>
      supabase
        .from('groups')
        .select('id,name,path,status,is_organization')
        .order('id')
        .range(from, to),
    ),
    pages<WorkFilterCampaign>((from, to) =>
      supabase
        .from('campaigns')
        .select('id,name,group_id')
        .order('id')
        .range(from, to),
    ),
  ]);
  return { groups, campaigns };
}

export function useWorkFilterOptions() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.groups.filterOptions(memberId),
    queryFn: memberId ? fetchWorkFilterOptions : skipToken,
  });
}

/**
 * The Group and Campaign of every Event the caller may read, past and future
 * (`events_read` is the whole rule), paged: the Calendar's Rule W items.
 */
export async function fetchEventWork(): Promise<WorkItem[]> {
  return pages<WorkItem>((from, to) =>
    supabase
      .from('events')
      .select('group_id,campaign_id')
      .order('id')
      .range(from, to),
  );
}

export function useEventWork() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.events.work(memberId),
    queryFn: memberId ? fetchEventWork : skipToken,
  });
}

/**
 * The items the Calendar can show (Rule W, #845): every readable Event, the
 * member's own and pending-candidature Task deadlines, and — while
 * **Taskurile gestionate** is on — the managed Tasks' deadlines. Not `ready`
 * until every read in use has settled, so the filter never offers a partial list;
 * when one of them failed, `work` is `undefined` and the filter offers every
 * option rather than hiding the page's own.
 */
export function useCalendarWork(showManaged: boolean): {
  ready: boolean;
  work: WorkItem[] | undefined;
} {
  const events = useEventWork();
  const mine = useMyTasks();
  const candidatures = usePendingCandidatureTasks();
  const management = useTaskManagement();
  const withManaged = showManaged && management.data === true;
  const managed = useManagedTasks(withManaged);
  const reads = [events, mine, candidatures, ...(withManaged ? [managed] : [])];
  const ready = reads.every((read) => !read.isPending);
  const failed = reads.some((read) => read.isError);
  const work = useMemo(
    () =>
      failed || !events.data || !mine.data || !candidatures.data
        ? undefined
        : calendarWorkItems({
            events: events.data,
            tasks: [
              mine.data,
              candidatures.data,
              withManaged ? managed.data : undefined,
            ],
          }),
    [
      failed,
      events.data,
      mine.data,
      candidatures.data,
      managed.data,
      withManaged,
    ],
  );
  return { ready, work };
}

/**
 * The Calendar's Rule W items: every Event, and each Task that has a
 * deadline — a Task without one draws no chip, so it owns nothing there.
 */
export function calendarWorkItems({
  events,
  tasks,
}: {
  events: readonly WorkItem[];
  tasks: readonly (
    readonly (WorkItem & { deadline: string | null })[] | undefined
  )[];
}): WorkItem[] {
  return [
    ...events,
    ...tasks.flatMap((rows) => (rows ?? []).filter((task) => task.deadline)),
  ];
}
