-- #612: record an optional reason for Role and Status decisions.
-- Replace the old arities instead of retaining overloads: a two-argument call
-- uses the default, and PostgREST has exactly one matching command signature.
-- Preserve the latest #603 session-revoke implementation and all authority gates.
-- Both _impl bodies are rebuilt from main's latest definitions:
-- set_member_role_impl from #584 (20260922224243_group_applications.sql,
-- including ruling R30's pending-Application withdrawal on demotion) and
-- set_member_status_impl from #603 (20260921104500_revoke_member_sessions.sql).
-- The only delta is p_reason and its trimmed-or-fallback role_history write.

drop function public.set_member_role(uuid, public.member_role);

drop function public.set_member_status(uuid, public.member_status);

drop function private.set_member_role_impl(uuid, public.member_role);

drop function private.set_member_status_impl(uuid, public.member_status);

create function private.set_member_role_impl(
  p_member_id uuid,
  p_role public.member_role,
  p_reason text default null
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
$$;

create function public.set_member_role(
  p_member_id uuid,
  p_role public.member_role,
  p_reason text default null
)
returns public.profiles
language sql
security invoker
set search_path = ''
as $$
  select private.set_member_role_impl(p_member_id, p_role, p_reason);
$$;

comment on function public.set_member_role(uuid, public.member_role, text) is
  'Sets a Member''s rank, callable only by a live active BC or Moderator and never on themselves; granting or removing bc/moderator -- and any change whose target already holds either -- is the Moderator''s alone, and responsabil is accepted only as a source rank. Writes exactly one public.role_history row naming the real actor, and one direct system Notification to the target (never to the actor). It leaves Group Roles alone (ADR-0009 ruling R15): a promotion to BCE does not appoint a Department Group Manager and a demotion from it does not remove one -- a Group Manager or Responsible position is appointed and removed only by a Group command (#583). The single exception is Minimum Level: when the new rank falls below a Group''s min_level, the target''s rows on that Group are deleted -- ordinary membership and Group Role alike -- because a Group states the rank its members must hold, and T13''s invariant (#586, no roster row below its Group''s Minimum Level) holds from this side because of it. An ancestor Group with a lower Minimum Level keeps its row and its authority still flows down through groups.path. Since #584 (ruling R30) the same demotion also withdraws the target''s pending Applications to every Group whose Minimum Level now exceeds their rank, with the actor as decider. p_reason (#612), when non-blank, is stored trimmed as role_history.reason; omitted, null or all-whitespace falls back to a fixed string.';

revoke execute on function public.set_member_role(uuid, public.member_role, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_member_role(uuid, public.member_role, text)
  to authenticated;

comment on function private.set_member_role_impl(uuid, public.member_role, text) is
  'Body behind public.set_member_role (#580): authority, the audited rank change, and ruling R23''s Minimum-Level consequences. When the new rank falls below a Group''s min_level the target''s rows on that Group are deleted — ordinary membership and Group Role alike — and, since #584 (ruling R30), their pending Applications to every Group whose Minimum Level now exceeds their rank are withdrawn with the actor as decider: such an Application could only ever be answered group_member_below_min_level, and leaving it pending would keep the Group visible to them through ruling R17''s groups_read limb indefinitely. An ancestor Group with a lower Minimum Level keeps its row and its authority still flows down through groups.path. It leaves Group Roles alone everywhere else (ruling R15): a promotion to BCE does not appoint a Department Group Manager and a demotion from it does not remove one. p_reason (#612) is stored trimmed in role_history.reason, falling back to a fixed string when omitted or blank.';

revoke execute on function private.set_member_role_impl(uuid, public.member_role, text)
  from public, anon, authenticated, service_role;
grant execute on function private.set_member_role_impl(uuid, public.member_role, text)
  to authenticated;

create function private.set_member_status_impl(
  p_member_id uuid,
  p_status public.member_status,
  p_reason text default null
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
    coalesce(nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
      'Status changed by leadership (set_member_status)')
  );

  -- #603. The condition is on the *destination* Status, not on the direction
  -- of travel: every non-`activ` Status ends the Member's access to the
  -- organization, so `inactiv` and `alumni` both revoke. A change *to* `activ`
  -- -- a reactivation, or any future path that lands there -- revokes nothing:
  -- there is no security reason to sign a returning Member out of a session
  -- they are once again entitled to hold.
  if p_status <> 'activ' then
    perform private.revoke_member_sessions(p_member_id);
  end if;

  return v_member;
end;
$$;

create function public.set_member_status(
  p_member_id uuid,
  p_status public.member_status,
  p_reason text default null
)
returns public.profiles
language sql
security invoker
set search_path = ''
as $$
  select private.set_member_status_impl(p_member_id, p_status, p_reason);
$$;

comment on function public.set_member_status(uuid, public.member_status, text) is
  'Sets a Member''s Status, callable only by a live active BC or Moderator and never on themselves; a Member who holds bc/moderator may be deactivated or reactivated only by the Moderator. Writes exactly one public.role_history Status row naming the real actor, and no Notification at all -- a deactivated Member cannot read one and a reactivation is silent. It never touches group_members in either direction: deactivation leaves every roster row and Group Role in place, because authority is already live-filtered by the Wave 2 helpers, and a reactivated Member resumes the same positions. Any change to a Status other than activ also revokes the Member''s Auth sessions in this same transaction, through private.revoke_member_sessions (#603); a change to activ revokes nothing. The Member''s already-issued access token is not invalidated by that and cannot be: they keep a usable one for at most jwt_expiry (one hour), after which no refresh token is left to renew it and the claims hook would stamp no organization claims anyway -- the ADR-0003 deactivation window, now bounded rather than open-ended.';

revoke execute on function public.set_member_status(uuid, public.member_status, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_member_status(uuid, public.member_status, text)
  to authenticated;

comment on function private.set_member_status_impl(uuid, public.member_status, text) is
  'Body behind public.set_member_status: authority, target lock, the role_history Status write (#580), and the session revoke when the new Status is not activ (#603). Writes no Notification and no roster row.';

revoke execute on function private.set_member_status_impl(uuid, public.member_status, text)
  from public, anon, authenticated, service_role;
grant execute on function private.set_member_status_impl(uuid, public.member_status, text)
  to authenticated;
