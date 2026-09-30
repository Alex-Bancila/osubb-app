import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../lib/command-reasons';

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));

import {
  explicitRoster,
  fetchAdminGroups,
  fetchAppointableMembers,
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

/**
 * A PostgREST builder that answers whatever `rows` the table name maps to —
 * and the `group_roster` read (#929) from `rows.group_roster`, recording the
 * arguments it was called with.
 */
function tables(rows: Record<string, unknown[]>) {
  const builderFor = (name: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: (from: number) =>
        Promise.resolve({
          data: from === 0 ? (rows[name] ?? []) : [],
          error: null,
        }),
    };
    return builder;
  };
  api.from.mockImplementation((table: string) => builderFor(table));
  api.rpc.mockImplementation((name: string) => builderFor(name));
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
    isPrivate: true,
  });
  expect(api.rpc).toHaveBeenLastCalledWith('create_group', {
    p_name: 'Amfiteatru',
    p_category: 'team',
    p_parent_id: null,
    p_min_level: null,
    p_manager_id: null,
    p_color: null,
    p_short: null,
    p_is_private: true,
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
    applicationFormLabel: 'Formular de înscriere',
    applicationFormUrl: 'https://forms.example.org/amfiteatru',
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
    p_application_form_label: 'Formular de înscriere',
    p_application_form_url: 'https://forms.example.org/amfiteatru',
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
    isPrivate: false,
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
    p_is_private: false,
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
    applicationFormLabel: null,
    applicationFormUrl: null,
    confirmRemovals: false,
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CommandError);
  expect((failure as CommandError).reason).toBe(
    'group_has_members_below_level',
  );
  expect((failure as CommandError).message).not.toMatch(/_/);
});

it('counts a Group by every member it has, automatic and de drept included (#929)', async () => {
  tables({
    groups: [
      { id: 1, name: 'Educațional', path: [1], parent_id: null },
      { id: 2, name: 'Logistică', path: [1, 2], parent_id: 1 },
      { id: 3, name: 'Adunarea Generală', path: [3], parent_id: null },
    ],
    group_roster: [
      { group_id: 1 },
      { group_id: 1 },
      { group_id: 2 },
      // The Adunarea Generală: two automatic members and one membru de drept.
      { group_id: 3 },
      { group_id: 3 },
      { group_id: 3 },
    ],
  });
  const groups = await fetchAdminGroups();
  expect(api.rpc).toHaveBeenCalledWith('group_roster', {});
  expect(groups.map((group) => [group.name, group.memberCount])).toEqual([
    ['Educațional', 2],
    ['Logistică', 1],
    ['Adunarea Generală', 3],
  ]);
});

it('shows each Member beside their Membership Status and their own Level', async () => {
  // Deactivation never edits a roster (ruling R22), so an inactive Member is
  // still here — and their Level is what a raised Minimum Level compares to.
  tables({
    group_roster: [
      {
        member_id: 'b',
        group_role: 'manager',
        position_title: null,
        source: 'roster',
      },
      {
        member_id: 'a',
        group_role: 'member',
        position_title: null,
        source: 'roster',
      },
      // #929: an automatic member and a membru de drept carry no Group Role.
      {
        member_id: 'c',
        group_role: null,
        position_title: null,
        source: 'automatic',
      },
      {
        member_id: 'd',
        group_role: null,
        position_title: null,
        source: 'board',
      },
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
      {
        id: 'c',
        full_name: 'Cezar Vot',
        status: 'activ',
        avatar_color: null,
        role: 'vot',
      },
      {
        id: 'd',
        full_name: 'Dana Birou',
        status: 'activ',
        avatar_color: null,
        role: 'bc',
        // #963: a Board Title names the Role; the Level stays the rank's.
        board_title: 'Președinte',
      },
    ],
    roles: [
      { id: 'voluntar', name: 'Voluntar', level: 1 },
      { id: 'vot', name: 'Voluntar cu Drept de Vot', level: 3 },
      { id: 'bce', name: 'BCE', level: 5 },
      { id: 'bc', name: 'BC', level: 6 },
    ],
  });
  const roster = await fetchGroupRoster(7);
  expect(api.rpc).toHaveBeenCalledWith('group_roster', { p_group_id: 7 });
  expect(roster).toEqual([
    {
      memberId: 'a',
      name: 'Ana Pop',
      avatarColor: '#123456',
      groupRole: 'member',
      positionTitle: null,
      source: 'roster',
      status: 'inactiv',
      roleId: 'voluntar',
      roleLabel: 'Voluntar',
      level: 1,
    },
    {
      memberId: 'b',
      name: 'Bogdan Ion',
      avatarColor: null,
      groupRole: 'manager',
      positionTitle: null,
      source: 'roster',
      status: 'activ',
      roleId: 'bce',
      roleLabel: 'BCE',
      level: 5,
    },
    {
      memberId: 'c',
      name: 'Cezar Vot',
      avatarColor: null,
      groupRole: 'member',
      positionTitle: null,
      source: 'automatic',
      status: 'activ',
      roleId: 'vot',
      roleLabel: 'Voluntar cu Drept de Vot',
      level: 3,
    },
    {
      memberId: 'd',
      name: 'Dana Birou',
      avatarColor: null,
      groupRole: 'member',
      positionTitle: null,
      source: 'board',
      status: 'activ',
      roleId: 'bc',
      roleLabel: 'Președinte',
      level: 6,
    },
  ]);
  // Roluri and Setări act on the explicit rows alone.
  expect(explicitRoster(roster).map((entry) => entry.memberId)).toEqual([
    'a',
    'b',
  ]);
});

it('names an appointable BC or BCE member by their Board Title, the Level staying the rank (#963)', async () => {
  const selects: string[] = [];
  const builder = (rows: unknown[]) => {
    const chain = {
      select: (columns: string) => {
        selects.push(columns);
        return chain;
      },
      order: () => chain,
      range: (from: number) =>
        Promise.resolve({ data: from === 0 ? rows : [], error: null }),
    };
    return chain;
  };
  api.from.mockImplementation((table: string) =>
    builder(
      table === 'roles'
        ? [
            { id: 'bce', name: 'BCE', level: 5 },
            { id: 'bc', name: 'BC', level: 6 },
          ]
        : [
            {
              id: 'c',
              full_name: 'Cristina Șerban',
              nickname: null,
              status: 'activ',
              avatar_color: null,
              role: 'bc',
              board_title: 'Președinte',
            },
            {
              id: 'b',
              full_name: 'Bogdan Ion',
              nickname: null,
              status: 'activ',
              avatar_color: null,
              role: 'bce',
              board_title: null,
            },
          ],
    ),
  );
  const members = await fetchAppointableMembers();
  expect(selects).toContainEqual(expect.stringContaining('board_title'));
  expect(
    members.map(({ memberId, roleId, roleLabel, level }) => ({
      memberId,
      roleId,
      roleLabel,
      level,
    })),
  ).toEqual([
    { memberId: 'b', roleId: 'bce', roleLabel: 'BCE', level: 5 },
    { memberId: 'c', roleId: 'bc', roleLabel: 'Președinte', level: 6 },
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
