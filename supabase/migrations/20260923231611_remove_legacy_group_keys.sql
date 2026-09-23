-- #591: no backfill keys or legacy roster claims remain in the live schema.
do $$ begin
 if exists(select 1 from public.groups group by coalesce(parent_id,0),lower(name) having count(*)>1) then
  raise exception using errcode='23514',message='group_name_collision';
 end if;
end $$;
drop index public.groups_parent_name_uidx;
alter table public.groups drop constraint groups_legacy_one_ck,
 drop column legacy_dept_id, drop column legacy_team_id, drop column legacy_project_id;
create unique index groups_parent_name_uidx on public.groups(coalesce(parent_id,0),lower(name));
comment on table public.groups is 'Native organizational Groups; settings and explicit Group Roles govern authority.';
drop function public.auth_in_dept(text);
drop function public.auth_in_team(text);
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  member record;
  claims jsonb;
  meta   jsonb;
begin
  select p.role, r.level,
         -- Explicit roster rows only: Automatic Membership (the Organization Group) is
         -- derived from the Role and is never a claim. Numbers, ascending, so a token is
         -- byte-stable for the same roster.
         coalesce((select jsonb_agg(gm.group_id order by gm.group_id)
                     from public.group_members gm
                    where gm.member_id = p.id), '[]'::jsonb) as group_ids
    into member
    from public.profiles p
    join public.roles r on r.id = p.role
   where p.id = (event ->> 'user_id')::uuid
     and p.status = 'activ';

  if not found then
    return event;
  end if;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  meta   := (coalesce(claims -> 'app_metadata', '{}'::jsonb) - 'dept_ids' - 'team_ids')
            || jsonb_build_object(
                 'member_role',  member.role,
                 'member_level', member.level,
                 'group_ids',    member.group_ids);
  return jsonb_set(event, '{claims}', jsonb_set(claims, '{app_metadata}', meta));
end;
$$;

CREATE OR REPLACE FUNCTION private.create_group_impl(p_name text, p_category text, p_parent_id bigint DEFAULT NULL::bigint, p_min_level integer DEFAULT NULL::integer, p_manager_id uuid DEFAULT NULL::uuid, p_color text DEFAULT NULL::text, p_short text DEFAULT NULL::text)
 RETURNS groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_parent      public.groups%rowtype;
  v_min_level   integer;
  v_created     public.groups%rowtype;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). The presentation label is validated
  --    against the same vocabulary groups_category_ck holds, minus
  --    'organization': the Organization marker is a structural setting BC moves
  --    with update_group_structure, never something a create call may claim.
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_group_name';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('name', btrim(p_name), 3, 120);
  if p_category is null or p_category not in ('department', 'project', 'team') then
    raise sqlstate 'PT400' using message = 'invalid_group_category';
  end if;
  if p_min_level is not null and p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise sqlstate 'PT400' using message = 'invalid_group_color';
  end if;

  -- 2. Authority. A root Group is BC's and the Moderator's alone; a Child
  --    Group belongs to its parent's Managers. Every denial is the same
  --    42501, so an unknown parent, an archived one and one the caller may
  --    not touch are indistinguishable.
  if p_parent_id is null then
    begin
      v_actor := private.require_active_member();
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end;
    perform 1 from public.profiles as profile
      where profile.id = v_actor and profile.status = 'activ'
      for share of profile;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    if coalesce(private.actor_level(v_actor), -1) < 6 then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
  else
    -- The parent is a parent row, so it is locked FOR NO KEY UPDATE and never
    -- FOR UPDATE (conventions section 1): the new row's path is derived from
    -- it, two creates under one parent must serialize, and the foreign-key
    -- KEY SHARE every child insert takes must keep flowing.
    select parent.* into v_parent
      from public.groups as parent
     where parent.id = p_parent_id
     for no key update;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    v_actor := private.require_group_manager(p_parent_id);
    -- Reached only by a level-6 actor: below that, can_manage_group_work has
    -- already refused an archived parent with 42501. An authorized actor gets
    -- the real state conflict instead of a forbidden.
    if v_parent.status <> 'active' then
      raise sqlstate 'PT409' using message = 'group_archived';
    end if;
  end if;

  v_actor_level := private.actor_level(v_actor);
  v_min_level   := coalesce(p_min_level, v_parent.min_level, 0);

  -- 3. Minimum Level, judged against the loaded parent and the live actor.
  if v_parent.id is not null and v_min_level < v_parent.min_level then
    raise sqlstate 'PT400' using message = 'group_min_level_below_parent';
  end if;
  -- Moderator is exempt, as ADR-0009 already rules for Events: nobody else
  -- may put a Group out of their own reach.
  if coalesce(v_actor_level, -1) < 9 and v_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  -- 4. The Manager appointed with the Group (ruling R19: create_group is
  --    atomic, like create_project(p_leader_id) was). The profile is held
  --    `for share` before a roster row names it, so a concurrent deactivation
  --    serializes behind the decision. The same two reasons are raised again
  --    by the Appointment core at step 6; they are checked here first because
  --    an ineligible Manager must refuse before the Group row exists.
  if p_manager_id is not null then
    perform 1 from public.profiles as manager
      where manager.id = p_manager_id and manager.status = 'activ'
      for share of manager;
    if not found then
      raise sqlstate 'PT400' using message = 'group_member_not_eligible';
    end if;
    if coalesce(private.actor_level(p_manager_id), -1) < v_min_level then
      raise sqlstate 'PT400' using message = 'group_member_below_min_level';
    end if;
  end if;

  -- 5. Sibling names. The pre-check answers deterministically under the
  --    parent's lock; the exception arm below catches two roots racing, where
  --    there is no parent row to serialize on. groups_parent_name_uidx is
  --    still partial (native Groups only) until #591 dedupes the legacy names,
  --    so the pre-check matches the index exactly rather than being stricter
  --    than the constraint it explains.
  if exists (
    select 1 from public.groups as sibling
     where coalesce(sibling.parent_id, 0) = coalesce(p_parent_id, 0)
       and lower(sibling.name) = lower(btrim(p_name))
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  begin
    insert into public.groups (
      name, category, parent_id, min_level, color, short, created_by
    ) values (
      btrim(p_name), p_category, p_parent_id, v_min_level,
      p_color, nullif(btrim(p_short), ''), v_actor
    )
    returning * into v_created;
  exception when unique_violation then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end;

  -- 6. The Manager's own roster row, written here so the Group is never
  --    created leaderless in a separate round trip -- and written through
  --    #583's Appointment core, the one insert path into public.group_members,
  --    which also tells the new Group Manager they were appointed.
  if p_manager_id is not null then
    perform private.appoint_group_member(v_created.id, p_manager_id, v_actor, 'manager');
  end if;

  return v_created;
end;
$function$;

CREATE OR REPLACE FUNCTION private.update_group_impl(p_group_id bigint, p_name text, p_manager_title text, p_accepts_applications boolean, p_application_level integer, p_shared_work_visibility boolean, p_min_level integer, p_confirm_removals boolean DEFAULT false)
 RETURNS groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_parent      public.groups%rowtype;
  v_accepts     boolean := coalesce(p_accepts_applications, false);
  v_shared      boolean := coalesce(p_shared_work_visibility, false);
  v_title       text    := nullif(btrim(p_manager_title), '');
  v_updated     public.groups%rowtype;
  v_below       uuid[];
  v_removed     uuid[];
  v_managers    uuid[];
begin
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_group_name';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('name', btrim(p_name), 3, 120);
  if p_manager_title is not null and p_manager_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  if p_application_level is not null and p_application_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_application_level';
  end if;
  if v_accepts and p_application_level is null then
    raise sqlstate 'PT400' using message = 'invalid_application_level';
  end if;
  if p_application_level is not null and p_application_level < p_min_level then
    raise sqlstate 'PT400' using message = 'application_level_below_min_level';
  end if;

  v_actor := private.require_group_manager(p_group_id);
  v_actor_level := private.actor_level(v_actor);

  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.parent_id is null
     and p_min_level is distinct from v_group.min_level
     and coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  if v_accepts and v_group.automatic_membership then
    raise sqlstate 'PT409' using message = 'automatic_group_accepts_no_applications';
  end if;

  if v_group.parent_id is not null then
    select parent.* into v_parent
      from public.groups as parent
     where parent.id = v_group.parent_id
     for no key update;
    if v_parent.id is not null and p_min_level < v_parent.min_level then
      raise sqlstate 'PT400' using message = 'group_min_level_below_parent';
    end if;
  end if;
  if exists (select 1 from public.groups as child
              where child.parent_id = p_group_id and child.min_level < p_min_level) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_children';
  end if;
  if coalesce(v_actor_level, -1) < 9 and p_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  if exists (
    select 1 from public.groups as sibling
     where sibling.id <> p_group_id
       and coalesce(sibling.parent_id, 0) = coalesce(v_group.parent_id, 0)
       and lower(sibling.name) = lower(btrim(p_name))
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  if (btrim(p_name), v_title, v_accepts, p_application_level, v_shared, p_min_level)
     is not distinct from
     (v_group.name, v_group.manager_title, v_group.accepts_applications,
      v_group.application_level, v_group.shared_work_visibility, v_group.min_level) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  select array_agg(membership.member_id order by membership.member_id)
    into v_below
    from public.group_members as membership
    join public.profiles as profile on profile.id = membership.member_id
    join public.roles as role on role.id = profile.role
   where membership.group_id = p_group_id
     and role.level < p_min_level;

  if v_below is not null then
    if not coalesce(p_confirm_removals, false) then
      raise sqlstate 'PT409' using
        message = 'group_has_members_below_level',
        detail  = cardinality(v_below)::text;
    end if;

    perform 1 from public.group_members as membership
      where membership.group_id = p_group_id
        and membership.member_id = any (v_below)
      order by membership.member_id
      for update of membership;

    delete from public.group_members as membership
     where membership.group_id = p_group_id
       and membership.member_id = any (v_below);
    v_removed := v_below;

    -- #584 (ruling R30), the Application half of ruling R23.
    perform 1 from public.group_applications as application
      where application.group_id = p_group_id
        and application.member_id = any (v_removed)
        and application.status = 'pending'
      order by application.id
      for update of application;

    update public.group_applications as application
       set status     = 'withdrawn',
           decided_by = v_actor,
           decided_at = clock_timestamp()
     where application.group_id = p_group_id
       and application.member_id = any (v_removed)
       and application.status = 'pending';
  end if;

  update public.groups
     set name                   = btrim(p_name),
         manager_title          = v_title,
         accepts_applications   = v_accepts,
         application_level      = p_application_level,
         shared_work_visibility = v_shared,
         min_level              = p_min_level
   where id = p_group_id
  returning * into v_updated;

  if v_removed is not null then
    perform private.notify(
      v_removed, 'system'::public.noti_kind,
      'Nu mai faci parte din ' || v_updated.name,
      'Nivelul minim al grupului ' || v_updated.name
        || ' a fost ridicat, așa că nu mai faci parte din el.',
      null, null, v_actor);
    select array_agg(manager) into v_managers
      from private.group_managers(p_group_id) as manager;
    perform private.notify(
      v_managers, 'system'::public.noti_kind,
      'Nivel minim actualizat: ' || v_updated.name,
      cardinality(v_removed)::text || ' membri au fost eliminați din '
        || v_updated.name || ' după ridicarea nivelului minim.',
      null, null, v_actor, '/administrare/grupuri/' || p_group_id::text);
  end if;

  return v_updated;
end;
$function$;

