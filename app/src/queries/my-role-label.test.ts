import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberClaims } from '../lib/auth';
import type { GroupMemberRow } from './reference';

const state = vi.hoisted(() => ({
  claims: null as MemberClaims | null,
  profile: undefined as { role: string } | undefined,
  roles: undefined as Map<string, { name: string; level: number }> | undefined,
  membershipRows: undefined as GroupMemberRow[] | undefined,
  settings: undefined as Map<string, string | null> | undefined,
  settingsEnabled: [] as boolean[],
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ claims: state.claims, session: { user: { id: 'me' } } }),
}));
vi.mock('./profile', () => ({
  useMyProfile: () => ({ data: state.profile }),
}));
vi.mock('./reference', async (importOriginal) => ({
  // The real rule for reading a title off the caller's roster rows (D1).
  boardTitleFrom: (await importOriginal<typeof import('./reference')>())
    .boardTitleFrom,
  useRoles: () => ({ data: state.roles }),
  useMyGroups: () => ({ membershipRows: state.membershipRows }),
}));
vi.mock('./org-settings', () => ({
  useOrgSettings: ({ enabled = true }: { enabled?: boolean } = {}) => {
    state.settingsEnabled.push(enabled);
    return { data: enabled ? state.settings : undefined };
  },
}));

import { useMyRoleLabel } from './my-role-label';

const roles = new Map([
  ['voluntar', { name: 'Voluntar', level: 1 }],
  ['bce', { name: 'BCE', level: 5 }],
  ['bc', { name: 'BC', level: 6 }],
  ['moderator', { name: 'Moderator', level: 9 }],
]);
const onBoard: GroupMemberRow[] = [
  { group_id: 20, group_role: 'responsible', position_title: 'Coordonator' },
  { group_id: 99, group_role: 'responsible', position_title: 'Președinte' },
];

function as(role: string, level: number) {
  state.claims = { member_role: role, member_level: level, group_ids: [] };
  state.profile = { role };
}

function label() {
  return renderHook(() => useMyRoleLabel()).result.current;
}

beforeEach(() => {
  state.claims = null;
  state.profile = undefined;
  state.roles = roles;
  state.membershipRows = [];
  state.settings = new Map([['board_group_id', '99']]);
  state.settingsEnabled = [];
});

describe('useMyRoleLabel (#963)', () => {
  it('names a BC member by their Board Title', () => {
    as('bc', 6);
    state.membershipRows = onBoard;
    expect(label()).toBe('Președinte');
    expect(state.settingsEnabled).toContain(true);
  });

  it('keeps the Role name for a board member without a title, or with the setting unset', () => {
    as('bce', 5);
    state.membershipRows = [onBoard[0] as GroupMemberRow];
    expect(label()).toBe('BCE');
    state.membershipRows = onBoard;
    state.settings = new Map([['board_group_id', null]]);
    expect(label()).toBe('BCE');
  });

  it('never asks for the board setting below BCE, nor for the Moderator (F-7)', () => {
    as('voluntar', 1);
    state.membershipRows = onBoard;
    expect(label()).toBe('Voluntar');
    as('moderator', 9);
    expect(label()).toBe('Moderator');
    expect(state.settingsEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it('reads the live Profile before the token, and the enum value while Roles load', () => {
    // A promotion the token has not caught up with yet.
    state.claims = { member_role: 'voluntar', member_level: 1, group_ids: [] };
    state.profile = { role: 'bce' };
    expect(label()).toBe('BCE');
    state.roles = undefined;
    expect(label()).toBe('bce');
  });

  it('says nothing until a Role is known', () => {
    expect(label()).toBe('');
  });
});
