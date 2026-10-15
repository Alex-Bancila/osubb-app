# A minimum Role on whatever reaches all of OSUBB — design

- **Date:** 2026-10-14
- **Decided by:** Alex Băncilă, in the session of 2026-10-14 (ruling R57)
- **Status:** approved and built — part 1 (Events) #1066, part 2 (Tasks) #1067, both merged 2026-10-15.

## The request

> "add a filter of role for every create that has the whole osubb as scope, because some things even though are designed for the entire ong, some require al least volunteer role. For tasks, events, announcements and so on"

## Decisions

Alex chose, from three questions:

1. **Which Tasks:** every public Task (an Opportunity), not only the organisation-wide ones, so Tasks, Events and Announcements all offer the same field.
2. **Below the Role:** hidden. The Member does not see the Opportunity and cannot join its queue, as with an Event or an Announcement above their Level.
3. **Deals:** unchanged; a Deal reaches every Member.

He then approved the design below, including two calls made for him:

- a Member of a Group with Shared Work Visibility does not see a Task above their Role either;
- raising the Role removes an Executor below it, as moving a Task to a stricter Group already does.

## What exists (main at 18084d16)

| Create       | Minimum Role today                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Announcement | **Cine îl vede**, the whole ladder (`announcements_min_level_ck`: 0, 1, 2, 3, 5, 6), never above the author's Level. Nothing to do.                                                                             |
| Deal         | fixed at 0 (`DealFormSheet`). Stays so.                                                                                                                                                                         |
| Event        | **Cine îl vede**, but only Recrut, Voluntar cu Drept de Vot, BCE, BC (`events_min_level_ck` and the `invalid_event_min_level` checks: 0, 3, 5, 6 — the pre-ADR-0009 levels; `EVENT_MINIMUM_LEVELS` in the app). |
| Task         | none. Since ruling R26 (#794) an open organisation-wide Opportunity reaches every active Member with no Minimum Level gate; a local one reaches the Group's members.                                            |

The Level ladder (`app/src/lib/minimum-level.ts`): Recrut 0, Voluntar 1, Voluntar Activ 2, Voluntar cu Drept de Vot 3, BCE 5, BC 6; the Moderator's 9 is never offered.

## Design

Two PRs, merged in this order. Each carries its own tests and docs.

### PR 1 — an Event offers every Role

- `events_min_level_ck` becomes `check (min_level in (0, 1, 2, 3, 5, 6))`.
- `private.create_event_impl` (main's latest: `20261014160759_reminders.sql`) and `private.update_event_impl` (`20261014153142_edit_notices.sql`) accept the same set; `invalid_event_min_level` is kept for anything else. Their bodies are restated from those versions with only that line changed. The other rules stay: never below the Group's Minimum Level (`event_min_level_below_group`), never above the actor's own Level below 9 (`event_min_level_above_actor`).
- `private.can_read_event` already compares `level >= min_level`, so readers, notices (`private.event_notification_recipients`), RSVP and the reminders need no change.
- The Event's own Announcement copies the Event's Minimum Level, which `announcements_min_level_ck` already accepts.
- App: `EVENT_MINIMUM_LEVELS` becomes the whole ladder (`GROUP_MINIMUM_LEVELS`), so **Cine îl vede** in `EventForm` lists all six Roles from the Group's floor up to the actor's Level; `lib/schemas/event.ts` validates against it.

### PR 2 — a public Task's Minimum Level

**Data.** `tasks.min_level integer not null default 0`, `tasks_min_level_ck check (min_level in (0, 1, 2, 3, 5, 6))`, and `tasks_min_level_public_ck check (min_level = 0 or (kind = 'task' and assignment_mode = 'public'))`. Every existing Task gets 0, so nothing anyone sees changes until a Role is chosen. The approval stamp is untouched: Tasks have no approval.

**Glossary.** The Task's Minimum Level is the lowest Level that sees the Task as an Opportunity, or through Shared Work Visibility, and may join its Candidate Queue. It never widens who the Audience reaches: a local Task still reaches only its Group's members, an organisation-wide one every active Member, each now only at or above it.

**Built on the read sets of #1064.** PR 2 starts after #1064 (fast reads, part 1) merges: it turns `tasks_read` into Group sets read once per statement (`private.own_task_ids()`, `private.task_read_groups('whole' | 'open' | 'org')`) and keeps `private.can_read_task` as the reference its parity suite holds the policy to. Both change together here: R4 leaves `'whole'` for a new `'shared'` kind, so `'whole'` keeps R1 and R3, which the Role never gates; the policy tests `min_level <= (select private.caller_level())` on the row for `'shared'`, `'open'` and `'org'`; and `task_read_sets.test.sql` keeps its parity cases green and its set-content cases follow the split. Any Member list that #1064's later parts read through those sets or that policy inherits the gate.

**Who reads the Task** (`private.can_read_task`). The new test is `caller level >= target.min_level`, judged on the Task itself, also when it is read through its Umbrella. It applies to:

- the organisation-wide Opportunity rule (R6-org), which had no gate since R26;
- the Opportunities of one's own Group (R6-own);
- Shared Work Visibility (R4).

It does not apply to: one's own Assignment or Candidature, ever (R2); BCE, BC and the Moderator (R1); a Group Role on the path (R3). The Group's Minimum Level rule stays exactly as it is.

**The Group card.** `private.has_open_org_opportunity` counts only an open organisation-wide Opportunity at or below the caller's Level (`private.caller_level()`), so a Recrut is not shown a Group only a Voluntar-only Opportunity would reveal.

**Joining.** `private.express_task_interest_impl` refuses a live Member below the Task's Minimum Level with `42501 task_level_forbidden`. The check runs under the Task lock, after the Audience rule. A reader who sees the Task anyway (a Group Role on the path, a past Candidate) hears the refusal; anyone else cannot read the Task and gets `PT404 task_not_found`, as today. App copy: "Taskul e doar pentru {Rol} și peste." Selecting a Candidate is unchanged: a Member demoted after joining stays in the queue, as a Member who leaves a Group does today.

**Creating** (`private.create_task_impl`, `private.create_tasks_impl`, their public wrappers `create_task` and `create_tasks`). Both take a new last parameter, `p_min_level integer default 0`, so existing callers keep working. The old signatures are dropped and replaced, with grants and comments restated.

- A direct Task or an Umbrella is stored at 0, whatever was sent, as a direct Task is stored with the local Audience.
- Off the ladder → `PT400 invalid_task_min_level`.
- Above the actor's own Level, below 9 → `PT400 task_min_level_above_actor`.
- Every copy made in one call carries it.
- `private.duplicate_task_impl` copies it, and stores 0 when the copy is direct.

**Editing** (`private.update_task_impl`, `private.preview_task_update_impl`, `private.plan_task_update`, `private.task_update_consequences`, public `update_task` and `preview_task_update`). Each takes `p_min_level integer default null`; null keeps the stored value, so an installed client that does not send it changes nothing. Like every Task field, it is editable until review (ADR-0007, 2026-09-21).

- A Task made direct is stored at 0.
- A change by an editor below the stored or the new value → `task_min_level_above_actor` (raising, lowering, or clearing it by making the Task Direct; the Moderator excepted). An unchanged one is never judged, so a manager below a Role set by BC can still edit the Task's other fields. _Tightened during the build after an automated security review: the first version only refused raising above the editor's Level._
- **Raising it** adds two consequences to the shared definition. They are previewed, need `p_accept_consequences`, and are applied as the Group move applies them:
  - `candidate_removed` for each pending Candidate below the new value;
  - `executor_removed` for an active Executor below it, who loses the Assignment and leaves the Task To do with its queue intact (#682).

  Each consequence fires only when the value rises. Lowering it removes nobody.

- The Executor's R53 edit notice names the change: `private.task_field_labels` gains `min_level` → "cine îl vede".

**App.**

- The Task form (`TaskModeFields`, `task-form-model.ts`, `lib/schemas/task.ts`) shows **Cine îl vede** under **Audiență**, only while the Task is an ordinary public Task. Its choices come from `minimumLevelOptions`:
  - an organisation-wide Task offers every Role;
  - a local one offers the Roles from its Group's Minimum Level up;
  - both stop at the actor's own Level (all for the Moderator).

  The default is the lowest choice. A choice that falls outside the list (another Group, another Audience) resets to the lowest.

- The edit control sends the field and lists the two new consequences in **Confirmă consecințele**.
- `TaskDetailsSheet` shows a **Cine îl vede** fact ("De la Voluntar") when the value is above 0.
- `command-reasons.ts` gains `task_level_forbidden`, `invalid_task_min_level` and `task_min_level_above_actor`.
- `database.types.ts` is regenerated.

**Out of scope.**

- Deals (decision 3).
- Announcements, which already have it.
- The leadership Task lists (`private.task_list_scope`, `task_list`, R54), which read as Managers, Responsibles or level 5 and up — rules the new test does not touch.
- Selecting a Candidate.
- Completed-work Requests and the finished Tasks a manager adds directly (not Opportunities; stored at 0).

## Tests

**PR 1.** `events_min_level` assertions in the Event suites (`create_event`, `update_event` and the min-level suite), plus the app's `EventForm` and `event-form-model` tests:

- an Event at Voluntar and at Voluntar Activ is created, edited, read by a Voluntar Activ and hidden from a Recrut;
- its notice and reminder skip the Recrut;
- 4 and 9 are refused.

**PR 2.** A new `task_min_level.test.sql`, plus the existing Task suites (create, update/preview, interest, duplicate, visibility, the R26 org-Opportunity suite) updated for the new parameters. Each assertion fails if its rule is removed:

- create stores the value; a direct Task or an Umbrella is stored at 0; every copy carries it; off the ladder and above the actor are refused;
- an organisation-wide Opportunity at Voluntar is read by a Voluntar and not by a Recrut, Group card included; at 0 a Recrut still reads it (R26 kept);
- a local Opportunity at Voluntar Activ in a Group at Voluntar: a Voluntar member does not read it, a Voluntar Activ member does;
- Shared Work Visibility hides it below the Role; a Subtask above the Role stays hidden when its Umbrella is readable;
- a Group Manager below the Role still reads it; a past Candidate still reads it;
- interest below the Role is `task_level_forbidden` for a reader and `task_not_found` for anyone else;
- raising it previews and applies `candidate_removed` and `executor_removed`, refuses without confirmation, and notifies the removed; lowering it removes nobody; an unchanged value above the actor's Level is accepted; null keeps it;
- the Executor's edit notice says "cine îl vede";
- duplicate copies it.

`tracker_grants.test.sql` gets the roster changes if any private function is added; the conventions suite must stay green. App tests cover the field's choices and reset, the consequence lines, the details fact and the refusal copy.

## Docs

- **CONTEXT.md:** **Minimum Level** gains the Task's; **Task Audience** and **Opportunity** say "at or above the Task's Minimum Level"; **Event** may raise its Group's to any Role.
- **ADR-0007:** an amendment (2026-10-14, ruling R57) of R26's "no Minimum Level gate".
- **ADR-0008:** an amendment on the Event ladder.
- **Rulings table:** row R57 in `docs/superpowers/plans/2026-09-23-prod-readiness-grill.md`.

Ruling numbers: R53 is already used twice on main, by edit notices and reminders and by the Legacy Import. R54 is the fast Task lists, and R55 and R56 are proposed by the member-reads spec (#1064), so this design takes R57.
