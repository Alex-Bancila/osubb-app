-- Security pass 2026-09-27, backend finding H1: only the Moderator may create
-- a BC or Moderator account.
--
-- public.provision_profile inserted whatever p_role the invite-member Edge
-- Function passed through, and that function's only gate was "the caller is
-- level >= 6". So a BC could send `"role": "moderator"` and mint a second
-- Moderator -- who could then re-rank or deactivate every other BC and the
-- real Moderator. set_member_role_impl and set_member_status_impl already
-- reserve appointing or unseating leadership to the Moderator; this closes
-- the one door where a leadership account could be created without passing
-- that rule.
--
-- The rule lives HERE, in the function every provisioning path calls, so no
-- Edge Function (invite-member, csv-import, a future one) can bypass it. The
-- functions refuse first as well, so a caller gets a clear 403 before any
-- Auth user exists; this is the backstop.
--
-- provision_profile is service_role only: auth.uid() is null in every call,
-- so the actor is p_appointed_by -- the caller the Edge Function verified.
-- A reserved rank (bc, moderator) is provisioned only when
--   * p_appointed_by is a live `activ` Moderator (the same predicate
--     set_member_role_impl applies to its actor, and the same row lock), or
--   * p_appointed_by is null, the role is `moderator`, and no `activ`
--     Moderator exists yet: the very first Moderator, created by
--     scripts/bootstrap-production.mjs with the service key before anyone
--     else (docs/backend/production-bootstrap.md).
-- Anything else is 42501 member_manage_forbidden -- the reason
-- set_member_role uses for the same case, so one condition has one string.
-- It is raised before the profiles insert, so nothing is written.
--
-- Rebuilt from the latest body on main (20260927120000_retire_level_four.sql);
-- only the rank check and the comment are new. Same signature, same grants.

create or replace function public.provision_profile(
  p_user_id      uuid,
  p_full_name    text,
  p_email        text,
  p_role         public.member_role default 'recrut'::public.member_role,
  p_group_ids    bigint[] default '{}'::bigint[],
  p_appointed_by uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_group_id  bigint;
  v_reason    text;
  v_appointer public.member_role;
begin
  -- The rank ceiling (H1). Leadership is the Moderator's to appoint, exactly
  -- as in set_member_role_impl; answered before anything is written.
  if p_role in ('bc', 'moderator') then
    if p_appointed_by is null then
      -- The bootstrap path: the first Moderator, appointed by nobody. Once an
      -- `activ` Moderator exists, a null appointer creates no leadership.
      -- Two concurrent bootstrap calls would both see "no Moderator yet", so
      -- the `moderator` Role row is locked first: the second call waits, and
      -- its check below (a new snapshot under read committed) sees the
      -- first's committed row. `for no key update`, the house mode for a row
      -- other tables reference, so a key-share lock on it is never blocked.
      if p_role = 'moderator' then
        perform 1
           from public.roles as role
          where role.id = 'moderator'
            for no key update;
      end if;
      if p_role <> 'moderator'
         or exists (select 1
                      from public.profiles as holder
                     where holder.role = 'moderator'
                       and holder.status = 'activ') then
        raise exception using errcode = '42501', message = 'member_manage_forbidden';
      end if;
    else
      select appointer.role into v_appointer
        from public.profiles as appointer
       where appointer.id = p_appointed_by
         and appointer.status = 'activ'
       for share;
      if v_appointer is distinct from 'moderator'::public.member_role then
        raise exception using errcode = '42501', message = 'member_manage_forbidden';
      end if;
    end if;
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (p_user_id, p_full_name, lower(trim(p_email)), p_role);

  -- Shape 4: ascending id, duplicates collapsed.
  begin
    for v_group_id in
      select distinct g
        from unnest(coalesce(p_group_ids, '{}'::bigint[])) as g
       order by 1
    loop
      -- Shape 1 and 2: the one insert path, with the inviting BC as the actor.
      perform private.appoint_group_member(v_group_id, p_user_id, p_appointed_by);
    end loop;
  exception
    -- Shape 3: keep the core's reason, normalise the class. Anything else --
    -- a 23505 on the profiles row, say, which invite-member reads to tell a
    -- race from a typo -- passes through untouched, because it is raised
    -- outside this block.
    when insufficient_privilege or sqlstate 'PT400' or sqlstate 'PT409' then
      get stacked diagnostics v_reason = message_text;
      raise sqlstate 'PT400' using message = v_reason;
  end;

  return p_user_id;
end;
$function$;

revoke execute on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid)
  to service_role;

comment on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid) is 'Atomically provisions an invited auth user (ADR-0003, #602): the profiles row, then one Appointment per p_group_ids Group through private.appoint_group_member -- the ONE insert path into public.group_members (rulings R6/R27), which carries every roster invariant and writes the new Member''s Appointment Notification. p_appointed_by is the inviting BC or Moderator, whose live level >= 6 the Edge Function verifies from the database, and it reaches the core as p_actor, so the Notification is attributed to them (and private.notify drops the actor, so provisioning somebody as their own appointer notifies nobody). Rank ceiling (security pass 2026-09-27, H1): a bc or moderator profile is provisioned only when p_appointed_by is a live activ Moderator -- the rule set_member_role applies -- or, for the bootstrap, when p_appointed_by is null, the role is moderator and no activ Moderator exists yet; anything else is 42501 member_manage_forbidden before anything is written. Groups are appointed in ascending id order with duplicates collapsed, so the FOR NO KEY UPDATE locks the core takes can never deadlock two concurrent calls. Any refusal from the core -- group_archived, group_member_not_eligible, group_member_below_min_level, automatic_group_has_no_roster_members, already_group_member, or the non-disclosing group_manage_forbidden for an unknown id -- fails the WHOLE call as PT400 carrying the core''s own reason string, so no half-placed Member survives. Writes no legacy membership table: #590 drops both. Service-role only; shared by the single-invite and CSV-import flows.';
