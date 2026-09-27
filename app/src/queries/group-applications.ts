import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { MemberIdentity } from '../components/member/member-identity';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { readAllRows } from './groups-admin';

export type GroupApplication =
  Database['public']['Tables']['group_applications']['Row'] & {
    /** The applicant, named through MemberName (#676). */
    member: MemberIdentity;
  };
export async function fetchGroupApplications(
  memberId: string,
  groupId?: number,
): Promise<GroupApplication[]> {
  const rows = await readAllRows((from, to) => {
    let query = supabase
      .from('group_applications')
      .select('*')
      .eq('status', 'pending')
      .order('created_at')
      .order('id');
    query =
      groupId === undefined
        ? query.eq('member_id', memberId)
        : query.eq('group_id', groupId);
    return query.range(from, to);
  });
  const ids = [...new Set(rows.map((row) => row.member_id))];
  const profiles = ids.length
    ? await readAllRows((from, to) =>
        supabase
          .from('profiles_directory')
          .select('id, full_name, nickname, avatar_color')
          .in('id', ids)
          .order('id')
          .range(from, to),
      )
    : [];
  const byId = new Map(profiles.map((row) => [row.id, row]));
  return rows.map((row) => {
    const profile = byId.get(row.member_id);
    return {
      ...row,
      member: {
        memberId: row.member_id,
        fullName: profile?.full_name ?? 'Membru',
        nickname: profile?.nickname ?? null,
        avatarColor: profile?.avatar_color ?? null,
      },
    };
  });
}
/** A pending Application in the Cereri queue, with its Group's name. */
export type ManagedGroupApplication = GroupApplication & {
  group: { id: number; name: string };
};

/**
 * Every pending Group Application the viewer may decide on, across all the
 * Groups they manage (Administrare → Cereri, #825, decision D3). No Group
 * filter: `group_applications_read` already returns exactly the Groups the
 * viewer manages work in, plus their own Applications — which are dropped
 * here, because nobody decides their own.
 */
export async function fetchManagedGroupApplications(
  memberId: string,
): Promise<ManagedGroupApplication[]> {
  const rows = await readAllRows((from, to) =>
    supabase
      .from('group_applications')
      .select('*')
      .eq('status', 'pending')
      .neq('member_id', memberId)
      .order('created_at')
      .order('id')
      .range(from, to),
  );
  // The filter above is the server's; this one keeps the rule if it is lost.
  const theirs = rows.filter((row) => row.member_id !== memberId);
  const memberIds = [...new Set(theirs.map((row) => row.member_id))];
  const groupIds = [...new Set(theirs.map((row) => row.group_id))];
  const [profiles, groups] = await Promise.all([
    memberIds.length
      ? readAllRows((from, to) =>
          supabase
            .from('profiles_directory')
            .select('id, full_name, nickname, avatar_color')
            .in('id', memberIds)
            .order('id')
            .range(from, to),
        )
      : Promise.resolve([]),
    groupIds.length
      ? readAllRows((from, to) =>
          supabase
            .from('groups')
            .select('id, name')
            .in('id', groupIds)
            .order('id')
            .range(from, to),
        )
      : Promise.resolve([]),
  ]);
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const groupById = new Map(groups.map((row) => [row.id, row]));
  return theirs.map((row) => {
    const profile = profileById.get(row.member_id);
    return {
      ...row,
      member: {
        memberId: row.member_id,
        fullName: profile?.full_name ?? 'Membru',
        nickname: profile?.nickname ?? null,
        avatarColor: profile?.avatar_color ?? null,
      },
      group: {
        id: row.group_id,
        name: groupById.get(row.group_id)?.name ?? `Grupul #${row.group_id}`,
      },
    };
  });
}

/**
 * The Cereri queue. Under `['groups', 'applications']`, so a decision
 * (`useApplicationCommand`) refreshes it and each Group page's Cereri tab
 * together.
 */
export function useManagedGroupApplications() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: ['groups', 'applications', 'managed', { memberId }],
    queryFn: memberId
      ? () => fetchManagedGroupApplications(memberId)
      : skipToken,
  });
}

export function useGroupApplications(groupId?: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: ['groups', 'applications', { memberId, groupId }],
    queryFn: memberId
      ? () => fetchGroupApplications(memberId, groupId)
      : skipToken,
  });
}
export type ApplicationCommand =
  | { kind: 'apply'; groupId: number; note: string }
  | { kind: 'withdraw'; applicationId: number }
  | { kind: 'decide'; applicationId: number; accept: boolean; note: string };
export async function runApplicationCommand(command: ApplicationCommand) {
  const result =
    command.kind === 'apply'
      ? await supabase.rpc('apply_to_group', {
          p_group_id: command.groupId,
          ...(command.note.trim() ? { p_note: command.note.trim() } : {}),
        })
      : command.kind === 'withdraw'
        ? await supabase.rpc('withdraw_group_application', {
            p_application_id: command.applicationId,
          })
        : await supabase.rpc('decide_group_application', {
            p_application_id: command.applicationId,
            p_accept: command.accept,
            ...(command.note.trim() ? { p_note: command.note.trim() } : {}),
          });
  if (result.error)
    throw new CommandError(
      result.error,
      'Nu am putut salva cererea. Reîncearcă.',
    );
  return result.data;
}
export function useApplicationCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runApplicationCommand,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.groups.all }),
        client.invalidateQueries({ queryKey: keys.members.all }),
        client.invalidateQueries({ queryKey: keys.profile.all }),
        client.invalidateQueries({ queryKey: keys.reference.all }),
        client.invalidateQueries({ queryKey: ['capabilities'] }),
      ]),
  });
}
export function useGroupUpcomingEvents(groupId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: ['events', 'group', { memberId, groupId }],
    queryFn:
      memberId && Number.isSafeInteger(groupId) && groupId > 0
        ? async () => {
            const { data, error } = await supabase
              .from('events')
              .select('id, title, starts_at, location')
              .eq('group_id', groupId)
              .is('cancelled_at', null)
              .gte('starts_at', new Date().toISOString())
              .order('starts_at')
              .limit(20);
            if (error) throw error;
            return data;
          }
        : skipToken,
  });
}

/** Same safe identity/position fields as Member Card; no ordinary roster rows. */
export async function fetchGroupCoordination(groupId: number) {
  const { data, error } = await supabase.rpc('group_coordination', {
    p_group_id: groupId,
  });
  if (error) throw error;
  return data.map((row) => ({
    memberId: row.member_id,
    fullName: row.full_name,
    nickname: row.nickname,
    groupRole: row.group_role,
    positionTitle: row.position_title,
  }));
}
export function useGroupCoordination(groupId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: ['groups', 'coordination', { memberId, groupId }],
    queryFn:
      memberId && Number.isSafeInteger(groupId) && groupId > 0
        ? () => fetchGroupCoordination(groupId)
        : skipToken,
  });
}
