import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import type { Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * "Șterge definitiv" (#1017, ruling R38): whoever manages a Task, Group, Event
 * or Campaign removes it for good. Each command keeps the gate its kind
 * already has; the server decides again inside its transaction, and every
 * refusal reaches the dialog in the shared Romanian copy.
 */

/** The Task Points a Task (and its Subtasks) still holds, per Member. */
export type PointsAtStake = {
  total: number;
  members: { memberId: string; points: number }[];
};

export type TaskDeletePreview = PointsAtStake & { subtasks: number };

/** What a Group's subtree holds — `group_delete_preview`, as numbers. */
export type GroupDeletePreview = {
  subgroups: number;
  members: number;
  tasks: number;
  tasksWithPoints: number;
  points: number;
  pointMembers: number;
  events: number;
  announcements: number;
  campaigns: number;
  applications: number;
  requests: number;
  protected: boolean;
};

export type GroupDeleteMode = 'everything' | 'empty';

type JsonObject = { [key: string]: Json | undefined };

function object(value: Json | undefined): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function count(value: Json | undefined): number {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : 0;
}

/** `{total, members: [{member_id, points}]}`, from a reply or a refusal. */
export function readPointsAtStake(value: Json | undefined): PointsAtStake {
  const row = object(value);
  const members = Array.isArray(row.members) ? row.members : [];
  return {
    total: count(row.total),
    members: members.flatMap((entry) => {
      const member = object(entry);
      return typeof member.member_id === 'string'
        ? [{ memberId: member.member_id, points: count(member.points) }]
        : [];
    }),
  };
}

export function readTaskDeletePreview(value: Json): TaskDeletePreview {
  return {
    subtasks: count(object(value).subtasks),
    ...readPointsAtStake(value),
  };
}

export function readGroupDeletePreview(value: Json): GroupDeletePreview {
  const row = object(value);
  return {
    subgroups: count(row.subgroups),
    members: count(row.members),
    tasks: count(row.tasks),
    tasksWithPoints: count(row.tasks_with_points),
    points: count(row.points),
    pointMembers: count(row.point_members),
    events: count(row.events),
    announcements: count(row.announcements),
    campaigns: count(row.campaigns),
    applications: count(row.applications),
    requests: count(row.requests),
    protected: row.protected === true,
  };
}

/**
 * Whether `'empty'` applies: nothing in the subtree but the roster, which goes
 * with the Group (`delete_group` refuses `'empty'` otherwise).
 */
export function groupIsEmpty(preview: GroupDeletePreview): boolean {
  return (
    preview.subgroups === 0 &&
    preview.tasks === 0 &&
    preview.events === 0 &&
    preview.announcements === 0 &&
    preview.campaigns === 0 &&
    preview.applications === 0 &&
    preview.requests === 0
  );
}

/**
 * A refused delete. `points` is set on `task_has_points`: the Task gained
 * points after the dialog read its preview, and the refusal names them.
 */
export class DeleteRefusal extends CommandError {
  readonly points: PointsAtStake | null;
  constructor(error: unknown, fallback: string) {
    super(error, fallback);
    this.name = 'DeleteRefusal';
    this.points = null;
    if (this.reason === 'task_has_points') {
      const details = (error as { details?: unknown }).details;
      try {
        const parsed: unknown =
          typeof details === 'string' ? JSON.parse(details) : details;
        this.points = readPointsAtStake(parsed as Json);
      } catch {
        this.points = { total: 0, members: [] };
      }
    }
  }
}

const TASK_FAILED = 'Nu am putut șterge taskul. Încearcă din nou.';
const TASK_PREVIEW_FAILED = 'Nu am putut verifica punctele taskului.';
const EVENT_FAILED = 'Nu am putut șterge evenimentul. Încearcă din nou.';
const CAMPAIGN_FAILED = 'Nu am putut șterge campania. Încearcă din nou.';
const GROUP_FAILED = 'Nu am putut șterge grupul. Încearcă din nou.';
const GROUP_PREVIEW_FAILED = 'Nu am putut verifica ce conține grupul.';

/* ------------------------------------------------------------------ Tasks */

export async function fetchTaskDeletePreview(
  taskId: number,
): Promise<TaskDeletePreview> {
  const { data, error } = await supabase.rpc('task_delete_preview', {
    p_task_id: taskId,
  });
  if (error) throw new DeleteRefusal(error, TASK_PREVIEW_FAILED);
  return readTaskDeletePreview(data);
}

/** Read each time the dialog opens: points may have moved since. */
export function useTaskDeletePreview(taskId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.deletePreview(taskId, memberId),
    queryFn: memberId ? () => fetchTaskDeletePreview(taskId) : skipToken,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export type TaskDeleted = {
  deletedTasks: number;
  /** The net change, e.g. −12. */
  pointsReversed: number;
  members: number;
};

export async function deleteTask({
  taskId,
  withPoints,
}: {
  taskId: number;
  withPoints: boolean;
}): Promise<TaskDeleted> {
  const { data, error } = await supabase.rpc('delete_task', {
    p_task_id: taskId,
    p_with_points: withPoints,
  });
  if (error) throw new DeleteRefusal(error, TASK_FAILED);
  const row = object(data);
  return {
    deletedTasks: count(row.deleted_tasks),
    pointsReversed: count(row.points_reversed),
    members: count(row.members),
  };
}

/** A query about one Task (its details, queue, history, preview). */
function aboutTask(taskId: number) {
  return (query: Query) => {
    const scope = query.queryKey[2];
    return (
      query.queryKey[0] === 'tasks' &&
      typeof scope === 'object' &&
      scope !== null &&
      (scope as { taskId?: unknown }).taskId === taskId
    );
  };
}

function invalidate(client: QueryClient, families: readonly QueryKey[]) {
  return Promise.all(
    families.map((queryKey) => client.invalidateQueries({ queryKey })),
  );
}

export function useDeleteTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteTask,
    onSuccess: (_result, { taskId }) => {
      // The deleted Task's own reads are only marked stale: refetching them
      // now would turn the open sheet into "Taskul nu este disponibil" under
      // the closing dialog. A later link to it refetches and lands there.
      const own = aboutTask(taskId);
      void client.invalidateQueries({ predicate: own, refetchType: 'none' });
      return Promise.all([
        client.invalidateQueries({
          queryKey: keys.tasks.all,
          predicate: (query) => !own(query),
        }),
        invalidate(client, [
          keys.points.all,
          keys.notifications.all,
          keys.campaigns.all,
          keys.requests.all,
          keys.members.all,
          keys.profile.all,
        ]),
      ]);
    },
  });
}

/* ----------------------------------------------------------------- Events */

export async function deleteEvent(eventId: number): Promise<{ rsvps: number }> {
  const { data, error } = await supabase.rpc('delete_event', {
    p_event_id: eventId,
  });
  if (error) throw new DeleteRefusal(error, EVENT_FAILED);
  return { rsvps: count(object(data).rsvps) };
}

export function useDeleteEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteEvent,
    onSuccess: () =>
      invalidate(client, [keys.events.all, keys.notifications.all]),
  });
}

/* -------------------------------------------------------------- Campaigns */

export async function deleteCampaign(
  campaignId: number,
): Promise<{ tasks: number; events: number }> {
  const { data, error } = await supabase.rpc('delete_campaign', {
    p_campaign_id: campaignId,
  });
  if (error) throw new DeleteRefusal(error, CAMPAIGN_FAILED);
  const row = object(data);
  return { tasks: count(row.tasks), events: count(row.events) };
}

export function useDeleteCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteCampaign,
    // The label goes from Tasks and Events, and from the Work Filters' choices.
    onSuccess: () =>
      invalidate(client, [
        keys.campaigns.all,
        keys.tasks.all,
        keys.events.all,
        keys.points.all,
        keys.groups.all,
      ]),
  });
}

/* ----------------------------------------------------------------- Groups */

export async function fetchGroupDeletePreview(
  groupId: number,
): Promise<GroupDeletePreview> {
  const { data, error } = await supabase.rpc('group_delete_preview', {
    p_group_id: groupId,
  });
  if (error) throw new DeleteRefusal(error, GROUP_PREVIEW_FAILED);
  return readGroupDeletePreview(data);
}

export function useGroupDeletePreview(groupId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.groups.deletePreview(groupId, memberId),
    queryFn: memberId ? () => fetchGroupDeletePreview(groupId) : skipToken,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export async function deleteGroup({
  groupId,
  mode,
}: {
  groupId: number;
  mode: GroupDeleteMode;
}): Promise<GroupDeletePreview & { pointsReversed: number }> {
  const { data, error } = await supabase.rpc('delete_group', {
    p_group_id: groupId,
    p_mode: mode,
  });
  if (error) throw new DeleteRefusal(error, GROUP_FAILED);
  return {
    ...readGroupDeletePreview(data),
    pointsReversed: count(object(data).points_reversed),
  };
}

export function useDeleteGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteGroup,
    // A subtree takes everything with it: every family that names a Group.
    onSuccess: () =>
      invalidate(client, [
        keys.groups.all,
        keys.reference.all,
        keys.tasks.all,
        keys.points.all,
        keys.events.all,
        keys.announcements.all,
        keys.campaigns.all,
        keys.notifications.all,
        keys.requests.all,
        keys.members.all,
        keys.profile.all,
        ['capabilities'],
      ]),
  });
}
