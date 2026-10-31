# Codebase audit — 2026-10-30

**Status 2026-10-31:** the six high findings (H1–H6) are fixed and merged in PRs #1123 (server) and #1124 (client), issues #1117–#1122; every medium and low finding below is still open.

Whole-repository audit of `main` at `0e6d3781` (PR #1116): the Postgres backend (effective schema of 273 migrations, dumped from the local stack, three newest migrations read from file), the React app (`app/src`), the Edge Functions, scripts, CI/CD, config and docs. Eight parallel read-only auditors covered one slice each; every finding listed as **confirmed** was then re-verified by reading the definition and its callers (and, for the catalog claims, by a read-only query against the local database). Nothing was executed, nothing was changed.

Confidence: **confirmed** = the code path was read end to end and the behaviour follows from it; **likely** = the mechanism is in the code but the trigger needs a state or timing not reproduced here; **possible** = plausible from the code, not fully traced.

File references are repo-relative; `schema.sql:N` refers to the effective-schema dump (the owning migration is named beside it).

## Summary

| Severity | Count | What it means here                                                       |
| -------- | ----- | ------------------------------------------------------------------------ |
| Critical | 0     | no authority bypass, wrong Task Points or data loss found                |
| High     | 6     | user-visible wrong behaviour, or a flow that fails deterministically     |
| Medium   | 27    | races, latent caps, integrity holes, N+1 and refetch storms, review gaps |
| Low      | 83    | cleanup, drift, defence in depth, dead code, latent limits               |

**Where bugs cluster** (from `git log` since 2026-10-01, `fix:` commits by directory): `screens/administrare` (101 touches), `screens/tracker` (55), `components/formatted-text` (44), `screens/announcements` (38). The two most-changed source files overall are `lib/command-reasons.ts` (72 changes) and `queries/keys.ts` (71): every feature edits both registries by hand.

**The ten to look at first**

1. H1 — a public Task returned from review and then given up can never be started or reopened again (`tasks_lifecycle_timestamp_order_ck`).
2. H2 — raising a Group's Minimum Level leaves its Events readable below it, and every later edit of those Events is refused.
3. H3 — "Deconectează-te de pe acest dispozitiv" signs the Member out of every device and leaves their push tokens live.
4. H4 — any secret-key write to a Profile that has a Nickname fails with 42501 (`private.fold_nickname`); this is the memory-noted production failure and it will hit the university backfill.
5. H5 — a sideways swipe inside any open sheet or dialog switches the tab behind it.
6. H6 — an `email_change` link signs whoever opens it into the sender's account.
7. M1 — `select_task_candidate` never re-checks eligibility, so a demoted or removed Candidate can still become Executor.
8. M2 — a Manager or Responsible appointed on the Organization Group can edit or delete every OSUBB-wide Announcement (R48).
9. M10/M11 — a Role Evaluation run ending today loses that afternoon's awards, and a finished Adunarea Generală run's sheet is recomputed from today's roles.
10. M22/M23 — a Release has no CI gate and can be re-run to roll production back; nothing refuses a migration dated before `main`'s newest.

---

## High

### H1. A Task returned from review and then given up (or stripped of its Executor by an edit) can never be started or reopened

- File: `supabase/migrations/20260911104000_tasks_lifecycle_timestamps.sql:63` (`tasks_lifecycle_timestamp_order_ck`, `schema.sql:2041`); `private.give_up_task_impl` (`20260924000120_queue_no_first_come.sql`); `private.update_task_impl`; `private.start_task_impl`; `private.reopen_task_impl`
- Category: bug · Confidence: confirmed
- The constraint requires `started_at IS NULL OR returned_to_progress_at IS NULL OR returned_to_progress_at >= started_at`. Since #682 `give_up_task` sets `status = 'todo', started_at = null` but keeps `returned_to_progress_at` (and `update_task` does the same when a consequence removes the Executor). The next `start_task` writes `started_at = now()`, later than the old return, and the row violates the check; `reopen_task`'s `started_at = coalesce(started_at, now())` hits the same arm.
- Failure: public Task; A starts, submits, the reviewer returns it; A gives up; the manager selects B; B taps Începe → raw `23514 tasks_lifecycle_timestamp_order_ck`. Only cancel or duplicate get out. No test runs return → give up → start (`give_up_task.test.sql:341` uses review_round 0).
- Fix: drop the `returned_to_progress_at >= started_at` arm (a later Executor's start legitimately postdates an earlier return) and add the two sequences as pgTAP cases.

### H2. Raising a Group's Minimum Level leaves its Events below it: lower Roles keep reading and RSVPing, and every later edit is refused

- File: `private.can_read_event` (`supabase/migrations/20260924132724_private_groups.sql:114`, `schema.sql:2927`); `private.update_group_impl` (`20260930190000_responsible_title.sql`); `private.update_group_structure_impl` (`20261013202856_cup_department_only.sql`); refusal in `private.update_event_impl`
- Category: bug / security · Confidence: confirmed
- `can_read_event` (the whole `events_read` rule, the notification recipients and the reminders) compares the caller only with `events.min_level` and `can_see_group`, which for a public Group checks nothing about level. `update_group` / `update_group_structure` raise `groups.min_level` and remove roster rows below it but never touch the Group's Events, and no trigger does. ADR-0009 says a Member below the Group's level does not see the Group "or its Events"; the Event rule "never below its Group's" is enforced only at Event write time.
- Failure: a Project goes from Minimum Level 0 to 3. Recruți no longer see the Project but still see, RSVP to and get reminders for its Events. When a Manager then edits one of those Events, the form resubmits `min_level 0` and gets `PT400 event_min_level_below_group` for a field they did not touch.
- Fix: in both update commands cascade `update events set min_level = greatest(min_level, p_min_level)` over the subtree (or also gate `can_read_event` on the Group's level); add the post-raise case to `rls_cross_role_sweep.test.sql` and `rls_events.test.sql`.

### H3. "Deconectează-te de pe acest dispozitiv" signs the Member out of every device and leaves their push tokens live

- File: `app/src/lib/auth.tsx:315` (`supabase.auth.signOut()` with no scope); copy in `app/src/screens/profile/SignOutDeviceLink.tsx`; auth-js 2.112 `GoTrueClient.signOut(options = { scope: 'global' })`
- Category: bug · Confidence: confirmed
- The two refusal paths (`AccountConfirmGate.tsx`, `AuthConfirm.tsx`) pass `{ scope: 'local' }` on purpose; the main sign-out does not, so it revokes every refresh token. On the other devices the sign-out never ran `unsubscribeDevice`, so their `push_tokens` rows stay and keep receiving this Member's pushes. `auth.test.tsx` only asserts that `signOut` was called.
- Failure: a Member signs out of a borrowed laptop; within the hour their phone PWA loses its session and needs a new emailed link, while the laptop and phone keep getting the Member's push notifications.
- Fix: `signOut({ scope: 'local' })`, pinned in the test; a separate labelled "sign out everywhere" action that also deletes the Member's `push_tokens` server-side if ever wanted.

### H4. Secret-key writes to a Profile that has a Nickname fail with 42501 on `private.fold_nickname`

- File: `supabase/migrations/20260923223833_nickname_member_card.sql:43-50` (grant to `authenticated` only, expression index `profiles_nickname_fold_uidx`); `20260927190000_daily_caps_latin_nickname.sql:657` (`private.guard_profile_nickname`, security invoker); callers `supabase/functions/reinvite-member/deps.ts:170` (`setProfileEmail`), `public.record_invitation_sent` (invoker), the planned R58 university backfill
- Category: bug · Confidence: confirmed (catalog: `has_schema_privilege('service_role','private','USAGE') = f`, `has_function_privilege('service_role','private.fold_nickname(text)','EXECUTE') = f`, guard is invoker; matches the memory note on production 42501s)
- Two paths reach the function as `service_role`: the invoker trigger when `nickname` is in the SET list, and the unique expression index on every INSERT and every non-HOT UPDATE of a nicknamed row (an `email` change is never HOT because `email` is indexed; an `invited_at`/`university` change is non-HOT when the page is full, hence "some rows"). `guard_profile_privileged_columns` was split for exactly this problem (#1076) and the Nickname path was missed.
- Failure: BC corrects a nicknamed invitee's address in Retrimite invitația → `500 email_sync_failed` every time; the `invited_at` stamp fails intermittently and is swallowed, so send-invitations treats the Member as never invited; the university backfill will fail on every nicknamed row.
- Fix: `grant execute on function private.fold_nickname(text) to service_role` (EXECUTE only; no schema usage needed for an index expression resolved by OID) and make the nickname guard `security definer`; add a service_role update of a nicknamed row with a forced non-HOT change to `profiles_nickname.test.sql`.

### H5. A swipe inside any open sheet, dialog or date-picker popover switches the tab underneath it

- File: `app/src/lib/swipe-tabs.ts:94` (`begin`) and `:70` (`swipeStartsElsewhere`); callers `AnnouncementsScreen.tsx`, `MemberScreen.tsx`, `GroupScreen.tsx`, `TrackerScreen.tsx`
- Category: bug · Confidence: likely
- The swipe handlers sit on the element holding the tab panels. Every sheet/dialog/popover those panels open is a Base UI portal rendered inside that React subtree, and React delivers a portal's touch events to its React ancestors. `swipeStartsElsewhere` walks `parentElement` from the target to the boundary; a portal's DOM lives under `document.body`, so the walk never meets the boundary and returns false, and the swipe is counted. No test swipes inside a portal.
- Failure: a Member drags an Announcement sheet's text sideways on a phone → `navigate('/anunturi/deals')`, the keyed content remounts and the sheet vanishes mid-read; on a Group page a drag inside the archive confirm switches the tab behind it.
- Fix: in `begin`, ignore touches whose target is not a DOM descendant of `event.currentTarget`; add a test that swipes on a `createPortal` child.

### H6. An `email_change` link signs any browser into the sender's account without the "Confirmă contul" question

- File: `app/src/screens/login/AuthConfirm.tsx:62` (`if (link.type === 'email_change') return 'ok'`), `:171`; pinned as correct by `AuthConfirm.test.tsx:298`
- Category: security · Confidence: likely
- `checkAccount` skips both the address comparison and the "did this browser ask for this link" check for `email_change`, on the reasoning that only a signed-in Member can start one. The starter is also the one who can forward the second link. `confirm()` never checks that the browser already held a session for the same user before `verifyOtp`.
- Failure: Member A changes their address, confirms the old-address link themselves, sends the new-address link to Member B; B taps and is silently inside A's account (the login-CSRF the F3 fix closed for every other link type).
- Fix: record the current session's user id before `verifyOtp`; treat `email_change` as `ok` only when the verified session's user matches it, else ask; flip the test.

---

## Medium

### Backend: Tracker and points

### M1. `select_task_candidate` never re-checks the Candidate's eligibility at selection

- File: `private.select_task_candidate_impl` (`supabase/migrations/20260914123925_select_task_candidate.sql`, `schema.sql:12571`)
- Category: security · Confidence: confirmed
- Eligibility (local Audience via `is_group_member`, the Task's Minimum Level per R57) is judged only when `express_task_interest` inserts the pending row. Nothing closes a pending Candidature when the Member is later removed from the Group or demoted. Selection checks only `candidate_not_pending` and `activ`; `assign_task_executor`, by contrast, enforces the level.
- Failure: a Voluntar Activ joins a level-2 local Task's queue, is demoted to Voluntar and removed from the Group; the manager still sees and selects them.
- Fix: under the Task lock, hold the Candidate's Profile `for share` and re-apply the join rule (refuse with the express reasons), or close such Candidatures on demotion/removal; add the test.

### M3. BC and the Moderator can create open work and Campaigns inside an archived Group, and the Task form offers archived Groups

- File: `private.create_task_impl` (`schema.sql:4405`, gate `:4469`), `private.duplicate_task_impl` (`:5512`) in `20261020213926_formatted_text.sql`; `private.create_campaign_impl` (`:3804`, `20260923231125_constraints_kit.sql`); root cause `private.can_manage_group_work` lets level ≥ 6 through on archived Groups; app side `app/src/queries/task-form-options.ts:10` / `screens/tracker/task-form-model.ts:7` (`managed_work_groups()` returns no status)
- Category: wrong-implementation · Confidence: confirmed
- `create_event` reloads the Group `where status = 'active'`, `create_completed_task` and the Request approval raise `PT409 group_archived`, `update_task` refuses a move into one. The three commands above have no status check, and `managed_work_groups()` offers archived Groups to BC in Task nou.
- Failure: a `todo` Task in an archived Group that its own Managers cannot manage and that `archive_group`'s "no open work" invariant said could not exist.
- Fix: `PT409 group_archived` in the three `_impl`s; return `status` from `managed_work_groups` and offer only active Groups (keeping an edit's current one).

### M4. Three helpers give three answers to "does this Group have a Manager?" (the Moderator's roster row)

- File: `private.has_group_manager` (`schema.sql:7546`, `20260919183347_group_authority_kit.sql`, no level filter) vs `private.task_managers` (`:15297`, `20261007120000_bc_group_positions.sql`, `role.level <= 6`) vs `private.group_managers` (`:6679`, counts level 9)
- Category: bug · Confidence: confirmed (code); impact needs a Moderator holding a Manager row, which nothing prevents (positions survive rank changes, R15; the local seed has the Moderator as a Responsible)
- `can_manage_task` / `task_list_scope` use `has_group_manager` for "peers manage when no Manager is on the path"; Task notices use `task_managers`. With a Moderator's Manager row on a Manager-less chain, Responsibles lose `can_manage_task` on peer Tasks while the "renunțare"/"trimis spre evaluare" notices still go to them.
- Fix: one rule — refuse a position for level 9 (and drop it when someone becomes Moderator), or add `level <= 6` to `has_group_manager` and `group_managers`; pin with a `can_manage_task` assertion in `task_managers_nearest_above.test.sql`.

### M25. Deciding a Completed-work Request computes the whole decider set per Request (O(pending × Members))

- File: `private.can_decide_request` (`schema.sql:2615`, `20260919185516_commands_write_group_id.sql`), `public.pending_request_decisions` (`:19260`), `private.work_deciders` (`:17334`)
- Category: inefficiency · Confidence: likely (algorithmic; not timed, local DB has 8 Members)
- `can_decide_request` is `auth.uid() in (select request_deciders(id))`, and `work_deciders` runs the definer `is_work_decider` once per `activ` Profile. The Cereri queue calls it once per pending Request; approve/reject twice. The needed answer is one `is_work_decider(group, requester, caller)` call.
- Fix: make `can_decide_request` call `is_work_decider` for the caller directly; keep `work_deciders` for the fan-out only.

### M26. Every `points_ledger` INSERT statement re-runs the full Promotion Candidate refresh

- File: trigger `points_ledger_refresh_promotion_candidates` (`20261002120000_live_promotion_candidates.sql`, `schema.sql:23295`); `private.refresh_promotion_candidates` (`20261018170000_portofoliu_interne.sql`); callers `evaluate_task`, `delete_tasks_effect` (one INSERT per award)
- Category: inefficiency · Confidence: confirmed (trigger shape), cost likely
- The trigger is per statement, but each evaluation and each reversal is its own statement. `create_completed_tasks` with 100 copies runs 100 refreshes; `delete_task` on an Umbrella or `delete_group` on a Department runs one per award, all inside one transaction holding Task, Group and roster locks. Each refresh aggregates `task_points_in_range` over the window.
- Fix: defer to once per transaction (transaction-local flag + deferred constraint trigger, or an explicit end-of-command call with the trigger skipped while the flag is set).

### M27. Tracker race refusals have no Romanian copy, and three older query mappers collapse them by SQLSTATE

- File: `app/src/lib/command-reasons.ts` (no entry for `already_candidate`, `already_executor`, `candidate_not_pending`, `task_queue_closed`, `task_not_in_review`, `task_not_in_progress`, `task_already_evaluated`, `umbrella_cancelled`, `task_has_no_executor`, `not_a_candidate`, `task_not_todo`, `task_not_overdue`, `task_not_public`, `task_audience_forbidden`, `task_executor_forbidden`, `invalid_links`, `too_many_ids`, `group_cycle`, `deal_not_found`, `deal_code_forbidden`, `event_not_visible`, `invalid_rsvp_status`); `app/src/queries/task-interest.ts:33` (`taskInterestError`), `task-candidate-selection.ts:40`, `event-rsvp.ts:80` map by code class only
- Category: bug / improvement · Confidence: confirmed (cross-check of every `raise … message = '…'` in the effective schema against the map; each listed reason is raised by a command the app calls)
- The README and the file header say every refusal becomes Romanian in one table; these queries bypass it, so `PT409 rate_limited` from `express_task_interest` reads "Taskul s-a schimbat. Lista a fost actualizată." and "someone was selected before you", "the queue closed", "you are already the Executor" all read the same.
- Fix: resolve `commandReason(error)` first everywhere, add copy for the listed reasons, and keep the class mapping only as the unknown fallback. (`event_not_visible` also breaks the conventions §3 rule "never mint a `*_not_visible` twin"; rename it `event_not_found`.)

### Backend: Calendar, Groups, Announcements, Notifications

### M2. A Manager or Responsible of the Organization Group edits and deletes every OSUBB-wide Announcement (R48)

- File: policies `announcements_update` / `announcements_delete` (`supabase/migrations/20261011130000_announcement_manage_author.sql`, `schema.sql:24180`, `:24200`); compare `private.can_manage_event` (`schema.sql:2729`)
- Category: security · Confidence: likely
- The non-Deal branch is `can_manage_group_work(group_id) OR (is_organization AND created_by = auth.uid())`. `can_manage_group_work` is true for any live Manager/Responsible row on the Group's path, and nothing refuses a position on the Organization Group (`member_card.test.sql` even seeds one). `can_manage_event` gets the same case right: creator or level ≥ 6 only.
- Failure: BC appoints a Voluntar Activ as Responsible of OSUBB to run org-wide Tasks; they can now delete or edit (and thereby un-approve) any OSUBB-wide Announcement.
- Fix: use the `can_manage_event` shape in both policies; add the Org-Group-position case to the #1042 block of `rls_announcements.test.sql`.

### M5. The Organization Group, the Adunarea Generală and Biroul de Conducere can be archived, and the Organization marker can be cleared by omission

- File: `private.archive_group_impl` (`20260928100000_notification_links.sql:848`, no protected-Group refusal); `private.update_group_structure_impl` (`20261013202856_cup_department_only.sql:49`, `coalesce(p_is_organization, false)` while a null `p_is_private` is refused); UI `app/src/queries/groups-admin.ts:422`, `GroupSettingsTab.tsx`
- Category: bug · Confidence: confirmed (code path)
- `delete_group` refuses `group_protected`; `archive_group` needs only level ≥ 6 and no open work, and the admin UI offers Arhivează on the root. Archiving cancels every future org-wide Event with a fan-out to every Member, and R65's unarchive never un-cancels. A full-state replace that omits `p_is_organization` unmarks the Organization Group, after which `announcement_recipients` resolves an org Audience to nobody.
- Fix: refuse `archive_group` (and hide the button) for the protected set `delete_group` uses; refuse a null `p_is_organization` as `p_is_private` is; require exactly one marked row.

### M6. `archive_group` races `create_event` / `create_task` / the Event-move branch of `update_event`

- File: `private.archive_group_impl` (`20260928100000_notification_links.sql:848-905`), `private.create_event_impl` (`20261023190000_all_day_events.sql:304`, reads the Group `status = 'active'` with no lock), `private.create_task_impl`, `private.update_event_impl` (move target read unlocked)
- Category: race · Confidence: likely
- Archive locks the target `FOR UPDATE` and descendants `FOR NO KEY UPDATE`, cancels the future Events it selects, then flips the status. The creators take only the FK `KEY SHARE`, which does not conflict with `NO KEY UPDATE` on a descendant at all, and on the target waits and then succeeds. `create_event_races`, `event_command_races` and `group_structure_races` cover other pairs.
- Failure: an archived Child Team with a live future Event whose audience got "Eveniment nou", or a non-terminal Task in an archived Group, which only BC can still touch.
- Fix: lock the owning Group `FOR NO KEY UPDATE` in the three commands and re-check `status = 'active'` under it; add two-session `test_race` cases.

### M7. Moving an approved local Event onto the Organization Group notifies the old Group about an Event it can no longer read

- File: `private.update_event_impl` (`20261023190000_all_day_events.sql:619`, `schema.sql:16074-16114`), with `private.stamp_approval` (`20261014160759_reminders.sql`)
- Category: bug · Confidence: confirmed
- Below BC, the move makes the Event pending again, `v_recipients` is empty, but the move branch appends `v_old_members` and `v_fields` holds `grup`, so `notify_event` sends "Eveniment actualizat … Grup: OSUBB" with a link to an Event `events_read` now hides from them. `approvals.test.sql:349-365` checks only Members outside the Department.
- Fix: append `v_old_members` only when `v_updated.approval_status = 'approved'`; tighten the assertion at line 360.

### M8. An Event's own Announcement never follows the Event

- File: `private.update_event_impl`, `private.create_event_impl` (`20261023190000_all_day_events.sql`), `private.cancel_event_effect` (`20260928100000_notification_links.sql`), `private.delete_event_impl` (`20261005022559_delete_for_good.sql`)
- Category: bug · Confidence: confirmed (behaviour), likely (against intent)
- `create_event(p_announce)` / `approve_event` write an Announcement with the Event's date line, place, description, Minimum Level and Termen = start. `announcements.event_id` records the link, but reschedule, place change, Minimum Level change, move into a Private Group, cancel and delete all leave it as written.
- Failure: an Event moved from 3 to 10 November, or cancelled, keeps a live Announcement saying "Luni, 3 noiembrie … Sala 305"; an Event raised to BCE+ stays readable through its Announcement by the original audience.
- Fix: update (or mark cancelled) the Announcement with `event_id = p_event_id` in those paths, or record the decision that it is frozen and show the link in the UI.

### M9. Notifications are never purged, and several hot paths scan each recipient's whole history

- File: `private.told_of` (`20261014153142_edit_notices.sql:39`), `private.send_reminders` (`20261023190000_all_day_events.sql`), `private.delete_event_impl` (`where subject = …`), cron list (`cron.job`)
- Category: inefficiency · Confidence: likely
- Cron prunes `push_deliveries`, `cron.job_run_details` and `email_digests` but never `notifications`; every org-wide notice adds one row per active Member. `told_of` (up to three calls per `notify_event`, one per `notify_announcement`) filters `member_id = any(...)` and `dedupe_key = k or like k||':%'` over read and unread rows with only `(member_id, created_at)` and unread-only partial indexes; `send_reminders` repeats a non-sargable `::date = today` per Announcement per Member; subject deletes have no index.
- Fix: a daily purge of read Notifications older than N days; an index `(member_id, dedupe_key)` without the `not read` predicate (or on `subject`).

### M21. The archive confirmation hides that archiving cancels every future Event, declines every pending Application and archives the whole subtree

- File: `app/src/screens/administrare/GroupSettingsTab.tsx:271`, `GroupChildrenTab.tsx:73`, `GroupDeleteDialog.tsx:221`
- Category: bug · Confidence: confirmed
- The dialog says only "Grupul nu mai poate primi taskuri, evenimente sau membri noi. Istoricul rămâne." `archive_group_impl` cancels every future Event of the subtree (fan-out to attendees), declines every pending Application (applicants notified) and cascades to every descendant; Dezarhivează restores none of it, as its own dialog says.
- Fix: state the consequences in the confirm, ideally with counts from a preview like the delete dialog's.

### Backend: Members and Role Evaluations

### M10. A run ending today (the form's default) leaves that day's later awards out of every promotion count

- File: `supabase/migrations/20261020190031_run_writes_only_the_share.sql:61` (refuses only `p_to > today`); `20261018170000_portofoliu_interne.sql:1363`, `:1519` (live window and standing start at `period_to + 1`); `app/src/screens/administrare/portofoliu/RunPanel.tsx:181-189` (Până la defaults to today)
- Category: wrong-implementation · Confidence: confirmed
- The run ranks what was committed when it ran over `[p_from, p_to + 1)`; the live Candidate window, Profil's standing and the next contiguous run all start the next day. Points evaluated on `p_to` after the run fall into nothing — yet `role_evaluation_ranking(id)` recomputes over the same range, so the run's sheet drifts from the Candidates and Signals it recorded.
- Fix: refuse `p_to >= today` in run and simulate and default the form to yesterday; or start the live window at `greatest(period_to + 1, run_at)` and record the cut-off instant on the run; add a pgTAP case.

### M11. A finished Adunarea Generală run's ranking sheet lists today's voters, not the run's

- File: `app/src/screens/administrare/portofoliu/RankingSheet.tsx:40` (`listedRows`), reading `public.role_evaluation_ranking` → `private.role_evaluation_rows` (`20261024175604_ag_ranks_the_same_pool.sql`)
- Category: bug · Confidence: confirmed
- The ranking is recomputed from the current `profiles` (status and role as of now) and since PR #1116 the AG sheet keeps only `row.role === 'vot'`. The code comments acknowledge only a later points reversal moving rows.
- Failure: BC runs the AG evaluation, gets three below-line Signals and demotes those voters as intended; the run's own sheet now omits exactly those three, and every "Loc" shifts.
- Fix: store the run's population (member, role at run, points, rank) when a run is finalised and read it back; until then say on the sheet that roles and places are today's.

### Frontend: data layer and screens

### M12. The Task edit form saves a stale full-state snapshot; `update_task` has no version check

- File: `app/src/screens/tracker/TaskEditControl.tsx:205-211` (state seeded once from `task`; `initialDeadline` recomputed from the live prop every render); `app/src/queries/task-edit.ts:46`; `public.update_task` signature (no `updated_at`/version argument)
- Category: race · Confidence: likely
- While the sheet is open the details query is refetched by live changes, so `task` moves under the form, which still sends its old title, description, links, Campaign and mode. Because `initialDeadline` is recomputed from the new prop while `deadline` state keeps the old wall time, `changed` turns true by itself and the old deadline is sent as an edit. `preview_task_update` lists only Executor/Candidate/Campaign consequences.
- Failure: Manager A opens Editează; Manager B moves the deadline to Monday; A fixes a typo and saves → the deadline silently goes back and the Executor is notified of a change nobody intended.
- Fix: pass `updated_at` (or a version) to `update_task`/`preview_task_update` and refuse `PT409` on mismatch; freeze `initialDeadline` in state and warn or re-seed when the live row differs.

### M13. Disponibile reads each row's Candidate Queue separately (2–3 requests per row, polled every 15 s)

- File: `app/src/queries/task-queue.ts:15-47` (`fetchTaskQueue`, `refetchInterval: 15_000`); mounted per row by `screens/tracker/TaskRow.tsx:323` → `TaskInterestControls.tsx:29`; stale comment `queries/task-opportunities.ts:130`
- Category: inefficiency · Confidence: confirmed
- `task_list('available')` already returns `my_candidature` and the Assignment History per row, and since ADR-0011 every `task_candidates` change invalidates `['tasks']`, so the polling is redundant. Each row still runs `hasOwnActiveAssignment`, then `fetchOwnCandidature`, then `fetchOwnQueuePosition`.
- Failure: 40 Opportunities → 80–120 requests on open and again every 15 s per Member on the page.
- Fix: seed the row's state from the list read; read every pending position in one `task_queue_summary` request for the visible ids; drop the interval.

### M14. Calendar cards read their own RSVP, every RSVP and the Members' identities one Event at a time

- File: `app/src/screens/calendar/EventRsvpControls.tsx:67`, `EventAttendance.tsx:41`, `:118`, `EventCard.tsx:197`; `queries/event-rsvp.ts:124`, `queries/event-attendance.ts:41`
- Category: inefficiency · Confidence: confirmed
- Every future non-deadline card mounts `useEventRsvp(eventId)`; every card is rendered `manageable`, so for a BCE+ or a manager `EventAttendance` reads all answers and then `useMemberIdentities`: three requests per card, repeated on every `['events']` invalidation. `useGoingEventIds` already reads the Member's own rows for the whole screen. The Agendă's default window is every future Event.
- Fix: read the viewer's answers for the window in one query and hand each card its status; batch or lazily load Cine participă.

### M15. Tracker lists re-render and re-present every loaded row every 30 s and on every keystroke; the finished part is never windowed

- File: `app/src/screens/tracker/TrackerScreen.tsx:475` (`now` ticks every 30 s), `TaskRowList.tsx:55` (`toTaskPresentation(row, now)` in the render prop, unmemoised), `ManagerTaskList.tsx:119`, `:174`, `TaskRow.tsx:265` (not memoised; re-strips the description), `components/layout/AnimatedList.tsx:34`
- Category: inefficiency · Confidence: confirmed
- The `search` object changes per keystroke (its `text`) although filtering waits for the debounced `needle`, so the whole list re-renders per key. Finished rows do not depend on `now` but re-present anyway. After the Legacy Import, Toate/De gestionat for BC can hold thousands of appended rows.
- Fix: `React.memo(TaskRow)` with per-row memoised presentations, finished presentations without `now`, pass only `needle` to the lists, virtualise or cap the rendered finished rows.

### M16. Live-change coalescing has no rate limit and restarts refetches already running

- File: `app/src/queries/live-changes.ts:193-219` (`timer ??= setTimeout(flush, COALESCE_MS)`; `invalidateQueries` with default `cancelRefetch: true`); the `profiles` row at `:74-84`
- Category: inefficiency · Confidence: likely
- A steady stream of signals flushes four times a second, each flush invalidating whole families and restarting in-flight refetches. `csv-import` calls `import_member` per row and `send-invitations` calls `record_invitation_sent` per Member, each stamping `profiles`, which fans out to profile, members, groups, tasks, points and capabilities on every connected client.
- Fix: throttle the flush per family (1–2 s, leading and trailing) with `cancelRefetch: false`; consider leaving `invited_at`-only updates out of the broadcast.

### M17. Any Task change anywhere cuts a Member's scrolled "Taskuri încheiate" back to its first page

- File: `app/src/queries/live-changes.ts:159-175`, `:203-204` (`keepFirstPages` for `keys.tasks.finishedAll` whenever `['tasks']` is invalidated)
- Category: wrong-implementation · Confidence: confirmed
- `['tasks']` is fed by `tasks`, `task_*`, `groups`, `group_members`, `profiles`, `campaigns`, `roles` and `completed_work_requests`. The same file spares the Anunțuri feed from this for exactly the reason it hurts here.
- Fix: refetch loaded pages in place with a cap (for example 3), or cut only when the query is inactive or the page hidden.

### M18. `privacy_acknowledgement_status` is read without paging and is cut at 500 rows

- File: `app/src/queries/privacy.ts:125` (one `rpc()` call, no `.range()`); `supabase/config.toml` `max_rows = 500`; `private.privacy_acknowledgement_status_impl` returns one row per `activ` Profile
- Category: bug · Confidence: likely (latent; depends on the active-Member count crossing 500, which the volunteer import of about 600 makes plausible)
- Every other per-Member list goes through `readAllRows`; this one builds the "not acknowledged" list and counts from the first 500 by uuid.
- Fix: `readAllRows((from, to) => supabase.rpc('privacy_acknowledgement_status').order('member_id').range(from, to))`.

### M19. An installed PWA never checks for a new build while it stays open or resumed

- File: `app/src/pwa/PwaUpdatePrompt.tsx:11` (`useRegisterSW()` with no `onRegisteredSW`), `pwa-config.ts:39` (`registerType: 'prompt'`)
- Category: improvement · Confidence: likely
- Nothing calls `registration.update()` periodically or on return to the foreground; only the PrivacyGate's "server ahead" path calls `reloadToLatestVersion`. A resumed app keeps the old precached `index.html` and the old RPC contract.
- Fix: in `onRegisteredSW`, call `r.update()` on `visibilitychange` (throttled) and on an interval.

### M20. Every Deal Code is shipped to every reader before the reveal; "Cod ascuns" and the reveal count are cosmetic

- File: `app/src/queries/deals.ts:35` (`code` in `DEAL_FIELDS`), `screens/deals/DealCodeStub.tsx:50`; `announcements.code` under the table `GRANT SELECT` (`has_column_privilege('authenticated','public.announcements','code','SELECT') = true`)
- Category: wrong-implementation · Confidence: confirmed
- `reveal_deal_code` (which records `deal_code_reveals`) is a UI step after the code is already in the response and the query cache. CONTEXT.md says the code is hidden until tapped and the team sees how many revealed it.
- Fix: revoke column SELECT on `code` for `authenticated`, expose `has_code`, and make `reveal_deal_code` the only read path (or document the count as advisory).

### Ops and CI

### M22. A Release deploys whatever `main` was dispatched at with no check that CI passed, and re-running an old Release rolls production's functions and web app back

- File: `.github/workflows/release-production.yml:113` (`release` job), `:156`; `docs/ops/release.md`
- Category: race · Confidence: confirmed (no CI gate), likely (re-run)
- Nothing between `report` and `db push` reads CI status for `$GITHUB_SHA`; house rule 7 allows docs-only pushes to `main`, so CI may be running or red. "Re-run failed jobs" on an older Release re-runs with its original SHA and redeploys that commit's functions and bundle over a newer production while the database stays at the newer migrations. `push-staging` likewise needs only `db`.
- Fix: before `db push`, require every CI check for `$GITHUB_SHA` green (`gh run list --commit`), and refuse unless the SHA is the current `origin/main` tip and descends from the newest `release/*` tag.

### M23. Nothing enforces that a new migration is dated after `main`'s newest; `db push --include-all` then applies it out of order on staging and production

- File: `.github/workflows/ci.yml:290`, `release-production.yml:165`, `.coderabbit.yaml:31` (the only guard is a review instruction)
- Category: race · Confidence: confirmed
- CLAUDE.md names the trap; CI builds the database in filename order, while staging and every Release apply the late file after newer ones — a `create or replace` body from an older PR silently wins in production while every test proved the newer one.
- Fix: a PR-time check that every added migration sorts after the newest file on the merge base; a Release-report warning for any added file older than the last released one.

### M24. Local and CI pin Postgres 15; the hosted projects most likely run 17

- File: `supabase/config.toml:24` (`major_version = 15`), `scripts/check-local-ci.sh:70` (its own comment about the 17.x image), `docs/team/presentation-pack/osubb-team-kickoff.html` ("Postgres 17.4 … configured to match production")
- Category: wrong-implementation · Confidence: possible (hosted version not verifiable from the repo)
- Every gate (pgTAP, race suites, upgrade harnesses, advisors, type generation) runs on 15. Planner choices, sort order without a total ORDER BY and lock interleavings the race suites pin can differ between majors.
- Fix: read `server_version_num` on staging and production, record it in `docs/backend/auth-config.md`, match `major_version`, and print the server version in the Release smoke step.

---

## Low

### Backend: authority and visibility

- **L1.** `profiles_read` and `roles_read` trust the JWT alone (`auth_is_member()` only); a deactivated Member keeps reading the whole directory for up to an hour. `supabase/migrations/20260822225003_profiles_read_policies.sql:29`. Fix: add `(select private.caller_level()) >= 0`; add a stale-token persona to `rls_profiles_read.test.sql`. Confirmed.
- **L2.** An Announcement's Minimum Level above its author's Level is refused only in the browser (`AnnouncementComposeSheet.tsx:59`, `AnnouncementEditSheet.tsx:127`); neither `guard_announcement_settings` (`20261007190200_osubb_deals.sql`) nor the policy checks it. Fix: `23514 announcement_min_level_above_actor` in the guard. Confirmed.
- **L3.** The Member Card names Groups above the viewer's Minimum Level: `private.member_card_impl` (`20261018130000_profiles_university.sql`) filters through `can_see_group` but not the level, unlike `groups_read` and `group_coordination_impl`. Likely.
- **L4.** The Sanction direct-insert path (deferred #104) lets a live BC member insert any `created_at`, any target and any delta with no notice: policy `points_ledger_create_sanction` (`20260927180000_live_level_gates.sql`) plus a table-wide INSERT grant; `guard_ledger_award_instant` constrains `task` rows only. Fix: revoke INSERT and drop the policy until a `record_sanction` command exists. Confirmed.
- **L5.** Claims-hook leftovers: `group_ids` is stamped but read by no server code and only by a dead client path (`queries/reference.ts:270`); `auth_in_group`, `auth_role` and `groups_read_auth_admin` are dead; the hook's not-`activ` branch returns `event` unchanged instead of stripping the three keys. `20260926123000_remove_legacy_group_keys.sql`, `20260918221121_groups_claims.sql`. Confirmed.
- **L6.** `can_read_announcement` builds a whole `group_audience` to test one Member (0.55–0.75 ms per call locally), per row in `announcements_read`, per `announcement_reads` insert and per Group in the feed, summary and badge. `20261007190200_osubb_deals.sql`, `20261014220000_announcement_feed.sql`. Fix: an `exists` membership probe. Confirmed.
- **L7.** `public.my_managed_task_ids()` still runs the per-Task definer over every readable Task (4–8 s on the archive) and is callable by any Member; `app/src` no longer calls it. `pending_candidate_count` in `task_queue_summary` re-runs `can_read_task` on rows `tasks_read` already filtered. `20260915193556_my_managed_task_ids.sql`. Confirmed.
- **L8.** Candidate identities: `task_candidates_read` hides other Candidatures from Shared Work Visibility members, `task_activity_read` (`is_task_team_member`) shows them through `interest_expressed` rows; and that arm ignores the Task's own Minimum Level (R57). `20261014180000_task_read_sets.sql`, `20260919184521_task_authority_on_groups.sql`. Possible.
- **L9.** A Group Responsible may evaluate (and remove points from) a BC member's Task — a Membru de drept reads as `'member'` in `group_role_of` — while the completed-work path refuses BC Executors outright. `private.can_evaluate_task`, `private.can_manage_task` vs `require_completed_work_group`. Intent undecided; ask. Possible.
- **L10.** Ordinary Members lose the Group of their own finished Tasks once it is archived (`groups_read` requires `active` below level 5) while `campaigns_read` ignores status; `task-lists.ts:154` resolves a `null` label. `20260925091107_task_visibility_follows_audience.sql`. Likely.
- **L11.** BCE can read the ledger rows of Private Group Tasks including `deleted_task_title` (policy `points_ledger_read` applies no `can_see_group`). Possible.
- **L12.** A creator who can no longer read the Task (moved into a Private Group) keeps receiving its manager Notifications with the title (`private.task_managers`, `20261007120000_bc_group_positions.sql`). Possible.
- **L13.** `pg_net`'s `http_*` functions are executable by `anon` and `authenticated` (defence in depth only while `net` is not exposed). Fix: revoke in a migration and pin in `conventions.test.sql`. Possible.
- **L14.** `announcement_reads.read_at` is client-writable (policy `FOR ALL`, table grant with UPDATE and DELETE): the readers list can be backdated or erased, which also undoes R53's "opened counts as knowing". Confirmed.
- **L15.** The level ≥ 5 gate on "mark all read" is cosmetic: every Member holds `UPDATE(read)` on their own `notifications` rows with an ownership-only policy, so one `PATCH` marks everything read or un-reads rows (which can collide with `notifications_member_dedupe_unread_uidx`). `20261005001035_notification_read_rules.sql`, `grants.sql:740`. Confirmed.

### Backend: Tracker and points

- **L16.** `duplicate_task` copies a Minimum Level above the duplicator's own Level, which `create_task` would refuse (`task_min_level_above_actor`). `20261020213926_formatted_text.sql`. Confirmed.
- **L17.** `duplicate_task` locks an Umbrella source `FOR UPDATE` before refusing it, stalling every concurrent Subtask evaluation for the transaction (conventions §2: parent rows `for no key update` unconditionally). Confirmed.
- **L18.** `approve_completed_work_request` with `p_title` null falls back to `left(description, 120)`; a 1–2 character description trips a raw `tasks_title_length_ck`, and same-Group approval skips `meets_group_min_level` while a Group-changing one enforces it. Confirmed (server path; the app always sends a title).
- **L19.** `update_task`'s confirmation is a boolean, so consequences that appear between preview and save (a new Candidate, a demotion) are applied unseen. Fix: send the accepted list or its hash and refuse on mismatch. Confirmed.
- **L20.** The Subtask rollup in `evaluate_task` and `cancel_task_impl` is counted without the Umbrella lock; two Subtasks finishing concurrently each see the other open, and the coalesced "n din m subtaskuri" notice can stay at n-1 for good. Likely.
- **L21.** `rating_guide.multiplier` duplicates `public.rating_mult()` (a hard-coded CASE) and no test holds them equal; `service_role` can edit the table. Confirmed.
- **L22.** The `task_create` cap counts `task_activity` rows that `delete_task` deletes (create+delete gives the slot back), `approve_completed_work_request` spends the decider's allowance without checking it, `create_task_impl` runs the cap before validating the direct Executor (conventions: after every other refusal), and the count scans the actor's whole history (`task_activity_actor_idx` is on `actor_id` alone). `20261024173518_task_create_cap_300.sql`. Confirmed.
- **L23.** `points_ledger` is append-only by grants alone: no BEFORE UPDATE/DELETE guard like `task_evaluations`/`task_activity` have; any definer body could change `delta` or `member_id`. Confirmed.
- **L24.** `update_task` / `preview_task_update` answer a null `p_group_id` with `42501 group_manage_forbidden` before `plan_task_update`'s `PT400 invalid_group`, so that branch is unreachable. Confirmed.
- **L25.** `set_event_rsvp` accepts an RSVP on a cancelled or finished Event (only the UI hides the controls), and its `for key share` does not conflict with cancel's lock. `20261011140000_org_wide_approval.sql:898`. Confirmed.
- **L26.** Archiving cancels `starts_at > now()` only, so an all-day or several-day Event already under way (R63) survives in an archived Group and keeps taking RSVPs that nobody below BC can cancel. Confirmed.
- **L27.** `remove_group_member` edits an archived Group's roster (no `group_archived` check, unlike Appointment and `set_group_role`), so R65's "rosters are simply there again" does not hold. Confirmed.
- **L28.** Raising a root Group's Minimum Level above its Application Level in Structura fails with a raw `groups_application_level_ck` violation instead of a named reason (`update_group_structure_impl`). Confirmed.
- **L29.** `update_event` resolves the old Group's audience (`group_notification_audience` + `can_read_event` per Member) on every edit even when the Group did not change; an OSUBB-wide typo fix pays two full-organization resolutions. Confirmed (code), cost possible.
- **L30.** `notif_suppression` is dead data: its only reader filters `kind = 'announce'` (no rows); the six seeded bc/bce rows are applied by no fan-out, so ADR-0010 and house rule 10 describe a suppression that does not run (BCE get every Event notice of every Group they belong to; R32/R43 replaced it). Confirmed.
- **L31.** `event_attendance` has no `created_at`/`updated_at` (conventions §7), so an RSVP's time is unknown; `checked_in` and `events.has_qr` are dead columns the app still selects. Confirmed.
- **L32.** `group_roster(null)` recomputes every Group's member set per 500-row page and before filtering (`20260929200000_group_member_set.sql`), called by Administrare › Grupuri and the directory through `readAllRows`. Likely.
- **L33.** conventions §10 misstates `archive_group`'s lock order (it locks the target `FOR UPDATE` first and the parent only via `validate_group_hierarchy`), so a future command copying "archive_group's order" from the doc inverts parent/target. Confirmed.

### Backend: Members, evaluations, seed

- **L34.** A skipped Promotion Candidate refresh is never retried: `refresh_promotion_candidates` returns 0 when `pg_try_advisory_xact_lock_shared(47,1)` fails during a run or a settings edit, and R58 dropped the daily job that healed it. `20261018170000_portofoliu_interne.sql:1335`. Likely.
- **L35.** The R58 commands (`set_eligibility_floor`, `set_membership_cutoff`, `set_points_start_date`, `set_evaluation_percent`, `run_role_evaluation`, `set_promotion_threshold`, `reject_promotion_candidate`) judge `actor_level >= 6` without holding the actor's Profile `for share` (conventions §2), unlike `set_org_setting_impl`. Confirmed.
- **L36.** `profiles.joined_at` accepts null or a future date from BC's direct write (`queries/admin-member.ts:158`); R58 made it load-bearing (`listable` requires `joined_at <= cutoff`), so the Member silently drops off the Candidate list. Confirmed.
- **L37.** `task_points_in_range` (language sql with SET, not inlinable) aggregates the whole ledger with no index on `task_evaluations(evaluated_at)`; `my_role_evaluation_standing` calls it for one Member, `role_evaluation_ranking` recomputes everything for a non-BC caller's own row, and the `profiles` refresh trigger fires on avatar/phone edits and `invited_at` stamps. Likely.
- **L38.** A repeated Finalizează records a second identical run and re-sends every Notification (dedupe keys carry the run id). Fix: `PT409 role_evaluation_duplicate` for the same kind/period/values within minutes, or an idempotency key. Confirmed.
- **L39.** Spec drift: `docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md:73-74` promises a server refusal `PT409 eligibility_floor_not_set`; the server validates only the passed `p_floor`/`p_cutoff`, and the gate lives in the page (`command-reasons.ts:662`). Confirmed.
- **L40.** "Nothing survives" a Member Deletion, but `auth.audit_log_entries` in the project database keeps the address and id indefinitely (no purge job), while the Privacy Notice attributes those logs to "the provider's policy". `20261020205141_member_deletion.sql:295-309`, `docs/legal/politica-de-confidentialitate.md:78`. Possible (depends on the hosted audit-log setting).
- **L41.** Re-seeding staging aborts with a NO ACTION FK error once a demo account has evaluated, approved or decided anything on non-demo work (`seed.sql:266-342` scopes the cleanup to demo-created Tasks); neither `check-seed-rerunnable.sh` nor the troubleshooting table covers it. Likely.

### Frontend

- **L42.** "Redeschide taskul" is offered on all 5 411 Legacy Import Tasks; the server always refuses `PT409 evaluation_not_found`, and the Member learns it only after writing a reason (`screens/tracker/TaskReopenControl.tsx:34`; the client reads no `source`). Confirmed.
- **L43.** Tracker membru labels Assignment end reasons with keys the database never writes (`reassigned`, `unfulfilled`) and misses `replaced`, `failed`, `task_updated`, `group_changed`, `legacy_migration`, which all read "Încheiată" (`screens/leadership/MemberTrackerScreen.tsx:67` vs `task_assignments_end_reason_ck`). Confirmed.
- **L44.** Tracker membru's total for an unranked Member is re-derived in the browser from RLS-filtered ledger embeds (`queries/leadership.ts:77`), so it can disagree with the board (Private Group rows drop out) and must mirror every server rule change. Possible.
- **L45.** Grupuri preferate keeps a muted Group's Task in De gestionat/Toate only when the Member executes it, not when they created it (`ManagerTaskList.tsx:147`, `lib/preferred-groups.ts:230`; `task_list` rows carry no `created_by`), against CONTEXT.md's "never silences their own work". Possible.
- **L46.** Lună empties the neighbouring months' padding days once the arrows set a range (`CalendarMonth.tsx:147`); the same month looks different depending on how it was reached. Possible.
- **L47.** A failed `my_capabilities()` read tells the Member "Nu ai acces la pagina cerută" and drops the deep link (`App.tsx:160-178` redirects on anything but `true`; the error branch is untested). Confirmed.
- **L48.** A lazy route chunk that goes missing after another tab accepted an update crashes to the full-screen error with no recovery: no `vite:preloadError` handler, one root `ErrorBoundary` (`App.tsx:46-82`, `components/shell/ErrorBoundary.tsx:14`). Likely.
- **L49.** The query retry policy does not treat `PT4xx` as verdicts (`queries/client.ts:12-16` matches only `42501`, `PGRST*`, bare `4xx`), so a `PT404` read is retried once before the "unavailable" state. No `client.test.ts`. Confirmed.
- **L50.** Theme "follows the OS until a Member picks" is broken: the OS listener persists the value as a choice and is mounted only by Profil (`lib/theme.ts:68-73`); no CSS rule follows `prefers-color-scheme` for the unset case. Confirmed.
- **L51.** Base UI's Select injects a `<style>` element that `style-src 'self'` blocks; harmless today (`alignItemWithTrigger={false}`) but the headers template and `docs/backend/hosting-headers.md` claim "nothing in the bundle writes a `<style>`". Fix: `<CSPProvider disableStyleElements>` or a hash. Likely.
- **L52.** Group pages and Administrare › Grupuri read whole tables to show one roster or a count (`queries/groups-admin.ts:61-85`, `:152-188`), re-run on every `groups`/`group_members`/`profiles` broadcast. Confirmed.
- **L53.** The Calendar's Work Filter reads every Event ever written through the per-row read policy to build a dozen (Group, Campaign) pairs (`queries/work-filter-options.ts:73-80`); Tasks got `leadership_filter_work` for this. Likely.
- **L54.** The direct-Executor picker and Task form options are keyed under `['tasks']` (`queries/keys.ts:118-121`) although their rows change with Groups/Members, so every Task command anywhere re-reads all of `group_members` while a form is open. Confirmed.
- **L55.** Deactivating or provisioning a Member does not refresh BC's privacy list (`profiles` feeds no `keys.privacy.all`; `member-role-management.ts:68-76` does not invalidate it). Confirmed.
- **L56.** `useDeleteTask` marks the deleted Task's queries stale without refetch so the sheet does not flip, but the `tasks` broadcast 250 ms later refetches it anyway (`queries/delete-for-good.ts:218-245` vs `live-changes.ts`). Possible.
- **L57.** Five copies of the page-through loop (`read-all.ts`, `leadership.ts:30`, `work-filter-options.ts:20`, `task-lists.ts:187`, `request-decisions.ts:26`) and two `useMyGroupRoles` (`my-groups.ts:27`, `groups-admin.ts:104`) already drift (null handling, hard-coded 500/499). Confirmed.
- **L58.** Dead query keys from the department model (`keys.ts` `tasks.open`, `tasks.scopes`, `tasks.byDept` — a department key against house rule 13) and stale caching docs (`client.ts:23-27` "polling first", `app/README.md` file table, mini-spec §177). Confirmed.
- **L59.** Every cold start shows two different loading screens in a row (`BootShell`, then `PrivacyGate`'s card loader). Confirmed.
- **L60.** Leadership-only screens (`LeadershipScreen`, `MemberTrackerScreen`, `CampaignsScreen`, `VolunteersScreen` with `@tanstack/react-table`) are imported eagerly in `App.tsx:26-39` while lighter Member routes are lazy. Likely (no build run).
- **L61.** A Text Link with an upper-case scheme (`HTTPS://`) is a link to the reader and the editor but raw Markdown to both strippers (`lib/formatted-text/plain.ts:223`, migration `20261023232804`), so it lands verbatim in Notification bodies and counts toward the 2000 visible characters. Confirmed.
- **L62.** DatePicker keyboard: after the month chevrons, or an arrow onto a disabled day, no day is in the tab order (`components/ui/date-picker.tsx:389`, `:313`, `:340-362`). Likely.
- **L63.** An Automatic-Membership Group still offers "Primește cereri de înscriere", which the server always refuses (`GroupSettingsTab.tsx:622-631`; the Private Group case is handled). Confirmed.
- **L64.** Member deletion's name check compares raw strings (no NFC, cedilla vs comma-below), so an imported "Ştefan" can never be matched by a typed "Ștefan" (`MemberDeletePanel.tsx:87`). Possible.
- **L65.** Free-text "Altă universitate" accepts "UBB"/"Babes-Bolyai" spellings, which then open a `not_ubb_student` Signal on a UBB voter (`lib/schemas/member-identity.ts:110-124`, `private.ubb_university()` exact match). Possible; relevant to the planned backfill.
- **L66.** Ledger and Application dates are formatted in the device's time zone (`MemberScreen.tsx:740`, `AdminApplicationsTab.tsx:433`, `GroupApplicationsTab.tsx:66`) while the rest of the app pins Europe/Bucharest. Confirmed.
- **L67.** Tailwind spacing steps 7/8/9 are silently remapped to 32/40/56 px (`theme/tailwind.css:54-56`), so `size-9`, `h-8`, `pl-9` and any pasted shadcn snippet render larger than written. Confirmed.
- **L68.** The Romanian "de" plural rule is copied about eleven times and two copies are already wrong (`requests-presentation.ts:6` never inserts "de"; `approval-labels.ts:5` inserts it for 101–119; `chosen-groups-label.ts` gives "0 de grupuri"). Fix: one `countLabel` in `lib/format.ts`. Confirmed.

### Edge Functions, scripts, config

- **L69.** The Edge Functions page Groups 1000 at a time while PostgREST caps responses at 500, so the "short page means done" loop ends after 500 Groups (`_shared/groups.ts:35`, `csv-import/deps.ts:36`, `bootstrap-production.mjs`); the app's copy was fixed to `READ_PAGE = 500`. Latent. Confirmed.
- **L70.** Deno is unpinned in CI (`v2.x`), `deno.lock` is never enforced (`--frozen`), and the type-check glob `supabase/functions/**/*.ts` runs under bash without `globstar`, so a nested folder would not be checked (`ci.yml:34`, `:163`, `:177`). Confirmed.
- **L71.** `send-digest` and `send-invitations` are outside the error-hygiene sweep, and `send-digest`'s error bodies do not use the shared `{ code, error }` shape (`send-digest/handler.ts:197-257`, `_shared/error-hygiene.test.ts:11`). Confirmed.
- **L72.** `invite-member` and `reinvite-member` log whole Auth/PostgREST error objects (addresses, constraint details), and `invite-member`'s compensating `deleteUser` ignores its `{ error }` and logs "rolled back" regardless (`invite-member/deps.ts:183`, `handler.ts:248`, `reinvite-member/handler.ts:284`). Likely.
- **L73.** `request-invitation`: the Origin "gate" is forgeable by any script, the IP cap falls back to the client-settable `x-forwarded-for`, and every call inserts a row and purges with an unindexed `requested_at < now() - 24h` scan (`request-invitation/handler.ts:62`, `:95`; `private.request_invitation_allowed_impl`). Confirmed (index), likely (spoofing).
- **L74.** Auth rate limits are sized "for ~20 Members" (`config.toml:71-90`) while the organization has hundreds; `email_sent = 100/hour` is shared by invitations and sign-in links and `send-invitations` stops only when Auth refuses, so an invitation batch can lock Members out of signing in for the rest of the hour. Likely (hosted values set by hand).
- **L75.** `csv-import`'s recruits path reports Auth's email rate limit as a generic `invite_failed` and keeps calling Auth for every remaining row (`_shared/member-invite.ts:149`). Confirmed.
- **L76.** `check-local-ci.sh` drifts from `ci.yml`: no `npm ci` (lockfile drift passes locally) and a different Montserrat grep (`scripts/check-local-ci.sh:141-154`). Confirmed.
- **L77.** `bootstrap-production.mjs --resume-tasks-from` bypasses the "runs only once" refusal and can file and approve the same historical Tasks again (Task Points credited twice); house rule 9 does not list it; the legacy-import rehearsal scripts are dead since #1050 dropped the command. Confirmed.
- **L78.** `config.toml`'s `[auth.email]` comment says the `enable_signup` below keeps the app invite-only; that key is the provider switch (`GOTRUE_EXTERNAL_EMAIL_ENABLED`) and setting it false breaks every magic link (`config.toml:98-104`; `docs/backend/auth-config.md` records this exact confusion from PR #127). Confirmed.
- **L79.** Hosted auth settings and email templates are pasted by hand and nothing checks them after a Release; the uptime job reports only by opening a GitHub issue and exits 0 when `UPTIME_URLS` is unset (`docs/backend/auth-config.md:142-156`, `uptime.yml:134`). Possible.

### Dependencies and tooling

- **L80.** `npm audit` on `app/`: `vite 8.2.0–8.2.2` (eight advisories incl. `launch-editor` command execution and `server.fs` bypasses; fix in 8.2.3+), `zod < 4.6.6` (memory exhaustion on constrained collections; app pins `^4.6.5`, fix 4.6.6+), `undici 7.x` (several DoS advisories), plus `@modelcontextprotocol/sdk`, `body-parser`, `proxy-addr` (critical), `source-map-js`, `systeminformation` — all pulled in through the `shadcn` CLI, which sits in `dependencies` (not `devDependencies`) and is only ever run by hand. Fix: move `shadcn` to devDependencies or remove it (run via `npx`), bump vite and zod, re-audit.
- **L81.** `cn` is a runtime npm dependency re-exported by `lib/utils.ts` (`export { cn } from 'cn'`) — works, but shadcn's own `cn` is normally a local two-liner and `cn@0.2.6` is three majors behind; one less supply-chain surface if inlined.
- **L82.** Majors available: `react-router 7.18 → 8.5`, `marked 17 → 18`; Supabase CLI pin `2.117.0` vs current `2.122.0` (the CLI pin is mirrored in `ci.yml`, so bump both together).
- **L83.** The two hand-maintained registries every feature edits — `lib/command-reasons.ts` (830 lines, 72 changes since September) and `queries/keys.ts` (71 changes) — are the repo's top churn files; M27 shows the reason table already missed 22 server reasons. A pgTAP or vitest check that every `message = '<reason>'` in the schema has a copy entry would turn this from review discipline into a gate.

### Test debt (no test fails if the behaviour is removed)

- return → give up → select → `start_task`, and the `update_task`-removal variant; `reopen_task` after unfulfilled-from-todo with `review_round > 0` (H1).
- Event visibility after a Group's Minimum Level is raised (H2).
- Sign-out scope (H3); a service_role update of a nicknamed Profile with a non-HOT change (H4); a swipe on a portal child (H5); the `email_change` confirmation (H6, currently pinned the wrong way).
- Eligibility at `select_task_candidate` (M1); an Org-Group position holder editing someone else's OSUBB-wide Announcement (M2); BC on an archived Group for `create_task`/`create_tasks`/`duplicate_task`/`create_campaign` (M3); `can_manage_task` with a Moderator Manager row on a Manager-less chain (M4); archive-vs-create races (M6); the old Group's audience on an approved → pending move (M7, the assertion at `approvals.test.sql:360` accepts it today); an award evaluated on `p_to` after the run (M10).
- `duplicate_task` by a duplicator below the source's level (L16); `approve_completed_work_request` with no title and a 2-character description (L18); `rating_guide.multiplier = rating_mult(rating)` (L21); RSVP on a cancelled Event (L25); an ongoing all-day Event at archive time (L26); a stale-token persona on `profiles_read` (L1); Announcement `min_level` above the author (L2).
- Frontend: `queries/client.ts` has no test; the capability error path (L47); the theme OS handler (L50); the service worker's route wiring; `MemberTrackerScreen` end reasons (L43); `GroupSettingsTab` automatic-membership case (L63). The CI "critical module coverage" gate covers three files (`App.tsx`, `auth-error-message.ts`, `capabilities.ts`).
- Edge Functions: `send-digest`/`send-invitations` outside the error-hygiene sweep (L71).

### Documentation drift

- `CLAUDE.md`: the Wave 4 bullet still says "fully built as a stacked PR chain, unmerged" and names `evaluation_periods`, `retention_ranking`, `open_/close_evaluation_period`, `set_promotion_rule`, none of which exist; "Ionic survives only in `ProfileScreen.tsx`" (no `@ionic` import anywhere; `ProfileScreen.test.tsx` asserts it); the ADR-0007 shorthand "a Campaign is … never a filter" contradicts CONTEXT.md and the Work Filter (the ADR says it never filters _who may execute_); house rule 10 and ADR-0010 describe `notif_suppression` as applied (L30).
- `docs/README.md` indexes none of the six specs under `superpowers/specs/2026-10-1*` nor `docs/org/*`, `docs/review/*`, `docs/team/setup.md`, although CLAUDE.md says it indexes every document.
- `docs/backend/conventions.md` §10 misstates `archive_group`'s lock order (L33); the portofoliu spec §B promises a server refusal that lives in the page (L39).
- `supabase/tests/README.md` names suites that no longer exist (`rls_teams_reference`, `independent_team_membership_concurrency`, `project_membership_commands`); `docs/backend/inviting.md:384` says `ALLOWED_ORIGINS` stays unset while two functions now refuse without it; `scripts/smoke-tracker-commands.sql` header tells the reader to export `DB_URL`, the name the wrapper avoids because seed-staging uses it.
- Function and column comments describe removed rules: the 100-copy cap, `executor_not_group_member` (removed by R51), the Wave-2 Origin bridge on `tasks.group_id`/`campaign_id`/`parent_task_id` and `completed_work_requests`, `task_evaluations.source` "reserved for #317's backfill"; `NotificationsScreen.test.tsx:536` still blames Ionic.
- `app/README.md`'s file table and `queries/client.ts`'s "polling first" comment predate ADR-0011.

---

## Suggested order

1. **One PR of server fixes with their tests** (small migrations, high value): H1 (drop the constraint arm), H2 (cascade `min_level` to Events), H4 (`grant execute … to service_role` + definer guard), M1 (re-check at selection), M2 (policy shape), M3 (`group_archived` in three commands), M5 (protected set in `archive_group`, refuse null marker), M7 (notify only when approved), L2, L25, L27, L28, L16, L17. Each is a few lines plus a pgTAP case; most already have a sibling command that does it right to copy from.
2. **One PR of client fixes**: H3 (`scope: 'local'`), H5 (portal check in `begin`), H6 (`email_change` confirm), M12 (freeze `initialDeadline`; the version check is a server follow-up), M18 (`readAllRows`), M27 (route the three mappers through `command-reasons` and add the 22 copies), L42, L43, L47, L49, L50, L63.
3. **Performance pass** before the member count grows: M13, M14, M15, M16, M17 (client), M9, M25, M26, L6, L7, L37 (server). M13/M14 remove the per-row reads that will dominate PostgREST load; M9 needs a decision on Notification retention.
4. **Role Evaluation integrity** before the next run: M10 (refuse `p_to >= today`), M11 (store the run's population), L34, L35, L38.
5. **Ops**: M22 and M23 are each one workflow step; L80 is a dependency bump; M24 is a lookup and a config change.
6. **Decisions to take with Alex** (not code yet): L9 (may a Responsible evaluate a BC member's Task?), M8 (does an Event's Announcement follow it or freeze?), L30 (drop `notif_suppression` or apply it), M20 (is the Deal Code a secret or a counter?), L40 (auth audit log vs "nothing survives"), L4 (close the Sanction path until #104).
