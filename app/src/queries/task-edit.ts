import { useMutation, useQueryClient } from '@tanstack/react-query';
import { memberDisplayName } from '../components/member/member-identity';
import { CommandError } from '../lib/command-reasons';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { keys } from './keys';

/** The full new state of every editable Task field (never a patch). */
export type TaskUpdateInput = {
  taskId: number;
  /** The Task's Group; a different one moves it (#627). */
  groupId: number;
  title: string;
  description: string | null;
  deadline: string | null;
  campaignId: number | null;
  /** Null for an Umbrella, which has neither. */
  assignmentMode: 'direct' | 'public' | null;
  audience: 'local' | 'org' | null;
  /** The Attached Link, full state like every other field: both null means
   *  no link, so leaving them null clears it (#684). */
  linkLabel: string | null;
  linkUrl: string | null;
};

export type TaskUpdateConsequence = {
  /** Includes Group move effects and campaign_cleared; unknown server kinds
   *  are still shown so they cannot be accepted unseen. */
  kind: string;
  /** Null for a consequence that affects the Task rather than a member. */
  memberId: string | null;
  /** The Nickname, or the full name when there is none (ruling R5). */
  memberName: string;
};

/** A refused edit, in the shared copy of `command-reasons.ts`. */
export class TaskEditError extends CommandError {}

/** The edit would now affect people the manager has not confirmed. */
export class TaskEditNeedsConfirmation extends Error {}

function commandArgs(input: TaskUpdateInput) {
  // SQL takes full replacement values and NULL clears a field. Generated RPC
  // argument types omit PostgreSQL parameter nullability; keep this boundary local.
  return {
    p_task_id: input.taskId,
    p_group_id: input.groupId,
    p_title: input.title.trim(),
    p_description: input.description?.trim() || null,
    p_deadline: input.deadline,
    p_campaign_id: input.campaignId,
    p_assignment_mode: input.assignmentMode,
    p_audience: input.audience,
    p_link_label: input.linkLabel,
    p_link_url: input.linkUrl,
  } as unknown as Database['public']['Functions']['preview_task_update']['Args'];
}

function editError(error: { message: string }) {
  if (error.message === 'task_update_needs_confirmation')
    return new TaskEditNeedsConfirmation(
      'Modificarea afectează acum alți membri. Verifică și confirmă din nou.',
    );
  return new TaskEditError(
    error,
    'Nu am putut salva modificările. Reîncearcă.',
  );
}

/**
 * What saving these values would do to other people, from the same server
 * definition the command applies. Nothing is written.
 */
export async function previewTaskUpdate(
  input: TaskUpdateInput,
): Promise<TaskUpdateConsequence[]> {
  const { data, error } = await supabase.rpc(
    'preview_task_update',
    commandArgs(input),
  );
  if (error) throw editError(error);
  const rows = data ?? [];
  if (!rows.length) return [];
  const ids = [
    ...new Set(
      rows
        .map((row) => row.member_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const people = ids.length
    ? (
        await supabase
          .from('profiles_directory')
          .select('id, full_name, nickname')
          .in('id', ids)
      ).data
    : [];
  const names = new Map(
    (people ?? []).map((person) => [
      person.id,
      // full_name can be withheld (R5); a Nickname alone still names them.
      memberDisplayName(person.nickname, person.full_name ?? '') || null,
    ]),
  );
  return rows.map((row) => ({
    kind: row.consequence,
    memberId: row.member_id,
    memberName: names.get(row.member_id) ?? 'Un membru',
  }));
}

export async function updateTask(
  input: TaskUpdateInput & { acceptConsequences: boolean },
) {
  const { data, error } = await supabase.rpc('update_task', {
    ...commandArgs(input),
    p_accept_consequences: input.acceptConsequences,
  });
  if (error) throw editError(error);
  return data;
}

export function useTaskEdit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateTask,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
