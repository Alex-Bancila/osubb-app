-- #1047: only a top-level Department competes in the Department Cup -- the server refuses what the settings form already hides.
--
-- Alex, 2026-10-11: "the Department Cup is a Department's" -- a top-level Team
-- or Project competes in nothing. #1044 shipped that in the settings form
-- alone: update_group_structure still took the flag for any top-level Group,
-- and groups_competes_top_level_ck was the only constraint. A Project flagged
-- before the form changed therefore stayed in the standings until someone
-- saved its settings again.
--
-- This amends ADR-0009, which made Cup participation a setting that no rule
-- reads the presentation label for. The amendment is narrow: the label is
-- checked where the setting is WRITTEN -- this command and one table
-- constraint. Every read (public.department_cup, the Leaderboard, authority,
-- visibility, membership, notifications) still reads the setting alone, and
-- conventions.test.sql still sweeps them.

-- 1. A Group flagged outside the Department label leaves the Cup. No Task
--    Points move: the standings are computed from the setting at read time,
--    so the Group's row simply stops appearing in them.
update public.groups
   set competes_in_cup = false
 where competes_in_cup
   and category <> 'department';

-- 2. The table refuses that state from now on, whoever writes it. Added
--    valid, not `not valid`: step 1 just made every row comply and groups is
--    a small table, so the validating scan is instant.
alter table public.groups
  add constraint groups_competes_department_ck
  check (not competes_in_cup or category = 'department');

-- 3. The command says why before the constraint would. Restated from the
--    live body (20260927150000_column_limits.sql) with one check added beside
--    cup_not_top_level; nothing else changes.
CREATE OR REPLACE FUNCTION private.update_group_structure_impl(p_group_id bigint, p_category text, p_competes_in_cup boolean, p_counts_toward_parent_cup boolean, p_automatic_membership boolean, p_min_level integer, p_color text, p_short text, p_is_organization boolean, p_is_private boolean, p_confirm_removals boolean DEFAULT false)
 RETURNS public.groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_parent      public.groups%rowtype;
  v_competes    boolean := coalesce(p_competes_in_cup, false);
  v_counts      boolean := coalesce(p_counts_toward_parent_cup, true);
  v_automatic   boolean := coalesce(p_automatic_membership, false);
  v_is_org      boolean := coalesce(p_is_organization, false);
  v_short       text    := nullif(btrim(p_short), '');
  v_updated     public.groups%rowtype;
  v_below       uuid[];
  v_removed     uuid[];
  v_managers    uuid[];
begin
  if p_category is null
     or p_category not in ('department', 'project', 'team', 'organization') then
    raise sqlstate 'PT400' using message = 'invalid_group_category';
  end if;
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise sqlstate 'PT400' using message = 'invalid_group_color';
  end if;
  -- Security pass 2026-09-27 (L1): groups_short_length_ck.
  perform private.require_text_length('short', v_short, null, 16);
  -- #756: a full-state replace must say which it is. A null is refused rather
  -- than read as "public", which would un-hide a Private Group by omission.
  if p_is_private is null then
    raise sqlstate 'PT400' using message = 'invalid_group_privacy';
  end if;
  -- #756: the Organization Group is every Member's, so it cannot be private --
  -- and since privacy cascades down, marking it so would hide the whole tree.
  if p_is_private and v_is_org then
    raise sqlstate 'PT400' using message = 'private_not_allowed_for_organization';
  end if;

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
  v_actor_level := private.actor_level(v_actor);
  if coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.parent_id is not null
     and p_min_level is distinct from v_group.min_level then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  if v_competes and v_group.parent_id is not null then
    raise sqlstate 'PT409' using message = 'cup_not_top_level';
  end if;
  -- ADR-0009, amended 2026-10-13 (Alex, 2026-10-11): the Department Cup is a
  -- Department's. The one place this command reads the label it writes, and
  -- it reads the REQUESTED label: a Group that takes another label leaves the
  -- Cup in the same command or is refused.
  if v_competes and p_category <> 'department' then
    raise sqlstate 'PT409' using message = 'cup_not_department';
  end if;
  if v_is_org and exists (select 1 from public.groups as other
                           where other.is_organization and other.id <> p_group_id) then
    raise sqlstate 'PT409' using message = 'organization_group_exists';
  end if;
  if v_automatic and not v_group.automatic_membership
     and exists (select 1 from public.group_members as membership
                  where membership.group_id = p_group_id
                    and membership.group_role = 'member') then
    raise sqlstate 'PT409' using message = 'automatic_group_has_roster_members';
  end if;
  if v_automatic and v_group.accepts_applications then
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
    -- #756 (ruling R25): a Private Group's subtree is private. The parent is
    -- held FOR NO KEY UPDATE above, so it cannot turn private underneath.
    if v_parent.is_private and not p_is_private then
      raise sqlstate 'PT400' using message = 'private_parent';
    end if;
  end if;
  if exists (select 1 from public.groups as child
              where child.parent_id = p_group_id and child.min_level < p_min_level) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_children';
  end if;
  if coalesce(v_actor_level, -1) < 9 and p_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  if (p_category, v_competes, v_counts, v_automatic, p_min_level, p_color, v_short, v_is_org,
      p_is_private)
     is not distinct from
     (v_group.category, v_group.competes_in_cup, v_group.counts_toward_parent_cup,
      v_group.automatic_membership, v_group.min_level, v_group.color,
      v_group.short, v_group.is_organization, v_group.is_private) then
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
     set category                 = p_category,
         competes_in_cup          = v_competes,
         counts_toward_parent_cup = v_counts,
         automatic_membership     = v_automatic,
         min_level                = p_min_level,
         color                    = p_color,
         short                    = v_short,
         is_organization          = v_is_org,
         is_private               = p_is_private,
         -- #756: a Private Group accepts no Applications (ruling R25).
         accepts_applications     = accepts_applications and not p_is_private
   where id = p_group_id
  returning * into v_updated;

  -- #756 (ruling R25): turning a Group private hides its whole subtree in this
  -- same transaction, and a Private Group accepts no Applications; turning it
  -- public leaves the Child Groups as they are. The descendants are Child rows
  -- of a row already held FOR UPDATE, so the update's own FOR NO KEY UPDATE is
  -- the only lock they take (conventions section 2); archive_group cascades
  -- over the same `path @>` set in the same order.
  --
  -- The cascade repeats until a pass changes nothing. create_group locks only
  -- its parent, so a Child Group created under a descendant while a pass is
  -- waiting on that descendant commits after the pass's snapshot was taken and
  -- the pass cannot see it. The next statement takes a fresh snapshot (READ
  -- COMMITTED) and does. A create that starts later waits on the descendant
  -- this command now holds and reads it private. Locking the whole ancestor
  -- path in create_group instead would invert update_group's and this
  -- command's own child-then-parent order and deadlock them.
  if p_is_private and not v_group.is_private then
    loop
      update public.groups as below
         set is_private           = true,
             accepts_applications = false
       where below.path @> array[p_group_id]
         and below.id <> p_group_id
         and (not below.is_private or below.accepts_applications);
      exit when not found;
    end loop;

    -- An Application filed before the Group turned private is not
    -- grandfathered: it is withdrawn with the actor as decider, exactly as
    -- ruling R23's Minimum-Level removal withdraws one (#584, ruling R30).
    perform 1 from public.group_applications as application
      join public.groups as below on below.id = application.group_id
     where below.path @> array[p_group_id]
       and application.status = 'pending'
     order by application.id
       for update of application;

    update public.group_applications as application
       set status     = 'withdrawn',
           decided_by = v_actor,
           decided_at = clock_timestamp()
      from public.groups as below
     where below.id = application.group_id
       and below.path @> array[p_group_id]
       and application.status = 'pending';
  end if;

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


comment on function private.update_group_structure_impl(bigint, text, boolean, boolean, boolean, integer, text, text, boolean, boolean, boolean) is
  'Body behind public.update_group_structure (#582): BC''s and the Moderator''s structural settings, the child Minimum-Level split, the tree and actor bounds, the full-state replace and ruling R23''s Minimum-Level removal behind p_confirm_removals. Since #584 (ruling R30) the removal also withdraws those Members'' pending Applications on this Group, with the actor as decider, exactly as private.update_group_impl does. Since #756 (ruling R25) it owns the Private Group setting: refused public under a private parent, cascaded down the subtree (with Applications switched off and pending ones withdrawn) when turned on, repeated until a pass changes nothing so a Child Group created concurrently under a descendant is caught too. This is one of the two Group commands allowed to write the presentation label -- it and private.create_group_impl are the only writers, and conventions.test.sql''s sweep names them (ruling R16). Since #1047 (ADR-0009 amended 2026-10-13) it also reads the label it is asked to write, for one rule only: PT409 cup_not_department when the requested state competes in the Department Cup under any label but department, after PT409 cup_not_top_level for a Child Group; groups_competes_department_ck backs it. It never writes groups.parent_id: a Group''s parent is fixed at creation (ruling R20).';
