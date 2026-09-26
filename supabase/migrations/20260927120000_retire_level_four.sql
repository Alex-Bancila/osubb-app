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
-- Wave 4 (#48, #51, #52): every function whose signature or result names the
-- type goes too, and is recreated below from its one body on main, unchanged.
drop function public.retention_ranking(p_period_id bigint);
drop function private.retention_ranking_impl(p_period_id bigint);
drop function private.retention_ranking_rows(p_period_id bigint);
drop function private.detect_retention_signals(p_period_id bigint);
drop function private.detect_close_promotions(p_period_id bigint);
drop function private.detect_promotions();
drop function private.apply_promotion(p_member_id uuid, p_from_role member_role, p_to_role member_role, p_rule_kind text, p_period_id bigint);
alter table public.profiles alter column role drop default;
alter table public.notif_suppression drop constraint notif_suppression_role_fkey;
alter table public.promotion_rules drop constraint promotion_rules_from_role_fkey,
 drop constraint promotion_rules_to_role_fkey;
delete from public.notif_suppression where role='responsabil';
delete from public.roles where id='responsabil';
create type public.member_role_new as enum ('recrut','voluntar','activ','vot','bce','bc','moderator');
alter table public.roles alter column id type public.member_role_new using id::text::public.member_role_new;
alter table public.profiles alter column role type public.member_role_new using role::text::public.member_role_new;
alter table public.notif_suppression alter column role type public.member_role_new using role::text::public.member_role_new;
alter table public.promotion_rules alter column from_role type public.member_role_new using from_role::text::public.member_role_new,
 alter column to_role type public.member_role_new using to_role::text::public.member_role_new;
drop type public.member_role;
alter type public.member_role_new rename to member_role;
alter table public.profiles alter column role set default 'recrut'::public.member_role;
alter table public.notif_suppression add constraint notif_suppression_role_fkey foreign key(role) references public.roles(id);
alter table public.promotion_rules add constraint promotion_rules_from_role_fkey foreign key(from_role) references public.roles(id),
 add constraint promotion_rules_to_role_fkey foreign key(to_role) references public.roles(id);
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

-- Wave 4 (#48, #51, #52), recreated on the new type from the bodies of
-- 20260926180400_retention_ranking.sql, 20260926180500_detect_promotions.sql and
-- 20260926180600_apply_promotions.sql, unchanged; grants and comments as there.
CREATE OR REPLACE FUNCTION private.retention_ranking_rows(p_period_id bigint)
 RETURNS TABLE(member_id uuid, role member_role, task_points integer, rank integer, cohort_size integer, share_size integer, inside boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_closed_at     timestamptz;
  v_activ_percent integer;
  v_vot_percent   integer;
begin
  select period.closed_at into v_closed_at
    from public.evaluation_periods as period
   where period.id = p_period_id;
  if not found then
    raise sqlstate 'PT404' using message = 'evaluation_period_not_found';
  end if;
  if v_closed_at is null then
    raise sqlstate 'PT409' using message = 'evaluation_period_open';
  end if;

  -- x: the Voluntar Activ share is the Promotion Rule's own percent (#49).
  select rule.percent into v_activ_percent
    from public.promotion_rules as rule
   where rule.kind = 'top_percent';
  if not found then
    raise sqlstate 'PT404' using message = 'promotion_rule_not_found';
  end if;

  -- y: the Vote Retention Threshold. org_settings_vote_retention_percent_ck
  -- keeps the value a whole 1-100, so the cast cannot fail.
  select setting.value::integer into v_vot_percent
    from public.org_settings as setting
   where setting.key = 'vote_retention_percent';
  if v_vot_percent is null then
    raise sqlstate 'PT404' using message = 'org_setting_not_found';
  end if;

  return query
  with holders as (
    select profile.id as member_id,
           profile.role as role,
           coalesce(ranked.task_points, 0) as task_points
      from public.profiles as profile
      left join private.evaluation_period_ranking_rows(p_period_id) as ranked
        on ranked.member_id = profile.id
     where profile.role in ('activ', 'vot')
       and profile.status = 'activ'
  ),
  cohorts as (
    select holder.member_id,
           holder.role,
           holder.task_points,
           (rank() over (partition by holder.role order by holder.task_points desc))::int as cohort_rank,
           (count(*) over (partition by holder.role))::int as cohort_count
      from holders as holder
  ),
  shares as (
    select cohort.member_id,
           cohort.role,
           cohort.task_points,
           cohort.cohort_rank,
           cohort.cohort_count,
           ceil(case cohort.role when 'activ' then v_activ_percent else v_vot_percent end
                * cohort.cohort_count / 100.0)::int as cohort_share
      from cohorts as cohort
  )
  select share.member_id,
         share.role,
         share.task_points,
         share.cohort_rank,
         share.cohort_count,
         share.cohort_share,
         share.cohort_rank <= share.cohort_share
    from shares as share
   order by share.role, share.cohort_rank, share.member_id;
end;
$function$
;
revoke execute on function private.retention_ranking_rows(bigint) from public,anon,authenticated,service_role;
comment on function private.retention_ranking_rows(bigint) is '#48 (ADR-0004 amended 2026-09-21): the retention ranking of one closed Evaluation Period, every row. One row per live active Member holding Voluntar Activ (activ) or Voluntar cu Drept de Vot (vot) now -- nobody else -- with their net Task Points in the Period (#47''s private.evaluation_period_ranking_rows; 0 when no in-Period Evaluation touched them), their rank within their Role''s cohort by Task Points descending (ties share it), the cohort size, the share size ceil(percent / 100 x cohort size) and inside = rank <= share, so Members tied at the boundary are inside together -- #49''s stamp rule, per cohort. percent is the top_percent Promotion Rule''s percent (x) for activ and org_settings.vote_retention_percent (y) for vot. Ordered by role, rank, member_id. PT404 evaluation_period_not_found, PT409 evaluation_period_open, PT404 promotion_rule_not_found (no top_percent row), PT404 org_setting_not_found (no vote_retention_percent row). Writes nothing and changes no Role. No visibility rule and granted to nobody: #51''s detect_retention_signals() reads it from a security-definer body.';
CREATE OR REPLACE FUNCTION private.retention_ranking_impl(p_period_id bigint)
 RETURNS TABLE(member_id uuid, role member_role, task_points integer, rank integer, cohort_size integer, share_size integer, inside boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_caller    uuid;
  v_full_read boolean;
begin
  -- Nothing without organization claims or a live activ Profile (house rule
  -- 12): answered before the Period is even looked up, so such a session
  -- learns nothing, not even which Period ids exist.
  if not (coalesce(public.auth_is_member(), false) and private.caller_level() >= 0) then
    return;
  end if;
  v_caller := auth.uid();
  v_full_read := private.can_read_evaluation_rankings();

  return query
  select ranked.member_id,
         ranked.role,
         ranked.task_points,
         ranked.rank,
         ranked.cohort_size,
         ranked.share_size,
         ranked.inside
    from private.retention_ranking_rows(p_period_id) as ranked
   where v_full_read
      or ranked.member_id = v_caller
   order by ranked.role, ranked.rank, ranked.member_id;
end;
$function$
;
revoke execute on function private.retention_ranking_impl(bigint) from public,anon,authenticated,service_role;
grant execute on function private.retention_ranking_impl(bigint) to authenticated;
comment on function private.retention_ranking_impl(bigint) is '#48: body of public.retention_ranking. private.retention_ranking_rows filtered for the caller: nothing -- and no error -- without organization claims or a live activ Profile (house rule 12, ADR-0003''s stale-token window); the caller''s own row, their standing in their Role''s cohort, for any live active Member who holds Voluntar Activ or Drept de Vot; every row when #512''s private.can_read_evaluation_rankings() holds -- BC and Moderator (live level >= 6), and the Group Managers and Group Responsibles of the Adunarea Generală or of an ancestor of it. PT404 evaluation_period_not_found / PT409 evaluation_period_open for a live Member.';
CREATE OR REPLACE FUNCTION public.retention_ranking(p_period_id bigint)
 RETURNS TABLE(member_id uuid, role member_role, task_points integer, rank integer, cohort_size integer, share_size integer, inside boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select *
    from private.retention_ranking_impl(p_period_id)
   order by role, rank, member_id;
$function$
;
revoke execute on function public.retention_ranking(bigint) from public,anon,authenticated,service_role;
grant execute on function public.retention_ranking(bigint) to authenticated;
comment on function public.retention_ranking(bigint) is '#48 (ADR-0004 amended 2026-09-21, ADR-0009 §Promotion hooks): the retention ranking of one closed Evaluation Period -- for every live active Voluntar Activ and Voluntar cu Drept de Vot holder: role, task_points (net, in the Period; 0 if none), rank within that Role''s cohort (shared on ties), cohort_size, share_size = ceil(percent / 100 x cohort_size), and inside (rank <= share_size, so ties at the boundary are inside). The percent is the top_percent Promotion Rule''s x for Voluntar Activ and the organization setting vote_retention_percent (y, BC-set through set_org_setting, seeded 25) for Drept de Vot. A holder outside is a Retention Signal to BC (#51); nothing here changes a Role. BC, Moderator and the Adunarea Generală''s Group Managers and Group Responsibles (and those of its ancestors) read every row; any other live Member reads their own row; a claimless or deactivated session reads nothing. PT404 evaluation_period_not_found, PT409 evaluation_period_open. #702''s Perioade de evaluare panel renders it.';
CREATE OR REPLACE FUNCTION private.detect_retention_signals(p_period_id bigint)
 RETURNS TABLE(member_id uuid, role member_role, task_points integer, rank integer, share_size integer, rule text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select ranked.member_id,
         ranked.role,
         ranked.task_points,
         ranked.rank,
         ranked.share_size,
         case ranked.role
           when 'activ' then 'top_percent'
           else 'vote_retention_percent'
         end
    from private.retention_ranking_rows(p_period_id) as ranked
   where not ranked.inside
   order by ranked.role, ranked.rank, ranked.member_id;
$function$
;
revoke execute on function private.detect_retention_signals(bigint) from public,anon,authenticated,service_role;
comment on function private.detect_retention_signals(bigint) is '#51 (ADR-0004 amended 2026-09-21): the Retention Signals of one closed Evaluation Period, as rows (member_id, role, task_points, rank, share_size, rule) -- nothing is written and no Role changes. Every row of #48''s private.retention_ranking_rows outside its share: a live active Voluntar Activ (role activ) below the top x% -- rule top_percent, the Promotion Rule''s percent -- and a live active Voluntar cu Drept de Vot (role vot) below the top y% -- rule vote_retention_percent. role is the Role at risk; task_points, rank (within the Role''s cohort) and share_size are #48''s. Not a promotion rule, so the top_percent rule''s enabled flag does not silence it. There is no Drept de Vot eligibility row. Ordered by role, rank, member_id. PT404 evaluation_period_not_found, PT409 evaluation_period_open, PT404 promotion_rule_not_found, PT404 org_setting_not_found (#48''s). Stable, executable by nobody: #701''s close and #52 read it from security-definer bodies; BC acts on it by hand.';
CREATE OR REPLACE FUNCTION private.detect_promotions()
 RETURNS TABLE(member_id uuid, from_role member_role, to_role member_role, rule_id bigint, rule_kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with today as (
    select (now() at time zone 'Europe/Bucharest')::date as on_date
  ),
  tenured as (
    select profile.id as member_id,
           rule.from_role,
           rule.to_role,
           rule.id as rule_id,
           rule.kind as rule_kind
      from public.promotion_rules as rule
      join public.profiles as profile
        on profile.role = rule.from_role
       and profile.status = 'activ'
     cross join today
     where rule.enabled
       and profile.joined_at is not null
       and (profile.joined_at + make_interval(months => rule.min_tenure_months))::date <= today.on_date
  ),
  detected as (
    select tenured.member_id, tenured.from_role, tenured.to_role, tenured.rule_id, tenured.rule_kind
      from tenured
     where tenured.rule_kind = 'time'
    union all
    select tenured.member_id, tenured.from_role, tenured.to_role, tenured.rule_id, tenured.rule_kind
      from tenured
      join public.evaluation_periods as period
        on period.closed_at is null
     cross join lateral private.evaluation_period_ranking_rows(period.id) as ranked
     where tenured.rule_kind = 'top_percent'
       and ranked.member_id = tenured.member_id
       and ranked.task_points >= public.promotion_threshold_in_force()
  )
  select detected.member_id, detected.from_role, detected.to_role, detected.rule_id, detected.rule_kind
    from detected
   order by detected.rule_kind <> 'time', detected.member_id;
$function$
;
revoke execute on function private.detect_promotions() from public,anon,authenticated,service_role;
comment on function private.detect_promotions() is '#51 (ADR-0004 amended 2026-09-21): the continuous Promotion Rules, as rows (member_id, from_role, to_role, rule_id, rule_kind) -- nothing is written. For every enabled promotion_rules row, only live active Members (status activ) holding its from_role with its tenure: joined_at + min_tenure_months on or before today''s Europe/Bucharest date (null joined_at: no tenure). kind time: every such Member (Recrut -> Voluntar). kind top_percent: every such Member whose net Task Points in the open Evaluation Period (#47''s ranking; a Member it does not list has none) reach public.promotion_threshold_in_force() (Voluntar -> Voluntar Activ); with no open Period this door returns nothing and the time rule still fires. The two are not chained in one run. Ordered time rows first, then by member_id. Stable, executable by nobody: #52''s daily job calls it from its security-definer body and applies the rows.';
CREATE OR REPLACE FUNCTION private.detect_close_promotions(p_period_id bigint)
 RETURNS TABLE(member_id uuid, from_role member_role, to_role member_role, rule_id bigint, rule_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_closed_at timestamptz;
  v_on_date   date;
begin
  select period.closed_at into v_closed_at
    from public.evaluation_periods as period
   where period.id = p_period_id;
  if not found then
    raise sqlstate 'PT404' using message = 'evaluation_period_not_found';
  end if;
  if v_closed_at is null then
    raise sqlstate 'PT409' using message = 'evaluation_period_open';
  end if;
  -- Tenure is measured at the close, on the Bucharest calendar.
  v_on_date := (v_closed_at at time zone 'Europe/Bucharest')::date;

  return query
  with ranking as (
    select ranked.member_id,
           ranked.rank,
           (count(*) over ())::int as ranked_count
      from private.evaluation_period_ranking_rows(p_period_id) as ranked
  ),
  -- Step 1: the tenure rule, at the close.
  time_step as (
    select profile.id as member_id,
           rule.from_role,
           rule.to_role,
           rule.id as rule_id,
           rule.kind as rule_kind
      from public.promotion_rules as rule
      join public.profiles as profile
        on profile.role = rule.from_role
       and profile.status = 'activ'
     where rule.kind = 'time'
       and rule.enabled
       and profile.joined_at is not null
       and (profile.joined_at + make_interval(months => rule.min_tenure_months))::date <= v_on_date
  ),
  -- Each live active Member's Role as step 1 leaves it.
  stepped as (
    select profile.id as member_id,
           coalesce(promoted.to_role, profile.role) as role,
           profile.joined_at
      from public.profiles as profile
      left join time_step as promoted
        on promoted.member_id = profile.id
     where profile.status = 'activ'
  ),
  -- Step 2: the top x% of the closing Period, behind the same tenure gate.
  top_step as (
    select stepped.member_id,
           rule.from_role,
           rule.to_role,
           rule.id as rule_id,
           rule.kind as rule_kind
      from public.promotion_rules as rule
      join stepped
        on stepped.role = rule.from_role
      join ranking
        on ranking.member_id = stepped.member_id
     where rule.kind = 'top_percent'
       and rule.enabled
       and stepped.joined_at is not null
       and (stepped.joined_at + make_interval(months => rule.min_tenure_months))::date <= v_on_date
       and ranking.rank <= ceil(rule.percent * ranking.ranked_count / 100.0)
  ),
  detected as (
    select 1 as step, time_step.member_id, time_step.from_role, time_step.to_role,
           time_step.rule_id, time_step.rule_kind
      from time_step
    union all
    select 2 as step, top_step.member_id, top_step.from_role, top_step.to_role,
           top_step.rule_id, top_step.rule_kind
      from top_step
  )
  select detected.member_id, detected.from_role, detected.to_role, detected.rule_id, detected.rule_kind
    from detected
   order by detected.step, detected.member_id;
end;
$function$
;
revoke execute on function private.detect_close_promotions(bigint) from public,anon,authenticated,service_role;
comment on function private.detect_close_promotions(bigint) is '#51 (ADR-0004 amended 2026-09-21): the Promotion Rules at the close of one Evaluation Period, as rows (member_id, from_role, to_role, rule_id, rule_kind) -- nothing is written. Tenure is measured at the Period''s closed_at, on its Europe/Bucharest date: joined_at + min_tenure_months on or before it (null joined_at: no tenure). Only enabled rules and live active Members (status activ). Step 1, kind time: every tenured holder of its from_role (Recrut -> Voluntar). Step 2, kind top_percent: every tenured Member whose Role after step 1 is its from_role and who is inside the Period''s top percent -- over #47''s full ranking, share = ceil(percent / 100 x ranked Members), inside = rank <= share, ties at the boundary inside (#49''s rule) -- so a Recrut reaching the tenure at the close and inside the top x% is returned for both steps. The Promotion Threshold in force is not consulted. Ordered step 1 then step 2, each by member_id -- the order #701''s close applies them in. PT404 evaluation_period_not_found, PT409 evaluation_period_open. Stable, executable by nobody: #701''s close_evaluation_period calls it from its security-definer body.';
CREATE OR REPLACE FUNCTION private.apply_promotion(p_member_id uuid, p_from_role member_role, p_to_role member_role, p_rule_kind text, p_period_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member      public.profiles%rowtype;
  v_from_level  integer;
  v_to_level    integer;
  v_to_name     text;
  v_period_name text;
  v_history_id  bigint;
  v_form_url    text;
  v_title       text;
  v_body        text;
begin
  -- The Profile under lock, re-read: detection ran before the lock.
  select * into v_member
    from public.profiles
   where id = p_member_id
   for no key update;
  if not found or v_member.status <> 'activ' or v_member.role <> p_from_role then
    return false;
  end if;

  -- Never a demotion, never a sideways move: the Role must rise.
  select role.level into v_from_level from public.roles as role where role.id = p_from_role;
  select role.level, role.name into v_to_level, v_to_name
    from public.roles as role
   where role.id = p_to_role;
  if v_from_level is null or v_to_level is null or v_to_level <= v_from_level then
    return false;
  end if;

  if p_period_id is not null then
    select period.name into v_period_name
      from public.evaluation_periods as period
     where period.id = p_period_id;
  end if;

  update public.profiles
     set role = p_to_role
   where id = p_member_id;

  insert into public.role_history (
    member_id, from_role, to_role, changed_by, actor_kind, reason
  ) values (
    p_member_id, p_from_role, p_to_role, null, 'automatic',
    case
      when p_period_id is null
        then format('Automatic promotion (apply_promotions, %s rule)', p_rule_kind)
      else format('Automatic promotion at the close of Evaluation Period %s (apply_close_promotions, %s rule)',
                  p_period_id, p_rule_kind)
    end
  )
  returning id into v_history_id;

  v_title := format('Felicitări! Acum ești %s', v_to_name);
  v_body := format('Rolul tău în OSUBB este acum %s: %s.', v_to_name,
    case
      when p_rule_kind = 'time'
        then 'ai împlinit vechimea cerută de regula de promovare'
      when p_period_id is null
        then 'ai atins Pragul de promovare în perioada de evaluare în curs'
      else format('ai încheiat perioada de evaluare „%s” în topul clasamentului', v_period_name)
    end);

  -- AG Eligibility follows from Voluntar Activ alone: this is where the
  -- adherence form is offered.
  if p_to_role = 'activ' then
    select nullif(btrim(setting.value), '') into v_form_url
      from public.org_settings as setting
     where setting.key = 'adherence_form_url';
    v_body := v_body || ' Ca Voluntar Activ ai Eligibilitate AG: poți intra în Adunarea Generală '
      || 'obținând Dreptul de Vot, pe care BC ți-l acordă după ce confirmă formularul de adeziune. '
      || case
           when v_form_url is not null then 'Completează formularul de adeziune: ' || v_form_url
           else 'Formularul de adeziune îl primești de la BC.'
         end;
  end if;

  perform private.notify(
    array[p_member_id], 'system', v_title, v_body, null,
    'promotion:' || v_history_id::text, null, '/profil');

  return true;
end;
$function$
;
revoke execute on function private.apply_promotion(uuid,member_role,member_role,text,bigint) from public,anon,authenticated,service_role;
comment on function private.apply_promotion(uuid,member_role,member_role,text,bigint) is '#52: the shared core of private.apply_promotions and private.apply_close_promotions -- applies one row #51 detected. Locks the Profile for no key update and re-reads it: skipped (false) unless the Member is live active and still holds p_from_role, and unless p_to_role''s level is above p_from_role''s (never a demotion). Otherwise sets profiles.role, writes one role_history row with the system actor (actor_kind automatic, changed_by null, #50) and one system Notification to the Member through private.notify (link /profil, dedupe key promotion:<role_history id>). The Voluntar Activ Notification names AG Eligibility and the path to Drept de Vot and carries org_settings.adherence_form_url, read at write time (#681, ruling R20), in its body. p_period_id is the closing Evaluation Period for the close-time run, null for the daily job. Executable by nobody.';


-- #52: role_history.to_role is text now, so the close-time run compares it to
-- the signal's Role as text. Body otherwise that of 20260926180600; grants and
-- comment are kept by create or replace.
CREATE OR REPLACE FUNCTION private.apply_close_promotions(p_period_id bigint, OUT promotions integer, OUT retention_signals integer)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row         record;
  v_signals     jsonb;
  v_period_name text;
  v_closed_at   timestamptz;
  v_ag_group_id bigint;
  v_recipients  uuid[];
  v_key         text;
begin
  perform pg_catalog.pg_advisory_xact_lock(52, 1);
  promotions := 0;
  retention_signals := 0;

  -- 1. The promotions, tenure step first. #51 raises PT404 / PT409 for an
  --    unknown or still-open Period, which rolls the close back. The
  --    Retention Signals are read before any Role moves (see the header).
  select coalesce(jsonb_agg(to_jsonb(signal)), '[]'::jsonb) into v_signals
    from private.detect_retention_signals(p_period_id) as signal;

  for v_row in
    select detected.member_id, detected.from_role, detected.to_role, detected.rule_kind
      from private.detect_close_promotions(p_period_id) as detected
  loop
    if private.apply_promotion(v_row.member_id, v_row.from_role, v_row.to_role,
                               v_row.rule_kind, p_period_id) then
      promotions := promotions + 1;
    end if;
  end loop;

  -- 2. The Retention Signals: nothing changes; BC and the Adunarea
  --    Generală's Group Responsibles are told.
  select period.name, period.closed_at into v_period_name, v_closed_at
    from public.evaluation_periods as period
   where period.id = p_period_id;

  select case when setting.value ~ '^[1-9][0-9]{0,17}$' then setting.value::bigint end
    into v_ag_group_id
    from public.org_settings as setting
   where setting.key = 'adunarea_generala_group_id';

  for v_row in
    select signal.member_id,
           signal.task_points,
           signal.rank,
           signal.share_size,
           role.name as role_name,
           coalesce(member.nickname, member.full_name) as member_name
      from jsonb_to_recordset(v_signals) as signal (
             member_id uuid, role public.member_role, task_points integer,
             rank integer, share_size integer)
      join public.roles as role on role.id = signal.role
      join public.profiles as member on member.id = signal.member_id
     -- A Member promoted into the Role at or after the close did not hold it
     -- through the Period: never at risk of it for this Period. This is what
     -- keeps a re-run exact, where #48's cohorts read the Roles as they are.
     where not exists (
       select 1 from public.role_history as history
        where history.member_id = signal.member_id
          and history.to_role = signal.role::text
          and history.created_at >= v_closed_at)
  loop
    v_key := 'retention_signal:' || p_period_id::text || ':' || v_row.member_id::text;

    select array_agg(recipient.id order by recipient.id) into v_recipients
      from (
        select profile.id
          from public.profiles as profile
          join public.roles as role on role.id = profile.role
         where profile.status = 'activ'
           and role.level >= 6
        union
        select held.member_id
          from public.group_members as held
         where held.group_id = v_ag_group_id
           and held.group_role = 'responsible'
      ) as recipient (id)
     where recipient.id <> v_row.member_id
       and not exists (
         select 1 from public.notifications as notification
          where notification.member_id = recipient.id
            and notification.dedupe_key = v_key);

    retention_signals := retention_signals + private.notify(
      v_recipients, 'system',
      format('Semnal de retenție: %s', v_row.member_name),
      format('%s (%s) a încheiat perioada de evaluare „%s” sub pragul rolului. '
             'Puncte în perioadă: %s. Locul în rol: %s; rolul cere cel mult locul %s. '
             'Rolul nu se retrage automat: decizia îi aparține BC.',
             v_row.member_name, v_row.role_name, v_period_name,
             v_row.task_points, v_row.rank, v_row.share_size),
      null, v_key, null, '/tracker/membru/' || v_row.member_id::text);
  end loop;
end;
$function$

;
