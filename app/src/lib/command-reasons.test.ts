import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  CommandError,
  commandErrorMessage,
  commandReason,
  describeFailure,
  knownReasons,
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
  expect(copy).toMatch(/^Porecla /);
  expect(commandReason({ code: '23514', message: reason })).toBe(reason);
});

/* R58: the Universitate and the rule that only a UBB student is granted Drept de Vot. */
it.each([
  ['invalid_university', 'Universitatea are între 2 și 120 de caractere.'],
  [
    'vote_requires_ubb_student',
    'Doar un student UBB poate primi Drept de Vot.',
  ],
])('has Romanian copy for the Universitate reason %s', (reason, copy) => {
  expect(reasonCopy(reason)).toBe(copy);
  expect(commandReason({ code: 'PT409', message: reason })).toBe(reason);
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
 * Every reason Portofoliu Interne (#827, R58) can meet: #826's
 * run_role_evaluation, set_promotion_threshold and reject_promotion_candidate,
 * the Simulation, the three evaluation settings and the ranking of a run.
 */
it.each([
  [
    'role_evaluation_manage_forbidden',
    'Doar BC și Moderatorul pot rula o evaluare de rol.',
  ],
  ['invalid_role_evaluation_kind', 'Alege tipul evaluării.'],
  ['invalid_role_evaluation_name', 'Scrie numele evaluării.'],
  ['date_range_in_future', 'Intervalul se poate termina cel târziu ieri.'],
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
  // The evaluation settings (R58): the Eligibility Floor, the Membership
  // Cutoff and the Points Start Date.
  [
    'invalid_eligibility_floor',
    'Pragul minim este un număr întreg de cel puțin 1.',
  ],
  [
    'invalid_membership_cutoff',
    'Data limită de intrare este o zi de cel târziu azi.',
  ],
  [
    'invalid_points_start_date',
    'Data de început a punctajului este o zi de cel târziu azi.',
  ],
  [
    'evaluation_settings_manage_forbidden',
    'Doar BC și Moderatorul pot schimba setările evaluărilor.',
  ],
  [
    'eligibility_floor_not_set',
    'Setează pragul minim înainte de a rula o evaluare.',
  ],
  [
    'membership_cutoff_not_set',
    'Setează data limită de intrare înainte de a rula evaluarea Voluntar Activ.',
  ],
  // The ranking of a recorded run (R58): the run was deleted or never was.
  ['role_evaluation_not_found', 'Evaluarea nu mai există. Reîncarcă pagina.'],
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
  [
    'candidate_rejection_reason_too_long',
    'Motivul are cel mult 500 de caractere.',
  ],
  ['date_required', 'Alege data.'],
])(
  "has the issue's Romanian copy for the Portofoliu Interne reason %s",
  (reason, copy) => {
    expect(reasonCopy(reason)).toBe(copy);
    expect(commandReason({ code: 'PT409', message: reason })).toBe(reason);
  },
);

// Ruling 21 (R58): no function raises them since the Promotion Rules and the
// run's PT409 went, so the page can meet neither; the copy went with them.
it.each(['org_setting_not_settable', 'promotion_threshold_not_set'])(
  'has no copy for %s, which no function raises any more',
  (reason) => {
    expect(reasonCopy(reason)).toBeUndefined();
    expect(knownReasons().has(reason)).toBe(false);
    expect(commandReason({ code: 'PT409', message: reason })).toBeUndefined();
  },
);

it.each([
  'invalid_date_range',
  'name_too_short',
  'name_too_long',
  'reason_too_long',
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

/* R58 dropped the Promotion Rules and update_promotion_rule with them: their
   four refusals are no longer raised, so none keeps a copy. */
it.each([
  'invalid_tenure_months',
  'invalid_promotion_rule_enabled',
  'promotion_rule_manage_forbidden',
  'promotion_rule_not_found',
])('no longer carries the Promotion Rule reason %s (R58)', (reason) => {
  expect(reasonCopy(reason)).toBeUndefined();
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

/* #1087 (ruling R59): every reason Member Deletion raises that has no copy yet. */
it('says why a Member cannot be deleted for good, and what to do instead', () => {
  const said = (message: string) =>
    commandErrorMessage({ code: 'PT409', message }, 'fallback');
  expect(said('member_has_history')).toBe(
    'Contul are istoric și nu poate fi șters definitiv. Îl poți dezactiva din Roluri.',
  );
  expect(said('member_is_last_bc')).toBe(
    'Este ultimul membru BC activ, așa că nu poate fi șters. Numește întâi alt membru BC.',
  );
  expect(said('member_is_last_moderator')).toBe(
    'Este ultimul Moderator activ, așa că nu poate fi șters. Numește întâi alt Moderator.',
  );
  expect(
    commandErrorMessage({ code: 'PT400', message: 'invalid_member' }, 'x'),
  ).toBe('Membrul nu mai este disponibil. Reîncarcă pagina.');
});

it('says why a Group outside the Department label stays out of the Cup (ADR-0009, amended 2026-10-13)', () => {
  expect(
    commandErrorMessage(
      { code: 'PT409', message: 'cup_not_department' },
      'fallback',
    ),
  ).toBe('Doar un departament poate concura în Cupa Departamentelor.');
});

it('says an imported Task cannot be reopened and what to do instead (Legacy Import, spec 2026-10-13)', () => {
  expect(
    commandErrorMessage(
      { code: 'PT409', message: 'evaluation_not_found' },
      'fallback',
    ),
  ).toBe(
    'Taskul vine din importul vechiului Task Tracker și nu poate fi redeschis. Îl poți șterge definitiv, cu punctele lui.',
  );
});

/* #1110 (ruling R65): the two unarchiving refusals. */
it('says why a Group cannot be unarchived', () => {
  const said = (message: string) =>
    commandErrorMessage({ code: 'PT409', message }, 'fallback');
  expect(said('group_not_archived')).toBe('Grupul este deja activ.');
  expect(said('group_parent_archived')).toBe(
    'Grupul părinte este arhivat. Dezarhivează-l întâi pe el.',
  );
});

// #1132 (audit M12): a Task edit saved from a form opened before someone
// else's change.
it('has copy for task_changed', () => {
  expect(reasonCopy('task_changed')).toBe(
    'Taskul a fost modificat între timp. Reîncarcă formularul și fă din nou modificarea.',
  );
  expect(commandReason({ code: 'PT409', message: 'task_changed' })).toBe(
    'task_changed',
  );
});

/* ---- #1143 (audit M27, L83): every refusal a client can meet has copy ---- */

// The 22 reasons the audit found with no copy, each raised by a command the
// app calls. event_not_visible is one of them under its new name: #1143
// renames it event_not_found (conventions section 3: never a *_not_visible
// twin), whose copy the Calendar's other commands already use.
it.each([
  'already_candidate',
  'already_executor',
  'candidate_not_pending',
  'task_queue_closed',
  'task_not_in_review',
  'task_not_in_progress',
  'task_already_evaluated',
  'umbrella_cancelled',
  'task_has_no_executor',
  'not_a_candidate',
  'task_not_todo',
  'task_not_overdue',
  'task_not_public',
  'task_audience_forbidden',
  'task_executor_forbidden',
  'invalid_links',
  'too_many_ids',
  'group_cycle',
  'deal_not_found',
  'deal_code_forbidden',
  'event_not_found',
  'invalid_rsvp_status',
])('has Romanian copy for %s (#1143)', (reason) => {
  expect(reasonCopy(reason)).toMatch(/\S/);
  expect(commandReason({ code: 'PT409', message: reason })).toBe(reason);
});

it('has no copy for event_not_visible, renamed event_not_found (#1143)', () => {
  expect(knownReasons().has('event_not_visible')).toBe(false);
});

/**
 * The gate (#1143, L83). Every reason a live `public`/`private` function
 * raises as a literal message has copy, unless it is on the list below of
 * reasons no client ever receives. "Live" is what the migrations leave
 * behind: they are replayed in order, the last `create` of a function name
 * wins and a `drop` removes it, so a reason only a retired body raised
 * (event_not_visible, org_setting_not_settable) is not asked for. A reason
 * built with `||` (`last_<role>_needs_replacement`, `<field>_too_long`) is
 * not a literal and is covered by its own entries.
 */
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../supabase/migrations',
);

function liveRaisedReasons(): Map<string, Set<string>> {
  const live = new Map<string, string>();
  const head =
    /\b(create(?:\s+or\s+replace)?|drop)\s+function\s+(?:if\s+exists\s+)?(public|private)\.([a-z0-9_]+)\s*\(/gi;
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const text = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    for (const match of text.matchAll(head)) {
      const name = `${match[2]}.${match[3]}`.toLowerCase();
      if (/^drop/i.test(match[1] ?? '')) {
        live.delete(name);
        continue;
      }
      const rest = text.slice(match.index);
      const open = /\bas\s+(\$[a-z_]*\$)/i.exec(rest);
      const tag = open?.[1];
      if (!open || !tag) throw new Error(`${file}: no body for ${name}`);
      const start = open.index + open[0].length;
      const end = rest.indexOf(tag, start);
      if (end < 0) throw new Error(`${file}: unterminated body for ${name}`);
      live.set(name, rest.slice(start, end));
    }
  }
  const literal =
    /\bmessage\s*=\s*'([a-z][a-z0-9_]*)'(?!\s*\|\|)|\braise\s+exception\s+'([a-z][a-z0-9_]*)'/g;
  const raised = new Map<string, Set<string>>();
  for (const [name, body] of live) {
    for (const match of body.matchAll(literal)) {
      const reason = match[1] ?? match[2];
      if (!reason) continue;
      const by = raised.get(reason) ?? new Set<string>();
      by.add(name);
      raised.set(reason, by);
    }
  }
  return raised;
}

/** Raised by a live function, but never by one a client role can reach. */
const NO_CLIENT_EVER_SEES = new Set([
  // Service-role commands: the Edge Functions and scripts holding the secret
  // key call them, and turn every refusal into their own answer.
  'email_required', // notify_email_delivery_problem, request_invitation_allowed
  'email_too_long',
  'invalid_delivery_id',
  'invalid_email_event',
  'invalid_ip_hash',
  'invalid_digest_outcome', // settle_email_digest
  'invalid_push_outcome', // settle_push_delivery
  'invalid_limit', // claim_push_deliveries, claim_email_digests
  'invalid_email', // import_member, import_member_lookup
  'invalid_placements',
  'invalid_problems',
  'invalid_sheet_row',
  'member_id_required',
  'member_not_imported',
  'too_many_emails',
  // Internal helpers: the commands that call them pass a value they chose,
  // so these mean a bug in the command, never a member's input.
  'invalid_assignment_via', // open_task_assignment
  'assignment_not_active', // end_task_assignment
  'invalid_notification_title', // notify
  'invalid_outcome', // evaluate_task
  // Row guards behind a command that refuses first or converts the error,
  // on tables no client role writes directly.
  'task_campaign_inactive', // create_task / update_task answer invalid_campaign
  'task_campaign_origin_mismatch',
  'event_campaign_inactive', // create_event / update_event answer invalid_campaign
  'event_campaign_origin_mismatch',
  'task_hierarchy_too_deep', // create_task refuses a Subtask parent first
  'task_parent_not_umbrella',
  'duplicate_provenance_write_forbidden',
  'task_activity_immutable',
  'task_evaluation_immutable',
  'task_evaluation_legacy_source_closed',
  'ledger_award_instant_mismatch',
  'role_history_immutable',
  'voting_role_requires_bc_actor', // set_member_role refuses below BC first
  'group_membership_identity_immutable', // the Appointment core only
]);

it('has copy for every reason a live command raises, unless no client ever sees it (#1143)', () => {
  const raised = liveRaisedReasons();
  const missing = [...raised.keys()]
    .filter((reason) => !knownReasons().has(reason))
    .filter((reason) => !NO_CLIENT_EVER_SEES.has(reason))
    .sort()
    .map(
      (reason) => `${reason} (${[...(raised.get(reason) ?? [])].join(', ')})`,
    );
  expect(missing).toEqual([]);
});

it('lists as unseen only reasons a live command raises and that have no copy (#1143)', () => {
  const raised = liveRaisedReasons();
  const stale = [...NO_CLIENT_EVER_SEES].filter(
    (reason) => !raised.has(reason),
  );
  const overlap = [...NO_CLIENT_EVER_SEES].filter((reason) =>
    knownReasons().has(reason),
  );
  expect({ stale, overlap }).toEqual({ stale: [], overlap: [] });
});
