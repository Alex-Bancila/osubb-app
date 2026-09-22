-- #603: deactivation really ends a Member's sessions.
--
-- ADR-0003 (amendment of 2026-08-23) accepts that a deactivated Member keeps
-- the claims already baked into their access token until it expires, on one
-- condition: their *refresh* sessions are revoked, so the window is bounded by
-- `jwt_expiry` (one hour) instead of running forever. #580 shipped
-- `set_member_status` without that half, and said so in its own comment: it
-- handed the revoke to a `revoke-sessions` Edge Function that #105's status
-- editor would call afterwards.
--
-- That design cannot be built. `@supabase/supabase-js@^2` -- the version the
-- Edge Functions pin -- exposes `admin.signOut(jwt, scope)`, which takes the
-- *user's own JWT*, not a user id, and an administrator deactivating someone
-- else does not hold their JWT. There is no sign-out-by-user-id anywhere in
-- the v2 admin API. #603's "Correction (2026-09-21)" retires the Edge Function
-- with the API it was written against, and Wave 3's ruling R28 (2026-09-21)
-- accepts the correction: the revoke moves into the database, inside the same
-- transaction as the Status change, so there is no second call that can fail
-- and no ordering to get wrong.
--
-- Demotion still does NOT revoke sessions, deliberately. `set_member_role` is
-- untouched by this migration: ADR-0003 (amended 2026-09-20) accepts the same
-- one-hour window there, because every *write* re-reads the actor's live level
-- from `public.profiles` and only *reads* follow the token.

-- ==================== 1 · the revoke helper ====================
-- Verified against the local stack on 2026-09-21: GoTrue **v2.196.0**
-- (`public.ecr.aws/supabase/gotrue:v2.196.0`), Supabase CLI 2.117.0, database
-- image `public.ecr.aws/supabase/postgres:15.8.1.085` (config.toml's pinned
-- `db.major_version = 15`; re-checked identical on 17.6.1.155). On that
-- version of GoTrue:
--
--   * sessions live in `auth.sessions`, keyed by `user_id uuid`;
--   * `auth.refresh_tokens.session_id` references `auth.sessions(id)`
--     **on delete cascade**, as does `auth.mfa_amr_claims.session_id`, so
--     deleting the session rows takes every refresh token issued against them;
--   * `auth.refresh_tokens.session_id` is nevertheless *nullable*, and its
--     `user_id` is a `character varying` holding the uuid as text. A token row
--     with no session -- anything minted before GoTrue grew sessions, or left
--     behind by a future schema change -- would survive the cascade, so it is
--     deleted explicitly by user id rather than trusted to the FK.
--
-- Both tables are owned by `supabase_auth_admin` and have RLS enabled;
-- `postgres` (the migration role, and therefore this function's owner and the
-- role a `security definer` body runs as) holds `arwdDxtm` on both and
-- `BYPASSRLS`, so the deletes are permitted without touching Auth's grants.
-- If a future CLI upgrade renames or re-keys these tables, this function is
-- the single place that has to change.
create function private.revoke_member_sessions(p_member_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where auth.sessions.user_id = p_member_id;
  delete from auth.refresh_tokens
   where auth.refresh_tokens.user_id = p_member_id::text;
$$;

comment on function private.revoke_member_sessions(uuid) is
  'Deletes every GoTrue session row for a Member (auth.sessions, plus any auth.refresh_tokens row the session cascade did not take), so every refresh token they hold stops working. Called only from private.set_member_status_impl, in the same transaction as the Status change, and executable by no client role. It lives in the database rather than in an Edge Function because the Edge-Function design #580 and ADR-0003 describe cannot be written: @supabase/supabase-js@^2''s admin.signOut takes a user''s JWT, not a user id, so an administrator deactivating someone else -- who does not hold that person''s JWT -- cannot call it, and the v2 admin API has no sign-out-by-user-id at all (#603, Correction of 2026-09-21; Wave 3 ruling R28). It does not and cannot invalidate an already-issued access token: that still expires on its own, which is the one-hour ADR-0003 window this revoke bounds.';

-- ==================== 2 · the call site ====================
-- `create or replace` preserves #580's ACL on this function (execute to
-- `authenticated`, which the security-invoker public wrapper needs). The only
-- change to the body is the revoke step at the end; everything above it is
-- #580's, unedited, because its migration is already in an open PR and must
-- not be rewritten in place.
create or replace function private.set_member_status_impl(
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

-- ==================== 3 · comments that were true until this migration ====
-- #580's comments on both the wrapper and the body say session revocation is
-- somebody else's job. They were accurate when they shipped and are false the
-- moment the call above exists, so they are replaced here rather than left to
-- mislead the next reader. #580's migration file itself is untouched.
comment on function public.set_member_status(uuid, public.member_status) is
  'Sets a Member''s Status, callable only by a live active BC or Moderator and never on themselves; a Member who holds bc/moderator may be deactivated or reactivated only by the Moderator. Writes exactly one public.role_history Status row naming the real actor, and no Notification at all -- a deactivated Member cannot read one and a reactivation is silent. It never touches group_members in either direction: deactivation leaves every roster row and Group Role in place, because authority is already live-filtered by the Wave 2 helpers, and a reactivated Member resumes the same positions. Any change to a Status other than activ also revokes the Member''s Auth sessions in this same transaction, through private.revoke_member_sessions (#603); a change to activ revokes nothing. The Member''s already-issued access token is not invalidated by that and cannot be: they keep a usable one for at most jwt_expiry (one hour), after which no refresh token is left to renew it and the claims hook would stamp no organization claims anyway -- the ADR-0003 deactivation window, now bounded rather than open-ended.';

comment on function private.set_member_status_impl(uuid, public.member_status) is
  'Body behind public.set_member_status: authority, target lock, the role_history Status write (#580), and the session revoke when the new Status is not activ (#603). Writes no Notification and no roster row.';

-- ==================== 4 · grants ====================
-- The four-role revoke with no grant back (conventions section 4, the
-- `require_*`/trigger shape): nothing but another `private` function running as
-- this function's owner may call it. A client that could call it directly
-- would hold an unauthenticated, unaudited sign-out for any Member in the
-- organization -- the authority gate lives in `set_member_status_impl`, which
-- is the only caller.
revoke execute on function private.revoke_member_sessions(uuid)
  from public, anon, authenticated, service_role;
