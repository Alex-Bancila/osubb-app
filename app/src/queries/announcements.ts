import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import type { RawAnnouncementRow } from '../screens/announcements/announcements-presentation';

const ANNOUNCEMENT_FIELDS = `
  id,
  title,
  body,
  dept_id,
  author,
  priority,
  category,
  pinned,
  form_label,
  form_url,
  published_at,
  created_by,
  announcement_reads (
    read_at
  )
`;

export type MarkAnnouncementReadInput = {
  announcementId: number;
  memberId: string;
};

/**
 * Fetch all announcements visible to the current member through RLS.
 * Pinned announcements appear first, followed by newest published_at.
 * Embedded announcement_reads rows reflect only the current member's reads
 * thanks to the announcement_reads_self RLS policy.
 */
export async function fetchAnnouncementsFeed(): Promise<RawAnnouncementRow[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_FIELDS)
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false });

  if (error) throw error;
  return (data as unknown as RawAnnouncementRow[]) ?? [];
}

export function announcementsFeedQueryOptions(memberId?: string) {
  return {
    queryKey: keys.announcements.feed(memberId),
    queryFn: () => fetchAnnouncementsFeed(),
  } as const;
}

export type {
  RawAnnouncementRow,
  RawAnnouncementRow as AnnouncementFeedRow,
} from '../screens/announcements/announcements-presentation';

export function useAnnouncementsFeed(memberId?: string) {
  const { session } = useAuth();
  const effectiveMemberId = memberId ?? session?.user.id;

  return useQuery({
    ...announcementsFeedQueryOptions(effectiveMemberId),
    enabled: Boolean(effectiveMemberId),
  });
}

/**
 * Mark an announcement as read for the active member.
 * Uses upsert with ignoreDuplicates so repeated or concurrent reads are idempotent.
 */
export async function markAnnouncementRead(
  input: MarkAnnouncementReadInput,
): Promise<void> {
  const { error } = await supabase.from('announcement_reads').upsert(
    {
      announcement_id: input.announcementId,
      member_id: input.memberId,
    },
    {
      onConflict: 'announcement_id,member_id',
      ignoreDuplicates: true,
    },
  );

  if (error) throw error;
}

export function markAnnouncementReadMutationOptions(
  queryClient: QueryClient,
  memberId?: string,
) {
  return {
    mutationFn: (announcementId: number) => {
      if (!memberId) throw new Error('Not authenticated');
      return markAnnouncementRead({
        announcementId,
        memberId,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: keys.announcements.all,
      });
    },
  } as const;
}

export function useMarkAnnouncementRead(memberId?: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const effectiveMemberId = memberId ?? session?.user.id;
  return useMutation(
    markAnnouncementReadMutationOptions(queryClient, effectiveMemberId),
  );
}
