import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import type { Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { AnnouncementRefusedError } from './announcements';
import { keys } from './keys';

/** The one Atribuție that exists today (ruling R44). */
export const OSUBB_DEALS_ASSIGNMENT = 'osubb_deals';

/**
 * A Deal as the feed reads it (ruling R45): an Announcement of kind `deal`,
 * the viewer's own read (`announcement_reads`) and own reveal
 * (`deal_code_reveals`) embedded — RLS lets each Member see only their own
 * rows of both, so an embedded row means "I did".
 */
const DEAL_FIELDS = `
  id,
  title,
  body,
  group_id,
  published_at,
  deadline,
  created_by,
  kind,
  code,
  links,
  announcement_reads (
    read_at
  ),
  deal_code_reveals (
    revealed_at
  )
`;

export type DealLink = { label: string; url: string };

export type RawDealRow = {
  id: number;
  title: string;
  body: string;
  group_id: number;
  published_at: string;
  deadline: string | null;
  created_by: string | null;
  kind: string;
  code: string | null;
  links: Json;
  announcement_reads?: { read_at: string }[] | null;
  deal_code_reveals?: { revealed_at: string }[] | null;
};

/**
 * Every Deal the viewer may read, newest first. The server's read rule does
 * the hiding (R45): a Member gets the Deals still within their Termen; the
 * team, BC and the Moderator get the expired ones too, and the screens decide
 * where those show.
 */
export async function fetchDeals(): Promise<RawDealRow[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select(DEAL_FIELDS)
    .eq('kind', 'deal')
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as RawDealRow[]) ?? [];
}

export function useDeals() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.announcements.deals(memberId),
    queryFn: memberId ? fetchDeals : skipToken,
  });
}

/**
 * Reveal a Deal Code (R45): the server records the reveal once, however
 * many times it is asked, and answers the code. The feed refetches, so every
 * card of this Member shows it revealed; their other devices read the reveal
 * the next time they load the Deals.
 */
export async function revealDealCode(announcementId: number): Promise<string> {
  const { data, error } = await supabase.rpc('reveal_deal_code', {
    p_announcement_id: announcementId,
  });
  if (error) throw error;
  return data ?? '';
}

export function revealDealCodeMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: revealDealCode,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['announcements', 'deals'],
      });
      await queryClient.invalidateQueries({
        queryKey: ['announcements', 'deal-reveals'],
      });
    },
  } as const;
}

export function useRevealDealCode() {
  const queryClient = useQueryClient();
  return useMutation(revealDealCodeMutationOptions(queryClient));
}

export type AnnouncementKind = 'announcement' | 'deal';

/**
 * The unread count of one tab of Anunțuri (R45): the badge's own function,
 * `my_unread_announcements_count(p_kind)`, so each tab counts under exactly
 * the read rule the badge does. Keyed under the badge's key, so whatever
 * refreshes the badge refreshes both.
 */
export async function fetchUnreadCountByKind(
  kind: AnnouncementKind,
): Promise<number> {
  const { data, error } = await supabase.rpc('my_unread_announcements_count', {
    p_kind: kind,
  });
  if (error) throw error;
  return data ?? 0;
}

export function useUnreadCountByKind(kind: AnnouncementKind) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: [...keys.announcements.unread(memberId), kind] as const,
    queryFn: memberId ? () => fetchUnreadCountByKind(kind) : skipToken,
  });
}

/** How many Members opened a Deal's code: the team, BC and the Moderator only. */
export async function fetchDealRevealCount(
  announcementId: number,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('deal_code_reveal_count', {
    p_announcement_id: announcementId,
  });
  if (error) {
    // Not the viewer's to see: hide the line rather than fail the sheet.
    if (error.code === '42501' || error.code === 'PT404') return null;
    throw error;
  }
  return data ?? 0;
}

export function useDealRevealCount(announcementId: number, enabled: boolean) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.announcements.dealReveals(announcementId, memberId),
    queryFn:
      memberId && enabled
        ? () => fetchDealRevealCount(announcementId)
        : skipToken,
  });
}

/** What the Deal form sends: the Deal fields only, nothing a Deal may not choose. */
export type DealInput = {
  title: string;
  body: string;
  deadline: string | null;
  links: DealLink[];
  code: string | null;
};

/**
 * Publish a Deal (R45): a direct insert under `announcements_create`, whose
 * check admits kind `deal` for the OSUBB Deals team only. Every setting a
 * Deal may not choose is fixed here, as the guard trigger demands: the
 * Organization Group, Audience org, Minimum Level 0, Priority normal, never
 * pinned. No RETURNING, as for an Announcement.
 */
export async function createDeal(
  input: DealInput & { organizationGroupId: number },
): Promise<void> {
  const { organizationGroupId, ...deal } = input;
  const { error } = await supabase.from('announcements').insert({
    kind: 'deal',
    group_id: organizationGroupId,
    audience: 'org',
    min_level: 0,
    priority: 'normal',
    pinned: false,
    title: deal.title,
    body: deal.body,
    deadline: deal.deadline,
    links: deal.links,
    code: deal.code,
  });
  if (error) throw error;
}

/** Edit a Deal: only its own fields, under `announcements_update`. */
export async function updateDeal({
  id,
  changes,
}: {
  id: number;
  changes: Partial<DealInput>;
}): Promise<void> {
  const { data, error } = await supabase
    .from('announcements')
    .update(changes)
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new AnnouncementRefusedError();
}

function dealWriteOptions<Input>(
  queryClient: QueryClient,
  mutationFn: (input: Input) => Promise<void>,
) {
  return {
    mutationFn,
    // The Deals, the feed and the badge all live under `announcements`.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.announcements.all });
    },
  } as const;
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation(dealWriteOptions(queryClient, createDeal));
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();
  return useMutation(dealWriteOptions(queryClient, updateDeal));
}

/* ---------------------------------------------------------------- team ---- */

/** The OSUBB Deals team: the Atribuție's holder and the two places they fill. */
export type DealsTeam = {
  holderId: string | null;
  coordinatorId: string | null;
  responsibleId: string | null;
};

export type TeamRole = 'coordinator' | 'responsible';

/**
 * Who holds Responsabil OSUBB Deals and who sits in its team (R44). Both
 * tables are readable by every live Member; nobody writes them directly.
 */
export async function fetchDealsTeam(): Promise<DealsTeam> {
  const [holder, team] = await Promise.all([
    supabase
      .from('bc_assignments')
      .select('member_id')
      .eq('assignment', OSUBB_DEALS_ASSIGNMENT),
    supabase
      .from('assignment_team')
      .select('team_role, member_id')
      .eq('assignment', OSUBB_DEALS_ASSIGNMENT),
  ]);
  if (holder.error) throw holder.error;
  if (team.error) throw team.error;
  const place = (role: TeamRole) =>
    (team.data ?? []).find((row) => row.team_role === role)?.member_id ?? null;
  return {
    holderId: holder.data?.[0]?.member_id ?? null,
    coordinatorId: place('coordinator'),
    responsibleId: place('responsible'),
  };
}

export function useDealsTeam(enabled = true) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.assignments.team(memberId),
    queryFn: memberId && enabled ? fetchDealsTeam : skipToken,
  });
}

/**
 * Fill or clear one place in the team (R44): `memberId` null clears it. The
 * holder sets both places, the Coordonator the Responsabil only; the server
 * decides, and notifies the person set and the one replaced.
 */
export async function setDealsTeamMember({
  role,
  memberId,
}: {
  role: TeamRole;
  memberId: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('set_assignment_team_member', {
    p_assignment: OSUBB_DEALS_ASSIGNMENT,
    p_team_role: role,
    // A null clears the place; the generated Args cannot say so.
    p_member_id: memberId,
  } as never);
  if (error) throw error;
}

export function useSetDealsTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDealsTeamMember,
    onSuccess: async () => {
      // A new place changes who may publish (the capability row) too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.assignments.all }),
        queryClient.invalidateQueries({ queryKey: ['capabilities'] }),
      ]);
    },
  });
}
