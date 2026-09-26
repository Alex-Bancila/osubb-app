-- #697: a Group's application form link -- groups.application_form_label/_url, set through update_group.
--
-- Ruling R18 of the 2026-09-23 grill; CONTEXT.md "Application" and "Attached
-- Link". A Group may point applicants to an external form instead of the
-- in-app Application: one optional Attached Link, "Formular de înscriere",
-- stored as two columns that travel together (the announcements_form_ck /
-- tasks_link_ck shape). It is a Group SETTING, not a rule of any Group kind,
-- and it couples to nothing server-side: apply_to_group and the other
-- Application commands are untouched, and whether the in-app path is offered
-- when a link exists is the frontend's decision (#698).
--
-- The columns are readable by every Member who can read the Group row under
-- groups_read, like every other setting -- an applicant has to open the link.
-- The only write path is public.update_group, which is dropped and recreated
-- with two parameters inserted before p_confirm_removals, so PostgREST never
-- sees two overloads. Authority is unchanged: private.require_group_manager.
--
-- Step 1, before the gate and for everyone: both values are trimmed (blank ->
-- null, rulings R6/R8) and judged by #684's private.require_attached_link, so
-- the reasons are the Attached Link vocabulary the Task link already uses --
-- PT400 link_incomplete / link_label_too_long / link_url_too_long /
-- link_url_invalid. Three named constraints hold the same rules underneath.
-- The columns are new and every existing row is null, so the constraints are
-- added valid in this one migration (the two-step NOT VALID rule in
-- conventions section 3 is for a new limit over rows that already exist).
--
-- update_group_impl's body is rebuilt from main's latest definition (#673's
-- step-1 length check in 20260923231125_constraints_kit.sql, over #584's
-- Application withdrawal); nothing else in it changes.

-- ---------------------------------------------------------------------------
-- The columns and their invariants.
-- ---------------------------------------------------------------------------
alter table public.groups
  add column application_form_label text,
  add column application_form_url text,
  add constraint groups_application_form_ck
    check ((application_form_url is null) = (application_form_label is null)),
  add constraint groups_application_form_label_ck
    check (application_form_label is null
           or (application_form_label ~ '[^[:space:]]'
               and char_length(application_form_label) <= 60)),
  add constraint groups_application_form_url_ck
    check (application_form_url is null
           or (application_form_url ~ '^https?://'
               and char_length(application_form_url) <= 2048));

comment on column public.groups.application_form_label is
  '#697 (ruling R18): the label of the Group''s "Formular de înscriere" Attached Link -- at most 60 characters, set together with application_form_url (groups_application_form_ck). Written only by public.update_group.';
comment on column public.groups.application_form_url is
  '#697 (ruling R18): the http(s) address of the Group''s "Formular de înscriere" Attached Link -- at most 2048 characters, set together with application_form_label (groups_application_form_ck). When set, applicants are sent to the form and joining happens by Appointment (#698). Written only by public.update_group.';

-- ---------------------------------------------------------------------------
-- update_group: two new parameters, drop and recreate.
-- ---------------------------------------------------------------------------
drop function public.update_group(bigint, text, text, boolean, integer, boolean, integer, boolean);
drop function private.update_group_impl(bigint, text, text, boolean, integer, boolean, integer, boolean);

create function private.update_group_impl(
  p_group_id               bigint,
  p_name                   text,
  p_manager_title          text,
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
as $$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_parent      public.groups%rowtype;
  v_accepts     boolean := coalesce(p_accepts_applications, false);
  v_shared      boolean := coalesce(p_shared_work_visibility, false);
  v_title       text    := nullif(btrim(p_manager_title), '');
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
       and num_nonnulls(sibling.legacy_dept_id, sibling.legacy_team_id, sibling.legacy_project_id) = 0
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  if (btrim(p_name), v_title, v_accepts, p_application_level, v_shared, p_min_level,
      v_form_label, v_form_url)
     is not distinct from
     (v_group.name, v_group.manager_title, v_group.accepts_applications,
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
$$;

create function public.update_group(
  p_group_id               bigint,
  p_name                   text,
  p_manager_title          text,
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
    p_group_id, p_name, p_manager_title, p_accepts_applications,
    p_application_level, p_shared_work_visibility, p_min_level,
    p_application_form_label, p_application_form_url, p_confirm_removals);
$$;

-- ---------------------------------------------------------------------------
-- Comments and grants (conventions section 4).
-- ---------------------------------------------------------------------------
comment on function public.update_group(bigint, text, text, boolean, integer, boolean, integer, text, text, boolean) is
  'Replaces a Group''s OPERATIONAL settings (#582, ADR-0009 Decision 5): name, the Group Manager''s display name, Accepts Applications with its Application Level, Shared Work Visibility, a Child Group''s Minimum Level and (#697, ruling R18) the "Formular de înscriere" application form link. Authorized by private.require_group_manager -- the Group''s own Managers and those of its ancestors, plus BC and the Moderator; a Group Responsible is refused. This is a full-state REPLACE, not a patch (conventions OD5): every column above is written from its argument, so a null clears a nullable one and a caller that wants to keep a value must send it back. Malformed input first, for everyone: PT400 invalid_group_name / name_too_short / name_too_long / invalid_position_title / invalid_group_min_level / invalid_application_level / application_level_below_min_level, then the application form link -- both values trimmed, blank -> null, and judged by private.require_attached_link: link_incomplete (label or address alone), link_label_too_long (over 60), link_url_too_long (over 2048), link_url_invalid (not http(s)). A TOP-LEVEL Group''s Minimum Level is structural, so changing it below live level 6 is 42501 group_manage_forbidden -- the mirror image of update_group_structure, which refuses a CHILD''s. Then PT409 group_archived; PT409 automatic_group_accepts_no_applications (a Group whose roster follows the rank accepts none, groups_automatic_no_applications_ck); PT400 group_min_level_below_parent / group_min_level_above_children / group_min_level_above_actor (Moderator exempt); PT409 group_name_taken; PT409 nothing_to_update when the state sent back is identical, the link included. Raising the Minimum Level above existing members is PT409 group_has_members_below_level, with the count in DETAIL (the message stays the snake_case reason the frontend matches on), unless p_confirm_removals is true -- then exactly those roster rows are deleted, whatever Group Role they carried, their pending Applications on this Group are withdrawn (#584, ruling R30), each removed Member is notified directly and the Group''s Managers get one summary. Descendants are never touched: group_min_level_above_children has already refused a level above a child''s. The link couples to nothing server-side: an Automatic-Membership Group may store one, and the Application commands never read it (#698 decides where "Aplică" goes).';

comment on function private.update_group_impl(bigint, text, text, boolean, integer, boolean, integer, text, text, boolean) is
  'Body behind public.update_group (#582): the operational settings, the top-level Minimum-Level split, the tree and actor bounds, the full-state replace and ruling R23''s Minimum-Level removal behind p_confirm_removals. Since #584 (ruling R30) the removal also withdraws those Members'' pending Applications on this Group, with the actor as decider. Since #697 (ruling R18) it also replaces the application form link, trimmed and judged at step 1 by private.require_attached_link.';

revoke execute on function private.update_group_impl(bigint, text, text, boolean, integer, boolean, integer, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_group(bigint, text, text, boolean, integer, boolean, integer, text, text, boolean)
  from public, anon, authenticated, service_role;

grant execute on function private.update_group_impl(bigint, text, text, boolean, integer, boolean, integer, text, text, boolean)
  to authenticated;
grant execute on function public.update_group(bigint, text, text, boolean, integer, boolean, integer, text, text, boolean)
  to authenticated;
