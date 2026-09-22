import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type RequestOrigin = {
  key: string;
  type: 'department' | 'team' | 'project';
  id: string;
  name: string;
};

export async function fetchRequestOrigins(
  memberId: string,
): Promise<RequestOrigin[]> {
  const [departments, teams, departmentMemberships, teamMemberships, projects] =
    await Promise.all([
      supabase.from('departments').select('id,name'),
      supabase.from('teams').select('id,name'),
      supabase
        .from('member_departments')
        .select('dept_id')
        .eq('member_id', memberId),
      supabase.from('team_members').select('team_id').eq('member_id', memberId),
      supabase
        .from('project_members')
        .select('project_id,projects(id,name,status)')
        .eq('member_id', memberId),
    ]);
  const error =
    departments.error ??
    teams.error ??
    departmentMemberships.error ??
    teamMemberships.error ??
    projects.error;
  if (error) throw error;

  const allowedDepartments = new Set(
    (departmentMemberships.data ?? []).map((row) => row.dept_id),
  );
  const allowedTeams = new Set(
    (teamMemberships.data ?? []).map((row) => row.team_id),
  );
  return [
    ...(departments.data ?? [])
      .filter((row) => allowedDepartments.has(row.id))
      .map((row) => ({
        key: `department:${row.id}`,
        type: 'department' as const,
        id: row.id,
        name: row.name,
      })),
    ...(teams.data ?? [])
      .filter((row) => allowedTeams.has(row.id))
      .map((row) => ({
        key: `team:${row.id}`,
        type: 'team' as const,
        id: row.id,
        name: row.name,
      })),
    ...(projects.data ?? []).flatMap((row) =>
      row.projects?.status === 'active'
        ? [
            {
              key: `project:${row.project_id}`,
              type: 'project' as const,
              id: String(row.project_id),
              name: row.projects.name,
            },
          ]
        : [],
    ),
  ].sort((a, b) => a.name.localeCompare(b.name, 'ro'));
}

export function useRequestOrigins() {
  const { session } = useAuth();
  return useQuery({
    queryKey: keys.requests.origins(session?.user.id),
    queryFn: () =>
      session ? fetchRequestOrigins(session.user.id) : Promise.resolve([]),
    enabled: Boolean(session),
  });
}

export async function fetchMyCompletedWorkRequests(memberId: string) {
  const { data, error } = await supabase
    .from('completed_work_requests')
    .select('id,description,status,created_at,decision_note,task_id')
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
  const { origin } = input;
  const args = {
    p_description: input.description,
    p_dept_id: origin.type === 'department' ? origin.id : null,
    p_team_id: origin.type === 'team' ? origin.id : null,
    p_project_id: origin.type === 'project' ? Number(origin.id) : null,
  };
  // PostgreSQL parameters are nullable even though generated RPC Args omit
  // null; this command requires null for the two Origins that were not chosen.
  const { data, error } = await supabase.rpc(
    'create_completed_work_request',
    args as unknown as Database['public']['Functions']['create_completed_work_request']['Args'],
  );
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
