import { expect, it } from 'vitest';
import {
  taskDraftErrorMessage,
  validateTaskDraft,
} from './task-draft-validation';
import type { TaskDraft, TaskFormOptions } from './task-form-model';
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
const draft: TaskDraft = {
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
};
it.each(['department', 'project', 'team'])(
  'accepts both audiences and assignment modes for the %s presentation category',
  (category) => {
    const categorizedOptions = {
      ...options,
      groups: options.groups.map((group) => ({ ...group, category })),
    };
    for (const audience of ['local', 'org'])
      for (const assignmentMode of ['direct', 'public'])
        expect(
          validateTaskDraft(
            { ...draft, audience, assignmentMode },
            categorizedOptions,
          ),
        ).toBeNull();
  },
);
it('accepts a Campaign from any ancestor or self, rejects siblings and a Campaign removed by a fresh read', () => {
  expect(validateTaskDraft({ ...draft, campaignId: 10 }, options)).toBeNull();
  expect(validateTaskDraft({ ...draft, campaignId: 11 }, options)).toBeNull();
  expect(validateTaskDraft({ ...draft, campaignId: 12 }, options)).toMatch(
    /campanie activă/,
  );
  expect(
    validateTaskDraft(
      { ...draft, campaignId: 10 },
      { ...options, campaigns: [] },
    ),
  ).toMatch(/campanie activă/);
});
it('requires one currently authorized Group and a complete ordinary Task combination', () => {
  expect(validateTaskDraft({ ...draft, groupId: [3, 4] }, options)).toMatch(
    /exact un grup/,
  );
  expect(validateTaskDraft(draft, { ...options, groups: [] })).toMatch(
    /Nu mai poți/,
  );
  expect(validateTaskDraft({ ...draft, audience: null }, options)).toMatch(
    /audiența/,
  );
  expect(
    validateTaskDraft({ ...draft, assignmentMode: null }, options),
  ).toMatch(/atribuirea/);
  expect(validateTaskDraft({ ...draft, deadline: null }, options)).toMatch(
    /termenul/,
  );
  expect(
    validateTaskDraft({ ...draft, executorId: 'member' }, options),
  ).toMatch(/lista de candidați/);
});
it('checks the live Umbrella and inherited Origin, rejecting nested Umbrellas', () => {
  expect(validateTaskDraft({ ...draft, parentTaskId: 30 }, options)).toBeNull();
  expect(
    validateTaskDraft(
      { ...draft, parentTaskId: 30 },
      { ...options, umbrellas: [] },
    ),
  ).toMatch(/nu mai este disponibil/);
  expect(validateTaskDraft({ ...draft, parentTaskId: 31 }, options)).toMatch(
    /păstreze grupul/,
  );
  expect(
    validateTaskDraft(
      { ...draft, kind: 'umbrella', parentTaskId: 30 },
      options,
    ),
  ).toMatch(/nu poate fi Subtask/);
});
it('requires an Umbrella to have no audience, assignment mode, Executor, or Campaign', () => {
  const umbrella = {
    ...draft,
    kind: 'umbrella',
    deadline: null,
    audience: null,
    assignmentMode: null,
  };
  expect(validateTaskDraft(umbrella, options)).toBeNull();
  for (const patch of [
    { audience: 'local' },
    { assignmentMode: 'direct' },
    { executorId: 'member' },
    { campaignId: 10 },
  ])
    expect(validateTaskDraft({ ...umbrella, ...patch }, options)).toMatch(
      /Taskul-umbrelă nu are/,
    );
});
it.each([
  ['PT400', 'invalid_campaign', 'Campania nu mai este disponibilă'],
  ['PT400', 'invalid_origin', 'Alege un grup'],
  ['PT400', 'subtask_origin_mismatch', 'Subtaskul trebuie'],
  ['42501', 'private_authority_detail', 'Nu mai ai permisiunea'],
  ['PT404', 'private_lookup_detail', 'nu mai este disponibil'],
  ['PT409', 'parent_terminal', 's-a schimbat'],
])('maps %s/%s to safe Romanian copy', (code, message, expected) => {
  expect(
    taskDraftErrorMessage({ code, message, details: 'private row' }),
  ).toContain(expected);
  expect(
    taskDraftErrorMessage({ code, message, details: 'private row' }),
  ).not.toContain('private');
});
it('never displays unknown server payloads or arbitrary error messages', () => {
  for (const error of [
    new Error('secret SQL'),
    { code: '23514', message: 'secret SQL' },
    { code: 'PT400', message: 'secret SQL' },
    'secret SQL',
    null,
  ])
    expect(taskDraftErrorMessage(error)).not.toMatch(/secret|SQL/);
});
