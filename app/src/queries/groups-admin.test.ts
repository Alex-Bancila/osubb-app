import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../lib/command-reasons';

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));

import {
  fetchAdminGroups,
  fetchGroupRoster,
  groupAuthority,
  runGroupCommand,
} from './groups-admin';
import type { MyGroup } from './my-groups';

beforeEach(() => {
  api.rpc.mockReset();
  api.from.mockReset();
  api.rpc.mockResolvedValue({ data: { id: 1 }, error: null });
});

/** A PostgREST builder that answers whatever `rows` the table name maps to. */
function tables(rows: Record<string, unknown[]>) {
  api.from.mockImplementation((table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: (from: number) =>
        Promise.resolve({
          data: from === 0 ? (rows[table] ?? []) : [],
          error: null,
        }),
    };
    return builder;
  });
}

it('sends every Administrare write through its own command, nulls included', async () => {
  await runGroupCommand({
    kind: 'create',
    name: '  Amfiteatru  ',
    category: 'team',
    parentId: null,
    minLevel: null,
    managerId: null,
    color: '  ',
    short: null,
  });
  expect(api.rpc).toHaveBeenLastCalledWith('create_group', {
    p_name: 'Amfiteatru',
    p_category: 'team',
    p_parent_id: null,
    p_min_level: null,
    p_manager_id: null,
    p_color: null,
    p_short: null,
  });

  await runGroupCommand({
    kind: 'settings',
    groupId: 3,
    name: 'Amfiteatru',
    managerTitle: 'Coordonator Principal',
    acceptsApplications: true,
    applicationLevel: 1,
    sharedWorkVisibility: false,
    minLevel: 3,
    confirmRemovals: true,
  });
  expect(api.rpc).toHaveBeenLastCalledWith('update_group', {
    p_group_id: 3,
    p_name: 'Amfiteatru',
    p_manager_title: 'Coordonator Principal',
    p_accepts_applications: true,
    p_application_level: 1,
    p_shared_work_visibility: false,
    p_min_level: 3,
    p_confirm_removals: true,
  });

  await runGroupCommand({
    kind: 'structure',
    groupId: 3,
    category: 'department',
    competesInCup: true,
    countsTowardParentCup: false,
    automaticMembership: false,
    minLevel: 0,
    color: '#C8102E',
    short: 'EDU',
    isOrganization: false,
    confirmRemovals: false,
  });
  expect(api.rpc).toHaveBeenLastCalledWith('update_group_structure', {
    p_group_id: 3,
    p_category: 'department',
    p_competes_in_cup: true,
    p_counts_toward_parent_cup: false,
    p_automatic_membership: false,
    p_min_level: 0,
    p_color: '#C8102E',
    p_short: 'EDU',
    p_is_organization: false,
    p_confirm_removals: false,
  });

  await runGroupCommand({ kind: 'archive', groupId: 3 });
  expect(api.rpc).toHaveBeenLastCalledWith('archive_group', { p_group_id: 3 });

  await runGroupCommand({ kind: 'addMember', groupId: 3, memberId: 'm-1' });
  expect(api.rpc).toHaveBeenLastCalledWith('add_group_member', {
    p_group_id: 3,
    p_member_id: 'm-1',
  });

  await runGroupCommand({ kind: 'removeMember', groupId: 3, memberId: 'm-1' });
  expect(api.rpc).toHaveBeenLastCalledWith('remove_group_member', {
    p_group_id: 3,
    p_member_id: 'm-1',
  });

  await runGroupCommand({
    kind: 'setRole',
    groupId: 3,
    memberId: 'm-1',
    groupRole: 'responsible',
    positionTitle: ' Responsabil Logistică ',
  });
  expect(api.rpc).toHaveBeenLastCalledWith('set_group_role', {
    p_group_id: 3,
    p_member_id: 'm-1',
    p_group_role: 'responsible',
    p_position_title: 'Responsabil Logistică',
  });
});

it('raises a translated refusal that still carries the server reason', async () => {
  api.rpc.mockResolvedValue({
    data: null,
    error: { code: 'PT409', message: 'group_has_members_below_level' },
  });
  const failure = await runGroupCommand({
    kind: 'settings',
    groupId: 3,
    name: 'Amfiteatru',
    managerTitle: null,
    acceptsApplications: false,
    applicationLevel: null,
    sharedWorkVisibility: false,
    minLevel: 3,
    confirmRemovals: false,
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CommandError);
  expect((failure as CommandError).reason).toBe(
    'group_has_members_below_level',
  );
  expect((failure as CommandError).message).not.toMatch(/_/);
});

it('counts a Group by its roster rows and reads every page', async () => {
  tables({
    groups: [
      { id: 1, name: 'Educațional', path: [1], parent_id: null },
      { id: 2, name: 'Logistică', path: [1, 2], parent_id: 1 },
    ],
    group_members: [{ group_id: 1 }, { group_id: 1 }, { group_id: 2 }],
  });
  const groups = await fetchAdminGroups();
  expect(groups.map((group) => [group.name, group.memberCount])).toEqual([
    ['Educațional', 2],
    ['Logistică', 1],
  ]);
});

it('shows each Member beside their Membership Status and their own Level', async () => {
  // Deactivation never edits a roster (ruling R22), so an inactive Member is
  // still here — and their Level is what a raised Minimum Level compares to.
  tables({
    group_members: [
      { member_id: 'b', group_role: 'manager', position_title: null },
      { member_id: 'a', group_role: 'member', position_title: null },
    ],
    profiles_directory: [
      {
        id: 'a',
        full_name: 'Ana Pop',
        status: 'inactiv',
        avatar_color: '#123456',
        role: 'voluntar',
      },
      {
        id: 'b',
        full_name: 'Bogdan Ion',
        status: 'activ',
        avatar_color: null,
        role: 'bce',
      },
    ],
    roles: [
      { id: 'voluntar', name: 'Voluntar', level: 1 },
      { id: 'bce', name: 'BCE', level: 5 },
    ],
  });
  const roster = await fetchGroupRoster(7);
  expect(roster).toEqual([
    {
      memberId: 'a',
      name: 'Ana Pop',
      avatarColor: '#123456',
      groupRole: 'member',
      positionTitle: null,
      status: 'inactiv',
      roleLabel: 'Voluntar',
      level: 1,
    },
    {
      memberId: 'b',
      name: 'Bogdan Ion',
      avatarColor: null,
      groupRole: 'manager',
      positionTitle: null,
      status: 'activ',
      roleLabel: 'BCE',
      level: 5,
    },
  ]);
});

function myGroup(id: number, role: string): MyGroup {
  return {
    id,
    name: `G${id}`,
    short: '',
    color: '',
    category: 'team',
    path: [id],
    min_level: 0,
    status: 'active',
    is_organization: false,
    group_role: role,
    explicit: true,
    automatic: false,
  };
}

it('offers exactly what each command would accept, per persona', () => {
  const root = { id: 1, parent_id: null };
  const child = { id: 2, parent_id: 1 };

  // BC / Moderator: everything, everywhere.
  const bc = groupAuthority(root, [], true);
  expect(bc).toEqual({
    manageWork: true,
    manageGroup: true,
    editStructure: true,
    appointManager: true,
    archive: true,
    editMinLevel: true,
  });

  // A top-level Group's Manager runs the Group, but structure stays BC's and
  // so does appointing the Group's own Manager and archiving a Department.
  const topManager = groupAuthority(root, [myGroup(1, 'manager')], false);
  expect(topManager).toEqual({
    manageWork: true,
    manageGroup: true,
    editStructure: false,
    appointManager: false,
    archive: false,
    editMinLevel: false,
  });

  // A Child Group's Manager owns the Child Group — including its Minimum
  // Level and archiving it — but its Manager is the parent's to appoint.
  expect(groupAuthority(child, [myGroup(2, 'manager')], false)).toEqual({
    manageWork: true,
    manageGroup: true,
    editStructure: false,
    appointManager: false,
    archive: true,
    editMinLevel: true,
  });

  // The parent's Manager appoints the Child Group's Manager.
  expect(
    groupAuthority(child, [myGroup(1, 'manager'), myGroup(2, 'manager')], false)
      .appointManager,
  ).toBe(true);

  // A Group Responsible is admitted to the Group's work, not its structure.
  expect(groupAuthority(child, [myGroup(2, 'responsible')], false)).toEqual({
    manageWork: true,
    manageGroup: false,
    editStructure: false,
    appointManager: false,
    archive: false,
    editMinLevel: false,
  });

  // An ordinary member of the Group may change nothing about it.
  expect(groupAuthority(child, [myGroup(2, 'member')], false)).toEqual({
    manageWork: false,
    manageGroup: false,
    editStructure: false,
    appointManager: false,
    archive: false,
    editMinLevel: false,
  });
});
