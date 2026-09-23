import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { fetchMyGroups, type MyGroup } from './my-groups';
import { keys } from './keys';

/**
 * The reads and the commands behind Administrare.
 *
 * Everything here is a Group command (#582, #583) or a plain read of a table
 * RLS already filters. Nothing in this file writes `groups` or `group_members`
 * directly: a direct client write to a Group table is a bug, not a shortcut.
 */

type GroupRow = Database['public']['Tables']['groups']['Row'];

/** A Group as the management surface shows it: every setting, plus its size. */
export type AdminGroup = Pick<
  GroupRow,
  | 'id'
  | 'name'
  | 'short'
  | 'color'
  | 'category'
  | 'path'
  | 'parent_id'
  | 'min_level'
  | 'status'
  | 'is_organization'
  | 'manager_title'
  | 'automatic_membership'
  | 'accepts_applications'
  | 'application_level'
  | 'competes_in_cup'
  | 'counts_toward_parent_cup'
  | 'shared_work_visibility'
> & {
  /** Roster rows. An Automatic-Membership Group has none by design. */
  memberCount: number;
};

const GROUP_FIELDS =
  'id, name, short, color, category, path, parent_id, min_level, status, is_organization, manager_title, automatic_membership, accepts_applications, application_level, competes_in_cup, counts_toward_parent_cup, shared_work_visibility';

/* Supabase caps a response at 1,000 rows; rosters pass that before the Group
   tree does, so every projection here is read in stable pages. */
async function readAllRows<T>(
  readPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function fetchAdminGroups(): Promise<AdminGroup[]> {
  const [groups, memberships] = await Promise.all([
    readAllRows((from, to) =>
      supabase.from('groups').select(GROUP_FIELDS).order('id').range(from, to),
    ),
    readAllRows((from, to) =>
      supabase
        .from('group_members')
        .select('group_id')
        .order('group_id')
        .range(from, to),
    ),
  ]);
  const counts = new Map<number, number>();
  for (const row of memberships)
    counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
  return groups.map((group) => ({
    ...(group as Omit<AdminGroup, 'memberCount'>),
    memberCount: counts.get(group.id) ?? 0,
  }));
}

/**
 * Every Group the caller may read, with its settings. RLS is the only filter —
 * the browser asks for no level or roster branch and receives exactly the rows
 * `groups_read` admits, which for BC and Moderator is the whole tree.
 */
export function useAdminGroups() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.groups.tree(memberId),
    queryFn: memberId ? fetchAdminGroups : skipToken,
  });
}

/**
 * The caller's effective Group Roles (`my_groups()`, ruling R14), read live
 * rather than from the `group_ids` claim: a Member appointed after signing in
 * would otherwise wait up to an hour for their own Group to appear.
 */
export function useMyGroupRoles() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.groups.mine(memberId),
    queryFn: memberId ? fetchMyGroups : skipToken,
  });
}

export type GroupRole = 'manager' | 'responsible' | 'member';

/** One roster row, with everything the Roster and Roluri tabs show about it. */
export type RosterEntry = {
  memberId: string;
  name: string;
  avatarColor: string | null;
  groupRole: GroupRole;
  positionTitle: string | null;
  /** Membership Status (ruling R22): deactivation never edits a roster. */
  status: string;
  roleLabel: string;
  /** The member's own Level — what a raised Minimum Level is compared against. */
  level: number;
};

function asGroupRole(value: string): GroupRole {
  return value === 'manager' || value === 'responsible' ? value : 'member';
}

export async function fetchGroupRoster(
  groupId: number,
): Promise<RosterEntry[]> {
  const memberships = await readAllRows((from, to) =>
    supabase
      .from('group_members')
      .select('member_id, group_role, position_title')
      .eq('group_id', groupId)
      .order('member_id')
      .range(from, to),
  );
  if (!memberships.length) return [];
  const [profiles, roles] = await Promise.all([
    readAllRows((from, to) =>
      supabase
        .from('profiles_directory')
        .select('id, full_name, status, avatar_color, role')
        .order('id')
        .range(from, to),
    ),
    readAllRows((from, to) =>
      supabase
        .from('roles')
        .select('id, name, level')
        .order('id')
        .range(from, to),
    ),
  ]);
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const roleById = new Map(roles.map((row) => [row.id, row]));
  return memberships
    .map((row) => {
      const profile = profileById.get(row.member_id);
      const role = profile?.role ? roleById.get(profile.role) : undefined;
      return {
        memberId: row.member_id,
        name: profile?.full_name ?? 'Membru',
        avatarColor: profile?.avatar_color ?? null,
        groupRole: asGroupRole(row.group_role),
        positionTitle: row.position_title,
        status: profile?.status ?? '—',
        roleLabel: role?.name ?? '—',
        level: role?.level ?? 0,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'ro'));
}

export function useGroupRoster(groupId: number | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.groups.roster(groupId ?? 0, memberId),
    queryFn:
      memberId && groupId !== null
        ? () => fetchGroupRoster(groupId)
        : skipToken,
  });
}

/** A member an Appointment may name: what the picker searches through. */
export type AppointableMember = {
  memberId: string;
  name: string;
  avatarColor: string | null;
  status: string;
  roleLabel: string;
  level: number;
};

export async function fetchAppointableMembers(): Promise<AppointableMember[]> {
  const [profiles, roles] = await Promise.all([
    readAllRows((from, to) =>
      supabase
        .from('profiles_directory')
        .select('id, full_name, status, avatar_color, role')
        .order('id')
        .range(from, to),
    ),
    readAllRows((from, to) =>
      supabase
        .from('roles')
        .select('id, name, level')
        .order('id')
        .range(from, to),
    ),
  ]);
  const roleById = new Map(roles.map((row) => [row.id, row]));
  return profiles
    .flatMap((profile) => {
      if (!profile.id) return [];
      const role = profile.role ? roleById.get(profile.role) : undefined;
      return [
        {
          memberId: profile.id,
          name: profile.full_name ?? 'Membru',
          avatarColor: profile.avatar_color,
          status: profile.status ?? '—',
          roleLabel: role?.name ?? '—',
          level: role?.level ?? 0,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'ro'));
}

export function useAppointableMembers(enabled = true) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.groups.appointable(memberId),
    queryFn: memberId && enabled ? fetchAppointableMembers : skipToken,
    staleTime: 5 * 60_000,
  });
}

/**
 * Every write Administrare makes, as the command it calls. One union rather
 * than seven hooks, so a screen cannot invent an eighth way to change a Group.
 */
export type GroupCommand =
  | {
      kind: 'create';
      name: string;
      category: string;
      parentId: number | null;
      minLevel: number | null;
      managerId: string | null;
      color: string | null;
      short: string | null;
    }
  | {
      kind: 'settings';
      groupId: number;
      name: string;
      managerTitle: string | null;
      acceptsApplications: boolean;
      applicationLevel: number | null;
      sharedWorkVisibility: boolean;
      minLevel: number;
      confirmRemovals: boolean;
    }
  | {
      kind: 'structure';
      groupId: number;
      category: string;
      competesInCup: boolean;
      countsTowardParentCup: boolean;
      automaticMembership: boolean;
      minLevel: number;
      color: string | null;
      short: string | null;
      isOrganization: boolean;
      confirmRemovals: boolean;
    }
  | { kind: 'archive'; groupId: number }
  | { kind: 'addMember'; groupId: number; memberId: string }
  | { kind: 'removeMember'; groupId: number; memberId: string }
  | {
      kind: 'setRole';
      groupId: number;
      memberId: string;
      groupRole: GroupRole;
      positionTitle: string | null;
    };

const FALLBACK = 'Nu am putut salva schimbarea. Reîncearcă.';

function trimmed(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

export async function runGroupCommand(command: GroupCommand) {
  const result = await callCommand(command);
  if (result.error) throw new CommandError(result.error, FALLBACK);
  return result.data;
}

/*
 * `as never` on the argument objects, deliberately: the generated Args types
 * mark every parameter non-null, because Supabase's generator has no way to
 * say "this one accepts null". These commands do — a null `p_manager_title`
 * clears the display name, a null `p_application_level` falls back to the
 * Minimum Level, a null `p_parent_id` means a top-level Group — and sending
 * `undefined` instead would drop the key from the JSON body, which for a
 * full-state command is a different request. The cast is the lie the generated
 * type forces; the values below are the truth.
 */
function callCommand(command: GroupCommand) {
  switch (command.kind) {
    case 'create':
      return supabase.rpc('create_group', {
        p_name: command.name.trim(),
        p_category: command.category,
        p_parent_id: command.parentId,
        p_min_level: command.minLevel,
        p_manager_id: command.managerId,
        p_color: trimmed(command.color),
        p_short: trimmed(command.short),
      } as never);
    case 'settings':
      return supabase.rpc('update_group', {
        p_group_id: command.groupId,
        p_name: command.name.trim(),
        p_manager_title: trimmed(command.managerTitle),
        p_accepts_applications: command.acceptsApplications,
        p_application_level: command.applicationLevel,
        p_shared_work_visibility: command.sharedWorkVisibility,
        p_min_level: command.minLevel,
        p_confirm_removals: command.confirmRemovals,
      } as never);
    case 'structure':
      return supabase.rpc('update_group_structure', {
        p_group_id: command.groupId,
        p_category: command.category,
        p_competes_in_cup: command.competesInCup,
        p_counts_toward_parent_cup: command.countsTowardParentCup,
        p_automatic_membership: command.automaticMembership,
        p_min_level: command.minLevel,
        p_color: trimmed(command.color),
        p_short: trimmed(command.short),
        p_is_organization: command.isOrganization,
        p_confirm_removals: command.confirmRemovals,
      } as never);
    case 'archive':
      return supabase.rpc('archive_group', { p_group_id: command.groupId });
    case 'addMember':
      return supabase.rpc('add_group_member', {
        p_group_id: command.groupId,
        p_member_id: command.memberId,
      });
    case 'removeMember':
      return supabase.rpc('remove_group_member', {
        p_group_id: command.groupId,
        p_member_id: command.memberId,
      });
    case 'setRole':
      return supabase.rpc('set_group_role', {
        p_group_id: command.groupId,
        p_member_id: command.memberId,
        p_group_role: command.groupRole,
        p_position_title: trimmed(command.positionTitle),
      } as never);
  }
}

/**
 * Runs one command and refreshes everything a Group change can touch: the
 * tree and rosters, the caller's own Groups and capability row (appointing
 * yourself out of a Group changes what you may do), the Task form's Group
 * options, and the profile's Group list.
 */
export function useGroupCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runGroupCommand,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.groups.all }),
        client.invalidateQueries({ queryKey: keys.reference.all }),
        client.invalidateQueries({ queryKey: keys.profile.all }),
        client.invalidateQueries({ queryKey: keys.members.all }),
        client.invalidateQueries({ queryKey: keys.tasks.all }),
        client.invalidateQueries({ queryKey: ['capabilities'] }),
      ]),
  });
}

/* ---------------------------------------------------------------- authority */

/**
 * What the caller may do in one Group, exactly as the commands decide it
 * (#582, #583). Nothing here is a security control — every command asks again
 * on the server; this is what keeps the screen from offering a button that can
 * only be refused.
 */
export type GroupAuthority = {
  /** `require_group_work_manager`: roster Appointment and removal. */
  manageWork: boolean;
  /** `require_group_manager`: settings, Child Groups, Group Responsibles. */
  manageGroup: boolean;
  /** Structure is BC's and the Moderator's everywhere. */
  editStructure: boolean;
  /** A Group Manager is appointed one level up (root: BC/Moderator). */
  appointManager: boolean;
  /** A top-level Group is archived by BC/Moderator, a Child by its Managers. */
  archive: boolean;
  /** A root's Minimum Level is BC's; a Child's belongs to its Managers. */
  editMinLevel: boolean;
};

export function groupAuthority(
  group: Pick<AdminGroup, 'id' | 'parent_id'>,
  myGroups: readonly MyGroup[] | undefined,
  createTopLevelGroups: boolean,
): GroupAuthority {
  const roleOn = (groupId: number | null) =>
    groupId === null
      ? undefined
      : myGroups?.find((row) => row.id === groupId)?.group_role;
  const role = roleOn(group.id);
  const manageGroup = createTopLevelGroups || role === 'manager';
  const parentManager =
    createTopLevelGroups || roleOn(group.parent_id) === 'manager';
  const root = group.parent_id === null;
  return {
    manageWork:
      createTopLevelGroups || role === 'manager' || role === 'responsible',
    manageGroup,
    editStructure: createTopLevelGroups,
    appointManager: root ? createTopLevelGroups : parentManager,
    archive: root ? createTopLevelGroups : manageGroup,
    editMinLevel: root ? createTopLevelGroups : manageGroup,
  };
}
