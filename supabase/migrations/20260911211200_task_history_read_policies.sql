-- #319: read policies for the four Task history tables — task_assignments
-- (#289), task_candidates (#291), task_activity (#292), task_evaluations
-- (#316) — all created deny-by-default, awaiting this policy. ADR-0007
-- §Authorization: "Role levels 0-3 see their own Tasks, own Candidatures ...";
-- "Team members see all Tasks and complete Task Activity for their Team";
-- BCE/BC/Moderator read/override globally. private.can_read_task (#318) is
-- reused unmodified as the gate: a caller must be able to read the parent
-- Task before any history row of it is even considered.
--
-- One `<table>_read` policy per table, on `authenticated`, each starting
-- with `(select public.auth_is_member())` (house rule 12), then
-- `private.can_read_task(task_id)`, then an OR of:
--   - the row is the caller's own: `member_id` (task_assignments,
--     task_candidates), `actor_id` (task_activity), `evaluated_by`
--     (task_evaluations);
--   - `private.can_manage_task(task_id)` — a manager of the Task sees all
--     four tables for it (issue #319 AC: "Manager sees all four tables for
--     managed Tasks"), reusing the T16 predicate unchanged;
--   - `private.is_global_task_reader()` (new, decision (a) below);
--   - `private.is_task_team_member(task_id)` (new) — task_activity ONLY,
--     decision (b) below.
--
-- Decision (a) — global readers see every history row, all four tables.
-- ADR-0007 says "BCE reads all Tasks globally ..." and "BC/Moderator has
-- global override"; #260 (Leadership: expose one member's authorized Task
-- Tracker drill-down) is blocked by #319 specifically because it needs
-- "evaluation history" for a BCE-authorized read of someone else's Tracker.
-- A drill-down that could see every Task (R1 of can_read_task) but none of
-- its Assignments/Candidatures/Activity/Evaluations would not satisfy that
-- AC, so R1 is extended to the history tables via the new
-- private.is_global_task_reader() (mirrors can_read_task's R1 branch: live
-- profiles/roles join, `caller_role.level >= 5`, never the JWT — house
-- rule 12, same staleness reasoning as T16 decision (d)).
--
-- Decision (b) — "complete Task Activity" is taken literally: ADR-0007's
-- sentence names task_activity only ("Team members see all Tasks and
-- complete Task Activity for their Team"), not task_assignments,
-- task_candidates or task_evaluations. Per the brief's instruction to take
-- the narrower reading where the ADR is silent, a Team member who is not
-- the row's own actor and does not manage the Task sees the Team's
-- task_activity rows in full, but gets no extra branch on the other three
-- tables — there they read only their own rows (already covered by
-- can_read_task's R4 granting them the Task itself, R2 covering their own
-- Assignment/Candidature). New helper private.is_task_team_member(task_id).
--
-- Decision (c) — task_evaluations "own row" is `evaluated_by` (the
-- evaluator), not the Executor being evaluated, matching the brief's
-- literal column mapping ("member_id/actor_id/evaluated_by as applies") and
-- issue #319's AC, which lists what the Executor sees as "their assignment
-- and activity" and does not mention Evaluations. An Executor who neither
-- evaluated their own work (ADR-0007: "the lead may evaluate their own
-- Task") nor manages the Task does not read the raw Evaluation row through
-- this policy; they still read their own point total through the existing
-- points_ledger / my_points path, which this PR does not touch.
--
-- ==================== Candidate privacy (issue #319) ====================
-- RLS cannot hide a column, so task_candidates_read admits only the
-- caller's own row (plus manager/global-reader rows) — a fellow pending
-- candidate never appears as a row to another candidate. Queue position and
-- the pending count are instead exposed through `public.task_queue_summary`,
-- a `security_invoker` view (conventions §4's default — task_queue_summary
-- is not on the member_points/profiles_contact exception list) restricted
-- to Tasks the caller can read (it selects from `public.tasks`, whose own
-- `tasks_read` RLS already does this restriction — no separate predicate is
-- needed in the view body). Because the view is security_invoker, any
-- computation it does over task_candidates runs AS THE CALLER, so a direct
-- `count(*)`/`row_number()` there would be filtered by task_candidates_read
-- down to the caller's own row alone — useless for an aggregate. Both
-- figures are instead computed by SECURITY DEFINER helpers that read
-- task_candidates as the table owner (bypassing its RLS the same way
-- can_read_task already bypasses tasks' RLS to resolve a Task by id):
--   - private.queue_position(p_task_id, p_member_id) — the brief's exact
--     signature: 1-based position over status = 'pending' ordered by
--     (joined_at, id). Self-gated: answers only when p_member_id is the
--     caller, or the caller manages the Task, or is a global reader —
--     otherwise null. Without this gate, granting EXECUTE to authenticated
--     (required so the security_invoker view can call it as the caller)
--     would let anyone probe an arbitrary member's queue position directly
--     (`select private.queue_position(<task>, '<victim>')`), defeating the
--     privacy goal the view exists for. The view itself always passes its
--     own `(select auth.uid())`, so the gate is transparent to it.
--   - private.pending_candidate_count(p_task_id) — a second helper (the
--     brief names only queue_position; this one is this migration's
--     addition, following the same shape) returning the pending count.
--     Gated on private.can_read_task(p_task_id) only — a count, unlike a
--     position, carries no per-identity information, so anyone who can
--     read the Task may see how many are queued; anyone else gets null.
-- Both are policy-predicate-shaped helpers (return a scalar the caller
-- consumes, not a boolean, but same revoke/grant idiom): four-role revoke,
-- then `grant execute to authenticated` — required, not optional, because
-- task_queue_summary is security_invoker and therefore runs every function
-- it calls as the querying role.

-- ==================== New predicate helpers ====================

create function private.is_global_task_reader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.profiles as caller
         join public.roles as caller_role on caller_role.id = caller.role
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
          and caller_role.level >= 5
     );
$$;

comment on function private.is_global_task_reader() is
  'Whether the active caller is a global Task reader by live role — BCE, BC, Moderator (level >= 5), the same threshold as can_read_task''s R1. Used to extend that global-read rule to the Task history tables (#319, decision (a)).';

create function private.is_task_team_member(p_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.tasks as task
         join public.team_members as membership on membership.team_id = task.team_id
         join public.profiles as caller on caller.id = membership.member_id
        where task.id = p_task_id
          and membership.member_id = (select auth.uid())
          and caller.status = 'activ'
     );
$$;

comment on function private.is_task_team_member(bigint) is
  'Whether the active caller is a member of this Task''s Team (Department Team or Independent Team). Backs task_activity_read''s "complete Task Activity for their Team" branch only (#319, decision (b)) — not extended to the other three history tables.';

revoke execute on function private.is_global_task_reader()
  from public, anon, authenticated, service_role;
revoke execute on function private.is_task_team_member(bigint)
  from public, anon, authenticated, service_role;

grant execute on function private.is_global_task_reader() to authenticated;
grant execute on function private.is_task_team_member(bigint) to authenticated;

-- ==================== Grants: the four tables now have a read path ====================

grant select on table public.task_assignments to authenticated;
grant select on table public.task_candidates to authenticated;
grant select on table public.task_activity to authenticated;
grant select on table public.task_evaluations to authenticated;

-- ==================== Policies ====================

create policy task_assignments_read
  on public.task_assignments
  for select
  to authenticated
  using (
    (select public.auth_is_member())
    and private.can_read_task(task_id)
    and (
      member_id = (select auth.uid())
      or private.can_manage_task(task_id)
      or private.is_global_task_reader()
    )
  );

comment on policy task_assignments_read on public.task_assignments is
  'ADR-0007 (#319): the caller''s own Assignment (current or ended), every Assignment of a Task they manage, or every Assignment when they are a global Task reader (BCE/BC/Moderator). No Team-member branch — decision (b): ADR-0007 grants Team members "complete Task Activity", not complete Assignment history.';

create policy task_candidates_read
  on public.task_candidates
  for select
  to authenticated
  using (
    (select public.auth_is_member())
    and private.can_read_task(task_id)
    and (
      member_id = (select auth.uid())
      or private.can_manage_task(task_id)
      or private.is_global_task_reader()
    )
  );

comment on policy task_candidates_read on public.task_candidates is
  'ADR-0007 (#319): the caller''s own Candidature (any status), every Candidature of a Task they manage, or every Candidature when they are a global Task reader. Fellow candidates never see each other''s row here (candidate privacy, issue #319) — queue position and the pending count are exposed instead through public.task_queue_summary. No Team-member branch (decision (b)).';

create policy task_activity_read
  on public.task_activity
  for select
  to authenticated
  using (
    (select public.auth_is_member())
    and private.can_read_task(task_id)
    and (
      actor_id = (select auth.uid())
      or private.can_manage_task(task_id)
      or private.is_global_task_reader()
      or private.is_task_team_member(task_id)
    )
  );

comment on policy task_activity_read on public.task_activity is
  'ADR-0007 (#319): the caller''s own actor rows, every event of a Task they manage, every event when they are a global Task reader, or — decision (b), the literal ADR-0007 text — every event of a Task belonging to their Team ("Team members see all Tasks and complete Task Activity for their Team").';

create policy task_evaluations_read
  on public.task_evaluations
  for select
  to authenticated
  using (
    (select public.auth_is_member())
    and private.can_read_task(task_id)
    and (
      evaluated_by = (select auth.uid())
      or private.can_manage_task(task_id)
      or private.is_global_task_reader()
    )
  );

comment on policy task_evaluations_read on public.task_evaluations is
  'ADR-0007 (#319): the caller''s own Evaluations as evaluator, every Evaluation of a Task they manage, or every Evaluation when they are a global Task reader. Decision (c): "own row" is evaluated_by, not the Executor being evaluated — the brief''s literal column mapping and issue #319''s AC (silent on the Executor seeing raw Evaluations). No Team-member branch (decision (b)).';

-- ==================== Candidate-queue privacy view ====================

create function private.queue_position(p_task_id bigint, p_member_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select ordered.rank::integer
    from (
      select candidate.member_id,
             row_number() over (order by candidate.joined_at, candidate.id) as rank
        from public.task_candidates as candidate
       where candidate.task_id = p_task_id
         and candidate.status = 'pending'
    ) as ordered
   where ordered.member_id = p_member_id
     and (
       p_member_id = (select auth.uid())
       or private.can_manage_task(p_task_id)
       or private.is_global_task_reader()
     );
$$;

comment on function private.queue_position(bigint, uuid) is
  '1-based position of p_member_id in p_task_id''s pending Candidate Queue, ordered (joined_at, id); null when not pending. Self-gated: answers only for the caller''s own id, a manager of the Task, or a global Task reader — otherwise null, so granting EXECUTE to authenticated (required for the security_invoker task_queue_summary view) cannot be used to probe another candidate''s position (#319 candidate privacy).';

create function private.pending_candidate_count(p_task_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.task_candidates as candidate
   where candidate.task_id = p_task_id
     and candidate.status = 'pending'
     and private.can_read_task(p_task_id);
$$;

comment on function private.pending_candidate_count(bigint) is
  'Count of pending Candidates for p_task_id, or null when the caller cannot read the Task. A count carries no per-identity information, so unlike queue_position it is not further self-gated. Bypasses task_candidates RLS (security definer, reads as the table owner) so the count reflects every pending candidate, not just the caller''s own visible rows.';

revoke execute on function private.queue_position(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.pending_candidate_count(bigint)
  from public, anon, authenticated, service_role;

grant execute on function private.queue_position(bigint, uuid) to authenticated;
grant execute on function private.pending_candidate_count(bigint) to authenticated;

create view public.task_queue_summary
with (security_invoker = on) as
select
  task.id as task_id,
  private.pending_candidate_count(task.id) as pending_count,
  private.queue_position(task.id, (select auth.uid())) as my_position
  from public.tasks as task;

comment on view public.task_queue_summary is
  'Per-Task Candidate Queue summary for the current caller: pending_count (visible to anyone who can read the Task) and my_position (the caller''s own 1-based pending position, null if not queued). security_invoker, so selecting from public.tasks here is already restricted by tasks_read to Tasks the caller can read — no separate predicate is needed. Both columns are computed by SECURITY DEFINER helpers that bypass task_candidates RLS on purpose (#319 candidate privacy): a fellow candidate reads their own position and the total count, never another candidate''s identity or row.';

revoke all on public.task_queue_summary from public, anon;
grant select on public.task_queue_summary to authenticated;
