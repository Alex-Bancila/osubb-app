import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import type { Database } from '../lib/database.types';
import type { AttachedLink } from '../lib/schemas/attached-link';
import { supabase } from '../lib/supabase';
import type { ManagedWorkGroup } from '../screens/tracker/task-form-model';
import { fetchCampaigns } from './campaigns';
import { keys } from './keys';
import { readAllRows } from './read-all';

/** A Campaign a completed Task may carry: one owned on its Group's path. */
export type CompletedTaskCampaign = {
  id: number;
  name: string;
  group_id: number;
};

/**
 * What the completed-Task form chooses from (#915): the Groups, the readable
 * Group names (so a Child Group shows its parent) and the active Campaigns.
 */
export type CompletedTaskOptions = {
  groups: ManagedWorkGroup[];
  groupNames: ReadonlyMap<number, { name: string }>;
  campaigns: CompletedTaskCampaign[];
};

async function readNamesAndCampaigns() {
  const [names, campaigns] = await Promise.all([
    readAllRows((from, to) =>
      supabase
        .from('groups')
        .select('id,name,status')
        .order('id')
        .range(from, to),
    ),
    fetchCampaigns().then((rows) =>
      rows.filter((campaign) => campaign.is_active),
    ),
  ]);
  return { names, campaigns };
}

/**
 * Taskuri › De gestionat: the caller's active managed Groups. Whom each one
 * offers is `completed_task_executors`' answer, read when a Group is chosen.
 */
export async function fetchCompletedTaskOptions(): Promise<CompletedTaskOptions> {
  const [managed, { names, campaigns }] = await Promise.all([
    readAllRows((from, to) =>
      supabase
        .rpc('managed_work_groups')
        .order('path')
        .order('id')
        .range(from, to),
    ),
    readNamesAndCampaigns(),
  ]);
  const active = new Set(
    names.filter((group) => group.status === 'active').map((group) => group.id),
  );
  return {
    // BC manages archived Groups too; a completed Task needs an active one.
    groups: managed.filter((group) => active.has(group.id)),
    groupNames: new Map(names.map((group) => [group.id, group])),
    campaigns,
  };
}

export function useCompletedTaskOptions(enabled = true) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.completedTaskOptions(memberId),
    queryFn: memberId && enabled ? fetchCompletedTaskOptions : skipToken,
  });
}

/**
 * The Groups where the caller may credit one volunteer with completed work
 * (`completed_task_groups`, the commands' own rule): an approval's Grup, and
 * Trackerul membrului's.
 */
export async function fetchCompletedTaskGroups(
  executorId: string,
): Promise<CompletedTaskOptions> {
  const [groups, { names, campaigns }] = await Promise.all([
    readAllRows((from, to) =>
      supabase
        .rpc('completed_task_groups', { p_executor_id: executorId })
        .order('path')
        .order('id')
        .range(from, to),
    ),
    readNamesAndCampaigns(),
  ]);
  return {
    groups,
    groupNames: new Map(names.map((group) => [group.id, group])),
    campaigns,
  };
}

export function useCompletedTaskGroups(executorId: string | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.completedTaskGroups(memberId, executorId),
    queryFn:
      memberId && executorId
        ? () => fetchCompletedTaskGroups(executorId)
        : skipToken,
  });
}

export type CompletedTaskVolunteer = {
  id: string;
  /** The Nickname when set (R5), else the full name. */
  name: string;
  /** What typing in the picker also matches (#1100): Nickname and full name. */
  nickname: string | null;
  fullName: string;
  avatarColor: string | null;
};

/** Whom the caller may credit in one Group (`completed_task_executors`). */
export async function fetchCompletedTaskExecutors(
  groupId: number,
): Promise<CompletedTaskVolunteer[]> {
  const rows = await readAllRows((from, to) =>
    supabase
      .rpc('completed_task_executors', { p_group_id: groupId })
      .order('full_name')
      .order('member_id')
      .range(from, to),
  );
  return rows
    .map((row) => ({
      id: row.member_id,
      name: row.nickname?.trim() || row.full_name || 'Membru OSUBB',
      nickname: row.nickname?.trim() || null,
      fullName: row.full_name ?? '',
      avatarColor: row.avatar_color,
    }))
    .sort(
      (a, b) => a.name.localeCompare(b.name, 'ro') || a.id.localeCompare(b.id),
    );
}

export function useCompletedTaskExecutors(groupId: number | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.completedTaskExecutors(memberId, groupId),
    queryFn:
      memberId && groupId !== null
        ? () => fetchCompletedTaskExecutors(groupId)
        : skipToken,
  });
}

/** A completed Task as the form hands it over, already validated. */
export type CompletedTaskDraft = {
  /** The volunteer; null only above one copy, when they come with the call. */
  executorId: string | null;
  groupId: number;
  title: string;
  description: string | null;
  /** The Attached Links, complete rows only (R46). */
  links: AttachedLink[];
  campaignId: number | null;
  difficulty: number;
  rating: number;
  note: string;
  /** How many finished Tasks to add (spec 2026-10-11, Part E); 1 everywhere but "Adaugă task finalizat". */
  copies: number;
};

const FAILED = 'Nu am putut adăuga taskul finalizat. Încearcă din nou.';
const BATCH_FAILED =
  'Nu am putut adăuga taskurile finalizate. Încearcă din nou.';

/** "Adaugă task finalizat": the one `create_completed_task` caller. */
export async function createCompletedTask(draft: CompletedTaskDraft) {
  const args = {
    p_executor_id: draft.executorId,
    p_group_id: draft.groupId,
    p_title: draft.title,
    p_description: draft.description,
    p_links: draft.links,
    p_campaign_id: draft.campaignId,
    p_difficulty: draft.difficulty,
    p_rating: draft.rating,
    p_note: draft.note,
  };
  // Generated RPC argument types omit nullability (no details, no link, no
  // Campaign are all NULL); isolate that mismatch here.
  const { data, error } = await supabase.rpc(
    'create_completed_task',
    args as unknown as Database['public']['Functions']['create_completed_task']['Args'],
  );
  if (error) throw new CommandError(error, FAILED);
  return data;
}

export function useCreateCompletedTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createCompletedTask,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.tasks.all }),
        client.invalidateQueries({ queryKey: keys.points.all }),
      ]),
  });
}

/** "Adaugă task finalizat" at any count: the draft plus, above one copy, the volunteers in order. */
export type CreateCompletedTasksInput = {
  draft: CompletedTaskDraft;
  /** One per copy, repeats allowed; ignored at one copy (the draft's volunteer). */
  executorIds?: readonly string[];
};

/**
 * The one `create_completed_tasks` caller (spec 2026-10-11, Part E): n
 * finished Tasks in one transaction, the same person allowed several times.
 * One copy goes the same way, with the form's volunteer as the one entry.
 */
export async function createCompletedTasks({
  draft,
  executorIds,
}: CreateCompletedTasksInput) {
  const args = {
    p_executor_ids:
      draft.copies > 1 ? [...(executorIds ?? [])] : [draft.executorId],
    p_group_id: draft.groupId,
    p_title: draft.title,
    p_description: draft.description,
    p_links: draft.links,
    p_campaign_id: draft.campaignId,
    p_difficulty: draft.difficulty,
    p_rating: draft.rating,
    p_note: draft.note,
    p_copies: draft.copies,
  };
  // Generated RPC argument types omit nullability; isolate that here.
  const { data, error } = await supabase.rpc(
    'create_completed_tasks',
    args as unknown as Database['public']['Functions']['create_completed_tasks']['Args'],
  );
  if (error)
    throw new CommandError(error, draft.copies > 1 ? BATCH_FAILED : FAILED);
  return data;
}

export function useCreateCompletedTasks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createCompletedTasks,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.tasks.all }),
        client.invalidateQueries({ queryKey: keys.points.all }),
      ]),
  });
}
