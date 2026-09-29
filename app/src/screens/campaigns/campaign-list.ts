import type { Campaign } from '../../queries/campaigns';

/** The query-string key of the Active / Inactive toggle; absent means active. */
export const CAMPAIGN_STATE_KEY = 'stare';
export type CampaignState = 'active' | 'inactive';

/** The part of a Group the panel reads to find a Campaign's owner. */
export type CampaignOwnerGroup = {
  id: number;
  name: string;
  path: readonly number[];
  /** An archived owner's Campaigns only report (Audit D-10). */
  status?: string;
};

const collator = new Intl.Collator('ro-RO', { sensitivity: 'base' });

/**
 * The Campaigns owned by `groupId` or any Group below it (a Group means its
 * whole subtree, R13): the chosen Group's own first, then by owner and name.
 * Without a Group it is every Campaign the caller may read (#908): filters
 * only narrow, so no Group chosen means nothing is left out.
 */
export function subtreeCampaigns<C extends Campaign>(
  campaigns: readonly C[],
  groups: readonly CampaignOwnerGroup[],
  groupId: number | undefined,
): C[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const owner = (campaign: C) => byId.get(campaign.group_id);
  const own = (campaign: C) =>
    groupId !== undefined && campaign.group_id === groupId;
  return campaigns
    .filter(
      (campaign) =>
        groupId === undefined ||
        own(campaign) ||
        (owner(campaign)?.path.includes(groupId) ?? false),
    )
    .sort(
      (a, b) =>
        Number(!own(a)) - Number(!own(b)) ||
        collator.compare(owner(a)?.name ?? '', owner(b)?.name ?? '') ||
        collator.compare(a.name, b.name) ||
        a.id - b.id,
    );
}
