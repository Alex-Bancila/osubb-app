import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type TaskAssignmentMode = 'direct' | 'public';
export type TaskAudience = 'local' | 'org';

export type TaskModeInput = {
  taskId: number;
  assignmentMode: TaskAssignmentMode;
  audience: TaskAudience;
};

/**
 * Has this Task ever had an Assignment or a Candidature?
 *
 * ADR-0007 §Task identity freezes Origin, Audience and Assignment Mode after
 * the *first* of either, so an ended Assignment and a withdrawn or closed
 * Candidature count exactly as much as a live one — hence no status filter.
 * Both halves are read from the server through RLS rather than inferred from
 * an embed that may simply not have been selected: a missing relation would
 * otherwise read as "nothing ever happened" and offer a conversion the
 * command is certain to refuse.
 */
export type TaskParticipation = { assigned: boolean; hasCandidates: boolean };

const commandErrors = new Map<string, string>([
  [
    'task_already_assigned',
    'Taskul are deja un executor. Modul de atribuire nu se mai poate schimba.',
  ],
  [
    'task_has_candidates',
    'Cineva s-a înscris deja în coada taskului. Modul de atribuire nu se mai poate schimba.',
  ],
  ['task_is_umbrella', 'Taskul-umbrelă nu are mod de atribuire sau audiență.'],
  ['task_terminal', 'Taskul a fost finalizat. Verifică starea actuală.'],
  ['nothing_to_update', 'Modul și audiența sunt deja cele alese.'],
  ['invalid_audience', 'Alege o audiență validă.'],
  ['invalid_assignment_mode', 'Alege un mod de atribuire valid.'],
  ['task_not_found', 'Taskul nu mai este disponibil.'],
  [
    'task_command_forbidden',
    'Nu mai ai permisiunea de a schimba modul acestui task.',
  ],
  [
    'task_manage_forbidden',
    'Nu mai ai permisiunea de a schimba modul acestui task.',
  ],
]);

export class TaskModeError extends Error {}

/** Only the server command changes Assignment Mode; it derives the actor. */
export async function convertTaskMode(input: TaskModeInput) {
  const { data, error } = await supabase.rpc('convert_task_mode', {
    p_task_id: input.taskId,
    p_assignment_mode: input.assignmentMode,
    p_audience: input.audience,
  });
  if (error)
    throw new TaskModeError(
      commandErrors.get(error.message) ??
        'Nu am putut schimba modul taskului. Reîncearcă.',
    );
  return data;
}

export async function fetchTaskParticipation(
  taskId: number,
): Promise<TaskParticipation> {
  const assignments = await supabase
    .from('task_assignments')
    .select('id')
    .eq('task_id', taskId)
    .limit(1);
  if (assignments.error) throw assignments.error;
  const candidates = await supabase
    .from('task_candidates')
    .select('id')
    .eq('task_id', taskId)
    .limit(1);
  if (candidates.error) throw candidates.error;
  return {
    assigned: assignments.data.length > 0,
    hasCandidates: candidates.data.length > 0,
  };
}

export function useTaskParticipation(taskId: number, enabled: boolean) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.participation(taskId, memberId),
    queryFn:
      memberId && enabled ? () => fetchTaskParticipation(taskId) : skipToken,
  });
}

export function useConvertTaskMode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: convertTaskMode,
    // A refusal needs the refresh as much as a success does: the reason it
    // gives is a fact about server state this browser has not seen yet.
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
