-- #580: BC and Moderator change a Member's Role and Status through two audited commands.
--
-- Until now the only way to re-rank or deactivate a Member was a direct
-- `update public.profiles` by a level-6 client, guarded by
-- `guard_profile_privileged_columns` (#3.2b). That path records nothing: who
-- decided, when, and from what were lost the moment the row was overwritten.
-- #50 built `role_history` to hold exactly that and shipped with no writer;
-- these two commands are it.
--
-- They do NOT close the direct path, and that is deliberate.
-- `update (role, status) on public.profiles` stays granted to `authenticated`,
-- so a level-6 client can still write the two columns through PostgREST and
-- leave no audit row. `guard_profile_privileged_columns` still enforces the
-- authority rule there (level >= 6, or a non-client caller) -- what is missing
-- is the record, not the gate. Revoking that column grant is what conventions
-- section 2 asks for once a command owns a table's writes, but it is a
-- security-boundary change for every client and it breaks fixtures in suites
-- this issue does not own, so it belongs in its own reviewed PR. Until that
-- lands, the audit is complete for every change that goes through these
-- commands and silent for anything that goes around them.

-- ==================== 1 · role_history also records Status decisions ====================
-- #50's table is the audit surface for "who decided what about a Member, and
-- why". Its `role_history_changed_role_ck` requires `from_role <> to_role`, so
-- a Status-only decision -- the thing `set_member_status` records -- cannot be
-- expressed in it at all: the Member's rank is identical before and after.
--
-- The alternative to widening it was a second, near-identical audit table with
-- its own RLS, policy, guard trigger and grants roster, or letting a
-- deactivation go unrecorded, which would leave the more dangerous of the two
-- commands with no trail at all. So this migration adds two nullable columns
-- and replaces #50's "something changed" check with one that says *exactly one
-- dimension changed per row*:
--
--   Role rows    -- both Status columns null, so the new check reduces to
--                   #50's own `from_role <> to_role`. Invariant unchanged.
--   Status rows  -- the same rank on both sides, differing Statuses.
--
-- A row changing both at once is refused, as is a row changing neither.
-- #527's suite is unaffected: it never names the constraint, never selects a
-- column list, and its three seeded rows are Role rows.
alter table public.role_history
  add column from_status public.member_status,
  add column to_status   public.member_status;

alter table public.role_history drop constraint role_history_changed_role_ck;
alter table public.role_history add constraint role_history_change_ck check (
  case when from_role <> to_role
       then from_status is not distinct from to_status
       else from_status is distinct from to_status
  end);

comment on table public.role_history is
  'Append-only Role and Status decisions. Trusted jobs/commands insert in the same transaction as the profile change; automatic actions use actor_kind=automatic and changed_by=NULL, human decisions name changed_by. Voting-right changes always require a live BC/Moderator actor. Exactly one dimension changes per row: a Role row leaves from_status/to_status null, a Status row repeats the unchanged rank on both sides. No client write path.';

-- ==================== 2 · set_member_role ====================
-- Lock order is the conventions' own: the target `for update` first, then the
-- actor `for share`, so a concurrent deactivation of the actor serializes
-- behind the decision instead of committing underneath it. Both locks land on
-- `public.profiles`, so two live BCs re-ranking *each other* at the same
-- instant can form an ABBA cycle and one of them will get `40P01`. That is
-- accepted rather than worked around with an id-ordered lock dance no other
-- command in this repo performs: a self-target is refused, so the cycle needs
-- two distinct level-6 actors each naming the other in the same instant, and
-- the losing side's answer is a retryable serialization failure, not a wrong
-- result.
create function private.set_member_role_impl(
  p_member_id uuid,
  p_role public.member_role
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
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
  --    verdict (conventions section 2). `responsabil` is a *source* rank only:
  --    ADR-0009 replaces the project-Responsible rank with a Group Role, so a
  --    holder may be re-ranked away from it and nobody may be moved onto it.
  if p_role is null or p_role = 'responsabil' then
    raise sqlstate 'PT400' using message = 'invalid_member_role';
  end if;

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
    'Role changed by leadership (set_member_role)'
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
$$;

-- ==================== 3 · set_member_status ====================
create function private.set_member_status_impl(
  p_member_id uuid,
  p_status public.member_status
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid;
  v_actor_role public.member_role;
  v_from       public.member_status;
  v_member     public.profiles%rowtype;
begin
  if p_status is null then
    raise sqlstate 'PT400' using message = 'invalid_member_status';
  end if;

  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 or v_actor = p_member_id then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

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

  v_from := v_member.status;

  -- The Moderator-only rule from `set_member_role` reaches Status too, and has
  -- to. `private.actor_level` returns null for anyone not `activ`, so setting a
  -- BC or the Moderator to `inactiv`/`alumni` removes their authority exactly
  -- as thoroughly as re-ranking them would -- and reactivating them restores
  -- it. Leaving this open would let one BC neutralize every other BC and the
  -- Moderator with a command the Moderator-only rank branch was written to
  -- prevent.
  if v_member.role in ('bc', 'moderator') and v_actor_role <> 'moderator' then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  if v_from = p_status then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  update public.profiles
     set status = p_status
   where id = p_member_id
  returning * into v_member;

  insert into public.role_history (
    member_id, from_role, to_role, from_status, to_status,
    changed_by, actor_kind, reason
  ) values (
    p_member_id, v_member.role, v_member.role, v_from, p_status,
    v_actor, 'human',
    'Status changed by leadership (set_member_status)'
  );

  return v_member;
end;
$$;

-- ==================== 4 · wrappers ====================
create function public.set_member_role(
  p_member_id uuid,
  p_role public.member_role
)
returns public.profiles
language sql
security invoker
set search_path = ''
as $$
  select private.set_member_role_impl(p_member_id, p_role);
$$;

create function public.set_member_status(
  p_member_id uuid,
  p_status public.member_status
)
returns public.profiles
language sql
security invoker
set search_path = ''
as $$
  select private.set_member_status_impl(p_member_id, p_status);
$$;

-- R15 (ADR-0009 Wave 3): rank and position are separate facts -- and the one
-- exception that proves it, stated in the same breath so nobody reads the rule
-- as absolute.
comment on function public.set_member_role(uuid, public.member_role) is
  'Sets a Member''s rank, callable only by a live active BC or Moderator and never on themselves; granting or removing bc/moderator -- and any change whose target already holds either -- is the Moderator''s alone, and responsabil is accepted only as a source rank. Writes exactly one public.role_history row naming the real actor, and one direct system Notification to the target (never to the actor). It leaves Group Roles alone (ADR-0009 ruling R15): a promotion to BCE does not appoint a Department Group Manager and a demotion from it does not remove one -- a Group Manager or Responsible position is appointed and removed only by a Group command (#583). The single exception is Minimum Level: when the new rank falls below a Group''s min_level, the target''s rows on that Group are deleted -- ordinary membership and Group Role alike -- because a Group states the rank its members must hold, and T13''s invariant (#586, no roster row below its Group''s Minimum Level) holds from this side because of it. An ancestor Group with a lower Minimum Level keeps its row and its authority still flows down through groups.path. Not yet done here: withdrawing the target''s pending Applications on those Groups. public.group_applications does not exist until #584, whose implementer replaces this body to add it -- it is deferred, not forgotten.';

comment on function public.set_member_status(uuid, public.member_status) is
  'Sets a Member''s Status, callable only by a live active BC or Moderator and never on themselves; a Member who holds bc/moderator may be deactivated or reactivated only by the Moderator. Writes exactly one public.role_history Status row naming the real actor, and no Notification at all -- a deactivated Member cannot read one and a reactivation is silent. It never touches group_members in either direction: deactivation leaves every roster row and Group Role in place, because authority is already live-filtered by the Wave 2 helpers, and a reactivated Member resumes the same positions. It also does NOT revoke the Member''s Auth sessions -- a Postgres command cannot call the Auth admin API. The Administrare status editor (#105) calls the revoke-sessions Edge Function after this command succeeds; that function is issue #603. Until it ships, a deactivated Member keeps a usable access token for at most jwt_expiry (one hour), after which the claims hook stamps no organization claims and every policy denies -- the ADR-0003 deactivation window, unchanged by this command.';

comment on function private.set_member_role_impl(uuid, public.member_role) is
  'Body behind public.set_member_role: authority, target lock, role_history write, Minimum-Level roster cleanup, and the direct Role-change Notification (#580).';
comment on function private.set_member_status_impl(uuid, public.member_status) is
  'Body behind public.set_member_status: authority, target lock, and the role_history Status write (#580). Writes no Notification and no roster row.';

-- ==================== 5 · grants ====================
revoke execute on function private.set_member_role_impl(uuid, public.member_role)
  from public, anon, authenticated, service_role;
revoke execute on function private.set_member_status_impl(uuid, public.member_status)
  from public, anon, authenticated, service_role;
grant execute on function private.set_member_role_impl(uuid, public.member_role)
  to authenticated;
grant execute on function private.set_member_status_impl(uuid, public.member_status)
  to authenticated;

revoke execute on function public.set_member_role(uuid, public.member_role)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_member_status(uuid, public.member_status)
  from public, anon, authenticated, service_role;
grant execute on function public.set_member_role(uuid, public.member_role)
  to authenticated;
grant execute on function public.set_member_status(uuid, public.member_status)
  to authenticated;
