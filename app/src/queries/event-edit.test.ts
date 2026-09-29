import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: { rpc: api.rpc } }));

import type { Capabilities } from '../lib/capabilities';
import { reasonCopy } from '../lib/command-reasons';
import { buildEventFormOptions } from './event-creation';
import {
  canManageEvent,
  cancelEvent,
  editEventFormOptions,
  eventFormValuesFor,
  keepUntouchedTimes,
  managesEvent,
  updateEvent,
} from './event-edit';
import type { EventPresentation } from './events';
import type { MyGroup } from './my-groups';
import type { Group } from './reference';

const MEMBER = 'd0000000-0000-0000-0000-000000000004';

const readable = [
  {
    id: 5,
    name: 'OSUBB',
    path: [5],
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
    id: 20,
    name: 'Festival',
    path: [20],
    min_level: 0,
    status: 'active',
    is_organization: false,
  },
];

function capabilities(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    managesAnyGroup: false,
    manageTasks: false,
    seeDirectory: false,
    seeLeadership: false,
    manageRoles: false,
    provisionMembers: false,
    createTopLevelGroups: false,
    administer: false,
    ...overrides,
  };
}

function role(id: number, groupRole: string): MyGroup {
  const group = readable.find((item) => item.id === id);
  if (!group) throw new Error(`no Group ${id}`);
  return {
    ...group,
    short: 'G',
    category: 'department',
    color: '#284C93',
    group_role: groupRole,
    explicit: true,
    automatic: false,
  };
}

function event(overrides: Partial<EventPresentation> = {}): EventPresentation {
  return {
    id: 31,
    title: 'Ședință Educațional',
    type: 'sedinta',
    groupId: 7,
    group: {
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      category: 'department',
      path: [7],
      is_organization: false,
    },
    campaignId: null,
    startsAt: '2030-10-01T15:00:31.021Z',
    endsAt: '2030-10-01T17:00:31.021Z',
    dayKey: '2030-10-01',
    dayLabel: 'marți, 1 octombrie 2030',
    startTime: '18:00',
    endTime: '20:00',
    location: 'Sala 305',
    capacity: 25,
    description: 'Planificarea lunii.',
    minLevel: 3,
    createdBy: 'someone-else',
    cancelledAt: null,
    cancelReason: null,
    ...overrides,
  };
}

const orgEvent = (createdBy: string) =>
  event({
    groupId: 5,
    group: {
      name: 'OSUBB',
      short: 'ORG',
      color: '#ED2025',
      category: 'organization',
      path: [5],
      is_organization: true,
    },
    createdBy,
  });

/** The viewer as the card sees them, from the same options Eveniment nou uses. */
function viewer(mine: MyGroup[], caps: Partial<Capabilities> = {}) {
  const all = capabilities({
    managesAnyGroup: mine.some((group) => group.group_role !== 'member'),
    ...caps,
  });
  return {
    memberId: MEMBER,
    capabilities: all,
    options: buildEventFormOptions(all, mine, readable),
  };
}

describe('canManageEvent (the update_event / cancel_event gate)', () => {
  it('hides the actions from a Voluntar with no Group Role', () => {
    const volunteer = viewer([role(7, 'member')]);
    expect(canManageEvent(event(), volunteer)).toBe(false);
    expect(canManageEvent(orgEvent('someone-else'), volunteer)).toBe(false);
  });

  it("offers them to the Group's Manager or Responsible, and inherited below", () => {
    expect(canManageEvent(event(), viewer([role(7, 'manager')]))).toBe(true);
    expect(canManageEvent(event(), viewer([role(7, 'responsible')]))).toBe(
      true,
    );
    // my_groups() carries the inherited role on the Child Group.
    expect(
      canManageEvent(
        event({ groupId: 12 }),
        viewer([role(7, 'manager'), role(12, 'manager')]),
      ),
    ).toBe(true);
  });

  it("hides them for another Group's Event (not in buildEventFormOptions)", () => {
    expect(
      canManageEvent(event({ groupId: 20 }), viewer([role(7, 'manager')])),
    ).toBe(false);
  });

  it('keeps an Organization Event to its creator and BC/Moderator', () => {
    const manager = viewer([role(7, 'manager')]);
    // A Group Role lets them create one, not edit someone else's.
    expect(manager.options.groups.some((group) => group.id === 5)).toBe(true);
    expect(canManageEvent(orgEvent('someone-else'), manager)).toBe(false);
    expect(canManageEvent(orgEvent(MEMBER), manager)).toBe(true);
    // The creator keeps it even with no Group Role left.
    expect(canManageEvent(orgEvent(MEMBER), viewer([]))).toBe(true);
    expect(
      canManageEvent(
        orgEvent('someone-else'),
        viewer([], { createTopLevelGroups: true }),
      ),
    ).toBe(true);
  });

  it('offers BC/Moderator every Event', () => {
    expect(
      canManageEvent(
        event({ groupId: 20 }),
        viewer([], { createTopLevelGroups: true }),
      ),
    ).toBe(true);
  });

  it('offers nothing on a cancelled Event (event_cancelled)', () => {
    expect(
      canManageEvent(
        event({ cancelledAt: '2030-09-01T10:00:00Z' }),
        viewer([], { createTopLevelGroups: true }),
      ),
    ).toBe(false);
  });
});

describe('managesEvent (who reads the RSVPs, #934)', () => {
  it('keeps a cancelled Event with its managers: its answers are history', () => {
    const cancelled = event({ cancelledAt: '2030-09-01T10:00:00Z' });
    expect(managesEvent(cancelled, viewer([role(7, 'manager')]))).toBe(true);
    expect(
      managesEvent(cancelled, viewer([], { createTopLevelGroups: true })),
    ).toBe(true);
  });

  it('is the same rule as canManageEvent on a live Event', () => {
    const viewers = [
      viewer([role(7, 'member')]),
      viewer([role(7, 'manager')]),
      viewer([role(7, 'responsible')]),
      viewer([], { createTopLevelGroups: true }),
      viewer([]),
    ];
    const events = [
      event(),
      event({ groupId: 20 }),
      orgEvent(MEMBER),
      orgEvent('someone-else'),
    ];
    for (const who of viewers)
      for (const shown of events)
        expect(managesEvent(shown, who)).toBe(canManageEvent(shown, who));
  });

  it('never names a Voluntar with no Group Role, nor a signed-out viewer', () => {
    expect(managesEvent(event(), viewer([role(7, 'member')]))).toBe(false);
    expect(
      managesEvent(event(), {
        ...viewer([role(7, 'manager')]),
        memberId: undefined,
      }),
    ).toBe(false);
  });
});

describe('the edit form', () => {
  it('starts from the Event, in Romanian wall time', () => {
    expect(eventFormValuesFor(event({ campaignId: 3 }))).toEqual({
      title: 'Ședință Educațional',
      type: 'sedinta',
      groupId: 7,
      startsAt: '2030-10-01T18:00',
      endsAt: '2030-10-01T20:00',
      location: 'Sala 305',
      capacity: '25',
      description: 'Planificarea lunii.',
      minLevel: 3,
      campaignId: 3,
      announce: false,
    });
    expect(
      eventFormValuesFor(
        event({
          endsAt: null,
          location: null,
          capacity: null,
          description: null,
        }),
      ),
    ).toMatchObject({
      endsAt: '',
      location: '',
      capacity: '',
      description: '',
    });
  });

  it("keeps the Event's own Group and a Campaign that went inactive", () => {
    const groups = new Map<number, Group>([
      [
        5,
        {
          id: 5,
          name: 'OSUBB',
          short: 'ORG',
          color: null,
          category: 'organization',
          path: [5],
          parent_id: null,
          min_level: 0,
          status: 'active',
          is_organization: true,
        },
      ],
    ]);
    const options = editEventFormOptions(
      { groups: [], groupNames: [], campaigns: [] },
      { ...orgEvent(MEMBER), campaignId: 9 },
      groups,
      [{ id: 9, name: 'Zilele OSUBB', group_id: 5 }],
    );
    expect(options.groups.map((group) => group.id)).toEqual([5]);
    expect(options.campaigns).toEqual([
      { id: 9, name: 'Zilele OSUBB', group_id: 5 },
    ]);
  });

  it('sends an untouched time back exactly as stored', () => {
    const initial = eventFormValuesFor(event());
    const draft = {
      title: 'Titlu nou',
      type: 'sedinta' as const,
      groupId: 7,
      startsAt: '2030-10-01T15:00:00.000Z',
      endsAt: '2030-10-01T17:00:00.000Z',
      location: 'Sala 305',
      capacity: 25,
      description: null,
      minLevel: 3,
      campaignId: null,
      announce: false,
    };
    expect(keepUntouchedTimes(draft, initial, initial, event())).toMatchObject({
      startsAt: '2030-10-01T15:00:31.021Z',
      endsAt: '2030-10-01T17:00:31.021Z',
    });
    const moved = { ...initial, startsAt: '2030-10-02T18:00' };
    expect(
      keepUntouchedTimes(
        { ...draft, startsAt: '2030-10-02T15:00:00.000Z' },
        moved,
        initial,
        event(),
      ).startsAt,
    ).toBe('2030-10-02T15:00:00.000Z');
  });
});

describe('the commands', () => {
  beforeEach(() => {
    api.rpc.mockReset();
    api.rpc.mockResolvedValue({ data: { id: 31 }, error: null });
  });

  it('update_event receives every field, a null clearing its column', async () => {
    await updateEvent({
      eventId: 31,
      draft: {
        title: 'Ședință mutată',
        type: 'activitate',
        groupId: 12,
        startsAt: '2030-10-02T15:00:00.000Z',
        endsAt: null,
        location: 'Online',
        capacity: null,
        description: null,
        minLevel: 0,
        campaignId: 4,
        announce: false,
      },
    });
    expect(api.rpc).toHaveBeenCalledWith('update_event', {
      p_event_id: 31,
      p_title: 'Ședință mutată',
      p_type: 'activitate',
      p_group_id: 12,
      p_starts_at: '2030-10-02T15:00:00.000Z',
      p_ends_at: null,
      p_location: 'Online',
      p_capacity: null,
      p_description: null,
      p_min_level: 0,
      p_campaign_id: 4,
    });
  });

  it('cancel_event receives the Event and the reason', async () => {
    await cancelEvent({ eventId: 31, reason: 'Sala nu mai este liberă.' });
    expect(api.rpc).toHaveBeenCalledWith('cancel_event', {
      p_event_id: 31,
      p_reason: 'Sala nu mai este liberă.',
    });
  });

  it('throws the refusal so the form can place it', async () => {
    api.rpc.mockResolvedValue({
      data: null,
      error: { message: 'event_cancelled' },
    });
    await expect(cancelEvent({ eventId: 31, reason: 'x' })).rejects.toEqual({
      message: 'event_cancelled',
    });
  });

  // Every reason private.update_event_impl and private.cancel_event_impl
  // raise (20260928100000_notification_links.sql, 20260924132724_private_groups.sql).
  it.each([
    'invalid_event_title',
    'title_too_short',
    'title_too_long',
    'description_too_long',
    'location_too_long',
    'invalid_event_type',
    'invalid_event_interval',
    'invalid_event_capacity',
    'invalid_event_min_level',
    'event_group_required',
    'calendar_manage_forbidden',
    'event_not_found',
    'event_min_level_below_group',
    'event_min_level_above_actor',
    'event_cancelled',
    'invalid_campaign',
    'reason_required',
    'reason_too_long',
    'rate_limited',
  ])('says %s in Romanian', (reason) => {
    expect(reasonCopy(reason)).toMatch(/\S/);
  });
});
