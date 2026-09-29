-- #917 (ruling R31, extended 2026-09-29): every BC member, not only the
-- Moderator, provisions an account at the BC or Moderator rank and changes the
-- Status of a BC or Moderator account. The last-holder safeguard of #905
-- applies: deactivating the last live holder of bc or moderator names the
-- replacement in the same call.
--
-- Alex, 2026-09-29, on the two Moderator-only paths #905 left: "Both, same as
-- roles."
--
-- 1. public.provision_profile: a live active BC or Moderator (level 6 and up)
--    may appoint at bc or moderator. Rebuilt from main's latest body
--    (20260927140000_provision_profile_rank_cap.sql); only the appointer
--    predicate and the comment change. The bootstrap path (no appointer, the
--    first Moderator) is untouched. Provisioning only ever adds a holder, so
--    no last-holder guard applies, and a new account is never its appointer.
-- 2. private.set_member_status_impl / public.set_member_status gain
--    p_replacement_id. A new trailing parameter changes the signature, so the
--    pair is dropped and created again, as #905 did for set_member_role. The
--    body is rebuilt from main's latest definition
--    (20260929110000_bc_rank_authority.sql): the Moderator-only branch for a
--    BC or Moderator target is gone, the actor is re-read under the lock with
--    its level, and the last-holder guard takes a named replacement exactly
--    as set_member_role does -- the same reasons, the same single id-ordered
--    lock statement (target, actor, replacement, every live holder), and the
--    same private.apply_member_role effect for the replacement's new rank.
--
-- The replacement may be the actor. It can never be the target, and it can
-- never be the last live holder of the other leadership rank: unlike a rank
-- change there is no swap here, because the target keeps their rank and only
-- leaves `activ`.

-- ---------------------------------------------------------------------------
-- 1. Provisioning at a leadership rank
-- ---------------------------------------------------------------------------
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
begin
  -- The rank ceiling (H1, widened by #917). A leadership account is created
  -- by leadership -- a live active BC or Moderator, the actor set_member_role
  -- accepts -- and answered before anything is written.
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
      -- #917: the appointer is a live active BC or Moderator, read under a
      -- share lock so a concurrent demotion or deactivation of them waits.
      perform 1
         from public.profiles as appointer
         join public.roles as role on role.id = appointer.role
        where appointer.id = p_appointed_by
          and appointer.status = 'activ'
          and role.level >= 6
          for share of appointer;
      if not found then
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

comment on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid) is 'Atomically provisions an invited auth user (ADR-0003, #602): the profiles row, then one Appointment per p_group_ids Group through private.appoint_group_member -- the ONE insert path into public.group_members (rulings R6/R27), which carries every roster invariant and writes the new Member''s Appointment Notification. p_appointed_by is the inviting BC or Moderator, whose live level >= 6 the Edge Function verifies from the database, and it reaches the core as p_actor, so the Notification is attributed to them (and private.notify drops the actor, so provisioning somebody as their own appointer notifies nobody). Rank ceiling (security pass 2026-09-27, H1; widened by ruling R31, #917): a bc or moderator profile is provisioned only when p_appointed_by is a live activ BC or Moderator (level 6 and up, read FOR SHARE) -- the actor set_member_role accepts -- or, for the bootstrap, when p_appointed_by is null, the role is moderator and no activ Moderator exists yet; anything else is 42501 member_manage_forbidden before anything is written. Groups are appointed in ascending id order with duplicates collapsed, so the FOR NO KEY UPDATE locks the core takes can never deadlock two concurrent calls. Any refusal from the core -- group_archived, group_member_not_eligible, group_member_below_min_level, automatic_group_has_no_roster_members, already_group_member, or the non-disclosing group_manage_forbidden for an unknown id -- fails the WHOLE call as PT400 carrying the core''s own reason string, so no half-placed Member survives. Writes no legacy membership table: #590 drops both. Service-role only; shared by the single-invite and CSV-import flows.';

-- ---------------------------------------------------------------------------
-- 2. Membership Status, with a named replacement
-- ---------------------------------------------------------------------------
drop function public.set_member_status(uuid, public.member_status, text);
drop function private.set_member_status_impl(uuid, public.member_status, text);

create function private.set_member_status_impl(
  p_member_id      uuid,
  p_status         public.member_status,
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
$function$;

revoke execute on function private.set_member_status_impl(uuid, public.member_status, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.set_member_status_impl(uuid, public.member_status, text, uuid)
  to authenticated;
comment on function private.set_member_status_impl(uuid, public.member_status, text, uuid) is
  'Body behind public.set_member_status (#580, #917): authority, the last-holder guard of ruling R31, the role_history Status write, and the session revoke when the new Status is not activ (#603). A live active BC or Moderator sets every Member''s Status, a BC or Moderator holder''s included, never their own. When the change takes the last live active holder of bc or moderator out of activ, p_replacement_id must name an active Member (the actor included) who is first given that rank through private.apply_member_role. Locks the target, the actor, the replacement and every live bc/moderator holder FOR UPDATE in one id-ordered statement before counting -- the lock set_member_role takes. Writes no Notification for the Status change and no roster row.';

create function public.set_member_status(
  p_member_id      uuid,
  p_status         public.member_status,
  p_reason         text default null,
  p_replacement_id uuid default null
)
returns public.profiles
language sql
security invoker
set search_path = ''
as $function$
  select private.set_member_status_impl(p_member_id, p_status, p_reason, p_replacement_id);
$function$;

revoke execute on function public.set_member_status(uuid, public.member_status, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_member_status(uuid, public.member_status, text, uuid)
  to authenticated;
comment on function public.set_member_status(uuid, public.member_status, text, uuid) is
  'Sets a Member''s Status, callable only by a live active BC or Moderator and never on themselves; since ruling R31 (#917) that includes a Member who holds bc or moderator. The organization never loses its last live Moderator or its last live BC: moving the last active holder of either rank out of activ needs p_replacement_id, an active Member (the actor included -- the one self-change allowed) who is given that rank in the same transaction, with its own role_history row and "Rol actualizat" Notification naming the real actor; without it the call answers PT409 last_moderator_needs_replacement / last_bc_needs_replacement, and a replacement named when no guard applies is PT400 replacement_not_needed. A replacement who is the last holder of the other leadership rank is PT409 replacement_is_last_bc / replacement_is_last_moderator; an unknown one is PT404 replacement_not_found, an inactive one PT400 replacement_inactive, and the target itself PT400 replacement_is_target. The Status change writes exactly one public.role_history Status row naming the real actor, and no Notification at all -- a deactivated Member cannot read one and a reactivation is silent. It never touches group_members in either direction: deactivation leaves every roster row and Group Role in place, because authority is already live-filtered by the Wave 2 helpers, and a reactivated Member resumes the same positions. Any change to a Status other than activ also revokes the Member''s Auth sessions in this same transaction, through private.revoke_member_sessions (#603); a change to activ revokes nothing. The Member''s already-issued access token is not invalidated by that and cannot be: they keep a usable one for at most jwt_expiry (one hour), after which no refresh token is left to renew it and the claims hook would stamp no organization claims anyway -- the ADR-0003 deactivation window, now bounded rather than open-ended.';

-- ---------------------------------------------------------------------------
-- 3. The shared effect now has two callers
-- ---------------------------------------------------------------------------
comment on function private.apply_member_role(uuid, public.member_role, uuid, text) is
  'The effect of one audited rank change (#905), with no gate of its own: sets the rank, writes the public.role_history row naming p_actor with p_reason, deletes the Member''s roster rows on every Group whose own Minimum Level is above the new rank (R23 -- ordinary membership and Group Role alike; an ancestor with a lower Minimum keeps its row), withdraws their pending Applications to those Groups with p_actor as decider (#584, ruling R30), and sends the one "Rol actualizat" Notification to the Member (private.notify drops the actor, so a Member who re-ranks themselves as a named replacement hears nothing). The caller must hold the Member''s Profile FOR UPDATE and have decided the change is allowed; only private.set_member_role_impl (for a named replacement and then for the target) and private.set_member_status_impl (for a named replacement, #917) call it. Granted to nobody.';
