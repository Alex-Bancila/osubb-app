import { describe, expect, it, vi } from 'vitest';
import type { Group } from './reference';
import {
  buildMemberGroups,
  resolveGroupRoleLabel,
  resolveMemberGroups,
} from './reference';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

const orgGroup: Group = {
  id: 1,
  name: 'OSUBB',
  short: 'OSUBB',
  color: '#ED2025',
  category: 'organization',
  path: [1],
  parent_id: null,
  min_level: 0,
  status: 'active',
  is_organization: true,
  automatic_membership: true,
  legacy_dept_id: 'org',
};

const agGroup: Group = {
  id: 2,
  name: 'Adunarea Generală',
  short: 'AG',
  color: '#284C93',
  category: 'organization',
  path: [2],
  parent_id: null,
  min_level: 3,
  status: 'active',
  is_organization: false,
  automatic_membership: true,
  legacy_dept_id: null,
};

const eduDeptGroup: Group = {
  id: 10,
  name: 'Educațional',
  short: 'EDU',
  color: '#284C93',
  category: 'department',
  path: [10],
  parent_id: null,
  min_level: 0,
  status: 'active',
  is_organization: false,
  automatic_membership: false,
  legacy_dept_id: 'edu',
};

const itTeamGroup: Group = {
  id: 20,
  name: 'Echipa IT',
  short: 'IT',
  color: '#007F33',
  category: 'team',
  path: [10, 20],
  parent_id: 10,
  min_level: 0,
  status: 'active',
  is_organization: false,
  automatic_membership: false,
  legacy_dept_id: null,
};

const archivedGroup: Group = {
  id: 99,
  name: 'Proiect Arhivat',
  short: 'OLD',
  color: '#888888',
  category: 'project',
  path: [99],
  parent_id: null,
  min_level: 0,
  status: 'archived',
  is_organization: false,
  automatic_membership: false,
  legacy_dept_id: null,
};

const testGroupsMap = new Map<number, Group>([
  [orgGroup.id, orgGroup],
  [agGroup.id, agGroup],
  [eduDeptGroup.id, eduDeptGroup],
  [itTeamGroup.id, itTeamGroup],
  [archivedGroup.id, archivedGroup],
]);

describe('resolveMemberGroups', () => {
  it('returns empty array when groups map is undefined', () => {
    expect(resolveMemberGroups(undefined)).toEqual([]);
  });

  it('includes explicit roster groups from explicitGroupIds', () => {
    const result = resolveMemberGroups(testGroupsMap, {
      memberLevel: 0,
      explicitGroupIds: [eduDeptGroup.id, itTeamGroup.id],
    });

    const ids = result.map((g) => g.id);
    expect(ids).toContain(eduDeptGroup.id);
    expect(ids).toContain(itTeamGroup.id);
  });

  it('includes Organization Group automatically for every member (min_level = 0)', () => {
    // Level 0 member with no explicit groups
    const result = resolveMemberGroups(testGroupsMap, {
      memberLevel: 0,
      explicitGroupIds: [],
    });

    expect(result.map((g) => g.id)).toContain(orgGroup.id);
  });

  it('excludes Adunarea Generală for members with level < 3', () => {
    // Level 1 Volunteer
    const result = resolveMemberGroups(testGroupsMap, {
      memberLevel: 1,
      explicitGroupIds: [eduDeptGroup.id],
    });

    const ids = result.map((g) => g.id);
    expect(ids).toContain(orgGroup.id);
    expect(ids).toContain(eduDeptGroup.id);
    expect(ids).not.toContain(agGroup.id);
  });

  it('includes Adunarea Generală automatically for members with level >= 3', () => {
    // Level 3 Voting Member
    const resultLevel3 = resolveMemberGroups(testGroupsMap, {
      memberLevel: 3,
      explicitGroupIds: [eduDeptGroup.id],
    });

    expect(resultLevel3.map((g) => g.id)).toContain(agGroup.id);
    expect(resultLevel3.map((g) => g.id)).toContain(orgGroup.id);

    // Level 6 BC Member
    const resultLevel6 = resolveMemberGroups(testGroupsMap, {
      memberLevel: 6,
      explicitGroupIds: [],
    });

    expect(resultLevel6.map((g) => g.id)).toContain(agGroup.id);
    expect(resultLevel6.map((g) => g.id)).toContain(orgGroup.id);
  });

  it('excludes archived groups even if present in explicitGroupIds', () => {
    const result = resolveMemberGroups(testGroupsMap, {
      memberLevel: 5,
      explicitGroupIds: [archivedGroup.id],
    });

    expect(result.map((g) => g.id)).not.toContain(archivedGroup.id);
  });

  it('sorts Organization Group first, then by category and alphabetical name', () => {
    const result = resolveMemberGroups(testGroupsMap, {
      memberLevel: 3,
      explicitGroupIds: [itTeamGroup.id, eduDeptGroup.id],
    });

    expect(result.map((g) => g.id)).toEqual([
      orgGroup.id,
      agGroup.id,
      eduDeptGroup.id,
      itTeamGroup.id,
    ]);
  });
});

describe('buildMemberGroups and resolveGroupRoleLabel', () => {
  const deptWithManager: Group = {
    ...eduDeptGroup,
    manager_title: 'Director Departament',
  };

  const testMap = new Map<number, Group>([
    [orgGroup.id, orgGroup],
    [agGroup.id, agGroup],
    [deptWithManager.id, deptWithManager],
    [itTeamGroup.id, itTeamGroup],
    [archivedGroup.id, archivedGroup],
  ]);

  it('resolves correct role labels according to ADR-0009 and issue #108', () => {
    expect(resolveGroupRoleLabel('manager', 'Director Departament', null)).toBe(
      'Director Departament',
    );
    expect(resolveGroupRoleLabel('manager', null, null)).toBe('Manager');
    expect(resolveGroupRoleLabel('responsible', null, 'Coordonator IT')).toBe(
      'Coordonator IT',
    );
    expect(resolveGroupRoleLabel('responsible', null, null)).toBe(
      'Responsabil',
    );
    expect(resolveGroupRoleLabel('member', 'Director', 'Coordonator')).toBe(
      'Membru',
    );
  });

  it('builds member groups from explicit group_members rows joined to groups', () => {
    const rows = [
      {
        group_id: deptWithManager.id,
        group_role: 'manager' as const,
        position_title: null,
      },
      {
        group_id: itTeamGroup.id,
        group_role: 'responsible' as const,
        position_title: 'Coordonator Tehnic',
      },
      {
        group_id: orgGroup.id, // organization group — must be omitted
        group_role: 'member' as const,
        position_title: null,
      },
      {
        group_id: archivedGroup.id, // archived group — must be omitted
        group_role: 'member' as const,
        position_title: null,
      },
    ];

    const result = buildMemberGroups(rows, testMap);

    expect(result).toHaveLength(2);
    // Excludes organization and archived
    expect(result.map((g) => g.id)).toEqual([
      itTeamGroup.id,
      deptWithManager.id,
    ]);

    // Role labels
    const deptResult = result.find((g) => g.id === deptWithManager.id);
    expect(deptResult?.role_label).toBe('Director Departament');

    const itResult = result.find((g) => g.id === itTeamGroup.id);
    expect(itResult?.role_label).toBe('Coordonator Tehnic');
  });

  it('returns empty array when input is undefined or empty', () => {
    expect(buildMemberGroups(undefined, testMap)).toEqual([]);
    expect(buildMemberGroups([], testMap)).toEqual([]);
    expect(buildMemberGroups([], undefined)).toEqual([]);
  });
});
