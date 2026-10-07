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
