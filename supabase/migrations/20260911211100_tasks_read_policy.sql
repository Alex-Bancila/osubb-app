-- #318: read Tasks by the ADR-0007 visibility rules. `tasks_read` replaces the
-- legacy `task_read` (20260911102000), which trusted the JWT — level >= 4 read
-- everything, `dept_ids`/`team_ids` claims stood in for membership — and knew
-- Executors only through the legacy `task_assignees` join. The whole rule
-- lives in private.can_read_task so the history read policies (#319) and the
-- Task commands (#327-#345) reuse one definition. `public.tasks_with_overdue`
-- is `security_invoker`, so it follows this policy with no change of its own.
--
-- Gate (every branch): organisation claims present (public.auth_is_member(),
-- house rule 12) AND a live `profiles.status = 'activ'` — ADR-0007
-- §Authorization: "Active OSUBB membership is mandatory for every operation".
-- Authority and memberships are read from live rows (profiles, roles,
-- member_departments, team_members, projects, project_members), never from
-- the JWT, so a demoted or deactivated member's unexpired token grants
-- nothing it no longer should. Then a caller reads a Task when ANY of:
--
--   R1 Global readers — live role level >= 5: BCE, BC, Moderator.
--      ADR-0007 §Authorization: "BCE reads all Tasks globally but writes only
--      in their Departments ..."; "BC/Moderator has global override". (Same
--      threshold #257 gave the Points Ledger.)
--   R2 Own work — any Assignment of the caller, current or ended, and any
--      Candidature, whatever its status (the tests private.is_task_executor
--      and private.is_task_candidate make). ADR-0007 §Authorization: "Role
--      levels 0–3 see their own Tasks, own Candidatures ..."; §Assignment and
--      candidate queue: after a queue closes "Existing participants retain
--      their own state"; #318: "own Tasks (active or past Executor), own
--      Candidatures".
--   R3 Origin managers — whoever may manage a Task reads it. Not a branch of
--      its own: every caller private.can_manage_origin (#321) admits is
--      already admitted here — BC, Moderator and local BCE by R1,
--      Independent-Team members by R4, an active Project's lead and
--      Responsibles by R5. rls_tasks_read_matrix.test.sql proves "manage
--      implies read" for every persona and fixture Task, so a widening of
--      can_manage_origin that outruns this rule fails there once a persona
--      exercises it.
--   R4 Team members — every Task whose Origin is their Team, Department Team
--      and Independent Team alike. ADR-0007 §Authorization: "Team members see
--      all Tasks and complete Task Activity for their Team"; §Assignment:
--      "Team members retain their broader Team visibility" after a queue
--      closes.
--   R5 Project lead and Responsibles — every Task of the Project, whether
--      the Project is active or archived (the tests private.is_project_lead
--      and private.is_project_responsible make, #271). ADR-0007
--      §Authorization: "The Project lead and Responsibles see all Project
--      Tasks"; #272: "Project relationships remain visible after archive so
--      historical Tracker records keep their context". Reading is not
--      managing: can_manage_task is false for an archived Project
--      (can_manage_project_work requires an active one).
--   R6 Eligible Opportunities — an ordinary Task (kind 'task') in public
--      Assignment Mode whose queue is open (queue_closed_at is null) and that
--      is not finished, to every active Member when its Audience is 'org' and
--      to members of the Origin itself when it is 'local': the Department's
--      members, the Team's members, the Project's members. CONTEXT.md
--      "Opportunity: A public Task whose Candidate Queue is open to eligible
--      Members"; ADR-0007 §Assignment: "A local queue admits eligible Origin
--      members; an organization-wide queue may also admit eligible members
--      outside the Origin", "Any active member admitted by the Audience may
--      express interest, regardless of role level", "Queueing remains
--      available after the deadline until a manager closes the queue or the
--      Task becomes completed or cancelled", "Closing the queue hides the
--      Opportunity from nonparticipants". An Executor does not end the
--      Opportunity: later members "enter an ordered Candidate Queue", so an
--      in-progress public Task with an open queue stays readable.
--      ('unfulfilled' is excluded with the other terminal outcomes;
--      tasks_queue_timestamp_state_check already forces a closed queue on
--      all three.)
--   R7 Subtasks — a Subtask whenever its Umbrella is readable by the same
--      caller (#318). can_read_task judges R1-R6 over the Task and, for a
--      Subtask, its Umbrella; an Umbrella never has a parent (#315,
--      tasks_umbrella_shape_ck), so this is a join, not recursion.
--
-- Nothing else. Plain Department members and plain Project members read only
-- R2 and R6 (ADR-0007 §Authorization: "Project members see their own Tasks
-- and Candidatures").
--
-- Cost: tasks_read evaluates can_read_task once per row, so its body makes
-- no nested security definer calls — it validates the caller once and
-- inlines the helpers' membership tests. With R2 and R3 as helper calls, a
-- plain member reading 5,000 Tasks took 2.5 s locally; inlined, 0.25 s.
--
-- Decisions where ADR-0007 is silent (the narrower reading, listed in the PR):
--   (a) A Department Team's local Opportunity admits the Team's members, not
--       the parent Department's: the Team is the Origin.
--   (b) An Umbrella is not readable merely because the caller executes or
--       queues for one of its Subtasks. Under R7 that would also hand them
--       every sibling Subtask.
--   (c) The organisation role Responsabil (level 4) is not named by ADR-0007
--       and reads like levels 0-3; the Project role Responsible is R5.
--   (d) The legacy `task_write` policy was FOR ALL, and a FOR ALL policy also
--       answers SELECT: it kept handing every Task to any JWT at level >= 4
--       (a Responsabil, or a demoted or deactivated member's unexpired token)
--       whatever `tasks_read` said. It is split into insert/update/delete
--       policies with the identical `auth_level() >= 4` predicate.
--       Consequences, verified empirically (psql, `begin; ... rollback;`, as
--       a level-4 Responsabil and as BC):
--       - INSERT: Postgres applies the table's SELECT policies to the new
--         row whenever the statement needs SELECT rights on it -- a
--         RETURNING clause, which is how PostgREST implements
--         `Prefer: return=representation` (supabase-js `.insert().select()`)
--         -- as an implicit WITH CHECK evaluated the same way the policy
--         reads any other row: a fresh query against `tasks`. `can_read_task`
--         resolves the row by id through such a query, and within the same
--         command the row it just inserted is not yet visible to it, so the
--         EXISTS it sits inside is always empty and the check always fails,
--         `42501`, for every caller INCLUDING BC and Moderator (their R1
--         branch never gets evaluated, because the whole predicate lives
--         inside that same EXISTS). A plain INSERT without RETURNING is
--         unaffected -- no SELECT policy is evaluated for it.
--       - UPDATE/DELETE: the same implicit SELECT check is added only when
--         the statement needs to read the target rows -- a WHERE clause, a
--         RETURNING clause, or a SET expression that references a column.
--         A blind `update public.tasks set status = 'cancelled';` with none
--         of those still reaches every row for a level >= 4 JWT, exactly as
--         under the old FOR ALL policy; only a statement that needs SELECT
--         is filtered to rows `tasks_read` admits, and silently (UPDATE 0
--         for the excluded rows), not with an error, unlike the INSERT case
--         above.
--       #345 drops the three with the rest of the legacy write path.

-- ==================== Predicates ====================

create function private.is_task_executor(p_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.task_assignments as assignment
         join public.profiles as caller on caller.id = assignment.member_id
        where assignment.task_id = p_task_id
          and assignment.member_id = (select auth.uid())
          and caller.status = 'activ'
     );
$$;

comment on function private.is_task_executor(bigint) is
  'Whether the active caller holds any Assignment for this Task, current or ended: past Executors keep reading their history (ADR-0007, #318).';

create function private.is_task_candidate(p_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.task_candidates as candidature
         join public.profiles as caller on caller.id = candidature.member_id
        where candidature.task_id = p_task_id
          and candidature.member_id = (select auth.uid())
          and caller.status = 'activ'
     );
$$;

comment on function private.is_task_candidate(bigint) is
  'Whether the active caller holds any Candidature for this Task — pending, selected, withdrawn, or closed. Participants retain their own state after a queue closes (ADR-0007).';

create function private.can_manage_task(p_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_manage_origin(task.dept_id, task.team_id, task.project_id)
      from public.tasks as task
     where task.id = p_task_id
  ), false);
$$;

comment on function private.can_manage_task(bigint) is
  'Whether the active caller may manage this Task: private.can_manage_origin over its Origin (a Subtask carries its Umbrella''s). False for a missing Task. Reused by the Task commands (#327-#345) -- but managing is not deciding: an Independent-Team member manages the Team''s Tasks yet must not evaluate them (ADR-0007). A command that decides/evaluates rather than manages needs its own narrower predicate, per 20260911210800_completed_work_requests.sql''s can_manage_origin header (#344''s decider is narrower than #318''s manager).';

create function private.can_read_task(p_task_id bigint)
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
         join public.tasks as target on target.id = p_task_id
         -- R7: judge the Task itself and, for a Subtask, its Umbrella.
         join public.tasks as task
           on task.id = target.id
           or task.id = target.parent_task_id
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
          and (
            -- R1 global readers: BCE, BC, Moderator by live role.
            caller_role.level >= 5

            -- R2 own work: any Assignment, current or ended
            -- (private.is_task_executor), any Candidature
            -- (private.is_task_candidate).
            or exists (
              select 1
                from public.task_assignments as assignment
               where assignment.task_id = task.id
                 and assignment.member_id = caller.id
            )
            or exists (
              select 1
                from public.task_candidates as candidature
               where candidature.task_id = task.id
                 and candidature.member_id = caller.id
            )

            -- R3 Origin managers: admitted by R1, R4 and R5 (see header).

            -- R4 Team members.
            or exists (
              select 1
                from public.team_members as membership
               where membership.team_id = task.team_id
                 and membership.member_id = caller.id
            )

            -- R5 Project lead (private.is_project_lead) and Responsibles
            -- (private.is_project_responsible), archived Projects included.
            or exists (
              select 1
                from public.projects as project
               where project.id = task.project_id
                 and project.leader_id = caller.id
            )
            or exists (
              select 1
                from public.project_members as membership
               where membership.project_id = task.project_id
                 and membership.member_id = caller.id
                 and membership.project_role = 'responsible'
            )

            -- R6 eligible Opportunities.
            or (
              task.kind = 'task'
              and task.assignment_mode = 'public'
              and task.queue_closed_at is null
              and task.status not in ('completed', 'unfulfilled', 'cancelled')
              and (
                task.audience = 'org'
                or (
                  task.audience = 'local'
                  and (
                    exists (
                      select 1
                        from public.member_departments as membership
                       where membership.dept_id = task.dept_id
                         and membership.member_id = caller.id
                    )
                    or exists (
                      select 1
                        from public.project_members as membership
                       where membership.project_id = task.project_id
                         and membership.member_id = caller.id
                    )
                    -- A Team-origin local Opportunity needs no branch here:
                    -- R4 above already admits every Team member
                    -- unconditionally (open queue or not, Opportunity or
                    -- plain direct Task), so this rule only has to
                    -- distinguish Department and Project Origins.
                  )
                )
              )
            )
          )
     );
$$;

comment on function private.can_read_task(bigint) is
  'The ADR-0007 Task visibility rule for the active caller (#318): R1 live BCE/BC/Moderator; R2 own Assignment (current or ended) or Candidature (any status); R4 member of the Task''s Team; R5 lead or Responsible of its Project, archived included; R6 an open, unfinished public Opportunity — Audience org for everyone, local for members of the Origin itself; R7 any of those on its Umbrella. Every private.can_manage_task caller (R3) is admitted by R1, R4 or R5. The one definition tasks_read and later policies/commands reuse.';

-- Policy predicate helpers (conventions §4): revoke from every role, grant
-- back to authenticated only. `private` is never exposed through PostgREST.
revoke execute on function private.is_task_executor(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.is_task_candidate(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_manage_task(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_read_task(bigint)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function private.is_task_executor(bigint) to authenticated;
grant execute on function private.is_task_candidate(bigint) to authenticated;
grant execute on function private.can_manage_task(bigint) to authenticated;
grant execute on function private.can_read_task(bigint) to authenticated;

-- ==================== Policies on public.tasks ====================

drop policy task_read on public.tasks;

create policy tasks_read
  on public.tasks
  for select
  to authenticated
  using ((select public.auth_is_member()) and private.can_read_task(id));

comment on policy tasks_read on public.tasks is
  'ADR-0007 Task visibility (#318), defined once in private.can_read_task: live BCE/BC/Moderator; own Assignments (current or ended) and Candidatures; Origin managers; Team members for their Team; Project lead/Responsibles for their Project (archived included); open, unfinished public Opportunities by Audience; and a Subtask whenever its Umbrella is readable.';

-- Decision (d): same predicate, no longer applied to SELECT.
drop policy task_write on public.tasks;

create policy tasks_create_legacy
  on public.tasks
  for insert
  to authenticated
  with check (public.auth_level() >= 4);

create policy tasks_update_legacy
  on public.tasks
  for update
  to authenticated
  using (public.auth_level() >= 4)
  with check (public.auth_level() >= 4);

create policy tasks_delete_legacy
  on public.tasks
  for delete
  to authenticated
  using (public.auth_level() >= 4);

comment on policy tasks_create_legacy on public.tasks is
  'Legacy direct Task insert for JWT level >= 4, split out of task_write by #318 so it no longer answers SELECT. Retired by #345.';
comment on policy tasks_update_legacy on public.tasks is
  'Legacy direct Task update for JWT level >= 4, split out of task_write by #318 so it no longer answers SELECT. A statement that needs SELECT on its targets (a WHERE, a RETURNING, or a SET expression referencing a column) reaches only rows tasks_read admits; a blind UPDATE with none of those still reaches every row (see the migration header). Retired by #345.';
comment on policy tasks_delete_legacy on public.tasks is
  'Legacy direct Task delete for JWT level >= 4, split out of task_write by #318 so it no longer answers SELECT. A statement that needs SELECT on its targets (a WHERE or a RETURNING) reaches only rows tasks_read admits; a blind DELETE with neither still reaches every row (see the migration header). Retired by #345.';

-- task_read was the last consumer of the legacy task_assignees predicate.
-- private.task_is_unassigned stays: claim_open_task still calls it (#345).
drop function public.is_assigned(bigint);
