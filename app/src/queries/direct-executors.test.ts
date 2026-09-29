import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import { fetchDirectExecutors } from './direct-executors';

beforeEach(() => vi.clearAllMocks());
it('paginates every read, reads only directory basics, and reads no Campaign data', async () => {
  const selects: string[] = [];
  const ranges: [string, number, number][] = [];
  api.from.mockImplementation((table: string) => {
    const builder = {
      select: (fields: string) => {
        selects.push(fields);
        return builder;
      },
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: async (from: number, to: number) => {
        ranges.push([table, from, to]);
        const rows =
          table === 'profiles_directory'
            ? Array.from({ length: from === 0 ? 500 : 1 }, (_, i) => ({
                id: `member-${from + i}`,
                full_name: 'Membru',
                role: 'voluntar',
                status: 'activ',
              }))
            : table === 'roles'
              ? [{ id: 'voluntar', level: 1 }]
              : [];
        return { data: rows, error: null };
      },
    };
    return builder;
  });
  const result = await fetchDirectExecutors();
  expect(result.members).toHaveLength(501);
  expect(ranges).toContainEqual(['profiles_directory', 500, 999]);
  expect(new Set(ranges.map(([table]) => table))).toEqual(
    new Set(['profiles_directory', 'roles', 'groups', 'group_members']),
  );
  expect(selects.join(' ')).not.toMatch(
    /email|phone|dept_id|team_id|project_id|category|campaign/,
  );
  expect(selects).toContain('id, full_name, role, status, avatar_color');
  expect(result.members[0]).toHaveProperty('avatarColor');
});

it('fails closed when a paged read fails instead of returning a partial directory', async () => {
  api.from.mockImplementation(() => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: async () => ({ data: null, error: new Error('offline') }),
    };
    return builder;
  });
  await expect(fetchDirectExecutors()).rejects.toThrow('offline');
});

it('never offers BC or the Moderator as a direct Executor (F-27, Alex 2026-09-29)', async () => {
  const profiles = [
    { id: 'vol', full_name: 'Voluntar', role: 'voluntar', status: 'activ' },
    { id: 'bce', full_name: 'Membru BCE', role: 'bce', status: 'activ' },
    { id: 'bc', full_name: 'Membru BC', role: 'bc', status: 'activ' },
    { id: 'mod', full_name: 'Moderator', role: 'moderator', status: 'activ' },
  ];
  const roles = [
    { id: 'voluntar', level: 1 },
    { id: 'bce', level: 5 },
    { id: 'bc', level: 6 },
    { id: 'moderator', level: 7 },
  ];
  api.from.mockImplementation((table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: async () => ({
        data:
          table === 'profiles_directory'
            ? profiles
            : table === 'roles'
              ? roles
              : [],
        error: null,
      }),
    };
    return builder;
  });
  const result = await fetchDirectExecutors();
  expect(result.members.map((member) => member.id).sort()).toEqual([
    'bce',
    'vol',
  ]);
});
