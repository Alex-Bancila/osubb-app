import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  fetchCapabilities: vi.fn(),
  fetchMyGroups: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { from: api.from, rpc: api.rpc },
}));
vi.mock('../lib/capabilities', () => ({
  fetchCapabilities: api.fetchCapabilities,
}));
vi.mock('./my-groups', () => ({ fetchMyGroups: api.fetchMyGroups }));

import {
  buildEventFormOptions,
  createEvent,
  createEventMutationOptions,
  fetchEventFormOptions,
} from './event-creation';
import type { MyGroup } from './my-groups';

const readableGroups = [
  {
    id: 1,
    name: 'OSUBB',
    path: [1],
    min_level: 0,
    status: 'active',
    is_organization: true,
  },
  {
    id: 7,
    name: 'Educațional',
    path: [7],
    min_level: 0,
    status: 'active',
    is_organization: false,
  },
  {
    id: 12,
    name: 'Social Media',
    path: [7, 12],
    min_level: 0,
    status: 'active',
    is_organization: false,
  },
  {
    id: 21,
    name: 'Proiect arhivat',
    path: [21],
    min_level: 0,
    status: 'archived',
    is_organization: false,
  },
];

const managerCapabilities = {
  managesAnyGroup: true,
  manageTasks: true,
  seeDirectory: false,
  seeLeadership: false,
  manageRoles: false,
  provisionMembers: false,
  createTopLevelGroups: false,
  administer: true,
};

function myGroup(
  index: number,
  groupRole: 'manager' | 'responsible' | 'member',
): MyGroup {
  const group = readableGroups[index];
  if (!group) throw new Error('Missing Group fixture');
  return {
    ...group,
    short: '',
    category: index === 2 ? 'team' : 'department',
    color: index === 1 ? '#284C93' : '',
    group_role: groupRole,
    explicit: true,
    automatic: false,
  };
}

describe('Event form options', () => {
  it('offers a Group leader their effective managed Groups and the Organization', () => {
    const result = buildEventFormOptions(
      managerCapabilities,
      [myGroup(1, 'manager'), { ...myGroup(2, 'manager'), explicit: false }],
      readableGroups,
    );

    expect(result.groups.map((group) => group.id)).toEqual([1, 7, 12]);
    expect(result.groups.some((group) => group.id === 21)).toBe(false);
  });

  it('offers BC every readable active Group', () => {
    const result = buildEventFormOptions(
      { ...managerCapabilities, createTopLevelGroups: true },
      [],
      readableGroups,
    );
    expect(result.groups.map((group) => group.id)).toEqual([1, 7, 12]);
  });

  it('does not turn ordinary membership into Event management', () => {
    const result = buildEventFormOptions(
      { ...managerCapabilities, managesAnyGroup: false, manageTasks: false },
      [myGroup(1, 'member')],
      readableGroups,
    );
    expect(result.groups).toEqual([]);
  });

  it('loads capabilities, effective roles, and readable Groups once', async () => {
    api.fetchCapabilities.mockResolvedValue(managerCapabilities);
    api.fetchMyGroups.mockResolvedValue([]);
    const select = vi.fn().mockResolvedValue({
      data: readableGroups,
      error: null,
    });
    api.from.mockReturnValue({ select });

    await expect(fetchEventFormOptions()).resolves.toEqual({
      groups: [
        {
          id: 1,
          name: 'OSUBB',
          path: [1],
          minLevel: 0,
          isOrganization: true,
        },
      ],
      groupNames: readableGroups.slice(0, 3).map((group) => ({
        id: group.id,
        name: group.name,
      })),
    });
    expect(api.from).toHaveBeenCalledWith('groups');
    expect(select).toHaveBeenCalledWith(
      'id,name,path,min_level,status,is_organization',
    );
  });
});

describe('create Event command', () => {
  beforeEach(() => {
    api.rpc.mockReset();
  });

  const draft = {
    title: 'Ședință',
    type: 'sedinta' as const,
    groupId: 7,
    startsAt: '2026-10-01T15:00:00.000Z',
    endsAt: null,
    location: null,
    capacity: null,
    description: null,
    minLevel: 0,
  };

  it('calls only create_event with named arguments', async () => {
    api.rpc.mockResolvedValue({ data: { id: 44 }, error: null });
    await expect(createEvent(draft)).resolves.toEqual({ id: 44 });
    expect(api.rpc).toHaveBeenCalledWith('create_event', {
      p_title: 'Ședință',
      p_type: 'sedinta',
      p_group_id: 7,
      p_starts_at: '2026-10-01T15:00:00.000Z',
      p_ends_at: null,
      p_location: null,
      p_capacity: null,
      p_description: null,
      p_min_level: 0,
    });
  });

  it('invalidates the Event family only after success', async () => {
    const client = { invalidateQueries: vi.fn() };
    const options = createEventMutationOptions(client as never);
    await options.onSuccess();
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['events'],
    });
  });
});
