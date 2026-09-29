CREATE OR REPLACE FUNCTION private.set_member_status_impl(p_member_id uuid, p_status member_status, p_reason text DEFAULT NULL::text, p_replacement_id uuid DEFAULT NULL::uuid)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_reason      text := nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_from        public.member_status;
  v_member      public.profiles%rowtype;
  v_replacement public.profiles%rowtype;
  v_guarded     public.member_role;
  v_other       public.member_role;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2).
  if p_status is null then
    raise sqlstate 'PT400' using message = 'invalid_member_status';
  end if;

  -- #724 (ruling R8). Measured exactly as it is stored -- trimmed; a blank
  -- reason still falls back to the fixed string below.
  perform private.require_text_length('reason', v_reason, null, 1000);

  -- A Member cannot replace themselves: they are the one leaving `activ`.
  if p_replacement_id = p_member_id then
    raise sqlstate 'PT400' using message = 'replacement_is_target';
  end if;

  -- 2. Authority. A live active BC or Moderator (level 6 and up) sets every
  --    Member's Status, a BC or Moderator holder's included (ruling R31,
  --    #917), and never their own. One reason string for every denial
  --    (conventions section 3). Naming themselves as the replacement is the
  --    one self-change allowed: the replacement is never the target.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 or v_actor = p_member_id then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 3. Locks, in one statement ordered by id: the target, the actor, the named
  --    replacement, and every live holder of bc and moderator -- the lock
  --    set_member_role takes, so a rank removal and a deactivation of the last
  --    two holders serialize against each other.
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
  v_from := v_member.status;
  if v_from = p_status then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- The last-holder guard (ruling R31): the change takes the last live active
  -- holder of bc or moderator out of `activ`.
  if v_from = 'activ'
     and p_status <> 'activ'
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

    -- The replacement cannot be the last live holder of the other leadership
    -- rank: the target keeps their rank and only leaves `activ`, so nobody
    -- would take the seat the replacement leaves.
    v_other := case v_guarded
                 when 'moderator' then 'bc'::public.member_role
                 else 'moderator'::public.member_role
               end;
    if v_replacement.role = v_other
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

  -- 5. Write. The replacement's rank first, so the rank is never without a
  --    live holder even inside the transaction; it writes its own
  --    role_history row and Notification naming the real actor.
  if v_guarded is not null then
    perform private.apply_member_role(
      p_replacement_id, v_guarded, v_actor,
      coalesce(v_reason, 'Named replacement for the last ' || v_guarded::text || ' (set_member_status)'));
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
    coalesce(v_reason, 'Status changed by leadership (set_member_status)')
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
$function$

