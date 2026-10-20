import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import type { Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * Member Deletion (#1087, ruling R59): BC and the Moderator delete for good a
 * Member with no history, sign-in included, and nothing survives. The server
 * decides again under its lock; the preview only says what it would meet.
 */

/** `member_delete_preview`: what holds the account and what goes with it. */
export type MemberDeletePreview = {
  /** One key per referencing column (`tasks.created_by`), its row count. */
  holds: Readonly<Record<string, number>>;
  /** The account's own rows, by table (`notifications`), counted. */
  goes: Readonly<Record<string, number>>;
  /** The rank the Member is the last active holder of, if any. */
  lastHolder: 'bc' | 'moderator' | null;
};

function counts(value: Json | undefined): Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      return typeof n === 'number' && Number.isFinite(n) && n > 0
        ? [[key, n]]
        : [];
    }),
  );
}

export function readMemberDeletePreview(value: Json): MemberDeletePreview {
  const row =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  const last = row.last_holder;
  return {
    holds: counts(row.holds),
    goes: counts(row.goes),
    lastHolder: last === 'bc' || last === 'moderator' ? last : null,
  };
}

/** True when nothing holds the account and its rank has another holder. */
export function memberDeletable(preview: MemberDeletePreview): boolean {
  return Object.keys(preview.holds).length === 0 && preview.lastHolder === null;
}

const PREVIEW_FAILED = 'Nu am putut verifica acest cont.';
const DELETE_FAILED = 'Nu am putut șterge contul. Încearcă din nou.';

export async function fetchMemberDeletePreview(
  memberId: string,
): Promise<MemberDeletePreview> {
  const { data, error } = await supabase.rpc('member_delete_preview', {
    p_member_id: memberId,
  });
  if (error) throw new CommandError(error, PREVIEW_FAILED);
  return readMemberDeletePreview(data);
}

/** Read fresh on every mount: history may have arrived since. */
export function useMemberDeletePreview(memberId: string) {
  const viewerId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.members.deletePreview(memberId, viewerId),
    queryFn: viewerId ? () => fetchMemberDeletePreview(memberId) : skipToken,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export async function deleteMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_member', {
    p_member_id: memberId,
  });
  if (error) throw new CommandError(error, DELETE_FAILED);
}

export function useDeleteMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteMember,
    // The account leaves every list that named it: Membri, the rosters and
    // the pickers (Group families), and the Notifications that named it.
    // Nothing is awaited and the Member's own queries are only marked stale,
    // so the page being left never re-reads an account that is gone.
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: keys.members.all,
        refetchType: 'none',
      });
      void client.invalidateQueries({ queryKey: keys.groups.all });
      void client.invalidateQueries({ queryKey: keys.notifications.all });
    },
  });
}
