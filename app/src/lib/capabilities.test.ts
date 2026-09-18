import { describe, expect, it } from 'vitest';
import type { MemberClaims } from './auth';
import { can, type Capability } from './capabilities';

const EXPECTED_THRESHOLDS = {
  manageTasks: 4,
  seeAllEvents: 4,
  createTeams: 5,
  seeDirectory: 5,
  seeLeadership: 5,
  seeAllSheets: 6,
  seeInterne: 6,
  manageRoles: 6,
} satisfies Record<Capability, number>;

function claims(memberLevel: number): MemberClaims {
  return {
    member_role: 'test-role',
    member_level: memberLevel,
    dept_ids: [],
    team_ids: [],
    group_ids: [],
  };
}

describe('can', () => {
  it('denies every capability without organization claims', () => {
    for (const capability of Object.keys(EXPECTED_THRESHOLDS) as Capability[]) {
      expect(can(null, capability)).toBe(false);
    }
  });

  it.each(Object.entries(EXPECTED_THRESHOLDS) as [Capability, number][])(
    'grants %s exactly at level %i',
    (capability, requiredLevel) => {
      expect(can(claims(requiredLevel - 1), capability)).toBe(false);
      expect(can(claims(requiredLevel), capability)).toBe(true);
      expect(can(claims(requiredLevel + 1), capability)).toBe(true);
    },
  );
});
