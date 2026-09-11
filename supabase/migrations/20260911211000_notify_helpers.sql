-- #320: notification columns (task reference, dedupe key) and the server
-- fan-out helpers private.notify / private.task_managers (ADR-0007
-- Server-command boundary). No command calls either helper yet -- that
-- starts with the #327-345 Task commands -- and no RLS policy changes here;
-- notifications.* read/write policies are #65 (dobrerares' #413, not in
-- this branch's base).

alter table public.notifications
  add column task_id    bigint references public.tasks (id) on delete set null,
  add column dedupe_key text;

comment on column public.notifications.task_id is
  'The Task this Notification is about, if any. ON DELETE SET NULL: a Notification outlives a deleted Task (supabase/seed.sql deletes and re-inserts demo Tasks on every rerun).';

comment on column public.notifications.dedupe_key is
  'Server-chosen coalescing key (e.g. a Task''s Candidate-queue key). private.notify() upserts on (member_id, dedupe_key) while the earlier row is unread -- the caller supplies the up-to-date coalesced text (e.g. "3 candidați noi"). Null for Notifications that are never coalesced.';

create index notifications_task_idx on public.notifications (task_id);

-- Partial: only an unread row can absorb a later notify() call for the same
-- key. Once read, the key is free again -- the next matching notify() call
-- starts a fresh, separate row rather than reviving the old one.
create unique index notifications_member_dedupe_unread_uidx
  on public.notifications (member_id, dedupe_key)
  where not read and dedupe_key is not null;

-- ==================== private.notify ====================
-- The one function that writes targeted in-app Notifications (ADR-0007
-- Server-command boundary): every Task command that changes state calls
-- this, in the same transaction as its other writes, once per distinct
-- recipient set/message. It is NOT the broadcast/announcement fan-out
-- (#68): Task Notifications are direct, addressed to specific Members by
-- the command that produced them, and are never suppressed -- notif_
-- suppression only ever applies to broadcast kinds reaching a Role, never
-- to a Member's own direct Notifications about their own Task.
create function private.notify(
  p_recipients uuid[],
  p_kind       public.noti_kind,
  p_title      text,
  p_body       text,
  p_task_id    bigint,
  p_dedupe_key text,
  p_actor      uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link  text;
  v_count integer;
begin
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_notification_title';
  end if;

  v_link := case when p_task_id is not null then '/tracker/' || p_task_id::text else null end;

  -- De-duplicate the recipient array, drop nulls, drop the actor (never
  -- echo an action back to its author -- ADR-0007), and keep only members
  -- whose live profile is activ: a deactivated Member keeps their
  -- auth.uid() and profiles row (house rule 12) but stops receiving new
  -- Notifications the moment they are deactivated.
  if p_dedupe_key is not null then
    insert into public.notifications as notification (
      member_id, kind, title, body, link, critical, task_id, dedupe_key
    )
    select recipient.member_id, p_kind, p_title, p_body, v_link, false, p_task_id, p_dedupe_key
      from (
        select distinct member_id
          from unnest(p_recipients) as u (member_id)
         where member_id is not null
           and member_id is distinct from p_actor
      ) as recipient
      join public.profiles as profile on profile.id = recipient.member_id
     where profile.status = 'activ'
    on conflict (member_id, dedupe_key) where not read and dedupe_key is not null
    do update
       set title      = excluded.title,
           body       = excluded.body,
           created_at = now();
  else
    insert into public.notifications (
      member_id, kind, title, body, link, critical, task_id, dedupe_key
    )
    select recipient.member_id, p_kind, p_title, p_body, v_link, false, p_task_id, null
      from (
        select distinct member_id
          from unnest(p_recipients) as u (member_id)
         where member_id is not null
           and member_id is distinct from p_actor
      ) as recipient
      join public.profiles as profile on profile.id = recipient.member_id
     where profile.status = 'activ';
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function private.notify(uuid[], public.noti_kind, text, text, bigint, text, uuid) is
  'Writes targeted in-app Notifications for p_recipients, minus nulls, duplicates, p_actor, and any recipient whose live profile is not activ. link is derived from p_task_id (''/tracker/<id>''); critical is always false here. With p_dedupe_key set, upserts on (member_id, dedupe_key) while the existing row is unread, replacing title/body/created_at -- the caller supplies the coalesced text (e.g. a Candidate-queue count); once that row is read, the next call with the same key starts a new row. Without a key, every call inserts fresh rows. Returns the number of recipients written. Blank/null title raises PT400 invalid_notification_title. Task Notifications are direct and are never suppressed -- notif_suppression applies only to the broadcast/announcement fan-out (#68), not here.';

revoke execute on function private.notify(uuid[], public.noti_kind, text, text, bigint, text, uuid)
  from public, anon, authenticated, service_role;

-- ==================== private.task_managers ====================
-- The recipient list for a Task's manager Notifications: give-up,
-- submission for review, new Candidates (coalesced), Subtask completion or
-- an Umbrella becoming completable (ADR-0007). This is NOT
-- private.can_manage_origin (#321): that predicate answers "can auth.uid()
-- manage this Origin" for the calling session and returns true for
-- BC/Moderator everywhere via their global override; this one lists every
-- live recipient for an arbitrary p_task_id, given a caller-supplied actor
-- to exclude, and is called from inside other security definer commands --
-- never from a policy, and never as "the caller".
create function private.task_managers(
  p_task_id bigint,
  p_actor   uuid
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_created_by      uuid;
  v_dept_id         text;
  v_team_id         text;
  v_project_id      bigint;
  v_parent_dept_id  text;
  v_origin_managers uuid[];
begin
  select task.created_by, task.dept_id, task.team_id, task.project_id
    into v_created_by, v_dept_id, v_team_id, v_project_id
    from public.tasks as task
   where task.id = p_task_id;

  if not found then
    return;
  end if;

  -- The Task Manager is the creator, recorded server-side at creation
  -- (ADR-0007) -- but only while they are still a live activ Member and are
  -- not the actor (never echo an action back to its author).
  if v_created_by is not null and v_created_by is distinct from p_actor then
    if exists (
      select 1
        from public.profiles as creator
       where creator.id = v_created_by
         and creator.status = 'activ'
    ) then
      return next v_created_by;
      return;
    end if;
  end if;

  -- The Task Manager is the actor, or is no longer active: the Origin's
  -- managers receive the manager Notifications instead (ADR-0007).
  if v_dept_id is not null then
    select array_agg(distinct membership.member_id)
      into v_origin_managers
      from public.member_departments as membership
      join public.profiles as profile on profile.id = membership.member_id
     where membership.dept_id = v_dept_id
       and profile.role = 'bce'
       and profile.status = 'activ'
       and membership.member_id is distinct from p_actor;

  elsif v_team_id is not null then
    select team.dept_id into v_parent_dept_id
      from public.teams as team
     where team.id = v_team_id;

    if v_parent_dept_id is not null then
      -- Department-Team: local BCE of the Team's parent Department, same
      -- test as the Department branch against team.dept_id, not the Team.
      select array_agg(distinct membership.member_id)
        into v_origin_managers
        from public.member_departments as membership
        join public.profiles as profile on profile.id = membership.member_id
       where membership.dept_id = v_parent_dept_id
         and profile.role = 'bce'
         and profile.status = 'activ'
         and membership.member_id is distinct from p_actor;
    else
      -- Independent Team (dept_id is null): active members jointly manage
      -- their own Team's work, whatever their role.
      select array_agg(distinct membership.member_id)
        into v_origin_managers
        from public.team_members as membership
        join public.profiles as profile on profile.id = membership.member_id
       where membership.team_id = v_team_id
         and profile.status = 'activ'
         and membership.member_id is distinct from p_actor;
    end if;

  elsif v_project_id is not null then
    -- Project: the lead plus every Responsible. A plain project_members
    -- 'member' row does not qualify.
    select array_agg(distinct candidate.member_id)
      into v_origin_managers
      from (
        select project.leader_id as member_id
          from public.projects as project
         where project.id = v_project_id
         union
        select membership.member_id
          from public.project_members as membership
         where membership.project_id = v_project_id
           and membership.project_role = 'responsible'
      ) as candidate
      join public.profiles as profile on profile.id = candidate.member_id
     where profile.status = 'activ'
       and candidate.member_id is distinct from p_actor;
  end if;

  if v_origin_managers is not null and array_length(v_origin_managers, 1) > 0 then
    return query select unnest(v_origin_managers);
    return;
  end if;

  -- Last resort: a coordination Department, an Independent Team, or a
  -- Department can each end up with no live local BCE / member to notify,
  -- but a Task must always have a manager to notify (ADR-0007). BC/Moderator
  -- are otherwise kept out of routine Project/Origin Notifications unless
  -- they are "otherwise a participant or intended manager" -- this is the
  -- one place their global standing stands in for a missing local manager.
  return query
    select profile.id
      from public.profiles as profile
     where profile.role in ('bc', 'moderator')
       and profile.status = 'activ'
       and profile.id is distinct from p_actor;
end;
$$;

comment on function private.task_managers(bigint, uuid) is
  'The live recipients for Task p_task_id''s manager Notifications, excluding p_actor: the creator (tasks.created_by) while they are a live activ Member and not the actor; otherwise the Origin''s managers -- local BCE for a Department or Department-Team, every active member for an Independent Team, or the lead plus every Responsible for a Project (a plain project member does not qualify); and if that set is empty, every live BC/Moderator as a last resort, so a Task always has someone to notify. Not private.can_manage_origin (#321): that answers for the calling session only and lets BC/Moderator through everywhere; this lists recipients for an arbitrary Task and actor. Returns an empty set for an unknown Task.';

revoke execute on function private.task_managers(bigint, uuid)
  from public, anon, authenticated, service_role;
