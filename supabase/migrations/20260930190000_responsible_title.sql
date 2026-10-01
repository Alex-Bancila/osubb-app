-- #962: a display name for the Group Responsible position (groups.responsible_title)
--
-- ADR-0009 §Group Roles, amended 2026-09-30. Every Group already names its
-- Group Manager position (groups.manager_title -- "Vicepreședinte" for a
-- Department since #957); the Group Responsible position was hard-coded
-- "Responsabil" wherever no individual title was at hand. A Department's
-- Group Responsibles are its BCE members, whom OSUBB calls Coordonatori, so
-- the position gets the same per-Group setting. Each Responsible keeps their
-- own title (group_members.position_title, still required at appointment):
-- the Group's is the default the appointment form pre-fills and the fallback
-- wherever a row carries none.
--
-- The column is an operational setting, written only by public.update_group,
-- which is dropped and recreated with p_responsible_title right after
-- p_manager_title, so PostgREST never sees two overloads. Authority is
-- unchanged (private.require_group_manager). Step 1, before the gate and for
-- everyone, mirrors the Manager title exactly: blank but not null is PT400
-- invalid_position_title, over 80 characters (measured trimmed, as stored) is
-- PT400 responsible_title_too_long through private.require_text_length. Two
-- named constraints hold the same rules underneath. The column is new and
-- every existing row is null, so both are added valid in this one migration
-- (the two-step NOT VALID rule in conventions section 3 is for a new limit
-- over rows that already exist).
--
-- private.appoint_group_member and private.set_group_role_impl name a
-- Responsible's position in their Notifications by the row's own title, then
-- the Group's responsible_title, then "responsabil" -- no longer the Manager
-- wording "coordonator de grup". A Manager's wording is unchanged.
--
-- Bodies rebuilt from main's latest definitions, nothing else in them
-- changed: update_group_impl from 20260927150000_column_limits.sql,
-- set_group_role_impl from the same file, appoint_group_member from
-- 20260928120000_audit_d_server_fixes.sql. The public.update_group wrapper
-- follows 20260924050506_group_application_form.sql.

-- ---------------------------------------------------------------------------
-- The column and its invariants.
-- ---------------------------------------------------------------------------
alter table public.groups
  add column responsible_title text,
  add constraint groups_responsible_title_ck
    check (responsible_title is null or responsible_title ~ '[^[:space:]]'),
  add constraint groups_responsible_title_length_ck
    check (responsible_title is null or char_length(responsible_title) <= 80);

comment on column public.groups.responsible_title is
  '#962: what this Group calls its Group Responsible position ("Coordonator" for a Department''s BCE members) -- at most 80 characters, never blank, null for the plain "Responsabil". The default the appointment form pre-fills and the fallback wherever a Responsible''s own group_members.position_title is absent. Written only by public.update_group.';

-- ---------------------------------------------------------------------------
-- update_group: one new parameter, drop and recreate.
-- ---------------------------------------------------------------------------
drop function public.update_group(bigint, text, text, boolean, integer, boolean, integer, text, text, boolean);
drop function private.update_group_impl(bigint, text, text, boolean, integer, boolean, integer, text, text, boolean);

create function private.update_group_impl(
  p_group_id               bigint,
  p_name                   text,
  p_manager_title          text,
  p_responsible_title      text,
  p_accepts_applications   boolean,
  p_application_level      integer,
  p_shared_work_visibility boolean,
  p_min_level              integer,
  p_application_form_label text,
  p_application_form_url   text,
  p_confirm_removals       boolean default false
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_parent      public.groups%rowtype;
  v_accepts     boolean := coalesce(p_accepts_applications, false);
  v_shared      boolean := coalesce(p_shared_work_visibility, false);
  v_title       text    := nullif(btrim(p_manager_title), '');
  v_resp_title  text    := nullif(btrim(p_responsible_title), '');
  v_form_label  text;
  v_form_url    text;
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
  -- Security pass 2026-09-27 (L1): groups_manager_title_length_ck.
  perform private.require_text_length('manager_title', v_title, null, 80);
  -- #962: the Group Responsible position's display name, judged exactly as
  -- the Manager's is -- blank is malformed, over 80 is too long.
  if p_responsible_title is not null and p_responsible_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  perform private.require_text_length('responsible_title', v_resp_title, null, 80);
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
  -- #697 (R18/R8): the application form link, trimmed (blank -> null) and
  -- judged exactly as a Task's Attached Link is.
  v_form_label := nullif(regexp_replace(coalesce(p_application_form_label, ''),
                                        '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_form_url := nullif(regexp_replace(coalesce(p_application_form_url, ''),
                                      '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_form_label, v_form_url);

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
  -- #756 (ruling R25): a Private Group accepts no Applications -- the same
  -- reason apply_to_group answers. update_group_structure switched them off
  -- when the Group turned private, so this refuses only turning them on.
  if v_accepts and v_group.is_private then
    raise sqlstate 'PT400' using message = 'group_private';
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

  if (btrim(p_name), v_title, v_resp_title, v_accepts, p_application_level, v_shared, p_min_level,
      v_form_label, v_form_url)
     is not distinct from
     (v_group.name, v_group.manager_title, v_group.responsible_title, v_group.accepts_applications,
      v_group.application_level, v_group.shared_work_visibility, v_group.min_level,
      v_group.application_form_label, v_group.application_form_url) then
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
         responsible_title      = v_resp_title,
         accepts_applications   = v_accepts,
         application_level      = p_application_level,
         shared_work_visibility = v_shared,
         min_level              = p_min_level,
         application_form_label = v_form_label,
         application_form_url   = v_form_url
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

create function public.update_group(
  p_group_id               bigint,
  p_name                   text,
  p_manager_title          text,
  p_responsible_title      text,
  p_accepts_applications   boolean,
  p_application_level      integer,
  p_shared_work_visibility boolean,
  p_min_level              integer,
  p_application_form_label text,
  p_application_form_url   text,
  p_confirm_removals       boolean default false
)
returns public.groups
language sql
security invoker
set search_path = ''
as $$
  select private.update_group_impl(
    p_group_id, p_name, p_manager_title, p_responsible_title, p_accepts_applications,
    p_application_level, p_shared_work_visibility, p_min_level,
    p_application_form_label, p_application_form_url, p_confirm_removals);
$$;

-- ---------------------------------------------------------------------------
-- Comments and grants (conventions section 4).
-- ---------------------------------------------------------------------------
comment on function public.update_group(bigint, text, text, text, boolean, integer, boolean, integer, text, text, boolean) is
  'Replaces a Group''s OPERATIONAL settings (#582, ADR-0009 Decision 5): name, the display names of its two positions -- the Group Manager''s and (#962) the Group Responsible''s --, Accepts Applications with its Application Level, Shared Work Visibility, a Child Group''s Minimum Level and (#697, ruling R18) the "Formular de înscriere" application form link. Authorized by private.require_group_manager -- the Group''s own Managers and those of its ancestors, plus BC and the Moderator; a Group Responsible is refused. This is a full-state REPLACE, not a patch (conventions OD5): every column above is written from its argument, so a null clears a nullable one and a caller that wants to keep a value must send it back. Malformed input first, for everyone: PT400 invalid_group_name / name_too_short / name_too_long / invalid_position_title (either display name blank but not null) / manager_title_too_long / responsible_title_too_long (over 80 characters, measured trimmed) / invalid_group_min_level / invalid_application_level / application_level_below_min_level, then the application form link -- both values trimmed, blank -> null, and judged by private.require_attached_link: link_incomplete (label or address alone), link_label_too_long (over 60), link_url_too_long (over 2048), link_url_invalid (not http(s)). A TOP-LEVEL Group''s Minimum Level is structural, so changing it below live level 6 is 42501 group_manage_forbidden -- the mirror image of update_group_structure, which refuses a CHILD''s. Then PT409 group_archived; PT409 automatic_group_accepts_no_applications (a Group whose roster follows the rank accepts none, groups_automatic_no_applications_ck); PT400 group_private (#756: a Private Group accepts none); PT400 group_min_level_below_parent / group_min_level_above_children / group_min_level_above_actor (Moderator exempt); PT409 group_name_taken; PT409 nothing_to_update when the state sent back is identical, both display names and the link included. Raising the Minimum Level above existing members is PT409 group_has_members_below_level, with the count in DETAIL (the message stays the snake_case reason the frontend matches on), unless p_confirm_removals is true -- then exactly those roster rows are deleted, whatever Group Role they carried, their pending Applications on this Group are withdrawn (#584, ruling R30), each removed Member is notified directly and the Group''s Managers get one summary. Descendants are never touched: group_min_level_above_children has already refused a level above a child''s. The link couples to nothing server-side: an Automatic-Membership Group may store one, and the Application commands never read it (#698 decides where "Aplică" goes).';

comment on function private.update_group_impl(bigint, text, text, text, boolean, integer, boolean, integer, text, text, boolean) is
  'Body behind public.update_group (#582): the operational settings, the top-level Minimum-Level split, the tree and actor bounds, the full-state replace and ruling R23''s Minimum-Level removal behind p_confirm_removals. Since #584 (ruling R30) the removal also withdraws those Members'' pending Applications on this Group, with the actor as decider. Since #697 (ruling R18) it also replaces the application form link, trimmed and judged at step 1 by private.require_attached_link. Since #962 it also replaces groups.responsible_title, the Group Responsible position''s display name, trimmed and judged at step 1 exactly as the Manager''s is.';

revoke execute on function private.update_group_impl(bigint, text, text, text, boolean, integer, boolean, integer, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_group(bigint, text, text, text, boolean, integer, boolean, integer, text, text, boolean)
  from public, anon, authenticated, service_role;

grant execute on function private.update_group_impl(bigint, text, text, text, boolean, integer, boolean, integer, text, text, boolean)
  to authenticated;
grant execute on function public.update_group(bigint, text, text, text, boolean, integer, boolean, integer, text, text, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- set_group_role_impl: a Responsible's Notifications name their position by
-- the Group's responsible_title when the row has no title of its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.set_group_role_impl(p_group_id bigint, p_member_id uuid, p_group_role text, p_position_title text DEFAULT NULL::text)
 RETURNS public.group_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor        uuid;
  v_parent_id    bigint;
  v_manager_tier boolean;
  v_group        public.groups%rowtype;
  v_row          public.group_members%rowtype;
  v_current      text;
  v_title        text := nullif(btrim(p_position_title), '');
  v_display      text;
  v_old_display  text;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). group_members_role_ck holds the same
  --    vocabulary; group_members_position_title_ck rejects a blank title.
  if p_group_role is null or p_group_role not in ('manager', 'responsible', 'member') then
    raise sqlstate 'PT400' using message = 'invalid_group_role';
  end if;
  if p_position_title is not null and v_title is null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  -- Security pass 2026-09-27 (L1): group_members_position_title_length_ck.
  perform private.require_text_length('position_title', v_title, null, 80);
  -- A Group Responsible is always shown under a custom display name
  -- (CONTEXT.md, ADR-0009 Group Roles), so the name is part of the
  -- appointment and not an afterthought. A Group Manager's display name is a
  -- GROUP setting (groups.manager_title — BCE, Coordonator Principal), which
  -- is update_group's to write, and ordinary membership has none: sending
  -- either one a title here is the caller misunderstanding the model, not a
  -- value to silently drop.
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role <> 'responsible' and v_title is not null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;

  -- 2. Which tier decides. Read unlocked first: the gate must run before any
  --    lock on public.groups (shape 6), and both inputs it needs — whether
  --    the Group is a root and whether this call grants or removes `manager`
  --    — are re-read under the lock at step 4, where an escalation is caught.
  select grp.parent_id into v_parent_id
    from public.groups as grp where grp.id = p_group_id;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  select existing.group_role into v_current
    from public.group_members as existing
   where existing.group_id = p_group_id and existing.member_id = p_member_id;
  v_manager_tier := p_group_role = 'manager' or coalesce(v_current = 'manager', false);

  -- 3-4. Gate, then locks, then the same question again under them. The loop
  --      runs twice only when the answer changed while the gate ran — a
  --      concurrent promotion to `manager` committing between the unlocked
  --      read and the lock — in which case the STRONGER tier is re-run. The
  --      reverse never needs re-running: a parent's Group Manager holds the
  --      position in every Group below (ADR-0009), and level >= 6 passes
  --      everywhere, so the strong gate always implies the weak one.
  for v_attempt in 1 .. 2 loop
    if v_manager_tier then
      if v_parent_id is null then
        -- A root Group's Managers are BC's and the Moderator's appointment.
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
        -- The PARENT's Managers appoint a Child Group's (shape 1).
        v_actor := private.require_group_manager(v_parent_id);
      end if;
    else
      v_actor := private.require_group_manager(p_group_id);
    end if;

    select grp.* into v_group
      from public.groups as grp
     where grp.id = p_group_id
     for no key update;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    select existing.* into v_row
      from public.group_members as existing
     where existing.group_id = p_group_id and existing.member_id = p_member_id
     for update of existing;
    v_current := v_row.group_role;

    exit when v_manager_tier
           or not (p_group_role = 'manager' or coalesce(v_current = 'manager', false));
    v_manager_tier := true;
  end loop;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  -- 5. The write the caller asked for, judged against the loaded row.
  if v_current is null then
    -- No roster row yet: this IS an Appointment, so it goes through the one
    -- insert path (shape 3), which re-checks eligibility and Minimum Level,
    -- answers automatic_group_has_no_roster_members for an ordinary row on an
    -- Automatic-Membership Group, and writes the target's Notification.
    return private.appoint_group_member(
      p_group_id, p_member_id, v_actor, p_group_role, v_title);
  end if;

  if (p_group_role, v_title) is not distinct from (v_current, v_row.position_title) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- Shape 4: a write that PLACES the Member in a position they do not hold
  --  — any appointment — demands a live, eligible Member; a demotion or a
  -- removal never does, or an inactive Group Manager could be neither demoted
  -- here nor removed by remove_group_member.
  if p_group_role in ('manager', 'responsible') then
    perform 1 from public.profiles as target
      where target.id = p_member_id and target.status = 'activ'
      for share of target;
    if not found then
      raise sqlstate 'PT400' using message = 'group_member_not_eligible';
    end if;
    if coalesce(private.actor_level(p_member_id), -1) < v_group.min_level then
      raise sqlstate 'PT400' using message = 'group_member_below_min_level';
    end if;
  end if;

  -- #962: a Group Responsible's position is named by their own title, then
  -- by the Group setting groups.responsible_title; a Group Manager's by
  -- groups.manager_title, as before.
  if v_current = 'responsible' then
    v_old_display := coalesce(v_row.position_title,
                              nullif(btrim(v_group.responsible_title), ''),
                              'responsabil');
  else
    v_old_display := coalesce(v_row.position_title,
                              nullif(btrim(v_group.manager_title), ''),
                              'coordonator de grup');
  end if;

  if p_group_role = 'member' and v_group.automatic_membership then
    -- Shape 5: the row goes rather than becoming an ordinary one. The Member
    -- keeps their place in the Group through the derived roster.
    delete from public.group_members as membership
     where membership.group_id = p_group_id and membership.member_id = p_member_id;
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire încheiată în ' || v_group.name,
      'Nu mai ești ' || v_old_display || ' în grupul ' || v_group.name || '.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
    return null;
  end if;

  update public.group_members as membership
     set group_role     = p_group_role,
         position_title = v_title
   where membership.group_id = p_group_id and membership.member_id = p_member_id
  returning * into v_row;

  if p_group_role = 'member' then
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire încheiată în ' || v_group.name,
      'Nu mai ești ' || v_old_display || ' în grupul ' || v_group.name
        || ', dar rămâi membru.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
  else
    if p_group_role = 'responsible' then
      v_display := coalesce(v_title, nullif(btrim(v_group.responsible_title), ''), 'responsabil');
    else
      v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    end if;
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$function$;

comment on function private.set_group_role_impl(bigint, uuid, text, text) is
  'Body behind public.set_group_role (#583): argument validation, the tier decision (the parent''s Managers for manager, the Group''s own for everything else), the gate-then-locks order, and the insert / update / delete branches with their Notifications. Lock order is gate -> public.groups FOR NO KEY UPDATE -> the target roster row FOR UPDATE, the same order #582''s update commands take; taking the Group before the gate would invert it and deadlock against public.update_group, which holds a Manager''s roster row FOR SHARE and then reaches for the Group. The Group is FOR NO KEY UPDATE rather than FOR UPDATE because this command does not write it — it needs the Minimum Level, status and Automatic Membership it judges the row against to hold still, which is exactly what serializes it against a concurrent Minimum-Level raise. Its Notifications name the position a Member takes or leaves (#962): a Group Responsible by their own title, then the Group setting groups.responsible_title, then "responsabil"; a Group Manager by groups.manager_title, then "coordonator de grup".';

-- ---------------------------------------------------------------------------
-- appoint_group_member: the same wording on the one insert path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.appoint_group_member(p_group_id bigint, p_member_id uuid, p_actor uuid, p_group_role text DEFAULT 'member'::text, p_position_title text DEFAULT NULL::text, p_notify boolean DEFAULT true)
 RETURNS public.group_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_group   public.groups%rowtype;
  v_title   text := nullif(btrim(p_position_title), '');
  v_row     public.group_members%rowtype;
  v_display text;
begin
  -- No gate of its own (#582's private.cancel_event_effect established the
  -- shape): every caller brings its own authority — add_group_member_impl the
  -- work tier, set_group_role_impl the Manager tier, create_group_impl the
  -- parent's Managers, #602's provisioning the inviting BC's level. What lives
  -- here is what must be true of the ROSTER ROW whoever writes it, so that no
  -- second path can ever be a shortcut past it.
  --
  -- Malformed arguments first, as in every command (conventions section 2).
  -- set_group_role_impl has already answered these for a client call; a
  -- programmatic caller such as provisioning has not.
  if p_group_role is null or p_group_role not in ('manager', 'responsible', 'member') then
    raise sqlstate 'PT400' using message = 'invalid_group_role';
  end if;
  if p_position_title is not null and v_title is null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  -- Security pass 2026-09-27 (L1): group_members_position_title_length_ck.
  perform private.require_text_length('position_title', v_title, null, 80);
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role <> 'responsible' and v_title is not null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;

  select grp.* into v_group
    from public.groups as grp
   where grp.id = p_group_id
   for no key update;
  if not found then
    -- Non-disclosing, like every other refusal in this family: an unknown
    -- Group, an archived one below level 6 and one the caller may not touch
    -- are a single answer.
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  -- The Member's profile is held FOR SHARE before a roster row names it, so a
  -- concurrent deactivation serializes behind this decision instead of
  -- committing underneath it (conventions section 2).
  perform 1 from public.profiles as target
    where target.id = p_member_id and target.status = 'activ'
    for share of target;
  if not found then
    raise sqlstate 'PT400' using message = 'group_member_not_eligible';
  end if;
  if coalesce(private.actor_level(p_member_id), -1) < v_group.min_level then
    raise sqlstate 'PT400' using message = 'group_member_below_min_level';
  end if;

  -- Shape 5: a Group whose roster follows the rank holds no ordinary rows.
  if p_group_role = 'member' and v_group.automatic_membership then
    raise sqlstate 'PT409' using message = 'automatic_group_has_no_roster_members';
  end if;

  if exists (select 1 from public.group_members as existing
              where existing.group_id = p_group_id
                and existing.member_id = p_member_id) then
    raise sqlstate 'PT409' using message = 'already_group_member';
  end if;

  insert into public.group_members (group_id, member_id, group_role, position_title)
  values (p_group_id, p_member_id, p_group_role, v_title)
  returning * into v_row;

  -- #861 (Audit D-20): a caller whose own Notification already tells the
  -- target (decide_group_application's "Cerere acceptată: <Group>") passes
  -- p_notify => false, so the target hears about one decision once. Every
  -- other caller keeps the default and this Notification.
  if p_notify is false then
    return v_row;
  end if;

  -- One direct Notification to the TARGET, in the same transaction, never to
  -- the actor (ruling R25 — private.notify drops the actor from the recipient
  -- array by itself, so an actor appointing themselves is told nothing). The
  -- link is the member-facing Group page (#589).
  if p_group_role = 'member' then
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Ai fost adăugat în ' || v_group.name,
      -- #843 (B36): the title says it all.
      null,
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  else
    -- #962: the position's display name -- a Group Responsible's own title,
    -- then the Group setting groups.responsible_title; a Group Manager's
    -- groups.manager_title.
    if p_group_role = 'responsible' then
      v_display := coalesce(v_title, nullif(btrim(v_group.responsible_title), ''), 'responsabil');
    else
      v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    end if;
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$function$;

comment on function private.appoint_group_member(bigint, uuid, uuid, text, text, boolean) is
  'The Appointment core (#583, rulings R6/R27): the ONLY insert path into public.group_members outside migrations'' own backfills, the Wave 1 mirror writers (dropped by #586) and rolled-back test fixtures. It carries no authority check of its own — like private.cancel_event_effect (#582), the gates stay with the callers: private.add_group_member_impl brings the work tier, private.set_group_role_impl the Manager tier, private.create_group_impl the parent''s Managers, and #602''s provisioning the inviting BC''s level, passed as p_actor. What it carries is everything that must be true of the roster row whoever writes it: the Group exists (42501 group_manage_forbidden, non-disclosing) and is active (PT409 group_archived); the Member is live (PT400 group_member_not_eligible — an unknown or inactive target) and at or above the Group''s Minimum Level (PT400 group_member_below_min_level); the Group Role is one of the three (PT400 invalid_group_role) with a display name exactly when it is responsible (PT400 position_title_required / invalid_position_title); an Automatic-Membership Group takes no ordinary row (PT409 automatic_group_has_no_roster_members); and the Member is not already on the roster (PT409 already_group_member). It holds the Group FOR NO KEY UPDATE and the target''s profiles row FOR SHARE, so a concurrent Minimum-Level raise or deactivation serializes behind the decision. It writes exactly one direct system Notification to the target with link /grupuri/<group_id> — added to the Group, or appointed under the position''s display name (a Group Responsible''s own title, then the Group setting groups.responsible_title (#962), then "responsabil"; for a Group Manager the Group setting groups.manager_title, then "coordonator de grup") — and private.notify drops the actor, so appointing yourself notifies nobody. With p_notify => false it writes none (#861, Audit D-20): private.decide_group_application_impl passes it because its own "Cerere acceptată: <Group>" already tells the applicant. Executable by no client role.';
