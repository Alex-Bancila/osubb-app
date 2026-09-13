-- #343: create_campaign, update_campaign, set_campaign_active — the local
-- BCE of a Campaign's own Department (plus BC/Moderator globally) manage
-- Campaigns through narrow, actor-derived commands (ADR-0007 Sec Campaigns).
-- A Campaign's department_id never changes -- no command in this file (or
-- anywhere else) reassigns it, which also means nothing here re-validates
-- Tasks already carrying a Campaign when its department would move (#314's
-- gap note: Task-Campaign origin consistency is enforced only at the moment
-- a Task's own campaign_id/dept_id/team_id is set, not by a Campaign-side
-- change, because no Campaign-side change to department_id exists to
-- trigger it).
--
-- private.set_updated_at() (#368) lives in dobrerares' #420, which is not in
-- this stack's base (docs/backend/conventions.md Sec7 allows this
-- explicitly): update_campaign and set_campaign_active set
-- updated_at = clock_timestamp() themselves below, and drop that once #420
-- lands. now() is not used here because it is frozen for the whole
-- transaction (transaction_timestamp()), which would make two commands
-- issued back to back in one transaction (as the test suite does) produce
-- identical updated_at values.

create function private.require_campaign_manager(p_department_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_kind text;
  v_actor_role public.member_role;
begin
  -- Department existence/kind: departments_read has required org membership
  -- (`using (auth_is_member())`) since
  -- 20260823140923_require_membership_policies.sql, not `using (true)` --
  -- but every caller here has already passed the _impl's pre-lock gate (a
  -- live active BC/Moderator/BCE), so naming an unknown or invalid-kind
  -- department discloses nothing new to a caller who already reaches this
  -- line. Department kind is an allow-list, not a single forbidden value:
  -- an unrecognized future kind is rejected by default rather than silently
  -- treated as campaign-eligible.
  select department.kind
    into v_kind
    from public.departments as department
   where department.id = p_department_id;

  if not found then
    raise sqlstate 'PT404' using message = 'department_not_found';
  end if;

  if v_kind not in ('department', 'coordination') then
    raise sqlstate 'PT400' using message = 'invalid_campaign_department';
  end if;

  -- Cheap authority check: #321's private.can_manage_origin, Department
  -- branch only (a Campaign's owner is always a Department, never a Team or
  -- Project) -- live BC/Moderator role level, or a live local BCE of this
  -- Department.
  if v_actor is null
     or not coalesce(private.can_manage_origin(p_department_id, null, null), false) then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;

  -- Re-validate under lock the way the Department-Team commands do
  -- (20260910190000_harden_department_membership_management.sql): hold the
  -- actor's live profile, and for a BCE, their specific Department
  -- membership row, so a concurrent deactivation or Department-membership
  -- removal cannot commit while this authorization decision is still relied
  -- upon by the caller's transaction.
  select profile.role
    into v_actor_role
    from public.profiles as profile
   where profile.id = v_actor
     and profile.status = 'activ'
     and profile.role in ('bc', 'moderator', 'bce')
   for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;

  if v_actor_role = 'bce' then
    perform membership.member_id
      from public.member_departments as membership
     where membership.member_id = v_actor
       and membership.dept_id = p_department_id
     for share;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'campaign_manage_forbidden';
    end if;
  end if;

  return v_actor;
end;
$$;

comment on function private.require_campaign_manager(text) is
  'Returns auth.uid() only when the department exists, is not the org pseudo-department, and the live caller may manage its work (private.can_manage_origin Department branch): a live BC/Moderator, or a live local BCE of that department. Locks the actor profile, and a BCE''s Department membership row, FOR SHARE so a concurrent revocation serializes.';

create function private.create_campaign_impl(
  p_department_id text,
  p_name text
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text;
  v_campaign public.campaigns%rowtype;
  v_constraint text;
begin
  -- Cheap gate before require_campaign_manager's Department lookup (#343
  -- review round 1, for symmetry with update/set_campaign_active below): an
  -- identity that can never manage any Campaign must not be able to use an
  -- unknown/invalid p_department_id to learn PT404 vs PT400 vs 42501. This
  -- is the same non-disclosure discipline the Task commands (#318) must
  -- copy from this template.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = v_actor
          and profile.status = 'activ'
          and profile.role in ('bc', 'moderator', 'bce')
     ) then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;

  perform private.require_campaign_manager(p_department_id);

  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_campaign_name';
  end if;

  -- regexp_replace, not btrim: btrim only strips plain spaces, so a
  -- tab-padded name would dodge the lower(name) uniqueness check below
  -- while still colliding once trimmed for storage
  -- (private.create_project_impl's precedent).
  v_name := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  begin
    insert into public.campaigns (department_id, name, created_by)
    values (p_department_id, v_name, v_actor)
    returning * into v_campaign;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

      if v_constraint <> 'campaigns_department_name_uidx' then
        raise;
      end if;

      raise sqlstate 'PT409' using message = 'campaign_name_taken';
  end;

  return v_campaign;
end;
$$;

comment on function private.create_campaign_impl(text, text) is
  'Creates one Campaign for a Department the caller manages; the actor is auth.uid(), never a parameter. Rejects a blank name, trims a padded one, and re-raises the campaigns_department_name_uidx unique_violation as campaign_name_taken (any other constraint violation propagates unchanged).';

create function private.update_campaign_impl(
  p_campaign_id bigint,
  p_name text
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_department_id text;
  v_name text;
  v_campaign public.campaigns%rowtype;
  v_constraint text;
begin
  -- Cheap gate BEFORE the row lock below (#343 review round 1): an identity
  -- that can never manage any Campaign must not be able to take the
  -- Campaign row's FOR UPDATE lock, or learn campaign_not_found vs a real
  -- authorization decision, purely by naming an id. This does not replace
  -- require_campaign_manager's Department-scoped check below (a BCE of the
  -- wrong Department still passes this gate and fails there); it only keeps
  -- a caller who can never manage *anything* from reaching the lock at all
  -- -- the same non-disclosure discipline the Task commands (#318) must
  -- copy from this template.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = v_actor
          and profile.status = 'activ'
          and profile.role in ('bc', 'moderator', 'bce')
     ) then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;

  -- An unknown Campaign is still PT404 no matter who is asking
  -- (campaigns_read already lets every active member see every Campaign
  -- row, so this does not disclose anything new to a caller who already
  -- passed the gate above).
  select campaign.department_id
    into v_department_id
    from public.campaigns as campaign
   where campaign.id = p_campaign_id
   for update;

  if not found then
    raise sqlstate 'PT404' using message = 'campaign_not_found';
  end if;

  perform private.require_campaign_manager(v_department_id);

  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_campaign_name';
  end if;

  -- regexp_replace, not btrim: btrim only strips plain spaces, so a
  -- tab-padded name would dodge the lower(name) uniqueness check below
  -- while still colliding once trimmed for storage
  -- (private.create_project_impl's precedent).
  v_name := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  begin
    update public.campaigns as campaign
       set name = v_name,
           updated_at = clock_timestamp()
     where campaign.id = p_campaign_id
    returning campaign.* into v_campaign;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

      if v_constraint <> 'campaigns_department_name_uidx' then
        raise;
      end if;

      raise sqlstate 'PT409' using message = 'campaign_name_taken';
  end;

  return v_campaign;
end;
$$;

comment on function private.update_campaign_impl(bigint, text) is
  'Renames an existing Campaign; department_id never changes here or anywhere else. Gates on a live BC/Moderator/BCE before locking the Campaign row. Rejects a blank name, trims a padded one, and re-raises the campaigns_department_name_uidx unique_violation as campaign_name_taken (any other constraint violation propagates unchanged). Sets updated_at itself (private.set_updated_at(), #368, is not in this stack''s base).';

create function private.set_campaign_active_impl(
  p_campaign_id bigint,
  p_active boolean
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_department_id text;
  v_current_active boolean;
  v_campaign public.campaigns%rowtype;
begin
  -- Validate the flag before anything else, including the gate below: a
  -- null p_active is malformed input for every caller, authorized or not,
  -- so there is nothing to gain by checking authority first.
  if p_active is null then
    raise sqlstate 'PT400' using message = 'invalid_campaign_active';
  end if;

  -- Cheap gate BEFORE the row lock below (#343 review round 1): see
  -- update_campaign_impl's identical comment. Also means authority is
  -- re-checked even when p_active repeats the current value -- an
  -- unauthorized caller cannot use a same-value call as a way to probe or
  -- "no-op" past this command.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = v_actor
          and profile.status = 'activ'
          and profile.role in ('bc', 'moderator', 'bce')
     ) then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;

  select campaign.department_id, campaign.is_active
    into v_department_id, v_current_active
    from public.campaigns as campaign
   where campaign.id = p_campaign_id
   for update;

  if not found then
    raise sqlstate 'PT404' using message = 'campaign_not_found';
  end if;

  perform private.require_campaign_manager(v_department_id);

  -- Idempotent: setting the already-current value is a no-op that still
  -- returns the row rather than a PT409 conflict -- a caller (or a retried
  -- request) does not need to read is_active first, and this also means a
  -- no-op never bumps updated_at.
  if v_current_active = p_active then
    select campaign.*
      into v_campaign
      from public.campaigns as campaign
     where campaign.id = p_campaign_id;

    return v_campaign;
  end if;

  update public.campaigns as campaign
     set is_active = p_active,
         updated_at = clock_timestamp()
   where campaign.id = p_campaign_id
  returning campaign.* into v_campaign;

  return v_campaign;
end;
$$;

comment on function private.set_campaign_active_impl(bigint, boolean) is
  'Activates or deactivates an existing Campaign; rejects a null flag, gates on a live BC/Moderator/BCE before locking the Campaign row, and re-checks that authority even for a same-value no-op. Setting the current value again does not bump updated_at. Sets updated_at itself on a real change (private.set_updated_at(), #368, is not in this stack''s base).';

create function public.create_campaign(
  p_department_id text,
  p_name text
)
returns public.campaigns
language sql
security invoker
set search_path = ''
as $$
  select private.create_campaign_impl(p_department_id, p_name);
$$;

create function public.update_campaign(
  p_campaign_id bigint,
  p_name text
)
returns public.campaigns
language sql
security invoker
set search_path = ''
as $$
  select private.update_campaign_impl(p_campaign_id, p_name);
$$;

create function public.set_campaign_active(
  p_campaign_id bigint,
  p_active boolean
)
returns public.campaigns
language sql
security invoker
set search_path = ''
as $$
  select private.set_campaign_active_impl(p_campaign_id, p_active);
$$;

comment on function public.create_campaign(text, text) is
  'Creates a Campaign for a Department; callable only by a live active BC/Moderator, or the live active BCE of that Department.';
comment on function public.update_campaign(bigint, text) is
  'Renames a Campaign; callable only by a live active BC/Moderator, or the live active BCE of its Department.';
comment on function public.set_campaign_active(bigint, boolean) is
  'Activates or deactivates a Campaign (idempotent); callable only by a live active BC/Moderator, or the live active BCE of its Department.';

-- Campaigns already ship with no direct-write grant for `authenticated`
-- (20260911093000_campaigns_schema.sql revokes all and grants back only
-- select), so this is idempotent -- kept anyway so a conventions sweep that
-- greps for the literal table-DML revoke statement (docs/backend/
-- conventions.md Sec2/Sec9) finds it here, next to the commands that make
-- it true, rather than only in a migration three files back.
revoke insert, update, delete on table public.campaigns from authenticated;

revoke execute on function private.require_campaign_manager(text)
  from public, anon, authenticated, service_role;
revoke execute on function private.create_campaign_impl(text, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.update_campaign_impl(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.set_campaign_active_impl(bigint, boolean)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function private.create_campaign_impl(text, text)
  to authenticated;
grant execute on function private.update_campaign_impl(bigint, text)
  to authenticated;
grant execute on function private.set_campaign_active_impl(bigint, boolean)
  to authenticated;

revoke execute on function public.create_campaign(text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_campaign(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_campaign_active(bigint, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.create_campaign(text, text)
  to authenticated;
grant execute on function public.update_campaign(bigint, text)
  to authenticated;
grant execute on function public.set_campaign_active(bigint, boolean)
  to authenticated;
