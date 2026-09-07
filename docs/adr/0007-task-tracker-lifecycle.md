# ADR-0007 — Projects, teams, and the Task Tracker lifecycle

- **Status:** Accepted (2026-09-07)
- **Deciders:** Alex Băncilă + team
- **Related:** ADR-0001, ADR-0003, ADR-0004, `CONTEXT.md`

## Context

The first Tracker schema models tasks as department/team rows with several assignees, an `open` status, and direct table updates. It cannot safely represent independent Projects, one accountable executor, an ordered volunteer queue, manager review, give-up history, or atomic evaluation. The old award/new-task request model also does not match how OSUBB wants to recognize already-completed work.

This ADR defines the target model. Migrations may reach it incrementally, but new work must not extend the retired model.

## Work origins

Every Task has exactly one **Origin**: a Department, a Project, or a Team.

A **Project** is independent of departments. It has an active/archived state, one lead, members, and zero or more Project Responsibles. The lead and every Responsible must also be an active Project member. BC or Moderator creates and archives Projects and chooses the lead. The lead manages membership and Responsibles. The lead and Responsibles manage Project work.

A **Department Team** has a parent Department. Local BCE, BC, or Moderator manages membership and planned work. Team members may submit Completed-work Requests but do not create planned tasks.

An **Independent Team** has no parent Department and no internal lead. Its active members jointly manage planned work. BC or Moderator manages membership and evaluates completed work.

The legacy `teams.lead_id` is retired. A Project lead is a real Project role, not a Team field.

## Task identity

In addition to its Origin, each Task has:

- an **Audience**: `local` or `org`;
- an **Assignment Mode**: `direct` or `public`;
- at most one active **Executor**;
- an exact `timestamptz` deadline displayed in `Europe/Bucharest`;
- a status: `todo`, `in_progress`, `in_review`, `completed`, or `cancelled`.

**Overdue** is derived from the deadline and an unfinished status. It is not stored. **Open** means a public Task has an open queue and no Executor; it is not a lifecycle status.

Origin, Audience, and Assignment Mode become immutable after the first Assignment or Candidature. Content, deadline, and proposed Difficulty remain editable with audit until final Evaluation.

## Assignment and candidate queue

Assignment History is append-only and permits at most one active Executor per Task.

For a direct Task, the Executor must be an active member of the Origin. For a public Task, the first eligible active member who expresses interest becomes Executor. Later members enter an ordered Candidate Queue. Self-selection is limited to active role levels 0–3. A local queue admits eligible Origin members; an organization-wide queue may also admit eligible members outside the Origin.

Candidates have `pending`, `selected`, `withdrawn`, or `closed` status. A pending Candidate may withdraw without a reason and may later rejoin at the end. Queueing remains available after the deadline until a manager closes the queue or the Task becomes completed or cancelled.

Closing the queue hides the Opportunity from nonparticipants. Existing participants retain their own state; Team members retain their broader Team visibility.

An Executor may Give Up only while `todo` or `in_progress` and must provide a reason. The oldest pending Candidate is promoted atomically. Give Up is blocked while `in_review`. A manager may replace the Executor only with a queued Candidate and decides whether remaining Candidates stay pending or are closed.

## Lifecycle and points

The normal transition is:

```text
todo → in_progress → in_review → completed
```

An authorized Reviewer may return `in_review` work to `in_progress` with a note. Final Evaluation sets the effective Difficulty and Rating and awards Task points only to the active Executor in the same transaction.

Reopening completed work requires a reason, returns it to `in_progress`, and reverses its Task-ledger effect atomically. Cancelling requires a reason and never deletes Assignments, Candidatures, Evaluations, or Task Activity.

The Points Ledger remains append-only. Ordinary members see only their own total and own ledger rows. BCE, BC, and Moderator receive leadership metrics and may open one member's authorized full Task Tracker. The leadership Leaderboard contains member name and Task points only. Anyone with completed Task history remains eligible regardless of their current Profile status. Department Cup includes Department Tasks and Department-Team Tasks; Project and Independent-Team work never contributes. Awards do not exist. Sanctions are a separate deferred feature and may affect a member's personal total.

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
express_task_interest
withdraw_task_interest
set_task_queue
give_up_task
select_task_candidate
start_task
submit_task_for_review
return_task_to_progress
complete_task_review
reopen_task
cancel_task
```

Authenticated direct state-changing grants are revoked after the command set is complete. Every command validates active membership, locks the affected rows where concurrency matters, records Task Activity, and commits state, Assignment/Candidature, points, and targeted in-app notifications atomically.

Task Activity timestamps are server-written and immutable. Notifications never echo an action back to its actor. Public-queue changes notify the Task creator in-app; later joins update the in-app queue count without creating repeated push deliveries. A BC/Moderator who merely has global override does not receive routine Project notifications unless they are otherwise a participant or intended manager.

Supabase Realtime is only a signal to invalidate TanStack Query caches. The browser refetches through RLS; Realtime payloads are not a second authorization path.

## Completed-work requests

A **Completed-work Request** contains a description and exactly one Origin chosen from the requester's memberships. It replaces both award requests and new-task requests.

Approval creates the completed Task, requester Assignment, Evaluation, and Task-ledger entry in one transaction. Department requests are decided by local BCE/BC/Moderator; Project requests by the lead/BC/Moderator; Department-Team requests by local BCE/BC/Moderator; Independent-Team requests by BC/Moderator. Rejection requires a note. Concurrent or repeated decisions return a stable conflict.

## Consequences

- The legacy task/request tables need additive migrations, deterministic data conversion, and eventually narrower grants.
- Queue and lifecycle behavior becomes explicit, auditable, and safe under concurrent browser sessions.
- Project administration UI is deferred; seeded Projects may support Tracker development first.
- More server commands and tests are required, but every state transition has one authoritative transaction.
