import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  fetchCapabilities: vi.fn(),
  fetchMyGroups: vi.fn(),
  fetchCampaigns: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { from: api.from, rpc: api.rpc },
}));
vi.mock('../lib/capabilities', () => ({
  fetchCapabilities: api.fetchCapabilities,
}));
vi.mock('./my-groups', () => ({ fetchMyGroups: api.fetchMyGroups }));
vi.mock('./campaigns', () => ({ fetchCampaigns: api.fetchCampaigns }));

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
  administerBc: false,
  manageDeals: false,
  manageDealsTeam: false,
  pickDealsCoordinator: false,
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

  it('offers "Creează și un anunț" exactly where the compose sheet lets them publish (#909)', () => {
    const leader = buildEventFormOptions(
      managerCapabilities,
      [myGroup(1, 'manager')],
      readableGroups,
    );
    expect(leader.announceGroupIds).toEqual([1, 7]);
    const member = buildEventFormOptions(
      { ...managerCapabilities, managesAnyGroup: false },
      [myGroup(1, 'member')],
      readableGroups,
    );
    expect(member.announceGroupIds).toEqual([]);
    const bc = buildEventFormOptions(
      { ...managerCapabilities, createTopLevelGroups: true },
      [],
      readableGroups,
    );
    expect(bc.announceGroupIds).toEqual([1, 7, 12]);
  });

  it('offers BC every readable active Group', () => {
    const result = buildEventFormOptions(
      { ...managerCapabilities, createTopLevelGroups: true },
      [],
      readableGroups,
    );
    expect(result.groups.map((group) => group.id)).toEqual([1, 7, 12]);
  });

  describe('offers the Groups in one order for every viewer (F-15)', () => {
    // Creation order (ids) scrambles the names; the Organization comes last.
    const scrambled = [
      [2, 'Imagine & PR', [2]],
      [3, 'Tineret', [3]],
      [5, 'Financiar', [5]],
      [4, 'Resurse Umane', [4]],
      [40, 'Achiziții', [5, 40]],
      [30, 'OSUBB', [30]],
    ].map(([id, name, path]) => ({
      id: id as number,
      name: name as string,
      path: path as number[],
      min_level: 0,
      status: 'active',
      is_organization: id === 30,
    }));
    const role = (id: number): MyGroup => ({
      ...(scrambled.find((group) => group.id === id) as (typeof scrambled)[0]),
      short: '',
      category: 'department',
      color: '',
      group_role: 'manager',
      explicit: true,
      automatic: false,
    });

    it('BC (and the Moderator): OSUBB first, then the tree by name', () => {
      const result = buildEventFormOptions(
        { ...managerCapabilities, createTopLevelGroups: true },
        [],
        scrambled,
      );
      expect(result.groups.map((group) => group.name)).toEqual([
        'OSUBB',
        'Financiar',
        'Achiziții',
        'Imagine & PR',
        'Resurse Umane',
        'Tineret',
      ]);
    });

    it('BCE: the same order over the Groups it manages', () => {
      const result = buildEventFormOptions(
        managerCapabilities,
        [role(3), role(40), role(5)],
        scrambled,
      );
      expect(result.groups.map((group) => group.name)).toEqual([
        'OSUBB',
        'Financiar',
        'Achiziții',
        'Tineret',
      ]);
    });
  });

  it('does not turn ordinary membership into Event management', () => {
    const result = buildEventFormOptions(
      { ...managerCapabilities, managesAnyGroup: false, manageTasks: false },
      [myGroup(1, 'member')],
      readableGroups,
    );
    expect(result.groups).toEqual([]);
  });

  it('loads capabilities, effective roles, readable Groups and active Campaigns once', async () => {
    api.fetchCapabilities.mockResolvedValue(managerCapabilities);
    api.fetchMyGroups.mockResolvedValue([]);
    api.fetchCampaigns.mockResolvedValue([
      { id: 3, name: 'Bun venit', group_id: 7, is_active: true },
      { id: 4, name: 'Arhivată', group_id: 7, is_active: false },
    ]);
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
      // #691: only an active Campaign may be attached to an Event.
      campaigns: [{ id: 3, name: 'Bun venit', group_id: 7 }],
      // #909: no Group Role in my_groups(), so no Origin to publish from.
      announceGroupIds: [],
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
    campaignId: 3,
    announce: false,
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
      p_campaign_id: 3,
      p_announce: false,
    });
  });

  it('asks create_event for the Announcement when the box is ticked (#909)', async () => {
    api.rpc.mockResolvedValue({ data: { id: 45 }, error: null });
    await createEvent({ ...draft, announce: true });
    expect(api.rpc).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({ p_announce: true }),
    );
  });

  it('invalidates the Event family only after success', async () => {
    const client = { invalidateQueries: vi.fn() };
    const options = createEventMutationOptions(client as never);
    await options.onSuccess(undefined, draft);
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['events'],
    });
    expect(client.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['announcements'],
    });
  });

  it('refreshes Anunțuri too when an Announcement was published with the Event', async () => {
    const client = { invalidateQueries: vi.fn() };
    const options = createEventMutationOptions(client as never);
    await options.onSuccess(undefined, { ...draft, announce: true });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['announcements'],
    });
  });
});
