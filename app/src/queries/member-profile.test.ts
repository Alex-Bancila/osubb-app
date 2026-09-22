import { expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));

import { fetchMemberProfileRows } from './member-profile';

function table(result: unknown, calls: Record<string, unknown[]>) {
  const chain = {
    select: (...args: unknown[]) => {
      calls.select = args;
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.eq = args;
      return Object.assign(Promise.resolve(result), chain);
    },
    maybeSingle: () => Promise.resolve(result),
  };
  return chain;
}

it('reads the profile, contact and roster rows through RLS-backed sources', async () => {
  const calls: Record<string, Record<string, unknown[]>> = {
    profiles_directory: {},
    profiles_contact: {},
    group_members: {},
  };
  api.from.mockImplementation((name: string) =>
    table(
      name === 'profiles_directory'
        ? {
            data: {
              full_name: 'Ana Pop',
              avatar_color: null,
              role: 'vot',
              joined_year: 2024,
            },
            error: null,
          }
        : name === 'profiles_contact'
          ? // Not the viewer's to read: the view simply answers no row.
            { data: null, error: null }
          : {
              data: [
                { group_id: 7, group_role: 'member', position_title: null },
              ],
              error: null,
            },
      (calls[name] ??= {}),
    ),
  );

  await expect(fetchMemberProfileRows('member-1')).resolves.toEqual({
    profile: {
      full_name: 'Ana Pop',
      avatar_color: null,
      role: 'vot',
      joined_year: 2024,
    },
    contact: null,
    memberships: [{ group_id: 7, group_role: 'member', position_title: null }],
  });
  for (const name of Object.keys(calls))
    expect(calls[name]?.eq).toEqual(
      name === 'group_members' ? ['member_id', 'member-1'] : ['id', 'member-1'],
    );
});

it('surfaces a failed read instead of showing an empty profile', async () => {
  api.from.mockImplementation(() =>
    table({ data: null, error: new Error('boom') }, {}),
  );
  await expect(fetchMemberProfileRows('member-1')).rejects.toThrow('boom');
});
