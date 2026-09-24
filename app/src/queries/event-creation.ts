import {
  type QueryClient,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { fetchCapabilities, type Capabilities } from '../lib/capabilities';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type {
  EventDraft,
  EventFormGroup,
  EventFormOptions,
} from '../screens/calendar/event-form-model';
import { keys } from './keys';
import { fetchMyGroups, type MyGroup } from './my-groups';

type GroupRow = Pick<
  Database['public']['Tables']['groups']['Row'],
  'id' | 'name' | 'path' | 'min_level' | 'status' | 'is_organization'
>;

function byPathThenId(a: GroupRow, b: GroupRow): number {
  const length = Math.max(a.path.length, b.path.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.path[index];
    const right = b.path[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left !== right) return left - right;
  }
  return a.id - b.id;
}

function toFormGroup(group: GroupRow): EventFormGroup {
  return {
    id: group.id,
    name: group.name,
    path: group.path,
    minLevel: group.min_level,
    isOrganization: group.is_organization,
  };
}

/**
 * Compute kind UI options from live server reads. This is not authorization:
 * create_event performs the same decision again inside one transaction.
 */
export function buildEventFormOptions(
  capabilities: Capabilities,
  mine: readonly MyGroup[],
  readable: readonly GroupRow[],
): EventFormOptions {
  const active = readable
    .filter((group) => group.status === 'active')
    .toSorted(byPathThenId);
  const managedIds = new Set(
    mine
      .filter(
        (group) =>
          group.status === 'active' &&
          (group.group_role === 'manager' ||
            group.group_role === 'responsible'),
      )
      .map((group) => group.id),
  );

  const groups = active.filter(
    (group) =>
      capabilities.createTopLevelGroups ||
      managedIds.has(group.id) ||
      (group.is_organization && capabilities.managesAnyGroup),
  );

  return {
    groups: groups.map(toFormGroup),
    groupNames: active.map((group) => ({ id: group.id, name: group.name })),
  };
}

export async function fetchEventFormOptions(): Promise<EventFormOptions> {
  const [capabilities, mine, groupsResult] = await Promise.all([
    fetchCapabilities(),
    fetchMyGroups(),
    supabase
      .from('groups')
      .select('id,name,path,min_level,status,is_organization'),
  ]);
  if (groupsResult.error) throw groupsResult.error;
  return buildEventFormOptions(
    capabilities,
    mine,
    (groupsResult.data ?? []) as GroupRow[],
  );
}

export function useEventFormOptions() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.events.formOptions(memberId),
    queryFn: memberId ? fetchEventFormOptions : skipToken,
  });
}

export async function createEvent(draft: EventDraft) {
  const args = {
    p_title: draft.title,
    p_type: draft.type,
    p_group_id: draft.groupId,
    p_starts_at: draft.startsAt,
    p_ends_at: draft.endsAt,
    p_location: draft.location,
    p_capacity: draft.capacity,
    p_description: draft.description,
    p_min_level: draft.minLevel,
  };
  // PostgreSQL accepts NULL for optional values while generated optional RPC
  // properties omit nullability. Keep that generated-type mismatch local.
  const { data, error } = await supabase.rpc(
    'create_event',
    args as unknown as Database['public']['Functions']['create_event']['Args'],
  );
  if (error) throw error;
  return data;
}

export function createEventMutationOptions(client: QueryClient) {
  return {
    mutationFn: createEvent,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.events.all }),
  };
}

export function useCreateEvent() {
  const client = useQueryClient();
  return useMutation(createEventMutationOptions(client));
}
