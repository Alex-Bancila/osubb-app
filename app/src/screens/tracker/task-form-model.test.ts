import { describe, expect, it } from 'vitest';
import {
  campaignsFor,
  groupsBelow,
  rootGroups,
  rootOf,
  taskDraftInput,
  type ManagedWorkGroup,
  type TaskFormOptions,
  type TaskFormValues,
} from './task-form-model';

// Educațional (1) is readable but not managed; the caller manages
// Conferință (2) under it, its Teams (3, 5) and a Team below a Team (6),
// plus the whole of Tineret (4).
const groups: ManagedWorkGroup[] = [
  { id: 6, name: 'Afișe mari', path: [1, 2, 3, 6], min_level: 1 },
  { id: 3, name: 'Echipa afișe', path: [1, 2, 3], min_level: 1 },
  { id: 2, name: 'Conferință', path: [1, 2], min_level: 1 },
  { id: 5, name: 'Buget', path: [1, 2, 5], min_level: 1 },
  { id: 4, name: 'Tineret', path: [4], min_level: 0 },
];
const names = (rows: ManagedWorkGroup[]) => rows.map((group) => group.name);

describe('the Origin cascade (ruling R3)', () => {
  it('offers as roots only the managed Groups with no managed ancestor', () => {
    expect(names(rootGroups(groups))).toEqual(['Conferință', 'Tineret']);
  });

  it('shows a manager of one Child Group that Group as their root', () => {
    const team = groups.filter((group) => group.id === 3);
    expect(names(rootGroups(team))).toEqual(['Echipa afișe']);
    expect(groupsBelow(3, team)).toEqual([]);
  });

  it('lists every managed Group below a root, at any depth, in tree order', () => {
    expect(names(groupsBelow(2, groups))).toEqual([
      'Buget',
      'Echipa afișe',
      'Afișe mari',
    ]);
    expect(groupsBelow(4, groups)).toEqual([]);
  });

  it('finds the root a chosen Origin sits under', () => {
    expect(rootOf(6, groups)?.id).toBe(2);
    expect(rootOf(2, groups)?.id).toBe(2);
    expect(rootOf(4, groups)?.id).toBe(4);
    expect(rootOf(null, groups)).toBeUndefined();
    expect(rootOf(99, groups)).toBeUndefined();
  });
});

const options: TaskFormOptions = {
  groups,
  campaigns: [
    { id: 10, name: 'Educațional', group_id: 1 },
    { id: 11, name: 'Conferință', group_id: 2 },
    { id: 12, name: 'Afișe', group_id: 3 },
    { id: 13, name: 'Tineret', group_id: 4 },
  ],
  umbrellas: [{ id: 30, title: 'Pregătirea', group_id: 3 }],
};

describe('Campaign options', () => {
  it('are the Campaigns owned on the chosen Group’s path, never below or beside it', () => {
    const on = (id: number) =>
      campaignsFor(
        groups.find((group) => group.id === id),
        options,
      ).map((campaign) => campaign.id);
    expect(on(2)).toEqual([10, 11]);
    expect(on(6)).toEqual([10, 11, 12]);
    expect(on(4)).toEqual([13]);
    expect(campaignsFor(undefined, options)).toEqual([]);
  });
});

describe('taskDraftInput', () => {
  const values: TaskFormValues = {
    title: 'Afișe',
    description: '',
    deadline: '2030-10-01T12:30',
    groupId: 6,
    kind: 'task',
    parentTaskId: null,
    audience: 'local',
    assignmentMode: 'direct',
    executorId: 'ana',
    campaignId: 12,
    links: [{ label: 'Brief', url: 'https://example.org' }],
    copies: '1',
    minLevel: 0,
  };
  it('sends exactly the one chosen Group, the Campaign it shows and the links as typed', () => {
    expect(taskDraftInput(values, options)).toMatchObject({
      groupId: 6,
      campaignId: 12,
      deadline: '2030-10-01T09:30:00.000Z',
      links: [{ label: 'Brief', url: 'https://example.org' }],
    });
  });
  it('drops a Campaign the chosen Group cannot carry', () => {
    expect(
      taskDraftInput({ ...values, groupId: 4 }, options).campaignId,
    ).toBeNull();
  });
  it('gives a Subtask its Umbrella’s Group', () => {
    expect(
      taskDraftInput(
        { ...values, kind: 'subtask', groupId: 4, parentTaskId: 30 },
        options,
      ),
    ).toMatchObject({ groupId: 3, parentTaskId: 30 });
  });
  it('sends a direct Task as local whatever Audience was picked (R26)', () => {
    expect(
      taskDraftInput({ ...values, audience: 'org' }, options).audience,
    ).toBe('local');
    // The choice is kept for Public: switching back sends it again.
    expect(
      taskDraftInput(
        {
          ...values,
          audience: 'org',
          assignmentMode: 'public',
          executorId: null,
        },
        options,
      ).audience,
    ).toBe('org');
  });
});

describe('taskDraftInput: Cine îl vede (R57)', () => {
  const publicOrg: TaskFormValues = {
    title: 'Afișe',
    description: '',
    deadline: '2030-10-01T12:30',
    groupId: 4,
    kind: 'task',
    parentTaskId: null,
    audience: 'org',
    assignmentMode: 'public',
    executorId: null,
    campaignId: null,
    links: [],
    copies: '1',
    minLevel: 2,
  };
  const sent = (values: TaskFormValues, actorLevel: number) =>
    taskDraftInput(values, options, actorLevel).minLevel;
  it('sends the chosen Role while it is offered', () => {
    expect(sent(publicOrg, 6)).toBe(2);
  });
  it('sends 0 for an Umbrella and for a direct Task, whatever was chosen', () => {
    expect(sent({ ...publicOrg, kind: 'umbrella' }, 6)).toBe(0);
    expect(sent({ ...publicOrg, assignmentMode: 'direct' }, 6)).toBe(0);
  });
  it('falls to the lowest choice when the chosen one is no longer offered', () => {
    // Afișe mari (6) sits at Voluntar: a local Task there starts at Voluntar.
    expect(
      sent({ ...publicOrg, groupId: 6, audience: 'local', minLevel: 0 }, 6),
    ).toBe(1);
    // An actor at Voluntar cannot keep a Voluntar Activ choice.
    expect(sent(publicOrg, 1)).toBe(0);
  });
  it('sends 0 when no Role is offered at all', () => {
    expect(sent({ ...publicOrg, groupId: 6, audience: 'local' }, 0)).toBe(0);
  });
});
