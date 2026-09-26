-- #593: deploy only after the human re-ranking in #592. No holder is
-- silently reassigned, including inactive profiles.
do $$ declare v_holders bigint; begin
 select count(*) into v_holders from public.profiles where role::text='responsabil';
 if v_holders > 0 then
  raise exception using errcode='23514',message='responsabil_holder_remains',
   detail=format('%s profile(s), of any status, still hold the retired responsabil rank.', v_holders),
   hint='Re-rank every holder with public.set_member_role first (#592); nothing was changed.';
 end if;
end $$;
-- OD3: colleague attendance moves from level 4 to level 5 (a level only ever
-- moves up). The policy keeps its command, roles and every other limb.
alter policy event_attendance_read on public.event_attendance
using(public.auth_is_member() and exists(select 1 from public.events e where e.id=event_attendance.event_id)
 and (member_id=(select auth.uid()) or public.auth_level()>=5));

-- The audit is historical: keep past rank names as text, including the retired
-- rank, without retaining it in the live enum. New commands accept only live ranks.
alter table public.role_history drop constraint role_history_voting_actor_ck;
alter table public.role_history alter column from_role type text using from_role::text,
 alter column to_role type text using to_role::text;
alter table public.role_history add constraint role_history_voting_actor_ck
 check((from_role<>'vot' and to_role<>'vot') or actor_kind='human');
alter table public.role_history add constraint role_history_role_names_ck check(
 from_role in ('recrut','voluntar','activ','vot','responsabil','bce','bc','moderator') and
 to_role in ('recrut','voluntar','activ','vot','responsabil','bce','bc','moderator'));

drop view public.leaderboard;
drop view public.profiles_directory;
drop function public.auth_role();
drop function public.provision_profile(p_user_id uuid, p_full_name text, p_email text, p_role member_role, p_group_ids bigint[], p_appointed_by uuid);
drop function public.set_member_role(p_member_id uuid, p_role member_role, p_reason text);
drop function public.member_card(p_member_id uuid);
drop function private.set_member_role_impl(p_member_id uuid, p_role member_role, p_reason text);
drop function private.member_card_impl(p_member_id uuid);
alter table public.profiles alter column role drop default;
alter table public.notif_suppression drop constraint notif_suppression_role_fkey;
delete from public.notif_suppression where role='responsabil';
delete from public.roles where id='responsabil';
create type public.member_role_new as enum ('recrut','voluntar','activ','vot','bce','bc','moderator');
alter table public.roles alter column id type public.member_role_new using id::text::public.member_role_new;
alter table public.profiles alter column role type public.member_role_new using role::text::public.member_role_new;
alter table public.notif_suppression alter column role type public.member_role_new using role::text::public.member_role_new;
drop type public.member_role;
alter type public.member_role_new rename to member_role;
alter table public.profiles alter column role set default 'recrut'::public.member_role;
alter table public.notif_suppression add constraint notif_suppression_role_fkey foreign key(role) references public.roles(id);
create view public.leaderboard with(security_invoker=on) as  SELECT mp.member_id,
    pr.full_name,
    pr.role,
    mp.points,
    rank() OVER (ORDER BY mp.points DESC) AS rank
   FROM public.member_points mp
     JOIN public.profiles pr ON pr.id = mp.member_id
  WHERE (public.auth_level() >= 5 OR (CURRENT_USER <> ALL (ARRAY['authenticated'::name, 'anon'::name]))) AND pr.status = 'activ'::public.member_status;
revoke all on public.leaderboard from public,anon,authenticated,service_role;
grant select on public.leaderboard to authenticated,service_role;
comment on view public.leaderboard is 'Legacy global leaderboard, now visible only to BCE, BC, Moderator, and trusted server roles. A task-only leadership leaderboard replaces its contents in a later migration.';
create view public.profiles_directory with(security_invoker=on) as  SELECT profiles.id,
    profiles.full_name,
    profiles.role,
    profiles.status,
    profiles.avatar_color,
    profiles.tier,
    profiles.joined_year,
    profiles.created_at,
    profiles.joined_at,
    profiles.nickname
   FROM public.profiles;
revoke all on public.profiles_directory from public,anon,authenticated,service_role;
grant select on public.profiles_directory to authenticated,service_role;
CREATE OR REPLACE FUNCTION private.set_member_role_impl(p_member_id uuid, p_role member_role, p_reason text DEFAULT NULL::text)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_role  public.member_role;
  v_from        public.member_role;
  v_role_name   text;
  v_new_level   integer;
  v_groups_left text[];
  v_member      public.profiles%rowtype;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). The retired rank is no longer a value
  --    of the enum (#593), so it cannot reach this command at all.
  if p_role is null then
    raise sqlstate 'PT400' using message = 'invalid_member_role';
  end if;

  -- #724 (ruling R8). Measured exactly as it is stored -- trimmed -- and
  -- malformed for every caller, so it is answered before any authority
  -- verdict; a blank reason still falls back to the fixed string below.
  perform private.require_text_length('reason',
    regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 1000);

  -- 2. Authority. One reason string for every denial -- a caller must not be
  --    able to tell "you are not BC" from "you may not touch that Member" from
  --    "you cannot re-rank yourself" (conventions section 3).
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 or v_actor = p_member_id then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 3. Target under lock, then the actor's own row re-read `for share`.
  select * into v_member
    from public.profiles
   where id = p_member_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;

  select actor.role into v_actor_role
    from public.profiles as actor
   where actor.id = v_actor
     and actor.status = 'activ'
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  v_from := v_member.role;

  -- 4. Appointing or unseating leadership is the Moderator's alone. BC holds
  --    every other rank decision. Authority is answered before state, so a BC
  --    reaching for `bc` gets 42501 whether or not the target already holds it.
  if (v_from in ('bc', 'moderator') or p_role in ('bc', 'moderator'))
     and v_actor_role <> 'moderator' then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  if v_from = p_role then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  select role.name, role.level into strict v_role_name, v_new_level
    from public.roles as role
   where role.id = p_role;

  update public.profiles
     set role = p_role
   where id = p_member_id
  returning * into v_member;

  insert into public.role_history (
    member_id, from_role, to_role, changed_by, actor_kind, reason
  ) values (
    p_member_id, v_from, p_role, v_actor, 'human',
    coalesce(nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
      'Role changed by leadership (set_member_role)')
  );

  -- 5. The one case where a Role change edits rosters. A Group states the rank
  --    its members must hold; once the target falls below it they are not a
  --    member of that Group any more, whatever position they held there, so
  --    the row goes -- ordinary membership and Group Role alike. Only Groups
  --    whose *own* Minimum Level is above the new rank are touched: an
  --    ancestor with a lower Minimum keeps its row, and the authority it
  --    carries still flows down through `groups.path`. This is what makes
  --    T13's invariant (#586, "no roster row below its Group's Minimum
  --    Level") hold from the Role side.
  --
  --    The rows are locked `for update` before anything is decided about
  --    them. `for update of membership` locks `group_members` only: a
  --    `groups` row is read here, never locked, because a share lock on one
  --    would ABBA against any Group command holding it `for update` (the
  --    cross-cutting lock rule). Ordering by `group_id` keeps two concurrent
  --    demotions of different Members over the same Groups in one sequence.
  perform 1
     from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where membership.member_id = p_member_id
      and grp.min_level > v_new_level
    order by membership.group_id
      for update of membership;

  with removed as (
    delete from public.group_members as membership
     using public.groups as grp
     where grp.id = membership.group_id
       and membership.member_id = p_member_id
       and grp.min_level > v_new_level
    returning grp.name as group_name
  )
  select array_agg(distinct group_name order by group_name)
    into v_groups_left
    from removed;

  -- #584 (ruling R30). The Application half of the same rule: a request to
  -- join a Group the target can no longer qualify for is settled here rather
  -- than left for a Manager to be told group_member_below_min_level about.
  -- The rows are locked in id order before anything is decided about them.
  perform 1
     from public.group_applications as application
     join public.groups as grp on grp.id = application.group_id
    where application.member_id = p_member_id
      and application.status = 'pending'
      and grp.min_level > v_new_level
    order by application.id
      for update of application;

  update public.group_applications as application
     set status     = 'withdrawn',
         decided_by = v_actor,
         decided_at = clock_timestamp()
    from public.groups as grp
   where grp.id = application.group_id
     and application.member_id = p_member_id
     and application.status = 'pending'
     and grp.min_level > v_new_level;

  perform private.notify(
    array[p_member_id],
    'system'::public.noti_kind,
    'Rol actualizat',
    case
      when p_role = 'vot' then
        'Rolul tău în OSUBB este acum Voluntar cu Drept de Vot. Ești membru al Adunării Generale.'
      else
        'Rolul tău în OSUBB este acum ' || v_role_name || '.'
    end
    -- A Member who lost Groups to the Minimum Level learns which ones from the
    -- same Notification: the removal is a consequence of the rank decision, not
    -- a separate event, and nothing else will tell them.
    || case
         when v_groups_left is null then ''
         else ' Nu mai faci parte din: '
              || array_to_string(v_groups_left, ', ') || '.'
       end,
    null,
    null,
    v_actor
  );

  return v_member;
end;
$function$
;
revoke execute on function private.set_member_role_impl(p_member_id uuid, p_role member_role, p_reason text) from public,anon,authenticated,service_role;
grant execute on function private.set_member_role_impl(p_member_id uuid, p_role member_role, p_reason text) to authenticated;
comment on function private.set_member_role_impl(p_member_id uuid, p_role member_role, p_reason text) is 'Body behind public.set_member_role (#580): authority, the audited rank change, and ruling R23''s Minimum-Level consequences. When the new rank falls below a Group''s min_level the target''s rows on that Group are deleted — ordinary membership and Group Role alike — and, since #584 (ruling R30), their pending Applications to every Group whose Minimum Level now exceeds their rank are withdrawn with the actor as decider: such an Application could only ever be answered group_member_below_min_level, and leaving it pending would keep the Group visible to them through ruling R17''s groups_read limb indefinitely. An ancestor Group with a lower Minimum Level keeps its row and its authority still flows down through groups.path. It leaves Group Roles alone everywhere else (ruling R15): a promotion to BCE does not appoint a Department Group Manager and a demotion from it does not remove one. p_reason (#612) is stored trimmed in role_history.reason, falling back to a fixed string when omitted or blank.';
CREATE OR REPLACE FUNCTION private.member_card_impl(p_member_id uuid)
 RETURNS TABLE(member_id uuid, nickname text, full_name text, role member_role, joined_at date, avatar_color text, primary_group_id bigint, primary_group_name text, primary_group_color text, other_memberships integer, memberships jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with explicit_memberships as (
    select membership.group_id,
           member_group.name,
           member_group.parent_id,
           member_group.color,
           membership.group_role,
           membership.position_title,
           membership.created_at
      from public.group_members as membership
      join public.groups as member_group on member_group.id = membership.group_id
     where membership.member_id = p_member_id
       and member_group.status = 'active'
       and not member_group.is_organization
       -- #756: a Private Group is named only to a viewer who can see it.
       and private.can_see_group(member_group.id, (select auth.uid()))
  ),
  primary_membership as (
    select explicit_memberships.group_id,
           explicit_memberships.name,
           explicit_memberships.color
      from explicit_memberships
     where explicit_memberships.parent_id is null
     order by explicit_memberships.created_at, explicit_memberships.group_id
     limit 1
  )
  select profile.id,
         profile.nickname,
         profile.full_name,
         profile.role,
         profile.joined_at,
         profile.avatar_color,
         primary_membership.group_id,
         primary_membership.name,
         primary_membership.color,
         ((select count(*) from explicit_memberships)
           - (select count(*) from primary_membership))::int,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object(
                      'group_id',       explicit_memberships.group_id,
                      'name',           explicit_memberships.name,
                      'parent_id',      explicit_memberships.parent_id,
                      'color',          explicit_memberships.color,
                      'group_role',     explicit_memberships.group_role,
                      'position_title', explicit_memberships.position_title,
                      'joined_at',      explicit_memberships.created_at)
                    order by explicit_memberships.created_at, explicit_memberships.group_id)
             from explicit_memberships
         ), '[]'::jsonb)
    from public.profiles as profile
    left join primary_membership on true
   where profile.id = p_member_id
     and coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.profiles as caller
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
     );
$function$
;
revoke execute on function private.member_card_impl(p_member_id uuid) from public,anon,authenticated,service_role;
grant execute on function private.member_card_impl(p_member_id uuid) to authenticated;
comment on function private.member_card_impl(p_member_id uuid) is 'Member Card projection body (R6, R17). One row for any Member when the caller carries organization claims and an activ Profile, none otherwise. The chip (primary_group_*) is the roster row with the earliest created_at on an active top-level Group that is not the Organization Group; other_memberships counts the remaining explicit rows on active, non-Organization Groups; memberships lists every such row, the chip''s included, in roster created_at order. No contact column, no points, no rank; the Group label is never read.';
CREATE OR REPLACE FUNCTION public.auth_role()
 RETURNS member_role
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select (auth.jwt() -> 'app_metadata' ->> 'member_role')::public.member_role
$function$
;
revoke execute on function public.auth_role() from public,anon,authenticated,service_role;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.auth_role() to service_role;
CREATE OR REPLACE FUNCTION public.provision_profile(p_user_id uuid, p_full_name text, p_email text, p_role member_role DEFAULT 'recrut'::member_role, p_group_ids bigint[] DEFAULT '{}'::bigint[], p_appointed_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
revoke execute on function public.provision_profile(p_user_id uuid, p_full_name text, p_email text, p_role member_role, p_group_ids bigint[], p_appointed_by uuid) from public,anon,authenticated,service_role;
grant execute on function public.provision_profile(p_user_id uuid, p_full_name text, p_email text, p_role member_role, p_group_ids bigint[], p_appointed_by uuid) to service_role;
comment on function public.provision_profile(p_user_id uuid, p_full_name text, p_email text, p_role member_role, p_group_ids bigint[], p_appointed_by uuid) is 'Atomically provisions an invited auth user (ADR-0003, #602): the profiles row, then one Appointment per p_group_ids Group through private.appoint_group_member -- the ONE insert path into public.group_members (rulings R6/R27), which carries every roster invariant and writes the new Member''s Appointment Notification. p_appointed_by is the inviting BC or Moderator, whose live level >= 6 the Edge Function verifies from the database, and it reaches the core as p_actor, so the Notification is attributed to them (and private.notify drops the actor, so provisioning somebody as their own appointer notifies nobody). Groups are appointed in ascending id order with duplicates collapsed, so the FOR NO KEY UPDATE locks the core takes can never deadlock two concurrent calls. Any refusal from the core -- group_archived, group_member_not_eligible, group_member_below_min_level, automatic_group_has_no_roster_members, already_group_member, or the non-disclosing group_manage_forbidden for an unknown id -- fails the WHOLE call as PT400 carrying the core''s own reason string, so no half-placed Member survives. Writes no legacy membership table: #590 drops both. Service-role only; shared by the single-invite and CSV-import flows.';
CREATE OR REPLACE FUNCTION public.set_member_role(p_member_id uuid, p_role member_role, p_reason text DEFAULT NULL::text)
 RETURNS profiles
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.set_member_role_impl(p_member_id, p_role, p_reason);
$function$
;
revoke execute on function public.set_member_role(p_member_id uuid, p_role member_role, p_reason text) from public,anon,authenticated,service_role;
grant execute on function public.set_member_role(p_member_id uuid, p_role member_role, p_reason text) to authenticated;
comment on function public.set_member_role(p_member_id uuid, p_role member_role, p_reason text) is 'Sets a Member''s rank, callable only by a live active BC or Moderator and never on themselves; granting or removing bc/moderator -- and any change whose target already holds either -- is the Moderator''s alone, and only the seven live ranks are accepted. Writes exactly one public.role_history row naming the real actor, and one direct system Notification to the target (never to the actor). It leaves Group Roles alone (ADR-0009 ruling R15): a promotion to BCE does not appoint a Department Group Manager and a demotion from it does not remove one -- a Group Manager or Responsible position is appointed and removed only by a Group command (#583). The single exception is Minimum Level: when the new rank falls below a Group''s min_level, the target''s rows on that Group are deleted -- ordinary membership and Group Role alike -- because a Group states the rank its members must hold, and T13''s invariant (#586, no roster row below its Group''s Minimum Level) holds from this side because of it. An ancestor Group with a lower Minimum Level keeps its row and its authority still flows down through groups.path. Since #584 (ruling R30) the same demotion also withdraws the target''s pending Applications to every Group whose Minimum Level now exceeds their rank, with the actor as decider. p_reason (#612), when non-blank, is stored trimmed as role_history.reason; omitted, null or all-whitespace falls back to a fixed string.';
CREATE OR REPLACE FUNCTION public.member_card(p_member_id uuid)
 RETURNS TABLE(member_id uuid, nickname text, full_name text, role member_role, joined_at date, avatar_color text, primary_group_id bigint, primary_group_name text, primary_group_color text, other_memberships integer, memberships jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from private.member_card_impl(p_member_id);
$function$
;
revoke execute on function public.member_card(p_member_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_card(p_member_id uuid) to authenticated;
comment on function public.member_card(p_member_id uuid) is 'Member Card (R6): a colleague''s Nickname, full name, Role, join date, avatar colour, first top-level Group chip, "+n" count and explicit Group memberships, for any active Member. Contact details stay behind profiles_contact; points and rank never appear.';
