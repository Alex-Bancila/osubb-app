-- #602: provisioning places a new Member's initial Groups by Appointment
-- (ADR-0009 Wave 3, T25; ruling R27). Tested by
-- supabase/tests/provision_profile.test.sql.
--
-- public.provision_profile is the RPC BOTH Edge Functions call -- the single
-- invite (invite-member) and the CSV import (csv-import) -- and it is the only
-- door into the application (ADR-0003: public sign-up is disabled and RLS
-- denies anyone without a profile). Until now it placed the new Member by
-- inserting into public.member_departments and public.team_members and letting
-- the Wave 1 mirror derive the Groups. #590 drops both tables, so that door
-- closes the day it merges; this migration re-points it at the Groups model.
--
-- Four shapes are worth stating once, here.
--
-- 1. ONE INSERT PATH INTO public.group_members (rulings R6/R27). Provisioning
--    does NOT insert a roster row: it calls #583's private.appoint_group_member
--    once per Group, which is what carries every roster invariant --
--    group_archived, group_member_not_eligible, group_member_below_min_level,
--    automatic_group_has_no_roster_members, already_group_member -- and writes
--    the target's Appointment Notification. group_roster_commands.test.sql's
--    catalog sweep is what keeps this honest: a direct insert here would name
--    this function and turn that suite red.
--
-- 2. THE CALLER BRINGS THE AUTHORITY. The Appointment core has no gate of its
--    own; here the authority is the inviting BC's or Moderator's, which the
--    Edge Function has already verified against the DATABASE (member_level()
--    >= 6, never the caller's claims -- a token issued before a demotion still
--    carries the old level for up to an hour). That actor arrives as
--    p_appointed_by and is handed straight to the core as p_actor, so the new
--    Member's Appointment Notification is attributed to the person who invited
--    them. provision_profile itself stays service-role only, exactly as it was:
--    it runs as its owner and bypasses RLS by design, so a client must never
--    reach it.
--
-- 3. ALL OR NOTHING, AND ONE REFUSAL CLASS. A Group that refuses the
--    Appointment fails the WHOLE call, so a Member is never created
--    half-placed -- the profiles row goes with it. The core's reason string is
--    preserved verbatim, but its sqlstate is normalised to PT400 (#602's
--    acceptance criterion): from a service-role caller's point of view an
--    unknown, archived, Automatic or too-high Group id is malformed INPUT to
--    the provisioning call, and the core's 42501 group_manage_forbidden would
--    otherwise read as "the server identity lacks permission", which is never
--    what happened. The Edge Function maps the whole class to one 400.
--
-- 4. ASCENDING GROUP ID, DUPLICATES COLLAPSED. The core locks each
--    public.groups row FOR NO KEY UPDATE, so several Groups in one call are
--    taken in ascending id order (conventions section 1) -- two concurrent
--    provisioning calls naming the same two Groups can then never deadlock
--    against each other. `distinct` makes a CSV row that names the same Group
--    twice (a Team that IS the Department, say) succeed rather than raise
--    already_group_member on the second pass.
--
-- The legacy tables are deliberately NOT written any more. Writing them would
-- put a second, derived writer back on public.group_members through the Wave 1
-- mirror, which is exactly what #583 removed for the roster commands; the
-- stance here is the same one public.add_group_member already takes, and #590
-- drops the tables outright. The known transitional consequence is shared with
-- #583 and disappears with #586: while private.sync_department_memberships
-- still exists, a later role change across the BCE line re-derives that
-- Member's Department-Group rows from public.member_departments and would drop
-- an appointed row on a legacy-backed Department Group. That is a property of
-- the surviving mirror, not of this function, and it is the reason #586 exists.

drop function public.provision_profile(uuid, text, text, public.member_role, text[], text[]);

create function public.provision_profile(
  p_user_id      uuid,
  p_full_name    text,
  p_email        text,
  p_role         public.member_role default 'recrut',
  p_group_ids    bigint[]           default '{}',
  p_appointed_by uuid               default null
) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_group_id bigint;
  v_reason   text;
begin
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
$$;

comment on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid) is
  'Atomically provisions an invited auth user (ADR-0003, #602): the profiles row, then one Appointment per p_group_ids Group through private.appoint_group_member -- the ONE insert path into public.group_members (rulings R6/R27), which carries every roster invariant and writes the new Member''s Appointment Notification. p_appointed_by is the inviting BC or Moderator, whose live level >= 6 the Edge Function verifies from the database, and it reaches the core as p_actor, so the Notification is attributed to them (and private.notify drops the actor, so provisioning somebody as their own appointer notifies nobody). Groups are appointed in ascending id order with duplicates collapsed, so the FOR NO KEY UPDATE locks the core takes can never deadlock two concurrent calls. Any refusal from the core -- group_archived, group_member_not_eligible, group_member_below_min_level, automatic_group_has_no_roster_members, already_group_member, or the non-disclosing group_manage_forbidden for an unknown id -- fails the WHOLE call as PT400 carrying the core''s own reason string, so no half-placed Member survives. Writes no legacy membership table: #590 drops both. Service-role only; shared by the single-invite and CSV-import flows.';

-- Clients must never provision themselves — this runs as its owner and
-- bypasses RLS by design, so execute stays with the server identity only.
revoke execute on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid)
  to service_role;
