import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { readAllRows } from './read-all';
import { keys } from './keys';

/** A Group a Completed-work Request may name as its Origin. */
export type RequestOrigin = { id: number; name: string; path: number[] };

/**
 * The Groups a Member may file a Request for, read live from
 * `request_origins()`, the command's own rule (ruling R64): any active Group
 * they can see whose Minimum Level they meet, member of it or not, except an
 * Automatic-Membership Group other than the Organization Group (#855, B31:
 * nobody works "for" the Adunarea Generală).
 */
export async function fetchRequestOrigins(): Promise<RequestOrigin[]> {
  const { data, error } = await supabase.rpc('request_origins');
  if (error) throw error;
  return (data ?? [])
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
  return readAllRows((from, to) =>
    supabase
      .from('completed_work_requests')
      .select('id,group_id,description,status,created_at,decision_note,task_id')
      .eq('requester_id', memberId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
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
