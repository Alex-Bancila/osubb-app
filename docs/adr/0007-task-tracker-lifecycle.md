# ADR-0007 — Projects, teams, and the Task Tracker lifecycle

- **Status:** Accepted
- **Date:** 2026-09-07
- **Amended:** 2026-09-10 — `unfulfilled` outcome, Feedback-pending sub-state, Campaigns, Umbrella Tasks, any-active-member direct assignment and self-selection, evaluation-time Difficulty, notification recipients, Leaderboard filters, coordination departments, BC/Moderator Project roster override
- **Amended:** 2026-09-18 — ADR-0009: Origins are Groups; the Work origins, Campaigns, and Authorization sections are read through ADR-0009's settings and Group Roles
- **Amended:** 2026-09-21 — the edit window: every Task field is editable until review, Group changes with accepted consequences, Public → Direct closes the queue; Campaigns report points and contributors
- **Amended:** 2026-09-23 — the Candidate Queue never promotes by arrival: interest only queues, the Task Manager selects, and give-up or an edit that removes the Executor returns the Task to To do with its queue intact
- **Deciders:** Alex Băncilă + team
- **Supersedes:** —
- **Superseded by:** —
- **Related:** ADR-0001, ADR-0003, ADR-0004, `CONTEXT.md`

> **Amended 2026-09-18 by ADR-0009.** A Department, Project, or Team is a Group with settings rather than a table of its own; a Task's Origin is a Group. Read "Project lead" as Group Manager (Coordonator Principal), "Project Responsible" as Group Responsible, "local BCE" as the Department's Group Manager, and "the Origin's managers" as the Group's Managers, then its ancestors', then BC. Campaigns are owned by any Group. The lifecycle, the Candidate Queue, the command boundary, Umbrella Tasks, Completed-work Requests, and the points rules are unchanged.

## Context

The first Tracker schema models tasks as department/team rows with several assignees, an `open` status, and direct table updates. It cannot safely represent independent Projects, one accountable executor, an ordered volunteer queue, manager review, give-up history, or atomic evaluation. The old award/new-task request model also does not match how OSUBB wants to recognize already-completed work.

This ADR defines the target model. Migrations may reach it incrementally, but new work must not extend the retired model.

## Work origins

Every Task has exactly one **Origin**: a Department, a Project, or a Team. A Subtask inherits its Umbrella Task's Origin, and that inheritance is immutable.

A **Project** is independent of departments. It has an active/archived state, one lead, members, and zero or more Project Responsibles. The lead and every Responsible must also be an active Project member. BC or Moderator creates and archives Projects and chooses the lead. The lead — or BC/Moderator by override — manages membership and Responsibles. The lead and Responsibles manage Project work.

A **Department Team** has a parent Department. Local BCE, BC, or Moderator manages membership and planned work. Team members may submit Completed-work Requests but do not create planned tasks.

An **Independent Team** has no parent Department and no internal lead. Its active members jointly manage planned work. BC or Moderator manages membership and evaluates completed work.

The legacy `teams.lead_id` is retired. A Project lead is a real Project role, not a Team field.

The five departments are joined by two **coordination structures**, `diverse` (hosting the IT and Interne Department Teams) and `secretariat`. Both use the Department model for Origins and authority but never enter the Department Cup. The legacy `it` coordination department is retired; its members move to the IT Department Team.

## Campaigns

A **Campaign** is a Department-owned label, not an Origin. Local BCE, BC, or Moderator create, rename, and activate or deactivate a Department's Campaigns. A Task may carry at most one Campaign, and only when its Origin is that Department or one of that Department's Department Teams. Campaigns have no members. They exist to filter the Tracker, the leadership Leaderboard, and the Department Cup and to create planned Tasks under a shared initiative; they never change authority, eligibility, or Cup rules. A Campaign is a label for reporting — the points it earned and the volunteers who worked on it — and never filters who may execute a Task. _(Amended 2026-09-21.)_

## Task identity

In addition to its Origin, each Task has:

- an **Audience**: `local` or `org`;
- an **Assignment Mode**: `direct` or `public`;
- at most one active **Executor**;
- an exact `timestamptz` deadline displayed in `Europe/Bucharest`;
- a status: `todo`, `in_progress`, `in_review`, `completed`, `unfulfilled`, or `cancelled`.

**Overdue** is derived from the deadline and an unfinished status. It is not stored. Completed-but-overdue is derived as `completed_at > deadline`. **Feedback pending** is a derived sub-state of `in_progress`, entered when a Reviewer returns work (`review_round > 0`); it is never a stored status. **Open** means a public Task has an open queue and no Executor; it is not a lifecycle status.

A Task Manager may edit a Task's content, deadline, Campaign, Origin Group, Audience, and Assignment Mode while it is `todo` or `in_progress` — Feedback pending included, since returned work may reveal the manager's own mistake. A Task `in_review` or in a terminal status is not editable. Every edit is audited and notifies the Executor. Changing the Group adds an Executor who may attend the new Group to it and removes from the Task an Executor or Candidate below its Minimum Level; switching Public to Direct closes the queue and notifies the pending Candidates. The server computes these consequences, and the manager accepts them before the edit applies. Difficulty is not set at creation; Evaluation sets Difficulty and Rating together. _(Amended 2026-09-21; previously Origin, Audience, and Assignment Mode froze at the first Assignment or Candidature, and content, deadline, and Campaign stayed editable until final Evaluation.)_

## Umbrella Tasks and Subtasks

A Task is either an ordinary Task or an **Umbrella Task**. An Umbrella Task groups **Subtasks** one level deep through `parent_task_id`. Subtasks are ordinary Tasks: each inherits the Umbrella's Origin immutably and has its own Audience, Assignment Mode, Executor, Candidate Queue, Evaluation, and Task Points. The Umbrella has no Executor, queue, Difficulty, Rating, or points. Its manager may mark it completed only when every Subtask is completed, unfulfilled, or cancelled; cancelling an Umbrella cancels its non-terminal Subtasks with the same reason.

## Assignment and candidate queue

Assignment History is append-only and permits at most one active Executor per Task.

For a direct Task, the manager may choose any active OSUBB member as Executor; Audience governs only public queues. For a public Task, the first eligible active member who expresses interest becomes Executor. Later members enter an ordered Candidate Queue. Any active member admitted by the Audience may express interest, regardless of role level. A local queue admits eligible Origin members; an organization-wide queue may also admit eligible members outside the Origin.

Candidates have `pending`, `selected`, `withdrawn`, or `closed` status. A pending Candidate may withdraw without a reason and may later rejoin at the end. Queueing remains available after the deadline until a manager closes the queue or the Task becomes completed or cancelled.

Closing the queue hides the Opportunity from nonparticipants. Existing participants retain their own state; Team members retain their broader Team visibility.

An Executor may Give Up only while `todo` or `in_progress` and must provide a reason. The oldest pending Candidate is promoted atomically. Give Up is blocked while `in_review`. A manager may replace the Executor only with a queued Candidate and decides whether remaining Candidates stay pending or are closed. A direct Task whose Executor gave up has no queue; a manager assigns a new Executor with `assign_task_executor`.

## Lifecycle and points

The normal transition is:

```text
todo → in_progress → in_review → completed
```

An authorized Reviewer may return `in_review` work to `in_progress` with a note; this increments the review round and marks the Task Feedback pending. Final Evaluation — `complete_task_review`, or `mark_task_unfulfilled` for overdue unfinished work — requires Difficulty, Rating, and a note, and awards Difficulty × the Rating multiplier from the scoring guide only to the active Executor in the same transaction.

Reopening completed work requires a reason, returns it to `in_progress`, and reverses its Task-ledger effect atomically. Cancelling requires a reason and never deletes Assignments, Candidatures, Evaluations, or Task Activity.

**Unfulfilled** is the terminal outcome for overdue work that was not delivered. While a Task is overdue and unfinished, an authorized Reviewer may evaluate it as `unfulfilled`: the same authority and ledger rules as completion apply, points may be zero or negative, and the active Assignment ends as failed. Unfulfilled Tasks count in the Leaderboard and Department Cup like any evaluated Task. `duplicate_task` clones a Task's content, Origin, Campaign, Audience, and Assignment Mode into a new `todo` Task with a new deadline and records the source Task.

The Points Ledger remains append-only. Ordinary members see only their own total and own ledger rows. BCE, BC, and Moderator receive leadership metrics and may open one member's authorized full Task Tracker. The leadership Leaderboard contains member name and Task points only. Leaderboard and Department Cup filters (Department including its Department Teams, Team, Project, Campaign) apply to the Task that produced the points, never to the member's current memberships; a Leaderboard row opens that member's authorized full Task Tracker. Anyone with completed Task history remains eligible regardless of their current Profile status. Department Cup includes Department Tasks and Department-Team Tasks; Project and Independent-Team work never contributes. Awards do not exist. Sanctions are a separate deferred feature and may affect a member's personal total.

## Authorization

Active OSUBB membership is mandatory for every operation.

- Role levels 0–3 see their own Tasks, own Candidatures, and eligible public Opportunities.
- Team members see all Tasks and complete Task Activity for their Team.
- Active Independent-Team members jointly create, edit, and manage Team Tasks; only BC/Moderator evaluates them.
- Department-Team and Department Tasks are created, administered, and evaluated by local BCE, BC, or Moderator.
- Project members see their own Tasks and Candidatures. The Project lead and Responsibles see all Project Tasks.
- Project Responsibles may evaluate ordinary Project members. A Responsible's own work requires the lead or BC/Moderator. A Responsible cannot evaluate the lead. The lead may evaluate their own Task.
- BC/Moderator has global override.
- BCE reads all Tasks globally but writes only in their Departments or where they hold an explicit Project role. Local BCE may evaluate Department-Team work.

## Server-command boundary

Browsers do not directly change Task state. Public commands derive the actor from `auth.uid()` and accept only necessary target identifiers:

```text
create_task
update_task_content
convert_task_mode
assign_task_executor
express_task_interest
withdraw_task_interest
set_task_queue
give_up_task
select_task_candidate
start_task
submit_task_for_review
return_task_to_progress
complete_task_review
mark_task_unfulfilled
reopen_task
cancel_task
complete_umbrella_task
duplicate_task
create_campaign
update_campaign
set_campaign_active
create_completed_work_request
approve_completed_work_request
reject_completed_work_request
```

Authenticated direct state-changing grants are revoked after the command set is complete. Every command validates active membership, locks the affected rows where concurrency matters, records Task Activity, and commits state, Assignment/Candidature, points, and targeted in-app notifications atomically.

Task Activity timestamps are server-written and immutable. The **Task Manager** is the Task's creator, recorded server-side at creation. Every command writes its targeted in-app notifications in the same transaction: the Executor is notified of every change to their Task (content or deadline edits, return to progress, evaluation, cancellation, replacement); the Task Manager is notified of give-up, submission for review, new Candidates (as one coalesced queue count, without repeated push deliveries), and Subtask completion or an Umbrella becoming completable; pending Candidates are notified when selected or when the queue closes. Notifications never echo an action back to its actor; when the Task Manager is the actor or is no longer active, the Origin's managers receive the manager notifications instead. A BC/Moderator who merely has global override does not receive routine Project notifications unless they are otherwise a participant or intended manager.

Supabase Realtime is only a signal to invalidate TanStack Query caches. The browser refetches through RLS; Realtime payloads are not a second authorization path.

## Completed-work requests

A **Completed-work Request** contains a description and exactly one Origin chosen from the requester's memberships. It replaces both award requests and new-task requests. Legacy `task_requests` (`award` and `new_task`) is retired in the Task Tracker backend milestone; the request commands ship with the core lifecycle.

Approval creates the completed Task, requester Assignment, Evaluation, and Task-ledger entry in one transaction. Department requests are decided by local BCE/BC/Moderator; Project requests by the lead/BC/Moderator; Department-Team requests by local BCE/BC/Moderator; Independent-Team requests by BC/Moderator. Rejection requires a note. Concurrent or repeated decisions return a stable conflict.

## Consequences

- The legacy task/request tables need additive migrations, deterministic data conversion, and eventually narrower grants.
- Queue and lifecycle behavior becomes explicit, auditable, and safe under concurrent browser sessions.
- Project administration UI is deferred; seeded Projects may support Tracker development first.
- More server commands and tests are required, but every state transition has one authoritative transaction.
- Departments reference data changes in a migration: `diverse` (with Department Teams IT and Interne) and `secretariat` are added as coordination structures outside the Cup, and the legacy `it` department is retired with its members moved to the IT team.
- Project roster commands accept BC/Moderator as well as the active lead.
- The 2026-09-10 amendment adds no stored state beyond `unfulfilled`, the review-round marker, `campaign_id`, `parent_task_id`, and the Campaign and Completed-work Request tables; everything else in it is command behavior or derived presentation.

## Amendment (2026-09-23) — the manager selects every Executor of a public Task

Read §Assignment and candidate queue as follows. Expressing interest in a public Task always adds a pending Candidate at the end of the arrival-ordered Candidate Queue; nobody becomes Executor by arriving first. The Task Manager selects the Executor from the queue with `select_task_candidate`, choosing anyone in it and deciding whether the remaining Candidates stay pending or are closed. When an Executor gives up, or an edit removes the Executor, no Candidate is promoted: the Task returns to `todo` with its queue intact, the managers are notified, and the manager selects again. Direct Tasks are unchanged. The `first_come` assignment path is retired.

Managers learn of new Candidates through the coalesced queue-count notification; a selected Candidate receives the ordinary "Task nou" notification. The trade-off is one more manager action per public Task in exchange for the manager always choosing who does the work (grilling of 2026-09-23).

## Amendment (2026-09-23) — every open Opportunity is visible at its Group's Minimum Level

Read §Authorization's "eligible public Opportunities" as: every open Opportunity (public, queue open, not terminal) of a Group whose Minimum Level the Member satisfies, whatever its Audience. Audience decides only who may express interest: a local-Audience Opportunity of a Group the Member is not in is visible but not joinable. The Tracker presents the Opportunities of the Member's own Groups in the Group's colour and the rest greyed as **Other OSUBB Opportunities**, each band in deadline order, mirroring ADR-0008's Relevant / Other OSUBB Event treatment; Opportunities of the Organization Group are everyone's and take the OSUBB colour. Direct Tasks and Tasks with a closed queue stay invisible to non-participants. This widens the read policy on purpose so Members can see what other Groups do and apply to them (grilling of 2026-09-23).
