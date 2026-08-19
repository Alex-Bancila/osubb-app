-- 20260819172728_tasks_points_policies.sql
-- OSUBB backend — Epic 3.3: RLS policies for tasks, assignees, ledger, requests.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md
-- (§4.3 matrix rows for tasks/task_assignees/points_ledger/task_requests, §4.4 sketch).
-- Tested by supabase/tests/rls_tasks_points.test.sql (per-role subset of Epic 6.1).
--
-- One deliberate addition to the §4.4 sketch: tasks with status 'open' are
-- visible to every member — the screen map (§ Task Tracker) gives all roles a
-- "mine / open" tab, and claiming a task you cannot see is meaningless.

-- ==================== Helper functions ====================
-- SECURITY DEFINER (owner bypasses RLS) for two reasons:
--  * is_assigned breaks the tasks ⇄ task_assignees policy recursion;
--  * in_my_dept must not depend on member_departments policies (Epic 3.2).

create or replace function is_assigned(tid bigint) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.task_assignees ta
                  where ta.task_id = tid and ta.member_id = auth.uid());
$$;

create or replace function in_my_dept(member uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.member_departments md
                  where md.member_id = member and public.auth_in_dept(md.dept_id));
$$;

revoke execute on function is_assigned(bigint), in_my_dept(uuid) from public, anon;
grant execute on function is_assigned(bigint), in_my_dept(uuid) to authenticated;

-- ==================== tasks ====================
-- Read: yours, your dept's / your team's, open to claim, or everything at level ≥ 4.
create policy task_read on tasks for select to authenticated using (
     auth_level() >= 4
  or status = 'open'
  or auth_in_dept(dept_id)
  or (team_id is not null and auth_in_team(team_id))
  or is_assigned(id)
);

-- Create / grade / edit / delete: level ≥ 4 (responsabil and up).
create policy task_write on tasks for all to authenticated
  using (auth_level() >= 4) with check (auth_level() >= 4);

-- ==================== task_assignees ====================
-- Read: same visibility as the parent task (tasks RLS applies inside the subquery).
create policy assignee_read on task_assignees for select to authenticated using (
  exists (select 1 from tasks t where t.id = task_assignees.task_id)
);

-- Managers assign freely.
create policy assignee_manage on task_assignees for all to authenticated
  using (auth_level() >= 4) with check (auth_level() >= 4);

-- Any member may claim an *open* task for themselves.
create policy assignee_claim_open on task_assignees for insert to authenticated
  with check (
    member_id = auth.uid()
    and exists (select 1 from tasks t where t.id = task_assignees.task_id
                                        and t.status = 'open')
  );

-- ==================== points_ledger ====================
-- Read: own rows; level ≥ 4 also their dept's members; level ≥ 6 everything.
create policy ledger_read on points_ledger for select to authenticated using (
     member_id = auth.uid()
  or auth_level() >= 6
  or (auth_level() >= 4 and in_my_dept(member_id))
);

-- Insert: 'task' rows come only from the grading trigger (SECURITY DEFINER —
-- unaffected by this policy). Manual awards need level ≥ 4; sanctions are a
-- BC act (level ≥ 6, Plan IV.3) and must name who awarded them.
create policy ledger_award on points_ledger for insert to authenticated
  with check (
    auth_level() >= 4
    and reason in ('manual_award', 'sanction')
    and (reason <> 'sanction' or auth_level() >= 6)
    and awarded_by = auth.uid()
  );

-- No update/delete policies: the ledger is append-only for clients; only the
-- grading trigger (as table owner) may reconcile 'task' rows.

-- ==================== task_requests ====================
-- Read: your own requests; deciders see their dept's (level ≥ 4) or all (level ≥ 6).
create policy request_read on task_requests for select to authenticated using (
     from_member = auth.uid()
  or auth_level() >= 6
  or (auth_level() >= 4 and auth_in_dept(dept_id))
);

-- Any member may file a request — always as themselves, always pending.
create policy request_create on task_requests for insert to authenticated
  with check (
    from_member = auth.uid()
    and status = 'pending'
    and decided_by is null
  );

-- Deciding (approve/reject): level ≥ 4 within the same visibility as reads;
-- the decision must be signed by the decider.
create policy request_decide on task_requests for update to authenticated
  using (auth_level() >= 4 and (auth_level() >= 6 or auth_in_dept(dept_id)))
  with check (decided_by = auth.uid());
