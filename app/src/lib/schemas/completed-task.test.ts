import { expect, it } from 'vitest';
import {
  completedTaskFieldForReason,
  completedTaskSchema,
  type CompletedTaskInput,
} from './completed-task';

const schema = completedTaskSchema({
  groupIds: [7, 9],
  campaigns: (groupId) => (groupId === 9 ? [3] : []),
});
const valid: CompletedTaskInput = {
  title: '  Atelier  ',
  description: '   ',
  groupId: 9,
  executorId: 'ana',
  copies: '1',
  links: [{ label: '', url: '' }],
  campaignId: 3,
  difficulty: '4',
  rating: '5',
  note: ' Excelent ',
};
const reasons = (input: Partial<CompletedTaskInput>) => {
  const result = schema.safeParse({ ...valid, ...input });
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
};

it('parses a completed Task: trimmed text, blank details as none, scores as numbers', () => {
  expect(schema.parse(valid)).toEqual({
    title: 'Atelier',
    description: null,
    groupId: 9,
    executorId: 'ana',
    copies: 1,
    links: [],
    campaignId: 3,
    difficulty: 4,
    rating: 5,
    note: 'Excelent',
  });
});

it('mirrors the server: the constraints kit, an offered Group, a volunteer, a Campaign of the Group', () => {
  expect(reasons({ title: 'ab' })).toEqual(['title_too_short']);
  expect(reasons({ description: 'd'.repeat(2001) })).toEqual([
    'description_too_long',
  ]);
  expect(reasons({ groupId: null, campaignId: null })).toEqual([
    'task_group_required',
  ]);
  expect(reasons({ groupId: 8, campaignId: null })).toEqual([
    'task_group_unavailable',
  ]);
  expect(reasons({ executorId: null })).toEqual(['executor_required']);
  expect(reasons({ groupId: 7 })).toEqual(['invalid_campaign']);
  expect(reasons({ links: [{ label: 'Poze', url: 'ftp://x' }] })).toEqual([
    'link_url_invalid',
  ]);
  expect(reasons({ difficulty: '', rating: '6', note: ' ' })).toEqual([
    'invalid_difficulty',
    'invalid_rating',
    'evaluation_note_required',
  ]);
});

it('counts the copies like Task nou (Part E): 1 to 100, whole, and the volunteer only at one', () => {
  expect(reasons({ copies: '' })).toEqual(['invalid_copies']);
  expect(reasons({ copies: 'abc' })).toEqual(['invalid_copies']);
  expect(reasons({ copies: '0' })).toEqual(['invalid_copies']);
  expect(reasons({ copies: '2.5' })).toEqual(['invalid_copies']);
  expect(reasons({ copies: '101' })).toEqual(['too_many_copies']);
  expect(reasons({ copies: '21' })).toEqual([]);
  // At several copies the volunteers come in the next step, so the form
  // builds the schema without the volunteer; everywhere else it is asked.
  const later = completedTaskSchema({
    groupIds: [7, 9],
    campaigns: (groupId) => (groupId === 9 ? [3] : []),
    volunteerRequired: false,
  });
  expect(
    later.safeParse({ ...valid, copies: '2', executorId: null }).success,
  ).toBe(true);
  expect(
    later.parse({ ...valid, copies: '3', executorId: null }),
  ).toMatchObject({ copies: 3, executorId: null });
  expect(reasons({ copies: '2', executorId: null })).toEqual([
    'executor_required',
  ]);
  expect(completedTaskFieldForReason('executorId').invalid_copies).toBe(
    'copies',
  );
  expect(completedTaskFieldForReason('executorId').too_many_copies).toBe(
    'copies',
  );
  expect(completedTaskFieldForReason('executorId').invalid_executors).toBe(
    'executorId',
  );
  expect(completedTaskFieldForReason('groupId').invalid_executors).toBe(
    'groupId',
  );
});

it('reports every missing field at once, not only after the text is fixed', () => {
  expect(
    reasons({ title: '', groupId: null, executorId: null, campaignId: null }),
  ).toEqual(['title_required', 'task_group_required', 'executor_required']);
});

it('puts a refusal about a fixed volunteer under Grup, a chosen one under Voluntar', () => {
  expect(completedTaskFieldForReason('groupId').executor_not_group_member).toBe(
    'groupId',
  );
  expect(
    completedTaskFieldForReason('executorId').executor_below_min_level,
  ).toBe('executorId');
  // R46: a server refusal cannot name the row, so it lands on the list.
  expect(completedTaskFieldForReason('executorId').link_url_invalid).toBe(
    'links',
  );
  expect(completedTaskFieldForReason('groupId').evaluation_note_required).toBe(
    'note',
  );
});
