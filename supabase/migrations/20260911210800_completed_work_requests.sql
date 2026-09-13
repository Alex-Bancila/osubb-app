-- #321: completed_work_requests — the table and read policy that replace
-- task_requests (award/new_task) for recognizing already-completed work
-- (ADR-0007 Sec "Completed-work requests"). Rows change status exactly once
-- (pending -> approved|rejected); decided_at is the change record, so this
-- table gets no updated_at (ADR-0007 timestamps convention, house rule 2/7).
--
-- Also introduces the shared origin-authority predicate
-- private.can_manage_origin(dept_id, team_id, project_id) — get it right
-- once here and reuse it for READING/MANAGING an Origin's work, never for
-- deciding a request:
--   - #343 create_campaign / update_campaign / set_campaign_active — a
--     Campaign's owner is always a Department (never a Team or Project), so
--     only this predicate's Department branch is the relevant shape, not
--     the whole predicate;
--   - #318 the rewritten Task read policy;
--   - #319 read policies for task_assignments/task_candidates/task_activity/
--     task_evaluations;
--   - #320 notification managers (who receives an Origin's routine
--     notifications) needs a member-id variant of this predicate — this one
--     only answers "can auth.uid() manage this Origin", not "can member X",
--     so #320 cannot call it as-is for an arbitrary recipient;
--   - #344 (approve_completed_work_request / reject_completed_work_request)
--     must NOT reuse this predicate to decide a Request. ADR-0007 gives the
--     decision to roles narrower than "who manages the Origin's work": an
--     Independent Team is jointly *managed* by every active member, but its
--     Requests are *decided* by BC/Moderator only; a Project is *managed* by
--     its lead and every Responsible, but its Requests are *decided* by the
--     lead/BC/Moderator only — a Responsible does not decide. #344 needs its
--     own, narrower decider predicate.
-- ADR-0007 Authorization: Department and Department-Team origins are managed
-- by local BCE (plus BC/Moderator globally); Independent-Team origins are
-- jointly managed by their active members (plus BC/Moderator); Project
-- origins are managed by the lead and Responsibles (plus BC/Moderator) via
-- the existing private.can_manage_project_work (#271).

create function private.can_manage_origin(
  p_dept_id text,
  p_team_id text,
  p_project_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    num_nonnulls(p_dept_id, p_team_id, p_project_id) = 1
    and coalesce(public.auth_is_member(), false)
    and exists (
      select 1
        from public.profiles as actor
        join public.roles as actor_role on actor_role.id = actor.role
       where actor.id = (select auth.uid())
         and actor.status = 'activ'
         and (
           -- BC/Moderator global override. Live database role and level win
           -- over a stale JWT claim (house rule 12; can_manage_project_work
           -- below applies the same rule for the Project branch).
           actor_role.level >= 6

           -- Department origin: a live local BCE of that Department.
           or (
             p_dept_id is not null
             and actor.role = 'bce'
             and exists (
               select 1
                 from public.member_departments as membership
                where membership.member_id = actor.id
                  and membership.dept_id = p_dept_id
             )
           )

           -- Department-Team origin (a Team whose dept_id is set): the same
           -- test against the Team's parent Department, not the Team itself.
           or (
             p_team_id is not null
             and actor.role = 'bce'
             and exists (
               select 1
                 from public.teams as team
                 join public.member_departments as membership
                   on membership.dept_id = team.dept_id
                where team.id = p_team_id
                  and team.dept_id is not null
                  and membership.member_id = actor.id
             )
           )

           -- Independent Team (dept_id is null): active members jointly
           -- manage their own Team's work, whatever their role level.
           or (
             p_team_id is not null
             and exists (
               select 1
                 from public.teams as team
                 join public.team_members as membership
                   on membership.team_id = team.id
                where team.id = p_team_id
                  and team.dept_id is null
                  and membership.member_id = actor.id
             )
           )

           -- Project origin: reuse the existing helper (lead, Responsible,
           -- BC/Moderator, project must be active) rather than re-deriving it.
           or (
             p_project_id is not null
             and private.can_manage_project_work(p_project_id)
           )
         )
    );
$$;

comment on function private.can_manage_origin(text, text, bigint) is
  'Whether the active caller may manage work for exactly one named Origin: Department (live local BCE), Department-Team (live local BCE of its parent Department), Independent Team (active team member), or Project (private.can_manage_project_work). BC/Moderator (live role level >= 6) always qualifies. Returns false for zero, two, or three non-null arguments, and for any origin the caller cannot manage.';

revoke execute on function private.can_manage_origin(text, text, bigint)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function private.can_manage_origin(text, text, bigint)
  to authenticated;

-- ==================== completed_work_requests ====================

create table public.completed_work_requests (
  id            bigint generated always as identity primary key,
  requester_id  uuid not null references public.profiles (id),
  dept_id       text references public.departments (id),
  team_id       text references public.teams (id),
  project_id    bigint references public.projects (id),
  description   text not null
                constraint completed_work_requests_description_ck check (
                  description ~ '[^[:space:]]'),
  status        text not null default 'pending'
                constraint completed_work_requests_status_ck check (
                  status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references public.profiles (id),
  decided_at    timestamptz,
  decision_note text,
  task_id       bigint references public.tasks (id),
  created_at    timestamptz not null default now(),

  -- Exactly one Origin, same shape as tasks_exactly_one_origin_check (#284).
  constraint completed_work_requests_origin_ck check (
    num_nonnulls(dept_id, team_id, project_id) = 1),

  -- A still-pending Request carries no decision trace, no decision note,
  -- and no created Task.
  constraint completed_work_requests_pending_shape_ck check (
    status <> 'pending'
    or (
      decided_by is null
      and decided_at is null
      and decision_note is null
      and task_id is null
    )
  ),

  -- Approval must name its decider, its moment, and the Task it created
  -- (ADR-0007: "Approval creates the completed Task ... in one transaction").
  -- decision_note is optional on approval, but never blank when present —
  -- guarded with `is null` ahead of the regex (same reasoning as the
  -- rejected-shape clause below: `null ~ pattern` evaluates to null, not
  -- false, so a bare regex cannot itself reject a blank value read back as
  -- "unknown"; here the guard's role is to make the "null or non-blank"
  -- disjunction explicit rather than to admit nulls through the regex).
  constraint completed_work_requests_approved_shape_ck check (
    status <> 'approved'
    or (
      decided_by is not null
      and decided_at is not null
      and task_id is not null
      and (decision_note is null or decision_note ~ '[^[:space:]]')
    )
  ),

  -- Rejection must name its decider, its moment, and a non-blank reason, and
  -- names no Task — only approval creates one (ADR-0007: "Rejection
  -- requires a note").
  -- decision_note is checked with an explicit `is not null` ahead of the
  -- regex: `null ~ pattern` evaluates to null, not false, and a CHECK
  -- constraint only rejects a row when its expression is false — a bare
  -- `decision_note ~ '[^[:space:]]'` would let a rejection with no
  -- decision_note through as "unknown" rather than reject it.
  constraint completed_work_requests_rejected_shape_ck check (
    status <> 'rejected'
    or (
      decided_by is not null
      and decided_at is not null
      and decision_note is not null
      and decision_note ~ '[^[:space:]]'
      and task_id is null
    )
  ),

  constraint completed_work_requests_decided_chronology_ck check (
    decided_at is null or decided_at >= created_at
  )
);

create index completed_work_requests_requester_idx
  on public.completed_work_requests (requester_id);
create index completed_work_requests_status_idx
  on public.completed_work_requests (status);
create index completed_work_requests_dept_idx
  on public.completed_work_requests (dept_id);
create index completed_work_requests_team_idx
  on public.completed_work_requests (team_id);
create index completed_work_requests_project_idx
  on public.completed_work_requests (project_id);

-- One approval per Task: approval links task_id to the Task it created
-- (#344), and a Task is the completed record of exactly one Request.
create unique index completed_work_requests_task_uidx
  on public.completed_work_requests (task_id)
  where task_id is not null;

alter table public.completed_work_requests enable row level security;

create policy completed_work_requests_read
  on public.completed_work_requests
  for select
  to authenticated
  using (
    public.auth_is_member()
    -- Live status, not just a live JWT (house rule 12, ledger_read
    -- precedent in 20260910123134/20260910144445): a deactivated
    -- requester's still-unexpired token must stop reading their own
    -- Requests immediately, not merely once can_manage_origin says no.
    and exists (
      select 1
        from public.profiles as caller
       where caller.id = (select auth.uid())
         and caller.status = 'activ'
    )
    and (
      requester_id = (select auth.uid())
      or private.can_manage_origin(dept_id, team_id, project_id)
    )
  );

comment on policy completed_work_requests_read on public.completed_work_requests is
  'A requester (live status = activ, checked here so a deactivated requester''s unexpired token stops reading immediately) reads their own Completed-work Requests; a caller who may manage the Request''s Origin (private.can_manage_origin) reads it too — including a plain Independent-Team member and a Project Responsible, who may read but must not decide. BC/Moderator read every Request via that same predicate. Reading is broader than deciding: ADR-0007 narrows who may approve or reject (#344) to local BCE/BC/Moderator (Department, Department-Team), the lead/BC/Moderator (Project), or BC/Moderator alone (Independent Team).';

-- No client write path exists yet — approve_completed_work_request and
-- reject_completed_work_request are #344. 20260819171628_capabilities_and_rls.sql's
-- default privileges hand every new public table INSERT/UPDATE/DELETE for
-- authenticated automatically, so this must be revoked explicitly, not
-- merely left un-widened (same reasoning as task_evaluations, #316).
revoke all on table public.completed_work_requests
  from public, anon, authenticated, service_role;
revoke all on sequence public.completed_work_requests_id_seq
  from public, anon, authenticated, service_role;

grant select on table public.completed_work_requests to authenticated, service_role;

comment on table public.completed_work_requests is
  'A member''s request to recognize already-completed work against exactly one Origin (Department, Department-Team, Independent Team, or Project). Replaces the legacy task_requests award/new_task kinds (ADR-0007). Approval/rejection commands are #344.';

comment on column public.completed_work_requests.description is
  'Requester narrative of the completed work; required and must be non-blank.';

comment on column public.completed_work_requests.status is
  'pending (default), approved, or rejected. Each status implies a fixed shape for decided_by/decided_at/decision_note/task_id — see the *_shape_ck constraints.';

comment on column public.completed_work_requests.decided_by is
  'The member who approved or rejected this Request. Deciding is narrower than managing the Origin (ADR-0007): local BCE/BC/Moderator decide Department and Department-Team Requests, the lead/BC/Moderator decide Project Requests, and only BC/Moderator decide Independent-Team Requests — not every Origin manager who can read this row. #344''s commands enforce that narrower rule; this column only records who did. Null while pending.';

comment on column public.completed_work_requests.decided_at is
  'When the Request was decided. Null while pending; required and >= created_at once decided.';

comment on column public.completed_work_requests.decision_note is
  'Required and non-blank on rejection (ADR-0007: "Rejection requires a note"); optional on approval.';

comment on column public.completed_work_requests.task_id is
  'The completed Task created by approval, in the same transaction as the Evaluation and Task-ledger entry (ADR-0007). Required once approved; null otherwise.';
