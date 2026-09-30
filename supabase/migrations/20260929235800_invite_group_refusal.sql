-- #949: "Invită membru" places a new Member in SEVERAL Groups, and an
-- ineligible choice refuses the whole invitation with a reason BC can read --
-- before anyone is emailed.
--
-- What already held, and still does: public.provision_profile takes a list of
-- Group ids and appoints each through private.appoint_group_member inside one
-- call, so a refusing Group rolls back the profile and every earlier
-- Appointment (supabase/tests/provision_profile.test.sql pins it). That call
-- stays the authority and is not changed here.
--
-- What did not: invite-member sends the magic link BEFORE it provisions,
-- because provisioning needs the Auth user the invitation creates. A Group
-- that refused the Appointment was therefore answered by deleting an account
-- whose invitation had already left -- a real person mailed a dead link. With
-- one Group that was rare; with several it is the common mistake. The
-- function only screened out unknown ids beforehand.
--
-- public.provision_group_refusal answers, without writing anything and before
-- the invitation is sent, the first refusal provision_profile would meet for a
-- new, active Member of p_role: it walks the ids in provision_profile's order
-- (ascending, duplicates collapsed) and asks each Group the questions the
-- Appointment core asks of the roster row, in the core's order --
--
--   unknown Group          -> group_manage_forbidden (42501 in the core)
--   status <> 'active'     -> group_archived (PT409)
--   rank below min_level   -> group_member_below_min_level (PT400)
--   automatic_membership   -> automatic_group_has_no_roster_members (PT409)
--
-- The core's two member-side questions have one answer for a Member created
-- `activ` one statement earlier with no roster row yet: group_member_not_eligible
-- and already_group_member cannot occur, so they are not asked. The rank's
-- level comes from public.roles, which is what private.actor_level reads for
-- a live Member. supabase/tests/invite_group_refusal.test.sql proves the two
-- answer alike Group by Group (the parity section), so neither can drift.
--
-- Advisory, not authority: no lock is taken, and provision_profile asks every
-- question again under its locks. A Group archived between the two calls is
-- still refused -- after the mail, as before, and rarer than ever.
--
-- Service-role only, like provision_profile and member_level.

create function public.provision_group_refusal(
  p_role      public.member_role,
  p_group_ids bigint[]
)
returns table (group_id bigint, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_level integer;
  v_id    bigint;
  v_group public.groups%rowtype;
begin
  -- provision_profile's own default rank, so a null reads as it would there.
  select role.level into v_level
    from public.roles as role
   where role.id = coalesce(p_role, 'recrut'::public.member_role);

  for v_id in
    select distinct g
      from unnest(coalesce(p_group_ids, '{}'::bigint[])) as g
     order by 1
  loop
    select grp.* into v_group
      from public.groups as grp
     where grp.id = v_id;

    group_id := v_id;
    if not found then
      reason := 'group_manage_forbidden';
    elsif v_group.status <> 'active' then
      reason := 'group_archived';
    elsif coalesce(v_level, -1) < v_group.min_level then
      reason := 'group_member_below_min_level';
    elsif v_group.automatic_membership then
      reason := 'automatic_group_has_no_roster_members';
    else
      continue;
    end if;

    -- The first refusal is the one provision_profile would raise.
    return next;
    return;
  end loop;
end;
$function$;

revoke execute on function public.provision_group_refusal(public.member_role, bigint[])
  from public, anon, authenticated, service_role;
grant execute on function public.provision_group_refusal(public.member_role, bigint[])
  to service_role;

comment on function public.provision_group_refusal(public.member_role, bigint[]) is
  'The first refusal public.provision_profile would meet placing a NEW, active Member of p_role in p_group_ids (#949), answered before invite-member or csv-import sends the invitation, so an ineligible Group no longer mails a person a link to an account that is then deleted. Zero rows: every Group would accept them. One row (group_id, reason): the first refusing Group in provision_profile''s order (ascending id, duplicates collapsed) and the reason private.appoint_group_member would raise for it, asked in the core''s order -- group_manage_forbidden (unknown id), group_archived, group_member_below_min_level (the rank''s public.roles level below groups.min_level), automatic_group_has_no_roster_members. The core''s member-side reasons (group_member_not_eligible, already_group_member) cannot occur for a Member created activ with no roster row, so they are not asked. Advisory: reads without locks and writes nothing; provision_profile asks again under its locks and stays the authority. supabase/tests/invite_group_refusal.test.sql pins the two to the same answer Group by Group. Service-role only.';
