import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
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

/** The organization settings (#681), by key. */
export async function fetchOrgSettings(): Promise<Map<string, string | null>> {
  const { data, error } = await supabase
    .from('org_settings')
    .select('key, value');
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.key, row.value]));
}

export function useOrgSettings() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.orgSettings.list(memberId),
    queryFn: memberId ? fetchOrgSettings : skipToken,
  });
}

/** What the panel asks the server to do: one organization setting. */
export type PeriodCommand = {
  kind: 'orgSetting';
  key: 'adherence_form_url' | 'adunarea_generala_group_id';
  value: string | null;
};

export async function runPeriodCommand(command: PeriodCommand) {
  const result = await supabase.rpc('set_org_setting', {
    p_key: command.key,
    // A blank value clears the setting on the server too.
    p_value: command.value ?? '',
  });
  if (result.error)
    throw new CommandError(
      result.error,
      'Nu am putut salva setarea. Reîncearcă.',
    );
}

/** One mutation for the panel's settings; a setting refreshes the settings. */
export function usePeriodCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runPeriodCommand,
    onSettled: () =>
      client.invalidateQueries({ queryKey: keys.orgSettings.all }),
  });
}
