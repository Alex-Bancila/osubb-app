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

/** The organization settings (#681), by key. Every Member reads every row. */
export async function fetchOrgSettings(): Promise<Map<string, string | null>> {
  const { data, error } = await supabase
    .from('org_settings')
    .select('key, value');
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.key, row.value]));
}

export function useOrgSettings({ enabled = true }: { enabled?: boolean } = {}) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.orgSettings.list(memberId),
    queryFn: memberId && enabled ? fetchOrgSettings : skipToken,
  });
}

/** The settings Administrare → Setări edits (#825). */
export type OrgSettingChange = {
  key: 'adherence_form_url' | 'adunarea_generala_group_id' | 'board_group_id';
  value: string | null;
};

export async function runOrgSettingChange(change: OrgSettingChange) {
  const result = await supabase.rpc('set_org_setting', {
    p_key: change.key,
    // A blank value clears the setting on the server too.
    p_value: change.value ?? '',
  });
  if (result.error)
    throw new CommandError(
      result.error,
      'Nu am putut salva setarea. Reîncearcă.',
    );
}

/** `set_org_setting` (level 6 on the server); refreshes the settings. */
export function useOrgSettingChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runOrgSettingChange,
    onSettled: () =>
      client.invalidateQueries({ queryKey: keys.orgSettings.all }),
  });
}
