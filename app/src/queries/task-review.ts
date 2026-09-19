import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
export function reviewError(code?: string) {
  return new Error(
    code === 'PT409'
      ? 'Taskul s-a schimbat. Verifică starea actuală înainte de a încerca din nou.'
      : code === '42501'
        ? 'Nu mai ai permisiunea de a evalua acest task.'
        : code === 'PT404'
          ? 'Taskul nu mai este disponibil.'
          : 'Nu am putut salva evaluarea. Încearcă din nou.',
  );
}
export async function evaluateTask(
  input: EvaluationInput & { outcome?: 'completed' | 'unfulfilled' },
) {
  if (
    !input.note.trim() ||
    !Number.isInteger(input.difficulty) ||
    input.difficulty < 1 ||
    input.difficulty > 5 ||
    !Number.isInteger(input.rating) ||
    input.rating < 1 ||
    input.rating > 5
  )
    throw new Error('Alege Dificultatea, Calificativul și scrie o notă.');
  const { data, error } = await supabase.rpc(
    input.outcome === 'unfulfilled'
      ? 'mark_task_unfulfilled'
      : 'complete_task_review',
    {
      p_task_id: input.taskId,
      p_difficulty: input.difficulty,
      p_rating: input.rating,
      p_note: input.note.trim(),
    },
  );
  if (error) throw reviewError(error.code);
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
