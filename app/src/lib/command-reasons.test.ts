import { expect, it } from 'vitest';
import {
  CommandError,
  commandErrorMessage,
  commandReason,
  describeFailure,
  reasonCopy,
} from './command-reasons';

it('turns a Group command refusal into Romanian, one table for every screen', () => {
  expect(
    commandErrorMessage(
      { code: '42501', message: 'group_manage_forbidden' },
      'fallback',
    ),
  ).toBe('Nu ai permisiunea să faci această schimbare în acest grup.');
  expect(
    commandErrorMessage(
      { code: 'PT409', message: 'group_has_open_work' },
      'fallback',
    ),
  ).toBe('Grupul are lucru neterminat.');
  // The Campaign panel reads the same table rather than keeping a second one.
  expect(reasonCopy('campaign_name_taken')).toMatch('Există deja o campanie');
});

it('never lets a snake_case reason or a database message reach the screen', () => {
  const unknown = commandErrorMessage(
    { code: 'PT409', message: 'some_reason_we_never_wrote' },
    'Nu am putut salva schimbarea.',
  );
  expect(unknown).toBe('Nu am putut salva schimbarea.');
  expect(unknown).not.toMatch(/_/);
  expect(
    commandErrorMessage(
      { code: '42501', message: 'permission denied for table groups' },
      'Nu am putut salva schimbarea.',
    ),
  ).toBe('Nu am putut salva schimbarea.');
  expect(commandErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  expect(commandReason({ message: 'not a reason at all' })).toBeUndefined();
});

it('keeps the server identifier so a screen can react to one refusal', () => {
  const failure = new CommandError(
    { code: 'PT409', message: 'group_has_members_below_level' },
    'fallback',
  );
  expect(failure.reason).toBe('group_has_members_below_level');
  expect(failure.message).toMatch('Confirmă scoaterea');
  expect(
    new CommandError({ message: 'nope nope' }, 'fallback').reason,
  ).toBeUndefined();
});

/*
 * Every reason the #673 migration (20260923231125_constraints_kit.sql) raises,
 * PT400 from the commands and 23514 from the two row guards. A new server
 * reason without Romanian copy fails here, in CI (ruling R8, #674).
 */
const CONSTRAINTS_KIT_REASONS = [
  'title_too_short',
  'title_too_long',
  'description_too_long',
  'name_too_short',
  'name_too_long',
  'note_too_long',
  'reason_too_long',
  'deadline_in_past',
  'starts_at_in_past',
  'invalid_event_capacity',
  'title_required',
  'body_required',
  'body_too_long',
  'link_label_too_long',
  'link_url_invalid',
  'link_url_too_long',
  'phone_invalid',
];

it.each(CONSTRAINTS_KIT_REASONS)('has Romanian copy for %s', (reason) => {
  const copy = reasonCopy(reason);
  expect(copy).toBeDefined();
  expect(copy).not.toMatch(/_/);
  expect(
    commandErrorMessage({ code: 'PT400', message: reason }, 'fallback'),
  ).toBe(copy);
});

/* Every reason #684's `submit_task_for_review` raises for a Submission Note
   (20260924010111_attached_link_submission_note.sql). */
it.each([
  'note_too_long',
  'link_incomplete',
  'link_label_too_long',
  'link_url_invalid',
  'link_url_too_long',
])('has Romanian copy for the Submission Note reason %s', (reason) => {
  const copy = reasonCopy(reason);
  expect(copy).toBeDefined();
  expect(copy).not.toMatch(/_/);
});

it('says the limits in words a member can act on', () => {
  expect(reasonCopy('title_too_short')).toBe(
    'Titlul are cel puțin 3 caractere.',
  );
  expect(reasonCopy('title_too_long')).toBe(
    'Titlul are cel mult 120 de caractere.',
  );
  expect(reasonCopy('deadline_in_past')).toBe(
    'Termenul nu poate fi în trecut.',
  );
  expect(reasonCopy('phone_invalid')).toBe(
    'Scrie un număr de telefon valid (de exemplu 0730 655 145).',
  );
});

it('keeps the reasons the per-feature tables used to translate (#674)', () => {
  for (const reason of [
    // task-draft-validation.ts, task-edit.ts, task-assignment.ts,
    // task-umbrella.ts, task-duplication.ts
    'parent_not_umbrella',
    'task_manage_forbidden',
    'task_parent_changed',
    'task_not_direct',
    'task_already_assigned',
    'umbrella_has_no_subtasks',
    'subtasks_not_terminal',
    'task_is_umbrella',
    // event-creation.ts
    'invalid_event_interval',
    'calendar_manage_forbidden',
    'event_min_level_above_actor',
    // request-decisions.ts, CompletedWorkRequestScreen.tsx, RolePanel.tsx
    'request_not_pending',
    'evaluation_note_required',
    'request_origin_forbidden',
    'member_manage_forbidden',
  ])
    expect(reasonCopy(reason), reason).toBeDefined();
});

it('describes a failure for a form: the reason and the copy', () => {
  expect(
    describeFailure({ code: 'PT400', message: 'title_too_long' }, 'fallback'),
  ).toEqual({
    reason: 'title_too_long',
    message: 'Titlul are cel mult 120 de caractere.',
  });
  expect(
    describeFailure(
      new CommandError({ message: 'note_required' }, 'fallback'),
      'other',
    ),
  ).toEqual({ reason: 'note_required', message: 'Scrie o notă.' });
  expect(describeFailure(new Error('SQL'), 'fallback')).toEqual({
    reason: undefined,
    message: 'fallback',
  });
});
