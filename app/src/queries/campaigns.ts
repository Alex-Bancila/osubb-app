import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import { parseOrRefuse } from '../lib/form-errors';
import { campaignSchema } from '../lib/schemas/campaign';
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
/** A refused Campaign change, in the shared copy of `command-reasons.ts`. */
export class CampaignError extends CommandError {}
const FAILED = 'Nu am putut salva campania. Reîncearcă.';
export async function changeCampaign(change: CampaignChange) {
  const result =
    change.kind === 'create'
      ? await supabase.rpc('create_campaign', {
          p_group_id: change.groupId,
          p_name: parseOrRefuse(campaignSchema, change, FAILED).name,
        })
      : change.kind === 'rename'
        ? await supabase.rpc('update_campaign', {
            p_campaign_id: change.id,
            p_name: parseOrRefuse(campaignSchema, change, FAILED).name,
          })
        : await supabase.rpc('set_campaign_active', {
            p_campaign_id: change.id,
            p_active: change.active,
          });
  if (result.error) throw new CampaignError(result.error, FAILED);
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

/**
 * A Campaign's report (#625): what the Campaign's Tasks are worth in total and
 * which volunteers earned those points. A Campaign is a reporting label — this
 * is the report, and it is never a roster: nobody is "in" a Campaign.
 */
export type CampaignReport = {
  totals: { points: number; tasksCompleted: number; tasksTotal: number };
  members: {
    memberId: string;
    name: string;
    nickname: string | null;
    points: number;
    tasksCompleted: number;
  }[];
};

export async function fetchCampaignReport(
  campaignId: number,
): Promise<CampaignReport> {
  const [totals, members] = await Promise.all([
    supabase.rpc('campaign_totals', { p_campaign_id: campaignId }),
    supabase.rpc('campaign_report', { p_campaign_id: campaignId }),
  ]);
  if (totals.error) throw totals.error;
  if (members.error) throw members.error;
  const total = totals.data?.[0];
  return {
    totals: {
      points: total?.points_total ?? 0,
      tasksCompleted: total?.tasks_completed ?? 0,
      tasksTotal: total?.tasks_total ?? 0,
    },
    members: (members.data ?? []).map((row) => ({
      memberId: row.member_id,
      name: row.full_name ?? 'Membru',
      nickname: row.nickname?.trim() || null,
      points: row.points,
      tasksCompleted: row.tasks_completed,
    })),
  };
}

/** Read only while a report is open: a panel of ten Campaigns is not ten reads. */
export function useCampaignReport(campaignId: number | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.campaigns.report(memberId, campaignId ?? 0),
    queryFn:
      campaignId === null ? skipToken : () => fetchCampaignReport(campaignId),
  });
}
