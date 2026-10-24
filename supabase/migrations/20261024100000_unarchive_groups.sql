-- #1110 (ruling R65, 2026-10-24): an archived Group can come back.
--
-- public.archive_group (newest in 20260922224243_group_applications.sql) had
-- no inverse: a Group archived by mistake, or a yearly project that returns,
-- could only be created again, losing its history and its Department Cup
-- attribution. public.unarchive_group is that inverse, and it mirrors
-- archiving:
--
--   * Authority is archiving's rule: BC or the Moderator (live level >= 6) for
--     a top-level Group, a Group Manager on the path for a Child Group. It
--     cannot simply call private.require_group_manager, because that helper
--     refuses an ARCHIVED Group below level 6 (private.can_manage_group_work's
--     status gate) -- and every Group this command sees is archived. So the
--     Child-Group branch reads the same rule without the status test: a live
--     active Member at level >= 6, or one holding a 'manager' roster row on a
--     Group of the target's path, the rows held FOR SHARE as the work tier
--     holds them. Every refusal is the one non-disclosing 42501
--     group_manage_forbidden, an unknown id included.
--   * PT409 group_not_archived for an active Group; PT409
--     group_parent_archived for a Child Group whose parent is archived (the
--     parent comes back first, and brings this one with it).
--   * The Group and every archived Group below it become active in ONE
--     statement over groups.path, as archiving cascaded the other way. Below
--     an archived Group everything is archived (archiving cascades and nothing
--     is created or unarchived under an archived parent), so the subtree that
--     returns is exactly the subtree.
--   * Nothing archiving ended comes back: cancelled Events stay cancelled,
--     declined Applications stay declined. No Event, Application, Task, roster
--     row, Group Role or setting is touched -- those were kept, so they are
--     simply there again.
--
-- Lock order is delete_group's and archive_group's: the parent (a possible
-- parent row is FOR NO KEY UPDATE, conventions section 2), then the target
-- FOR NO KEY UPDATE (it is a parent itself), then the gate, then the rest of
-- the subtree in one id-ordered statement. A child's id is always above its
-- parent's (a parent is fixed at creation, ruling R20), so this is ascending
-- id order throughout and serializes against a concurrent archive or delete
-- of any Group on the path instead of crossing it.

-- ==================== 1 · the command ====================

create function private.unarchive_group_impl(p_group_id bigint)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid;
  v_parent_id bigint;
  v_group     public.groups%rowtype;
  v_parent    public.groups%rowtype;
  v_updated   public.groups%rowtype;
begin
  -- 1. The parent first. groups.parent_id never changes (ruling R20), so the
  --    unlocked read names the row to lock.
  select parent_id into v_parent_id from public.groups where id = p_group_id;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if v_parent_id is not null then
    select * into v_parent from public.groups where id = v_parent_id for no key update;
  end if;

  select * into v_group from public.groups where id = p_group_id for no key update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  -- 2. The gate: archive_group's two branches, with the Child branch read
  --    without can_manage_group_work's active-status test.
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
    if v_group.parent_id is null then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    -- The roster rows the authority rests on, never a groups row: a Group
    -- Manager of the target or of any Group above it.
    perform 1
       from public.group_members as gm
      where gm.group_id = any (v_group.path)
        and gm.member_id = v_actor
        and gm.group_role = 'manager'
      order by gm.group_id
        for share of gm;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
  end if;

  perform 1
     from public.groups as descendant
    where descendant.path @> array[p_group_id]
      and descendant.id <> p_group_id
    order by descendant.id
      for no key update;

  -- 3. State.
  if v_group.status <> 'archived' then
    raise sqlstate 'PT409' using message = 'group_not_archived';
  end if;
  if v_parent_id is not null and v_parent.status = 'archived' then
    raise sqlstate 'PT409' using message = 'group_parent_archived';
  end if;

  -- 4. The whole archived subtree returns in one statement.
  update public.groups
     set status = 'active'
   where path @> array[p_group_id]
     and status = 'archived';

  select * into v_updated from public.groups where id = p_group_id;
  return v_updated;
end;
$$;

create function public.unarchive_group(p_group_id bigint)
returns public.groups
language sql
security invoker
set search_path = ''
as $$
  select private.unarchive_group_impl(p_group_id);
$$;

-- ==================== 2 · comments ====================

comment on function public.unarchive_group(bigint) is
  'Unarchives a Group and every archived Group below it (#1110, ruling R65, ADR-0009 amended 2026-10-24) -- the inverse of public.archive_group. Whoever may archive the Group may unarchive it: BC and the Moderator (live level >= 6) for a top-level Group; for a Child Group also a Group Manager of it or of any Group above it. Unknown and unauthorized are the same 42501 group_manage_forbidden. PT409 group_not_archived for an active Group; PT409 group_parent_archived for a Child Group whose parent is archived, which must come back first. The Group and its archived subtree become active in ONE statement over groups.path. Nothing archiving ended comes back: cancelled Events stay cancelled and declined Applications stay declined; rosters, Group Roles, settings and history were kept, so they are simply there again. Returns the Group''s row.';

comment on function private.unarchive_group_impl(bigint) is
  'Body behind public.unarchive_group (#1110, ruling R65): the parent and the target FOR NO KEY UPDATE, the gate, the subtree FOR NO KEY UPDATE in id order, the two state refusals, and the one-statement status cascade. The gate is archive_group''s rule read without private.can_manage_group_work''s active-status test, which would refuse every archived Group below level 6: a live active Member (Profile FOR SHARE) at level >= 6, or, for a Child Group, one holding a manager roster row on a Group of its path (those rows FOR SHARE). Touches no Event, Application, Task or roster row.';

-- ==================== 3 · grants (conventions section 4, four-role revoke) ====================

revoke execute on function private.unarchive_group_impl(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.unarchive_group_impl(bigint)
  to authenticated;

revoke execute on function public.unarchive_group(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.unarchive_group(bigint)
  to authenticated;
