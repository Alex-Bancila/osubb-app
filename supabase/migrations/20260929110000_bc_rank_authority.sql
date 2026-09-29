-- #905 (ruling R31): every BC member, not only the Moderator, grants and removes the BC and Moderator ranks; removing the last live holder of either needs a named replacement in the same call.
--
-- Alex, 2026-09-29: BC members change someone's Role to BC or Moderator and
-- remove it; whoever removes the last Moderator names who replaces them. The
-- replacement may be any active Member, the actor included (the one allowed
-- self-change), and the same safeguard holds for the last BC member.
--
-- 1. private.apply_member_role: the effect of one audited rank change, lifted
--    out of set_member_role_impl unchanged (the role_history row naming the
--    real actor, R23's Minimum-Level roster pruning, #584's Application
--    withdrawal, and the one Notification to the Member, never to the actor).
--    It has no gate of its own -- the #582 cancel_event_effect shape -- so it
--    is granted to nobody; set_member_role_impl calls it once for the
--    replacement and once for the target.
-- 2. private.set_member_role_impl / public.set_member_role gain
--    p_replacement_id. A new trailing parameter changes the signature, so the
--    pair is dropped and created again (an added default would otherwise leave
--    an ambiguous overload beside the old three-argument function). The body
--    is rebuilt from main's latest definition
--    (20260928100000_notification_links.sql); the authority step loses the
--    Moderator-only branch and gains the last-holder guard.
--
-- Locks: the target, the actor, the replacement and every live holder of bc
-- and moderator are taken `for update` in one statement ordered by id, before
-- anything is counted. Two leadership members each removing one of the last
-- two holders therefore serialize on the same rows, and the second call,
-- counting in a fresh statement after the first commits, sees it has the last
-- one. A single id-ordered statement is what keeps two such calls from
-- deadlocking. The target stays `for update` (not `for no key update`)
-- because #826's Role Evaluation run takes its population's Profiles `for key
-- share` to hold a promotion off until it commits.

drop function public.set_member_role(uuid, public.member_role, text);
drop function private.set_member_role_impl(uuid, public.member_role, text);

-- ---------------------------------------------------------------------------
-- 1. The effect of one rank change
-- ---------------------------------------------------------------------------
create function private.apply_member_role(
  p_member_id uuid,
  p_role      public.member_role,
  p_actor     uuid,
  p_reason    text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_from        public.member_role;
  v_role_name   text;
  v_new_level   integer;
  v_groups_left text[];
  v_form_url    text;
  v_member      public.profiles%rowtype;
begin
  -- No gate: the caller holds the Member's Profile `for update` and has
  -- decided the change is allowed. What lives here is what every rank change
  -- writes, whoever decided it.
  select profile.role into strict v_from
    from public.profiles as profile
   where profile.id = p_member_id;

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
    p_member_id, v_from, p_role, p_actor, 'human', p_reason
  );

  -- The one case where a Role change edits rosters. A Group states the rank
  -- its members must hold; once the Member falls below it they are not a
  -- member of that Group any more, whatever position they held there, so the
  -- row goes -- ordinary membership and Group Role alike. Only Groups whose
  -- *own* Minimum Level is above the new rank are touched: an ancestor with a
  -- lower Minimum keeps its row, and the authority it carries still flows down
  -- through `groups.path`.
  --
  -- The rows are locked `for update` before anything is decided about them.
  -- `for update of membership` locks `group_members` only: a `groups` row is
  -- read here, never locked, because a share lock on one would ABBA against
  -- any Group command holding it `for update`. Ordering by `group_id` keeps
  -- two concurrent demotions over the same Groups in one sequence.
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

  -- #584 (ruling R30). The Application half of the same rule, locked in id
  -- order before anything is decided about the rows.
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
         decided_by = p_actor,
         decided_at = clock_timestamp()
    from public.groups as grp
   where grp.id = application.group_id
     and application.member_id = p_member_id
     and application.status = 'pending'
     and grp.min_level > v_new_level;

  -- #826 (ruling R28): Voluntar Activ is granted by hand, so this is where AG
  -- Eligibility and the adherence form are offered. The address is read at
  -- write time (#681) and goes in the body: notifications.link is an in-app
  -- route.
  if p_role = 'activ' then
    select nullif(btrim(setting.value), '') into v_form_url
      from public.org_settings as setting
     where setting.key = 'adherence_form_url';
  end if;

  perform private.notify(
    array[p_member_id],
    'system'::public.noti_kind,
    'Rol actualizat',
    case
      when p_role = 'vot' then
        'Rolul tău în OSUBB este acum Voluntar cu Drept de Vot. Ești membru al Adunării Generale.'
      when p_role = 'activ' then
        'Rolul tău în OSUBB este acum ' || v_role_name || '. '
        || 'Ca Voluntar Activ ai Eligibilitate AG: poți intra în Adunarea Generală '
        || 'obținând Dreptul de Vot, pe care BC ți-l acordă după ce confirmă formularul de adeziune. '
        || case
             when v_form_url is not null then 'Completează formularul de adeziune: ' || v_form_url
             else 'Formularul de adeziune îl primești de la BC.'
           end
      else
        'Rolul tău în OSUBB este acum ' || v_role_name || '.'
    end
    || case
         when v_groups_left is null then ''
         else ' Nu mai faci parte din: '
              || array_to_string(v_groups_left, ', ') || '.'
       end,
    null,
    null,
    p_actor,
    -- #843 (D24): the new Role is on Profil.
    '/profil'
  );

  return v_member;
end;
$function$;

revoke execute on function private.apply_member_role(uuid, public.member_role, uuid, text)
  from public, anon, authenticated, service_role;
comment on function private.apply_member_role(uuid, public.member_role, uuid, text) is
  'The effect of one audited rank change (#905), with no gate of its own: sets the rank, writes the public.role_history row naming p_actor with p_reason, deletes the Member''s roster rows on every Group whose own Minimum Level is above the new rank (R23 -- ordinary membership and Group Role alike; an ancestor with a lower Minimum keeps its row), withdraws their pending Applications to those Groups with p_actor as decider (#584, ruling R30), and sends the one "Rol actualizat" Notification to the Member (private.notify drops the actor, so a Member who re-ranks themselves as a named replacement hears nothing). The caller must hold the Member''s Profile FOR UPDATE and have decided the change is allowed; only private.set_member_role_impl calls it, for a named replacement and then for the target. Granted to nobody.';

-- ---------------------------------------------------------------------------
-- 2. The command
-- ---------------------------------------------------------------------------
create function private.set_member_role_impl(
  p_member_id      uuid,
  p_role           public.member_role,
  p_reason         text default null,
  p_replacement_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor       uuid;
  v_reason      text := nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_member      public.profiles%rowtype;
  v_replacement public.profiles%rowtype;
  v_guarded     public.member_role;
  v_other       public.member_role;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2).
  if p_role is null then
    raise sqlstate 'PT400' using message = 'invalid_member_role';
  end if;

  -- #724 (ruling R8). Measured exactly as it is stored -- trimmed.
  perform private.require_text_length('reason', v_reason, null, 1000);

  -- A Member cannot replace themselves: they are the one leaving the rank.
  if p_replacement_id = p_member_id then
    raise sqlstate 'PT400' using message = 'replacement_is_target';
  end if;

  -- 2. Authority. A live active BC or Moderator (level 6 and up) decides every
  --    rank, bc and moderator included (ruling R31), and never their own. One
  --    reason string for every denial (conventions section 3). Naming
  --    themselves as the replacement is the one self-change allowed; it is not
  --    refused here because the replacement is never the target.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 or v_actor = p_member_id then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 3. Locks, in one statement ordered by id: the target, the actor, the named
  --    replacement, and every live holder of bc and moderator. Everything the
  --    last-holder guard counts below is held, so two leadership members
  --    removing the last two holders at once serialize here instead of each
  --    seeing the other's holder as the one who remains.
  perform 1
     from public.profiles as profile
    where profile.id = p_member_id
       or profile.id = v_actor
       or profile.id = p_replacement_id
       or (profile.role in ('bc', 'moderator') and profile.status = 'activ')
    order by profile.id
      for update;

  select * into v_member
    from public.profiles
   where id = p_member_id;
  if not found then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;

  -- The actor re-read under the lock: a demotion or deactivation that
  -- committed after the gate above is seen here.
  perform 1
     from public.profiles as actor
     join public.roles as role on role.id = actor.role
    where actor.id = v_actor
      and actor.status = 'activ'
      and role.level >= 6;
  if not found then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 4. State.
  if v_member.role = p_role then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- The last-holder guard (ruling R31): the change takes bc or moderator from
  -- the last live active Member holding it.
  if v_member.status = 'activ'
     and v_member.role in ('bc', 'moderator')
     and not exists (
       select 1
         from public.profiles as other
        where other.role = v_member.role
          and other.status = 'activ'
          and other.id <> p_member_id
     ) then
    v_guarded := v_member.role;
  end if;

  if v_guarded is null then
    if p_replacement_id is not null then
      raise sqlstate 'PT400' using message = 'replacement_not_needed';
    end if;
  else
    if p_replacement_id is null then
      raise sqlstate 'PT409' using message = 'last_' || v_guarded::text || '_needs_replacement';
    end if;

    select * into v_replacement
      from public.profiles
     where id = p_replacement_id;
    if not found then
      raise sqlstate 'PT404' using message = 'replacement_not_found';
    end if;
    if v_replacement.status <> 'activ' then
      raise sqlstate 'PT400' using message = 'replacement_inactive';
    end if;

    -- The replacement cannot be the last holder of the other leadership rank
    -- either, unless the target is taking that rank in the same call (the two
    -- swap seats and neither rank is left empty).
    v_other := case v_guarded
                 when 'moderator' then 'bc'::public.member_role
                 else 'moderator'::public.member_role
               end;
    if v_replacement.role = v_other
       and p_role <> v_other
       and not exists (
         select 1
           from public.profiles as other
          where other.role = v_other
            and other.status = 'activ'
            and other.id <> p_replacement_id
       ) then
      raise sqlstate 'PT409' using message = 'replacement_is_last_' || v_other::text;
    end if;
  end if;

  -- 5. Write. The replacement first, so the rank is never without a holder
  --    even inside the transaction; each change writes its own role_history
  --    row and Notification naming the real actor.
  if v_guarded is not null then
    perform private.apply_member_role(
      p_replacement_id, v_guarded, v_actor,
      coalesce(v_reason, 'Named replacement for the last ' || v_guarded::text || ' (set_member_role)'));
  end if;

  return private.apply_member_role(
    p_member_id, p_role, v_actor,
    coalesce(v_reason, 'Role changed by leadership (set_member_role)'));
end;
$function$;

revoke execute on function private.set_member_role_impl(uuid, public.member_role, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.set_member_role_impl(uuid, public.member_role, text, uuid)
  to authenticated;
comment on function private.set_member_role_impl(uuid, public.member_role, text, uuid) is
  'Body behind public.set_member_role (#580, #905): authority, the last-holder guard of ruling R31, and the audited change through private.apply_member_role, which carries ruling R23''s Minimum-Level consequences and #584''s Application withdrawal. A live active BC or Moderator decides every rank, bc and moderator included, never their own. When the change takes bc or moderator from its last live active holder, p_replacement_id must name an active Member (the actor included) who is first given that rank; each change writes its own role_history row. Locks the target, the actor, the replacement and every live bc/moderator holder FOR UPDATE in one id-ordered statement before counting. p_reason (#612) is stored trimmed, falling back to a fixed string when omitted or blank.';

create function public.set_member_role(
  p_member_id      uuid,
  p_role           public.member_role,
  p_reason         text default null,
  p_replacement_id uuid default null
)
returns public.profiles
language sql
set search_path = ''
as $function$
  select private.set_member_role_impl(p_member_id, p_role, p_reason, p_replacement_id);
$function$;

revoke execute on function public.set_member_role(uuid, public.member_role, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_member_role(uuid, public.member_role, text, uuid)
  to authenticated;
comment on function public.set_member_role(uuid, public.member_role, text, uuid) is
  'Sets a Member''s rank, callable only by a live active BC or Moderator and never on themselves; since ruling R31 (#905) that includes granting and removing bc and moderator, and changing a Member who holds either. Only the seven live ranks are accepted. The organization never loses its last Moderator or its last BC: a change that takes either rank from its last live active holder needs p_replacement_id, an active Member (the actor included -- the one self-change allowed) who is given that rank in the same transaction; without it the call answers PT409 last_moderator_needs_replacement / last_bc_needs_replacement, and a replacement named when no guard applies is PT400 replacement_not_needed. A replacement who is the last holder of the other leadership rank is PT409 replacement_is_last_bc / replacement_is_last_moderator unless the target takes that rank in the same call; an unknown one is PT404 replacement_not_found, an inactive one PT400 replacement_inactive, and the target itself PT400 replacement_is_target. Each change writes exactly one public.role_history row naming the real actor and one direct system Notification to its Member (never to the actor). It leaves Group Roles alone (ADR-0009 ruling R15): a promotion to BCE does not appoint a Department Group Manager and a demotion from it does not remove one -- a Group Manager or Responsible position is appointed and removed only by a Group command (#583). The single exception is Minimum Level: when the new rank falls below a Group''s min_level, the Member''s rows on that Group are deleted -- ordinary membership and Group Role alike -- because a Group states the rank its members must hold, and T13''s invariant (#586, no roster row below its Group''s Minimum Level) holds from this side because of it. An ancestor Group with a lower Minimum Level keeps its row and its authority still flows down through groups.path. Since #584 (ruling R30) the same demotion also withdraws the Member''s pending Applications to every Group whose Minimum Level now exceeds their rank, with the actor as decider. p_reason (#612), when non-blank, is stored trimmed as role_history.reason; omitted, null or all-whitespace falls back to a fixed string.';
