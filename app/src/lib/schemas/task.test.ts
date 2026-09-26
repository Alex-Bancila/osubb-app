import { describe, expect, it } from 'vitest';
import type {
  TaskDraft,
  TaskFormOptions,
} from '../../screens/tracker/task-form-model';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import {
  fieldForReason,
  taskDraftSchema,
  taskDuplicateSchema,
  taskUpdateSchema,
  type TaskDraftInput,
} from './task';

const now = () => new Date('2026-09-24T10:00:00Z');
const options: TaskFormOptions = {
  groups: [{ id: 3, name: 'Child', path: [1, 2, 3], min_level: 1 }],
  campaigns: [
    { id: 10, name: 'Ancestor', group_id: 1 },
    { id: 11, name: 'Own', group_id: 3 },
    { id: 12, name: 'Sibling', group_id: 4 },
  ],
  umbrellas: [
    { id: 30, title: 'Parent', group_id: 3 },
    { id: 31, title: 'Other Parent', group_id: 4 },
  ],
};
const draft: TaskDraftInput = {
  title: 'Task',
  description: null,
  deadline: '2026-10-01T10:00:00Z',
  groupId: 3,
  kind: 'task',
  parentTaskId: null,
  audience: 'local',
  assignmentMode: 'public',
  executorId: null,
  campaignId: null,
  link: { label: '', url: '' },
};
const schema = taskDraftSchema(options, { now });
const check = (patch: Partial<TaskDraftInput>) => {
  const result = schema.safeParse({ ...draft, ...patch });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

describe('taskDraftSchema', () => {
  it('trims the title and turns a blank description into null', () => {
    expect(
      schema.parse({ ...draft, title: '  Titlu  ', description: '   ' }),
    ).toMatchObject({ title: 'Titlu', description: null });
  });

  it.each([
    ['   ', ['title: title_required']],
    ['ab', ['title: title_too_short']],
    [' ab ', ['title: title_too_short']],
    ['abc', []],
    ['t'.repeat(120), []],
    ['t'.repeat(121), ['title: title_too_long']],
    // Characters, as char_length counts them: 120 emoji are 120, not 240.
    ['😀'.repeat(120), []],
  ])('measures the title %j at the boundary', (title, expected) => {
    expect(check({ title })).toEqual(expected);
  });

  it('allows a description of 2000 characters and refuses 2001', () => {
    expect(check({ description: 'd'.repeat(2000) })).toEqual([]);
    expect(check({ description: `  ${'d'.repeat(2000)}  ` })).toEqual([]);
    expect(check({ description: 'd'.repeat(2001) })).toEqual([
      'description: description_too_long',
    ]);
  });

  it('refuses a deadline in the past on creation, and one that does not exist', () => {
    expect(check({ deadline: '2026-09-24T09:59:00Z' })).toEqual([
      'deadline: deadline_in_past',
    ]);
    expect(check({ deadline: '' })).toEqual(['deadline: deadline_invalid']);
    expect(check({ deadline: null })).toEqual(['deadline: deadline_required']);
  });

  it('accepts both audiences on a public Task and a local direct one', () => {
    for (const audience of ['local', 'org'] as const)
      expect(check({ audience, assignmentMode: 'public' })).toEqual([]);
    expect(check({ audience: 'local', assignmentMode: 'direct' })).toEqual([]);
  });

  it('refuses an org Audience on a direct Task, on the mode (R26)', () => {
    expect(check({ audience: 'org', assignmentMode: 'direct' })).toEqual([
      'assignmentMode: direct_task_local_only',
    ]);
  });

  it('accepts a Campaign from any ancestor or self, not a sibling or a removed one', () => {
    expect(check({ campaignId: 10 })).toEqual([]);
    expect(check({ campaignId: 11 })).toEqual([]);
    expect(check({ campaignId: 12 })).toEqual(['campaignId: invalid_campaign']);
    expect(
      issues(
        taskDraftSchema({ ...options, campaigns: [] }, { now }).safeParse({
          ...draft,
          campaignId: 10,
        }),
      ),
    ).toEqual(['campaignId: invalid_campaign']);
  });

  it('requires one currently authorized Group and a complete ordinary Task', () => {
    expect(check({ groupId: 0 })).toEqual(['groupId: task_group_required']);
    expect(check({ groupId: 9 })).toEqual(['groupId: task_group_unavailable']);
    expect(check({ audience: null })).toEqual(['audience: invalid_audience']);
    expect(check({ assignmentMode: null })).toEqual([
      'assignmentMode: invalid_assignment_mode',
    ]);
    expect(check({ executorId: 'member' })).toEqual([
      'executorId: executor_not_allowed_for_public',
    ]);
    expect(check({ assignmentMode: 'direct', executorId: ' ' })).toEqual([
      'executorId: invalid_executor',
    ]);
  });

  it('checks the live Umbrella and inherited Origin, refusing nested Umbrellas', () => {
    expect(check({ parentTaskId: 30 })).toEqual([]);
    expect(check({ kind: 'subtask', parentTaskId: 30 })).toEqual([]);
    expect(check({ kind: 'subtask', parentTaskId: null })).toEqual([
      'parentTaskId: parent_unavailable',
    ]);
    expect(check({ parentTaskId: 99 })).toEqual([
      'parentTaskId: parent_unavailable',
    ]);
    expect(check({ parentTaskId: 31 })).toEqual([
      'parentTaskId: subtask_origin_mismatch',
    ]);
    expect(check({ kind: 'umbrella', parentTaskId: 30 })).toContain(
      'kind: subtask_cannot_be_umbrella',
    );
  });

  it('keeps an Umbrella free of audience, mode, Executor and Campaign, and of a deadline requirement', () => {
    const umbrella: Partial<TaskDraftInput> = {
      kind: 'umbrella',
      deadline: null,
      audience: null,
      assignmentMode: null,
    };
    expect(check(umbrella)).toEqual([]);
    for (const patch of [
      { audience: 'local' },
      { assignmentMode: 'direct' },
      { executorId: 'member' },
      { campaignId: 10 },
    ] as const)
      expect(check({ ...umbrella, ...patch })).toEqual([
        'kind: umbrella_has_no_mode',
      ]);
  });

  it('checks the Attached Link as a pair and sends blanks as none (#684)', () => {
    expect(schema.parse(draft).link).toEqual({ label: null, url: null });
    expect(
      schema.parse({
        ...draft,
        link: { label: ' Brief ', url: ' https://example.org/b ' },
      }).link,
    ).toEqual({ label: 'Brief', url: 'https://example.org/b' });
    expect(check({ link: { label: 'Brief', url: '' } })).toEqual([
      'link.url: link_url_required',
    ]);
    expect(check({ link: { label: '', url: 'https://example.org' } })).toEqual([
      'link.label: link_label_required',
    ]);
    expect(
      check({ link: { label: 'l'.repeat(61), url: 'https://example.org' } }),
    ).toEqual(['link.label: link_label_too_long']);
    expect(
      check({ link: { label: 'Brief', url: 'ftp://example.org' } }),
    ).toEqual(['link.url: link_url_invalid']);
    expect(
      check({
        link: { label: 'Brief', url: `https://${'a'.repeat(2041)}` },
      }),
    ).toEqual(['link.url: link_url_too_long']);
    // An Umbrella may carry a link like any Task.
    expect(
      check({
        kind: 'umbrella',
        deadline: null,
        audience: null,
        assignmentMode: null,
        link: { label: 'Plan', url: 'https://example.org' },
      }),
    ).toEqual([]);
  });

  it('turns the form’s Subtask into a Task draft with a parent', () => {
    const parsed: TaskDraft = schema.parse({
      ...draft,
      kind: 'subtask',
      parentTaskId: 30,
    });
    expect(parsed).toMatchObject({ kind: 'task', parentTaskId: 30 });
    // A finished draft passes the same schema again (the fresh re-check).
    expect(schema.safeParse(parsed).success).toBe(true);
  });
});

describe('taskUpdateSchema', () => {
  const edit = taskUpdateSchema({ umbrella: false, campaignIds: [11] });
  const values = {
    groupId: 3,
    title: 'Task',
    description: null,
    deadline: '2020-01-01T00:00:00Z',
    campaignId: null,
    assignmentMode: 'direct' as const,
    audience: 'local' as const,
    link: { label: 'Brief', url: 'https://example.org/brief' },
  };
  const checkEdit = (patch: object, editSchema = edit) => {
    const result = editSchema.safeParse({ ...values, ...patch });
    expectRoutable(result, fieldForReason);
    return issues(result);
  };

  it('accepts a deadline in the past: update_task does', () => {
    expect(checkEdit({})).toEqual([]);
  });

  it('refuses an org Audience on a direct Task, on the mode (R26)', () => {
    expect(checkEdit({ audience: 'org' })).toEqual([
      'assignmentMode: direct_task_local_only',
    ]);
    expect(checkEdit({ audience: 'org', assignmentMode: 'public' })).toEqual(
      [],
    );
  });

  it('keeps the title and description limits', () => {
    expect(checkEdit({ title: 't'.repeat(121) })).toEqual([
      'title: title_too_long',
    ]);
    expect(checkEdit({ description: 'd'.repeat(2001) })).toEqual([
      'description: description_too_long',
    ]);
  });

  it('allows only the offered Campaigns and keeps an Umbrella without one', () => {
    expect(checkEdit({ campaignId: 11 })).toEqual([]);
    expect(checkEdit({ campaignId: 12 })).toEqual([
      'campaignId: invalid_campaign',
    ]);
    expect(checkEdit({ deadline: null })).toEqual([
      'deadline: deadline_required',
    ]);
    const umbrella = taskUpdateSchema({ umbrella: true, campaignIds: [11] });
    expect(
      checkEdit(
        {
          deadline: null,
          campaignId: 11,
          assignmentMode: null,
          audience: null,
        },
        umbrella,
      ),
    ).toEqual(['campaignId: umbrella_has_no_campaign']);
  });
});

describe('taskUpdateSchema: Group and Attached Link (#627, #684)', () => {
  const values = {
    groupId: 3,
    title: 'Task',
    description: null,
    deadline: '2020-01-01T00:00:00Z',
    campaignId: null,
    assignmentMode: 'direct' as const,
    audience: 'local' as const,
    link: { label: '', url: '' },
  };
  const checkMove = (patch: object, groupIds?: number[]) => {
    const result = taskUpdateSchema({
      umbrella: false,
      campaignIds: [],
      groupIds,
    }).safeParse({ ...values, ...patch });
    expectRoutable(result, fieldForReason);
    return issues(result);
  };
  it('accepts a Group the fresh read offers and refuses one it does not', () => {
    expect(checkMove({ groupId: 4 }, [3, 4])).toEqual([]);
    expect(checkMove({ groupId: 5 }, [3, 4])).toEqual([
      'groupId: task_group_unavailable',
    ]);
    expect(checkMove({ groupId: 0 })).toEqual(['groupId: task_group_required']);
  });
  it('clears the link with blanks and refuses half of one', () => {
    const edit = taskUpdateSchema({ umbrella: false, campaignIds: [] });
    expect(edit.parse(values).link).toEqual({ label: null, url: null });
    expect(checkMove({ link: { label: 'Brief', url: ' ' } })).toEqual([
      'link.url: link_url_required',
    ]);
  });
});

describe('taskDuplicateSchema', () => {
  const duplicate = taskDuplicateSchema({ now });
  it('reads the new deadline in Romania and refuses one in the past', () => {
    expect(duplicate.parse({ deadline: '2026-10-01T12:30' })).toEqual({
      deadline: '2026-10-01T09:30:00.000Z',
    });
    expect(issues(duplicate.safeParse({ deadline: '' }))).toEqual([
      'deadline: deadline_required',
    ]);
    expect(
      issues(duplicate.safeParse({ deadline: '2027-03-28T03:30' })),
    ).toEqual(['deadline: deadline_invalid']);
    expect(
      issues(duplicate.safeParse({ deadline: '2026-09-01T12:00' })),
    ).toEqual(['deadline: deadline_in_past']);
  });
});

it('maps every reason a Task command raises to a Task field', () => {
  expectMapComplete(
    fieldForReason,
    [
      'title',
      'description',
      'deadline',
      'groupId',
      'kind',
      'parentTaskId',
      'audience',
      'assignmentMode',
      'executorId',
      'campaignId',
      'link.label',
      'link.url',
    ],
    [
      // #673
      'title_too_short',
      'title_too_long',
      'description_too_long',
      'deadline_in_past',
      // create_task / update_task
      'title_required',
      'deadline_required',
      'task_group_required',
      'invalid_task_kind',
      'invalid_audience',
      'private_group_local_only',
      'invalid_assignment_mode',
      'direct_task_local_only',
      'invalid_executor',
      'executor_not_allowed_for_public',
      'invalid_campaign',
      'umbrella_has_no_campaign',
      'umbrella_has_no_mode',
      'parent_not_umbrella',
      'parent_terminal',
      'subtask_origin_mismatch',
      'subtask_cannot_be_umbrella',
      // #627: update_task moving a Task
      'invalid_group',
      'subtask_origin_immutable',
      'umbrella_has_subtasks',
      // #684: private.require_attached_link
      'link_incomplete',
      'link_label_too_long',
      'link_url_too_long',
      'link_url_invalid',
    ],
  );
});
