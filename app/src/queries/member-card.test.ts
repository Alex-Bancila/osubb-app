import { expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));

import { fetchMemberCardRows, toMemberCardData } from './member-card';

const row = {
  member_id: 'member-1',
  nickname: 'Ani',
  full_name: 'Ana Pop',
  role: 'activ',
  joined_at: '2024-03-12',
  avatar_color: null,
  primary_group_id: 1,
  primary_group_name: 'Educațional',
  primary_group_color: '#284C93',
  other_memberships: 1,
  memberships: [],
};

function contactTable(result: unknown, calls: unknown[][]) {
  const chain = {
    select: (...args: unknown[]) => {
      calls.push(['select', ...args]);
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push(['eq', ...args]);
      return chain;
    },
    maybeSingle: () => Promise.resolve(result),
  };
  return chain;
}

it('reads member_card() and the contact row, and nothing else', async () => {
  const calls: unknown[][] = [];
  api.rpc.mockReturnValue({
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  });
  api.from.mockImplementation((name: string) => {
    calls.push(['from', name]);
    // Not the viewer's to read: the view simply answers no row.
    return contactTable({ data: null, error: null }, calls);
  });

  await expect(fetchMemberCardRows('member-1')).resolves.toEqual({
    card: row,
    contact: null,
  });
  expect(api.rpc).toHaveBeenCalledWith('member_card', {
    p_member_id: 'member-1',
  });
  expect(calls).toEqual([
    ['from', 'profiles_contact'],
    ['select', 'email, phone'],
    ['eq', 'id', 'member-1'],
  ]);
});

it('fails loudly when either read fails', async () => {
  const failure = { message: 'denied', code: '42501' };
  api.rpc.mockReturnValue({
    maybeSingle: () => Promise.resolve({ data: null, error: failure }),
  });
  api.from.mockImplementation(() =>
    contactTable({ data: null, error: null }, []),
  );
  await expect(fetchMemberCardRows('member-1')).rejects.toBe(failure);
});

it('turns the row into the card: role name, Group labels and roles, contact gate', () => {
  const data = toMemberCardData(
    {
      card: {
        ...row,
        nickname: '  ',
        memberships: [
          {
            group_id: 1,
            name: 'Educațional',
            parent_id: null,
            color: '#284C93',
            group_role: 'member',
            position_title: null,
            joined_at: '2024-03-12T10:00:00Z',
          },
          {
            group_id: 7,
            name: 'Mentorat',
            parent_id: 1,
            color: null,
            group_role: 'manager',
            position_title: null,
            joined_at: '2024-05-01T10:00:00Z',
          },
          {
            group_id: 9,
            name: 'Foto',
            parent_id: 4,
            color: null,
            group_role: 'responsible',
            position_title: 'Fotograf-șef',
            joined_at: '2024-06-01T10:00:00Z',
          },
        ],
      },
      contact: { email: null, phone: null },
    },
    new Map([['activ', { name: 'Voluntar Activ' }]]),
    new Map([
      [4, { name: 'Imagine & PR', manager_title: null }],
      [7, { name: 'Mentorat', manager_title: 'Mentor-coordonator' }],
      // A Private Group the viewer can read (#757): the card marks it.
      [9, { name: 'Foto', manager_title: null, is_private: true }],
    ]),
  );
  expect(data).toMatchObject({
    nickname: null,
    fullName: 'Ana Pop',
    roleLabel: 'Voluntar Activ',
    primaryGroup: {
      id: 1,
      name: 'Educațional',
      color: '#284C93',
      isPrivate: false,
    },
    otherMemberships: 1,
    // An empty contact row is no contact.
    contact: null,
  });
  expect(data?.groups).toEqual([
    {
      id: 1,
      name: 'Educațional',
      label: 'Educațional',
      color: '#284C93',
      roleLabel: 'Membru',
      isPrivate: false,
    },
    {
      id: 7,
      name: 'Mentorat',
      label: 'Mentorat · Educațional',
      color: null,
      roleLabel: 'Mentor-coordonator',
      isPrivate: false,
    },
    {
      id: 9,
      name: 'Foto',
      label: 'Foto · Imagine & PR',
      color: null,
      roleLabel: 'Fotograf-șef',
      isPrivate: true,
    },
  ]);
  expect(toMemberCardData({ card: null, contact: null })).toBeNull();
});
