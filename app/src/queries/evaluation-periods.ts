import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/** A Role Evaluation (#826, ruling R28), as the panel lists it. */
export type RoleEvaluation = {
  id: number;
  kind: string;
  name: string;
  period_from: string;
  period_to: string;
  run_at: string;
  threshold_used: number;
  threshold_computed: number | null;
};

/** Every Role Evaluation, newest run first. Every live active Member reads every row. */
export async function fetchRoleEvaluations(): Promise<RoleEvaluation[]> {
  const { data, error } = await supabase
    .from('role_evaluations')
    .select(
      'id, kind, name, period_from, period_to, run_at, threshold_used, threshold_computed',
    )
    .order('run_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function useRoleEvaluations() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.roleEvaluations(memberId),
    queryFn: memberId ? fetchRoleEvaluations : skipToken,
  });
}
