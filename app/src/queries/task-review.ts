import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { CommandError } from '../lib/command-reasons';
import { parseOrRefuse } from '../lib/form-errors';
import { evaluationSchema } from '../lib/schemas/evaluation';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';

export function useTaskEvaluationCapability(taskId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: ['tasks', 'evaluation-capability', { taskId, memberId }],
    queryFn: memberId
      ? async () => {
          const { data, error } = await supabase.rpc('can_evaluate_task', {
            p_task_id: taskId,
          });
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}
export type EvaluationInput = {
  taskId: number;
  difficulty: number;
  rating: number;
  note: string;
};
/** Per-action copy for the two refusals that name what was being attempted. */
export type ReviewErrorCopy = { forbidden: string; failed: string };
const evaluationCopy: ReviewErrorCopy = {
  forbidden: 'Nu mai ai permisiunea de a evalua acest task.',
  failed: 'Nu am putut salva evaluarea. Încearcă din nou.',
};
/**
 * A refused review command. A reason we know keeps its shared copy (and the
 * form can show it under its field); anything else is told by its code.
 */
export function reviewError(
  error: { code?: string; message?: string },
  copy = evaluationCopy,
) {
  const { code } = error;
  return new CommandError(
    error,
    code === 'PT409'
      ? 'Taskul s-a schimbat. Verifică starea actuală înainte de a încerca din nou.'
      : code === '42501'
        ? copy.forbidden
        : code === 'PT404'
          ? 'Taskul nu mai este disponibil.'
          : copy.failed,
  );
}
export async function evaluateTask(
  input: EvaluationInput & { outcome?: 'completed' | 'unfulfilled' },
) {
  const values = parseOrRefuse(evaluationSchema, input, evaluationCopy.failed);
  const { data, error } = await supabase.rpc(
    input.outcome === 'unfulfilled'
      ? 'mark_task_unfulfilled'
      : 'complete_task_review',
    {
      p_task_id: input.taskId,
      p_difficulty: values.difficulty,
      p_rating: values.rating,
      p_note: values.note,
    },
  );
  if (error) throw reviewError(error);
  return data;
}
export function useEvaluateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: evaluateTask,
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.tasks.all }),
        client.invalidateQueries({ queryKey: keys.points.all }),
      ]);
    },
  });
}
