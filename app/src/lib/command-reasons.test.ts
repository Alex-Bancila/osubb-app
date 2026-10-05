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

/* The security pass of 2026-09-27: the column limits that had none, from the
   commands (PT400) and the profile guard (23514). */
it.each([
  ['location_too_long', 'Locul are cel mult 200 de caractere.'],
  ['short_too_long', 'Prescurtarea are cel mult 16 caractere.'],
  ['manager_title_too_long', 'Numele funcției are cel mult 80 de caractere.'],
  // #962: the Group Responsible position's name, the same limit and words.
  [
    'responsible_title_too_long',
    'Numele funcției are cel mult 80 de caractere.',
  ],
  ['position_title_too_long', 'Numele funcției are cel mult 80 de caractere.'],
  ['full_name_too_long', 'Numele complet are cel mult 120 de caractere.'],
  ['invalid_avatar_color', 'Alege o culoare din listă.'],
])('has Romanian copy for the column-limit reason %s', (reason, copy) => {
  expect(reasonCopy(reason)).toBe(copy);
  expect(
    commandErrorMessage({ code: '23514', message: reason }, 'fallback'),
  ).toBe(copy);
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
    // request-decisions.ts, RequestsView.tsx, RolePanel.tsx
    'request_not_pending',
    'evaluation_note_required',
    'request_origin_forbidden',
    'member_manage_forbidden',
  ])
    expect(reasonCopy(reason), reason).toBeDefined();
});

/*
 * Every reason #905's set_member_role (ruling R31) adds for the last
 * Moderator or BC and the replacement named for them.
 */
it.each([
  'last_moderator_needs_replacement',
  'last_bc_needs_replacement',
  'replacement_not_needed',
  'replacement_is_last_moderator',
  'replacement_is_last_bc',
  'replacement_not_found',
  'replacement_inactive',
  'replacement_is_target',
])('has Romanian copy for the Role replacement reason %s', (reason) => {
  const copy = reasonCopy(reason);
  expect(copy).toBeDefined();
  expect(copy).not.toMatch(/_/);
});

/*
 * What update_task (#627 moving a Task) and private.require_attached_link
 * (#684) raise beyond the constraints kit — folded into this table with the
 * Task form (#688), so the tracker keeps no reason table of its own.
 */
it.each([
  'invalid_group',
  'subtask_origin_immutable',
  'umbrella_has_subtasks',
  'link_incomplete',
  'task_group_unavailable',
  'invalid_campaign',
])('has Romanian copy for the Task form reason %s', (reason) => {
  const copy = reasonCopy(reason);
  expect(copy).toBeDefined();
  expect(copy).not.toMatch(/_/);
  expect(commandReason({ code: 'PT409', message: reason })).toBe(reason);
});

/* Every reason #675's `private.guard_profile_nickname` raises (23514). */
it.each([
  'nickname_too_short',
  'nickname_too_long',
  'nickname_invalid',
  'nickname_taken',
])('has Romanian copy for the Nickname reason %s', (reason) => {
  const copy = reasonCopy(reason);
  expect(copy).toBeDefined();
  expect(copy).toMatch(/^Pseudonimul /);
  expect(commandReason({ code: '23514', message: reason })).toBe(reason);
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

/*
 * Every reason the Evaluări de rol tab (#827) can meet: #826's
 * run_role_evaluation, set_promotion_threshold and reject_promotion_candidate,
 * the rule lookup the run's ranking passes through, and set_org_setting
 * (#681, #512) in the Setări tab.
 */
it.each([
  [
    'role_evaluation_manage_forbidden',
    'Doar BC și Moderatorul pot rula o evaluare de rol.',
  ],
  ['invalid_role_evaluation_kind', 'Alege tipul evaluării.'],
  ['invalid_role_evaluation_name', 'Scrie numele evaluării.'],
  ['date_range_in_future', 'Intervalul se poate termina cel târziu azi.'],
  [
    'promotion_threshold_not_set',
    'Setează întâi pragul pentru acest tip de evaluare.',
  ],
  [
    'promotion_threshold_manage_forbidden',
    'Doar BC și Moderatorul pot schimba pragurile.',
  ],
  [
    'invalid_promotion_threshold',
    'Pragul este un număr întreg de cel puțin 1.',
  ],
  ['invalid_percent', 'Procentul trebuie să fie între 1 și 100.'],
  [
    'evaluation_percent_manage_forbidden',
    'Doar BC și Moderatorul pot schimba procentele.',
  ],
  ['org_setting_not_settable', 'Setarea se schimbă din Evaluări de rol.'],
  [
    'promotion_candidate_manage_forbidden',
    'Doar BC și Moderatorul pot decide asupra candidaților.',
  ],
  [
    'promotion_candidate_not_found',
    'Candidatul nu mai este în listă. Pagina a fost actualizată.',
  ],
  [
    'promotion_candidate_decided',
    'Candidatul a fost deja decis. Pagina a fost actualizată.',
  ],
  ['invalid_rejection_reason', 'Scrie motivul respingerii.'],
  ['rejection_reason_too_long', 'Motivul are cel mult 500 de caractere.'],
  ['date_required', 'Alege data.'],
])(
  "has the issue's Romanian copy for the Evaluări de rol reason %s",
  (reason, copy) => {
    expect(reasonCopy(reason)).toBe(copy);
    expect(commandReason({ code: 'PT409', message: reason })).toBe(reason);
  },
);

it.each([
  'invalid_date_range',
  'name_too_short',
  'name_too_long',
  'reason_too_long',
  'promotion_rule_not_found',
  'nothing_to_update',
  'invalid_org_setting_value',
  'org_settings_manage_forbidden',
  'org_setting_not_found',
  'value_too_long',
])('has Romanian copy for the shared reason %s', (reason) => {
  const copy = reasonCopy(reason);
  expect(copy).toBeDefined();
  expect(copy).not.toMatch(/_/);
});

it.each([
  'period_already_open',
  'period_already_closed',
  'period_manage_forbidden',
  'period_not_found',
  'invalid_period_name',
  'promotion_threshold_already_stamped',
  'promotion_rule_not_top_percent',
  'invalid_initial_threshold',
])('no longer carries the retired open/close reason %s (R28)', (reason) => {
  expect(reasonCopy(reason)).toBeUndefined();
});

/* #935: update_promotion_rule brings promotion_rule_manage_forbidden back,
   with its own words. */
it.each([
  [
    'invalid_tenure_months',
    'Vechimea este un număr întreg de luni, de la 0 la 120.',
  ],
  ['invalid_promotion_rule_enabled', 'Alege dacă regula este pornită.'],
  [
    'promotion_rule_manage_forbidden',
    'Doar BC și Moderatorul pot schimba regulile de promovare.',
  ],
])('has Romanian copy for the Promotion Rule reason %s', (reason, copy) => {
  expect(reasonCopy(reason)).toBe(copy);
});

/* #698: the application form link's own words (the settings form renames
   update_group's Attached Link reasons to these). */
it.each([
  ['application_form_incomplete', 'Completează și eticheta, și adresa.'],
  ['application_form_label_too_long', 'Eticheta are cel mult 60 de caractere.'],
  [
    'application_form_url_invalid',
    'Adresa trebuie să înceapă cu http:// sau https://.',
  ],
])('has Romanian copy for the application form reason %s', (reason, copy) => {
  expect(reasonCopy(reason)).toBe(copy);
  expect(commandReason({ code: 'PT400', message: reason })).toBe(reason);
});

it('tells a Member over a daily cap to come back tomorrow (security pass L3)', () => {
  expect(
    commandErrorMessage(
      {
        code: 'PT409',
        message: 'rate_limited',
        details: 'group_application: at most 10 per Member in any 24 hours',
      },
      'fallback',
    ),
  ).toBe('Ai atins limita zilnică. Încearcă mâine.');
  expect(reasonCopy('rate_limited')).not.toMatch(/_/);
});

/* #1017 (ruling R38): every reason the delete-for-good migration raises. */
it('has Romanian copy for every delete-for-good refusal', () => {
  for (const reason of [
    'task_has_points',
    'task_manage_forbidden',
    'task_evaluate_forbidden',
    'task_not_found',
    'task_parent_changed',
    'calendar_manage_forbidden',
    'event_not_found',
    'campaign_manage_forbidden',
    'campaign_not_found',
    'group_manage_forbidden',
    'group_protected',
    'group_not_empty',
    'invalid_delete_mode',
  ])
    expect(reasonCopy(reason), reason).toBeDefined();
});
