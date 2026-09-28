import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { fetchMyGroups, isMemberOf, type MyGroup } from './my-groups';

/** A Group a Completed-work Request may name as its Origin. */
export type RequestOrigin = Pick<MyGroup, 'id' | 'name' | 'path'>;

/**
 * Whether a Member may name this Group as the one they worked for: an active
 * Group they are a member of (ruling R31: their own roster row or Automatic
 * Membership — a Group reached only through a managed ancestor is not one they
 * worked for as a member), except a Group they belong to automatically, such as
 * the Adunarea Generală: nobody works "for" the assembly (#855, B31). The
 * Organization Group stays, for work done for OSUBB as a whole.
 */
export function isRequestOrigin(group: MyGroup): boolean {
  return (
    isMemberOf(group) &&
    group.status === 'active' &&
    (!group.automatic || group.is_organization)
  );
}

/** The Groups a Member may file a Request for (`isRequestOrigin`), read live. */
export async function fetchRequestOrigins(): Promise<RequestOrigin[]> {
  return (await fetchMyGroups())
    .filter(isRequestOrigin)
    .map(({ id, name, path }) => ({ id, name, path }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ro') || a.id - b.id);
}

export function useRequestOrigins() {
  const { session } = useAuth();
  return useQuery({
    queryKey: keys.requests.origins(session?.user.id),
    queryFn: fetchRequestOrigins,
    enabled: Boolean(session),
  });
}

export async function fetchMyCompletedWorkRequests(memberId: string) {
  const { data, error } = await supabase
    .from('completed_work_requests')
    .select('id,group_id,description,status,created_at,decision_note,task_id')
    .eq('requester_id', memberId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export function useMyCompletedWorkRequests() {
  const { session } = useAuth();
  return useQuery({
    queryKey: keys.requests.mine(session?.user.id),
    queryFn: () =>
      session
        ? fetchMyCompletedWorkRequests(session.user.id)
        : Promise.resolve([]),
    enabled: Boolean(session),
  });
}

export type SubmitCompletedWorkInput = {
  description: string;
  origin: RequestOrigin;
};

export async function submitCompletedWork(input: SubmitCompletedWorkInput) {
  // The Group is the only Origin a Request carries (#579).
  const { data, error } = await supabase.rpc('create_completed_work_request', {
    p_description: input.description,
    p_group_id: input.origin.id,
  });
  if (error) throw error;
  return data;
}

export function completedWorkMutationOptions(
  queryClient: QueryClient,
  memberId?: string,
) {
  return {
    mutationFn: submitCompletedWork,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: keys.requests.mine(memberId),
      });
    },
  } as const;
}

export function useSubmitCompletedWork() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation(
    completedWorkMutationOptions(queryClient, session?.user.id),
  );
}
