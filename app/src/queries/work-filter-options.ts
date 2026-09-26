import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { WorkFilterCampaign, WorkFilterGroup } from '../lib/work-filter';
import { keys } from './keys';

export type WorkFilterOptions = {
  groups: WorkFilterGroup[];
  campaigns: WorkFilterCampaign[];
};

async function pages<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await read(offset, offset + 499);
    if (page.error) throw page.error;
    if (!page.data) throw new Error('Missing Work Filter options');
    rows.push(...page.data);
    if (page.data.length < 500) return rows;
  }
}

/**
 * The Work Filter's choices (#678): every Group and Campaign the caller may
 * read, through their own RLS, paged. No category is excluded — the filter
 * offers Groups by the tree, not by kind.
 */
export async function fetchWorkFilterOptions(): Promise<WorkFilterOptions> {
  const [groups, campaigns] = await Promise.all([
    pages<WorkFilterGroup>((from, to) =>
      supabase
        .from('groups')
        .select('id,name,path,status,is_organization')
        .order('id')
        .range(from, to),
    ),
    pages<WorkFilterCampaign>((from, to) =>
      supabase
        .from('campaigns')
        .select('id,name,group_id')
        .order('id')
        .range(from, to),
    ),
  ]);
  return { groups, campaigns };
}

export function useWorkFilterOptions() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.groups.filterOptions(memberId),
    queryFn: memberId ? fetchWorkFilterOptions : skipToken,
  });
}
