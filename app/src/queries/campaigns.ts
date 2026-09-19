import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
export type Campaign = {
  id: number;
  name: string;
  group_id: number;
  is_active: boolean;
};
/** Include inactive Campaigns for history/filtering; creation forms filter them out. */
export async function fetchCampaigns(groupId?: number): Promise<Campaign[]> {
  const rows: Campaign[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabase
      .from('campaigns')
      .select('id,name,group_id,is_active')
      .order('id')
      .range(offset, offset + 499);
    if (groupId !== undefined) query = query.eq('group_id', groupId);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}
export function useCampaigns(groupId?: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.campaigns.list(memberId, groupId),
    queryFn: memberId ? () => fetchCampaigns(groupId) : skipToken,
  });
}
export type CampaignChange =
  | { kind: 'create'; groupId: number; name: string }
  | { kind: 'rename'; id: number; name: string }
  | { kind: 'active'; id: number; active: boolean };
export class CampaignError extends Error {}
export async function changeCampaign(change: CampaignChange) {
  const result =
    change.kind === 'create'
      ? await supabase.rpc('create_campaign', {
          p_group_id: change.groupId,
          p_name: change.name.trim(),
        })
      : change.kind === 'rename'
        ? await supabase.rpc('update_campaign', {
            p_campaign_id: change.id,
            p_name: change.name.trim(),
          })
        : await supabase.rpc('set_campaign_active', {
            p_campaign_id: change.id,
            p_active: change.active,
          });
  if (result.error)
    throw new CampaignError(
      result.error.code === '42501'
        ? 'Nu mai ai permisiunea de a modifica această campanie.'
        : result.error.code === 'PT400'
          ? 'Verifică numele campaniei și grupul ales.'
          : 'Nu am putut salva campania. Reîncearcă.',
    );
  return result.data;
}
export function useCampaignChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: changeCampaign,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.campaigns.all }),
        client.invalidateQueries({ queryKey: keys.tasks.all }),
      ]),
  });
}
