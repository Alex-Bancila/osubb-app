import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { taskInterestError } from './task-interest';

export async function withdrawTaskInterest(taskId: number): Promise<void> {
  const { error } = await supabase.rpc('withdraw_task_interest', {
    p_task_id: taskId,
  });
  if (error) throw taskInterestError(error.code);
}
export function useWithdrawTaskInterest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: withdrawTaskInterest,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
