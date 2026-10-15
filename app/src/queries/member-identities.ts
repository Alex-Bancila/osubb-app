import {
  queryOptions,
  skipToken,
  useQueries,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { MemberIdentity } from '../components/member/member-identity';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

const ID_CHUNK = 100;

/**
 * What a name button needs for a set of Members — Nickname, full name, avatar
 * colour — read from `profiles_directory`, which every active Member may read.
 * A Member the directory does not answer for is simply absent from the map.
 */
export async function fetchMemberIdentities(
  memberIds: readonly string[],
): Promise<Map<string, MemberIdentity>> {
  const ids = [...new Set(memberIds)];
  const identities = new Map<string, MemberIdentity>();
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK) {
    const { data, error } = await supabase
      .from('profiles_directory')
      .select('id, full_name, nickname, avatar_color')
      .in('id', ids.slice(offset, offset + ID_CHUNK));
    if (error) throw error;
    for (const row of data ?? []) {
      if (!row.id) continue;
      identities.set(row.id, {
        memberId: row.id,
        nickname: row.nickname?.trim() || null,
        fullName: row.full_name?.trim() || 'Membru OSUBB',
        avatarColor: row.avatar_color,
      });
    }
  }
  return identities;
}

/** The read of one set of Members, shared by every hook that asks for it. */
function namesQuery(
  viewerId: string | undefined,
  memberIds: readonly string[],
) {
  const ids = [...new Set(memberIds)].sort();
  return queryOptions({
    queryKey: keys.members.names(viewerId, ids),
    staleTime: 60_000,
    queryFn:
      viewerId && ids.length ? () => fetchMemberIdentities(ids) : skipToken,
  });
}

/** Read once per set of Members; the order of `memberIds` does not matter. */
export function useMemberIdentities(memberIds: readonly string[]) {
  const viewerId = useAuth().session?.user.id;
  return useQuery(namesQuery(viewerId, memberIds));
}

function everyAnswer(
  results: UseQueryResult<Map<string, MemberIdentity>>[],
): Map<string, MemberIdentity> {
  const identities = new Map<string, MemberIdentity>();
  for (const result of results)
    for (const [memberId, identity] of result.data ?? [])
      identities.set(memberId, identity);
  return identities;
}

/**
 * The Members of a list read by the page (Anunțuri's authors, R56): one read
 * per page's set, so a page that lands asks only for its own Members and the
 * names already drawn stay while it does. The map holds every answer so far.
 */
export function useMemberIdentitiesByPage(
  pages: readonly (readonly string[])[],
): Map<string, MemberIdentity> {
  const viewerId = useAuth().session?.user.id;
  return useQueries({
    queries: pages.map((memberIds) => namesQuery(viewerId, memberIds)),
    combine: everyAnswer,
  });
}
