-- #915: approving a Completed-work Request shapes the Task first, and a manager adds a completed Task for a Group member directly.
--
-- Two ways to write a completed Task, one path for its points. Both commands
-- insert the Task, open the Assignment through private.open_task_assignment
-- and hand the Evaluation to private.evaluate_task -- still the ONLY place
-- points are computed and written (ADR-0007, the command wave).
--
-- 1. approve_completed_work_request gains six optional arguments (p_title,
--    p_description, p_group_id, p_link_label, p_link_url, p_campaign_id); null
--    keeps what the Request says (a Request has no link and no Campaign, so
--    null there means none). A blank description clears the Task's details.
--    No deadline and no Audience: a completed Task is not an Opportunity, so
--    it stays local and direct and is deadlined at the approval instant, as
--    before. Moving the work to another Group is judged by the same rule the
--    direct command uses (below), with the Request's own refusal
--    `42501 request_decide_forbidden` for authority.
-- 2. public.create_completed_task: a Group's manager records work a member has
--    already done, choosing the same fields plus the Executor. Atomically the
--    Task (completed), the Assignment, the Evaluation and the points; the
--    Executor hears about it once (evaluate_task's "Task evaluat"), because
--    open_task_assignment's "Task nou" is skipped for the new via
--    'completed_task'. It spends create_task's daily cap (its 'created'
--    activity row counts).
--
-- One decider rule. private.request_deciders was the Request's decider set;
-- its predicate moves into private.is_work_decider(group, executor, actor) so
-- a Group that is not the Request's own can be judged by exactly the same
-- rule, and request_deciders now reads it (no behaviour change). A completed
-- Task's Group must be one where:
--   - the actor may manage work (private.require_group_work_manager, with its
--     share locks) -- 42501 task_manage_forbidden / request_decide_forbidden;
--   - the Group is active -- PT409 group_archived (BC passes the gate on an
--     archived Group, so this is its own refusal);
--   - the Executor is a live active Member (PT400 invalid_executor), not BC or
--     the Moderator on the direct path (PT409 executor_role_excluded; F-27:
--     they hold no Task work), a member of the Group or of a Group below it
--     (its Group Audience, private.group_audience -- PT409
--     executor_not_group_member) and at or above its Minimum Level (PT409
--     executor_below_min_level; unreachable while the roster invariants hold,
--     kept as the command's own check);
--   - the actor is in the Group's decider set for that Executor -- which never
--     contains the Executor, so nobody awards themselves, and a Group
--     Responsible never awards another Responsible or a Manager (42501
--     task_evaluate_forbidden / request_decide_forbidden).
--
-- Two reads serve the pickers from the same predicate, so the app never
-- offers a Group or a volunteer the commands would refuse:
-- public.completed_task_groups(executor) and
-- public.completed_task_executors(group).
--
-- Rebuilt from main's latest bodies: approve_completed_work_request_impl
-- (20260923231125), request_deciders (20260919185516), open_task_assignment
-- (20260929100000).

-- ==================== The decider rule, for any Group ====================
create function private.is_work_decider(p_group_id bigint, p_executor uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as profile
      join public.roles as role on role.id = profile.role
      join public.groups as grp on grp.id = p_group_id
     where profile.id = p_actor
       and profile.status = 'activ'
       and p_actor is distinct from p_executor
       and (role.level >= 6
            or (grp.status = 'active' and exists (
                  select 1
                    from public.group_members as gm
                   where gm.member_id = profile.id
                     and grp.path @> array[gm.group_id]
                     and (gm.group_role = 'manager'
                          or (gm.group_role = 'responsible'
                              and coalesce(private.group_role_of(p_group_id, p_executor), 'member')
                                    not in ('manager', 'responsible')))))));
$$;

comment on function private.is_work_decider(bigint, uuid, uuid) is
  '#915: the one decider rule for completed work in a Group (formerly inline in private.request_deciders): p_actor is a live activ Member other than p_executor and is BC/Moderator (level >= 6, any Group status) or, on an ACTIVE Group, a Group Manager on its path, or a Group Responsible on its path when p_executor holds no Manager/Responsible role there. Internal: executable by no client role.';

revoke execute on function private.is_work_decider(bigint, uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.work_deciders(p_group_id bigint, p_executor uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id
    from public.profiles as profile
   where profile.status = 'activ'
     and private.is_work_decider(p_group_id, p_executor, profile.id);
$$;

comment on function private.work_deciders(bigint, uuid) is
  '#915: every live Member private.is_work_decider accepts for p_executor''s completed work in p_group_id. Internal: executable by no client role.';

revoke execute on function private.work_deciders(bigint, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.request_deciders(p_request_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select decider
    from public.completed_work_requests as request,
         private.work_deciders(request.group_id, request.requester_id) as decider
   where request.id = p_request_id;
$$;

comment on function private.request_deciders(bigint) is
  'The single live decider and notification set: BC/Moderator and active ancestor Group Managers; Group Responsibles only for ordinary requesters. Always excludes the requester, including BC/Moderator. Since #915 it is private.work_deciders over the Request''s own Group and requester, so a Request moved to another Group is decided by the same rule.';

-- ==================== Who may be credited with completed work ====================
-- The rule has three parts, split so the pickers pay for a Group Audience once
-- per Group rather than once per candidate: the caller's standing in the Group
-- (can_award_in_group), the candidate's place in it (the Group Audience plus
-- meets_group_min_level) and the decider rule (is_work_decider).
create function private.meets_group_min_level(p_group_id bigint, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce(private.actor_level(p_member), -1) >= grp.min_level
      from public.groups as grp
     where grp.id = p_group_id
  ), false);
$$;

comment on function private.meets_group_min_level(bigint, uuid) is
  '#915: p_member is a live activ Member whose live level is at or above p_group_id''s Minimum Level. Internal: executable by no client role.';

revoke execute on function private.meets_group_min_level(bigint, uuid)
  from public, anon, authenticated, service_role;

create function private.can_award_in_group(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and coalesce(private.can_manage_group_work(p_group_id), false)
     and exists (select 1 from public.groups as grp
                  where grp.id = p_group_id and grp.status = 'active');
$$;

comment on function private.can_award_in_group(bigint) is
  '#915: the caller may record completed work in p_group_id at all -- organization claims, the manage-work authority there, and an active Group -- before any candidate is judged. Internal: executable by no client role.';

revoke execute on function private.can_award_in_group(bigint)
  from public, anon, authenticated, service_role;

create function private.can_award_completed_work(p_group_id bigint, p_executor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_award_in_group(p_group_id)
     and private.meets_group_min_level(p_group_id, p_executor)
     and private.is_work_decider(p_group_id, p_executor, (select auth.uid()))
     and exists (select 1 from private.group_audience(p_group_id) as member_id
                  where member_id = p_executor);
$$;

comment on function private.can_award_completed_work(bigint, uuid) is
  '#915: the caller may record completed work of p_executor in p_group_id -- the whole rule create_completed_task and a Group-changing approval enforce (manage work there, an active Group, an Executor in its Group Audience at or above its Minimum Level, the caller in the decider set), without their locks. Read by public.completed_task_groups, one Group at a time. Callable predicate, not a write path.';

revoke execute on function private.can_award_completed_work(bigint, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_award_completed_work(bigint, uuid) to authenticated;

create function private.completed_work_executors(p_group_id bigint)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The caller's standing once, then the Group Audience once, then the
  -- per-candidate checks: the same rule as can_award_completed_work.
  if not private.can_award_in_group(p_group_id) then
    return;
  end if;
  return query
    select member_id
      from private.group_audience(p_group_id) as member_id
     where private.meets_group_min_level(p_group_id, member_id)
       and private.is_work_decider(p_group_id, member_id, (select auth.uid()));
end;
$$;

comment on function private.completed_work_executors(bigint) is
  '#915: every Member the caller may credit with completed work in p_group_id -- exactly those private.can_award_completed_work accepts, computed with one Group Audience. Read by public.completed_task_executors. Callable set, not a write path.';

revoke execute on function private.completed_work_executors(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.completed_work_executors(bigint) to authenticated;

create function private.require_completed_work_group(
  p_group_id           bigint,
  p_executor           uuid,
  p_manage_forbidden   text,
  p_decide_forbidden   text,
  p_exclude_leadership boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role  public.member_role;
begin
  -- Authority to manage work in the Group, with the profile and roster rows
  -- it rests on held FOR SHARE until the command commits.
  begin
    perform private.require_group_work_manager(p_group_id);
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = p_manage_forbidden;
  end;
  -- BC and the Moderator pass the gate on an archived Group.
  if not exists (select 1 from public.groups as grp
                  where grp.id = p_group_id and grp.status = 'active') then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;
  -- The Executor's live profile, held against deactivation or demotion.
  select profile.role into v_role
    from public.profiles as profile
   where profile.id = p_executor and profile.status = 'activ'
     for share of profile;
  if not found then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  if p_exclude_leadership and v_role in ('bc', 'moderator') then
    raise sqlstate 'PT409' using message = 'executor_role_excluded';
  end if;
  if not exists (select 1 from private.group_audience(p_group_id) as member_id
                  where member_id = p_executor) then
    raise sqlstate 'PT409' using message = 'executor_not_group_member';
  end if;
  if not private.meets_group_min_level(p_group_id, p_executor) then
    raise sqlstate 'PT409' using message = 'executor_below_min_level';
  end if;
  if not private.is_work_decider(p_group_id, p_executor, v_actor) then
    raise exception using errcode = '42501', message = p_decide_forbidden;
  end if;
  return v_actor;
end;
$$;

comment on function private.require_completed_work_group(bigint, uuid, text, text, boolean) is
  '#915: the gate a completed Task''s Group passes, in order: 42501 p_manage_forbidden unless the caller may manage work there (private.require_group_work_manager and its FOR SHARE locks); PT409 group_archived unless the Group is active; PT400 invalid_executor unless p_executor is a live activ Member (held FOR SHARE); with p_exclude_leadership, PT409 executor_role_excluded for BC or the Moderator (F-27); PT409 executor_not_group_member outside the Group''s Group Audience; PT409 executor_below_min_level under its Minimum Level; 42501 p_decide_forbidden unless the caller is in private.is_work_decider''s set -- which never holds the Executor. Returns the actor. Granted to nobody.';

revoke execute on function private.require_completed_work_group(bigint, uuid, text, text, boolean)
  from public, anon, authenticated, service_role;

-- ==================== open_task_assignment: a completed Task announces nothing new ====================
CREATE OR REPLACE FUNCTION private.open_task_assignment(p_task_id bigint, p_member_id uuid, p_actor uuid, p_via text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
  v_title text;
  v_deadline timestamptz;
begin
  -- Closed allow-list: details.via is a pinned structured fact, not free
  -- text. A null or unknown via -- including the two arrival-based paths
  -- #682 retired -- is a caller bug, not a silent no-notification.
  -- #915: 'completed_task' is create_completed_task's Assignment.
  if p_via is null or p_via not in
     ('create', 'assign', 'select', 'reopen', 'request_approval', 'completed_task') then
    raise sqlstate 'PT400' using message = 'invalid_assignment_via';
  end if;
  if not exists (select 1 from public.profiles as p where p.id = p_member_id and p.status = 'activ') then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  values (p_task_id, p_member_id, p_actor, now())
  returning id into v_id;
  perform private.log_task_activity(p_task_id, 'executor_assigned', p_actor, v_id, null, null, null,
    jsonb_build_object('via', p_via, 'member_id', p_member_id));
  -- 'reopen' reactivates a past Executor and sends its own "Task redeschis"
  -- notification; a completed Task (#915) is evaluated in the same
  -- transaction and its Executor hears about it once, from evaluate_task.
  -- Every other path announces the new Task (p_via is never null here: the
  -- allow-list above refuses it).
  if p_via not in ('reopen', 'completed_task') then
    select title, deadline into v_title, v_deadline from public.tasks where id = p_task_id;
    perform private.notify(array[p_member_id], 'task'::public.noti_kind,
      'Task nou: ' || v_title,
      'Ți-a fost atribuit acest task. Termen: ' || coalesce(to_char(v_deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), '—') || '.',
      p_task_id, null, p_actor);
  end if;
  return v_id;
end;
$function$;

comment on function private.open_task_assignment(bigint, uuid, uuid, text) is
  'Opens the one active Assignment for a Task, writes its executor_assigned activity row (details.via records how: create, assign, select, reopen, request_approval, completed_task -- a closed allow-list, PT400 invalid_assignment_via otherwise; #682 retired the two arrival-based paths, so on a public Task only select_task_candidate, reopen_task and a request approval open one) and, except for a reopen and a completed Task (#915, whose Executor hears from evaluate_task in the same transaction), sends the new Executor the pinned "Task nou" notification. Raises PT400 invalid_executor for a member who is not a live activ profile. Relies on task_assignments_one_active_per_task_uidx as the last-resort race guard -- callers serialize on the tasks row lock first.';

-- ==================== approve_completed_work_request: shape the Task first ====================
drop function public.approve_completed_work_request(bigint, integer, integer, text);
drop function private.approve_completed_work_request_impl(bigint, integer, integer, text);

create function private.approve_completed_work_request_impl(
  p_request_id  bigint,
  p_difficulty  integer,
  p_rating      integer,
  p_note        text,
  p_title       text,
  p_description text,
  p_group_id    bigint,
  p_link_label  text,
  p_link_url    text,
  p_campaign_id bigint)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_note        text;
  v_title       text;
  v_description text;
  v_link_label  text;
  v_link_url    text;
  v_group       bigint;
  v_request     public.completed_work_requests%rowtype;
  v_task        public.tasks%rowtype;
  v_points      integer;
  v_constraint  text;
begin
  -- 1. Malformed for every caller, before the gate.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('note', v_note, null, 1000);
  -- #915: the Task's shape, when the decider changes it. Null keeps the
  -- Request's value; a title, once given, cannot be blank.
  if p_title is not null then
    if p_title !~ '[^[:space:]]' then
      raise sqlstate 'PT400' using message = 'title_required';
    end if;
    v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    perform private.require_text_length('title', v_title, 3, 120);
  end if;
  if p_description is not null then
    v_description := nullif(regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
    perform private.require_text_length('description', v_description, null, 2000);
  end if;
  v_link_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_url := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_link_label, v_link_url);
  -- 2. The actor.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  -- 3. The Request, locked; hidden and missing are one answer.
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_group_work(v_request.group_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  -- 4. Authority over the Request as filed, then its state.
  perform private.require_request_decider(p_request_id);
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  -- 5. #915: another Group is judged by the rule create_completed_task uses.
  v_group := coalesce(p_group_id, v_request.group_id);
  if v_group is distinct from v_request.group_id then
    perform private.require_completed_work_group(v_group, v_request.requester_id,
      'request_decide_forbidden', 'request_decide_forbidden', false);
  end if;
  -- 6. Mutate: the Task as shaped, then the shared cores.
  begin
    insert into public.tasks
      (title, description, deadline, group_id, campaign_id,
       audience, assignment_mode, status, created_by, link_label, link_url)
    values (coalesce(v_title, left(v_request.description, 120)),
            case when p_description is null then v_request.description else v_description end,
            now(), v_group, p_campaign_id,
            'local', 'direct', 'todo', v_actor, v_link_label, v_link_url)
    returning * into v_task;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tasks_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;

  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('from_request_id', p_request_id));
  perform private.open_task_assignment(v_task.id, v_request.requester_id, v_actor, 'request_approval');
  perform private.evaluate_task(v_task.id, 'completed', p_difficulty, p_rating, v_note, v_actor);

  update public.completed_work_requests
     set status        = 'approved',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note,
         task_id       = v_task.id
   where id = p_request_id;
  v_points := p_difficulty * public.rating_mult(p_rating);
  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere aprobată: ' || left(v_request.description, 60),
    case when abs(v_points) = 1 then v_points || ' punct' else v_points || ' puncte' end
      || ' (dificultate ' || p_difficulty || ', calificativ ' || p_rating || ').',
    v_task.id, null, v_actor);

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$$;

comment on function private.approve_completed_work_request_impl(bigint, integer, integer, text, text, text, bigint, text, text, bigint) is
  'Approves one pending Completed-work Request and, in the same transaction, creates the completed Task it recognizes, shaped by the decider (#915): p_title (default the description''s first 120 characters), p_description (default the Request''s description; blank clears it), p_group_id (default the Request''s Group), the Attached Link p_link_label/p_link_url and p_campaign_id (default none). The Task is local, direct, deadlined at the approval instant; the requester is opened as its Executor via private.open_task_assignment(..., ''request_approval'') and private.evaluate_task writes the Evaluation, the points, the terminal state and the ended Assignment. Step 1 (before the gate): PT400 invalid_difficulty / invalid_rating / evaluation_note_required / note_too_long, title_required / title_too_short / title_too_long, description_too_long and the Attached Link reasons. Then 42501 request_command_forbidden; the Request locked FOR UPDATE; PT404 request_not_found when missing or unreadable; 42501 request_decide_forbidden (private.require_request_decider); PT409 request_not_pending. A different Group passes private.require_completed_work_group with request_decide_forbidden for both authority refusals: PT409 group_archived, PT400 invalid_executor, PT409 executor_not_group_member / executor_below_min_level. A Campaign that cannot tag a Task of the Group is PT400 invalid_campaign. The requester is then notified of the decision.';

revoke execute on function private.approve_completed_work_request_impl(bigint, integer, integer, text, text, text, bigint, text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.approve_completed_work_request_impl(bigint, integer, integer, text, text, text, bigint, text, text, bigint)
  to authenticated;

create function public.approve_completed_work_request(
  p_request_id  bigint,
  p_difficulty  integer,
  p_rating      integer,
  p_note        text,
  p_title       text   default null,
  p_description text   default null,
  p_group_id    bigint default null,
  p_link_label  text   default null,
  p_link_url    text   default null,
  p_campaign_id bigint default null)
returns public.completed_work_requests
language sql
security invoker
set search_path = ''
as $$
  select private.approve_completed_work_request_impl(p_request_id, p_difficulty, p_rating, p_note,
    p_title, p_description, p_group_id, p_link_label, p_link_url, p_campaign_id);
$$;

comment on function public.approve_completed_work_request(bigint, integer, integer, text, text, text, bigint, text, text, bigint) is
  'Approve a Completed-work Request: creates the completed Task it describes -- with the title, details, Group, Attached Link and Campaign the decider chose (#915; each null keeps the Request''s value) -- credits the requester Difficulty x the Rating multiplier, and records the decision, atomically. Callable only by the Request''s decider; a different Group must be one the decider may decide the requester''s work in, active, with the requester a member of it or of a Group below it at or above its Minimum Level. Difficulty and Rating are 1..5 and a non-blank note is required. Two concurrent approvals leave exactly one Task: the second waits on the Request row and then receives PT409 request_not_pending.';

revoke execute on function public.approve_completed_work_request(bigint, integer, integer, text, text, text, bigint, text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_completed_work_request(bigint, integer, integer, text, text, text, bigint, text, text, bigint)
  to authenticated;

-- ==================== create_completed_task ====================
create function private.create_completed_task_impl(
  p_executor_id uuid,
  p_group_id    bigint,
  p_title       text,
  p_description text,
  p_link_label  text,
  p_link_url    text,
  p_campaign_id bigint,
  p_difficulty  integer,
  p_rating      integer,
  p_note        text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_note        text;
  v_title       text;
  v_description text;
  v_link_label  text;
  v_link_url    text;
  v_task        public.tasks%rowtype;
  v_constraint  text;
begin
  -- 1. Malformed for every caller, before the gate: the Evaluation's three
  --    inputs (as every evaluating command hoists them) and the Task's text.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('note', v_note, null, 1000);
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('title', v_title, 3, 120);
  v_description := nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('description', v_description, null, 2000);
  v_link_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_url := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_link_label, v_link_url);
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'task_group_required';
  end if;
  if p_executor_id is null then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  -- 2. The actor: a live activ Member with organization claims.
  if v_actor is null or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  -- 3. Authority and eligibility, under the share locks: create_task's
  --    manage gate, then the evaluator rule for this Executor.
  perform private.require_completed_work_group(p_group_id, p_executor_id,
    'task_manage_forbidden', 'task_evaluate_forbidden', true);
  -- 4. create_task's daily cap: this Task's 'created' row counts toward it.
  perform private.require_daily_cap('task_create', v_actor);
  -- 5. Mutate: the Task, then the Assignment and the Evaluation through the
  --    shared cores -- evaluate_task writes the points, nothing here does.
  begin
    insert into public.tasks
      (title, description, deadline, group_id, campaign_id,
       audience, assignment_mode, kind, status, created_by, link_label, link_url)
    values (v_title, v_description, now(), p_group_id, p_campaign_id,
            'local', 'direct', 'task', 'todo', v_actor, v_link_label, v_link_url)
    returning * into v_task;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tasks_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                       'campaign_id', p_campaign_id, 'executor_id', p_executor_id,
                       'completed_task', true));
  perform private.open_task_assignment(v_task.id, p_executor_id, v_actor, 'completed_task');
  perform private.evaluate_task(v_task.id, 'completed', p_difficulty, p_rating, v_note, v_actor);
  select * into v_task from public.tasks where id = v_task.id;
  return v_task;
end;
$$;

comment on function private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text) is
  '#915: records work a Member has already done as a completed Task in one transaction -- the Task (local, direct, deadlined now), the Assignment (private.open_task_assignment via ''completed_task'', which sends no "Task nou"), and the Evaluation and points (private.evaluate_task, whose "Task evaluat" is the Executor''s one Notification). Step 1: PT400 invalid_difficulty / invalid_rating / evaluation_note_required / note_too_long, title_required / title_too_short / title_too_long, description_too_long, the Attached Link reasons, task_group_required, invalid_executor (null). Then 42501 task_command_forbidden (no claims or no live activ profile); private.require_completed_work_group: 42501 task_manage_forbidden, PT409 group_archived, PT400 invalid_executor, PT409 executor_role_excluded (BC/Moderator), PT409 executor_not_group_member, PT409 executor_below_min_level, 42501 task_evaluate_forbidden (the caller is not a decider for this Executor -- including the caller themselves); PT409 rate_limited (task_create); PT400 invalid_campaign.';

revoke execute on function private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text)
  to authenticated;

create function public.create_completed_task(
  p_executor_id uuid,
  p_group_id    bigint,
  p_title       text,
  p_description text,
  p_link_label  text,
  p_link_url    text,
  p_campaign_id bigint,
  p_difficulty  integer,
  p_rating      integer,
  p_note        text)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.create_completed_task_impl(p_executor_id, p_group_id, p_title, p_description,
    p_link_label, p_link_url, p_campaign_id, p_difficulty, p_rating, p_note);
$$;

comment on function public.create_completed_task(uuid, bigint, text, text, text, text, bigint, integer, integer, text) is
  'Add a completed Task for a Group member ("Adaugă task finalizat", #915): the Task, its Assignment, its Evaluation and the Task Points, atomically. The caller manages work in the Group and decides this Executor''s work there; the Executor is an active member of the Group or of a Group below it, at or above its Minimum Level, never BC or the Moderator and never the caller.';

revoke execute on function public.create_completed_task(uuid, bigint, text, text, text, text, bigint, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_completed_task(uuid, bigint, text, text, text, text, bigint, integer, integer, text)
  to authenticated;

-- ==================== The pickers' reads ====================
create function public.completed_task_groups(p_executor_id uuid)
returns table (id bigint, name text, path bigint[], min_level integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select grp.id, grp.name, grp.path, grp.min_level
    from public.groups as grp
   where coalesce(public.auth_is_member(), false)
     and not exists (select 1 from public.profiles_directory as profile
                      where profile.id = p_executor_id
                        and profile.role in ('bc', 'moderator'))
     and private.can_award_completed_work(grp.id, p_executor_id)
   order by grp.path, grp.id;
$$;

comment on function public.completed_task_groups(uuid) is
  '#915: the Groups where the live caller may record p_executor_id''s completed work -- exactly the Groups create_completed_task accepts for that Executor (private.can_award_completed_work; none for BC or the Moderator, who hold no Task work), under Group RLS. An approval offers these plus the Request''s own Group. Clients page the stable path/id ordering.';

revoke execute on function public.completed_task_groups(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.completed_task_groups(uuid) to authenticated;

create function public.completed_task_executors(p_group_id bigint)
returns table (member_id uuid, full_name text, nickname text, avatar_color text)
language sql
stable
security invoker
set search_path = ''
as $$
  select profile.id, profile.full_name, profile.nickname, profile.avatar_color
    from private.completed_work_executors(p_group_id) as candidate
    join public.profiles_directory as profile on profile.id = candidate
   where coalesce(public.auth_is_member(), false)
     and profile.role not in ('bc', 'moderator')
   order by profile.full_name, profile.id;
$$;

comment on function public.completed_task_executors(bigint) is
  '#915: the Members the live caller may credit with completed work in p_group_id -- exactly the Executors create_completed_task accepts there (private.completed_work_executors, less BC and the Moderator), with the name, Nickname and avatar colour a picker shows. Empty for a Group the caller cannot award in.';

revoke execute on function public.completed_task_executors(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.completed_task_executors(bigint) to authenticated;
