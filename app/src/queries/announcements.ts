import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { fetchMemberIdentities } from './member-identities';
import type {
  AnnouncementReader,
  RawAnnouncementRow,
} from '../screens/announcements/announcements-presentation';

const ANNOUNCEMENT_FIELDS = `
  id,
  title,
  body,
  group_id,
  audience,
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
 * thanks to the announcement_reads_manage_self RLS policy.
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
 * The Anunțuri badge: unread Announcements the Member may read, counted by the
 * server under the same read policy as the feed (#693).
 */
export async function fetchUnreadAnnouncementsCount(): Promise<number> {
  const { data, error } = await supabase.rpc('my_unread_announcements_count');
  if (error) throw error;
  return data ?? 0;
}

export function unreadAnnouncementsCountQueryOptions(memberId?: string) {
  return {
    queryKey: keys.announcements.unread(memberId),
    queryFn: memberId ? fetchUnreadAnnouncementsCount : skipToken,
  } as const;
}

export function useUnreadAnnouncementsCount() {
  const memberId = useAuth().session?.user.id;
  return useQuery(unreadAnnouncementsCountQueryOptions(memberId));
}

/**
 * Who of the Audience has read an Announcement (#693), names resolved from the
 * directory. `null` when the server answers `PT404 announcement_not_found`:
 * the viewer may not see the readers, which hides the line rather than failing.
 */
export async function fetchAnnouncementReaders(
  announcementId: number,
): Promise<AnnouncementReader[] | null> {
  const { data, error } = await supabase.rpc('announcement_readers', {
    p_announcement_id: announcementId,
  });
  if (error) {
    if (error.code === 'PT404') return null;
    throw error;
  }
  const rows = data ?? [];
  const identities = await fetchMemberIdentities(
    rows.map((row) => row.member_id),
  );
  return rows.map((row) => ({
    member: identities.get(row.member_id) ?? {
      memberId: row.member_id,
      fullName: 'Membru OSUBB',
    },
    readAt: row.read_at ?? null,
  }));
}

/** Asked only when `enabled` — the viewer might be allowed (`mayAskForReaders`). */
export function useAnnouncementReaders(
  announcementId: number | null,
  enabled: boolean,
) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.announcements.readers(announcementId ?? 0, memberId),
    queryFn:
      announcementId !== null && memberId && enabled
        ? () => fetchAnnouncementReaders(announcementId)
        : skipToken,
  });
}

export type CreateAnnouncementInput = Pick<
  import('../lib/database.types').Database['public']['Tables']['announcements']['Insert'],
  | 'title'
  | 'body'
  | 'group_id'
  | 'audience'
  | 'priority'
  | 'pinned'
  | 'form_label'
  | 'form_url'
  | 'created_by'
>;

/** No RETURNING: a global writer can post a local item outside their own read audience. */
export async function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<void> {
  const { error } = await supabase.from('announcements').insert(input);
  if (error) throw error;
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAnnouncement,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.announcements.all });
    },
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
