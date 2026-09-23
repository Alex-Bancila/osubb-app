import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { keys } from './keys';

/** The full new state of every editable Task field (never a patch). */
export type TaskUpdateInput = {
  taskId: number;
  groupId: number;
  title: string;
  description: string | null;
  deadline: string | null;
  campaignId: number | null;
  /** Null for an Umbrella, which has neither. */
  assignmentMode: 'direct' | 'public' | null;
  audience: 'local' | 'org' | null;
};

export type TaskUpdateConsequence = {
  /** Includes Group move effects and campaign_cleared; unknown server kinds
   *  are still shown so they cannot be accepted unseen. */
  kind: string;
  /** Null for a consequence that affects the Task rather than a member. */
  memberId: string | null;
  memberName: string;
};

const commandErrors = new Map<string, string>([
  ['title_required', 'Scrie titlul taskului.'],
  ['deadline_required', 'Alege termenul taskului.'],
  ['invalid_audience', 'Alege audiența taskului.'],
  ['invalid_assignment_mode', 'Alege atribuirea directă sau publică.'],
  ['umbrella_has_no_campaign', 'Taskul-umbrelă nu poate avea o campanie.'],
  ['task_is_umbrella', 'Taskul-umbrelă nu are audiență sau mod de atribuire.'],
  [
    'task_in_review',
    'Taskul este în verificare și nu mai poate fi editat. Verifică starea actuală.',
  ],
  ['task_terminal', 'Taskul a fost finalizat. Verifică starea actuală.'],
  ['nothing_to_update', 'Nu există modificări de salvat.'],
  ['invalid_campaign', 'Campania nu mai este disponibilă pentru grupul ales.'],
  ['task_not_found', 'Taskul nu mai este disponibil.'],
  [
    'task_parent_changed',
    'Taskul-umbrelă s-a schimbat între timp. Verifică starea actuală.',
  ],
  ['task_command_forbidden', 'Nu mai ai permisiunea de a edita acest task.'],
  ['task_manage_forbidden', 'Nu mai ai permisiunea de a edita acest task.'],
]);

export class TaskEditError extends Error {}

/** The edit would now affect people the manager has not confirmed. */
export class TaskEditNeedsConfirmation extends TaskEditError {}

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
  } as unknown as Database['public']['Functions']['preview_task_update']['Args'];
}

function editError(error: { message: string }) {
  if (error.message === 'task_update_needs_confirmation')
    return new TaskEditNeedsConfirmation(
      'Modificarea afectează acum alți membri. Verifică și confirmă din nou.',
    );
  return new TaskEditError(
    commandErrors.get(error.message) ??
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
          .select('id, full_name')
          .in('id', ids)
      ).data
    : [];
  const names = new Map(
    (people ?? []).map((person) => [person.id, person.full_name]),
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
