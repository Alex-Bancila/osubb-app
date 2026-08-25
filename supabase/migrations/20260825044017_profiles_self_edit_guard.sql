-- 20260825044017_profiles_self_edit_guard.sql
-- OSUBB backend — Epic 3.2b: a member edits their own profile, nobody promotes
-- themselves.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§4.3)
-- Tested by supabase/tests/rls_profiles_write.test.sql.
--
-- §4.3: "SELF may edit own profile (not role/points); level >= 6 may edit roles".
-- That is two different rules and they need two different mechanisms:
--
--   WHICH ROWS you may touch      → an RLS policy (your own row, or any row at
--                                   level >= 6).
--   WHICH COLUMNS you may change  → not RLS. A policy sees the row, not the
--                                   diff, so it cannot say "you may update this
--                                   row but not this column of it". Column
--                                   privileges can, but they are granted per
--                                   *role* — and BC is `authenticated` like
--                                   everyone else, so revoking UPDATE(role)
--                                   from `authenticated` would lock BC out too.
--
-- Hence the split below: column grants remove what *nobody* edits through the
-- app, and a BEFORE UPDATE trigger — which does see old vs new — enforces the
-- level check on the rest.

-- ==================== 1 · rows ====================
-- house rule 12: `id = auth.uid()` is NOT a membership test on its own. A
-- member deactivated since their token was issued still has that uid and still
-- has a profiles row, so without auth_is_member() they could keep editing
-- themselves for up to an hour (ADR-0003, jwt_expiry).
create policy profiles_self_update on profiles
  for update to authenticated
  using      (auth_is_member() and (id = auth.uid() or auth_level() >= 6))
  with check (auth_is_member() and (id = auth.uid() or auth_level() >= 6));

-- ==================== 2 · columns nobody writes from the app ====================
-- `id` IS the auth user (a changed id would silently point a profile at someone
-- else's login); `created_at` is history. Neither is ever legitimately edited by
-- a client, BC included — so no client role gets the privilege at all, and the
-- trigger below never has to think about them.
revoke update on profiles from authenticated;
grant update (full_name, phone, avatar_color, email, role, status, tier, joined_year)
  on profiles to authenticated;

-- ==================== 3 · the privileged columns ====================
-- Plain (invoker-rights) function on purpose: it must see `current_user` as the
-- *caller*, which a security definer function would not — that is what lets a
-- server-side path through while holding a member back.
create or replace function guard_profile_privileged_columns() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- Fast path: an ordinary self-edit (name, phone, avatar) changes none of the
  -- guarded columns, so it never reaches the checks below.
  if new.role          is not distinct from old.role
     and new.status    is not distinct from old.status
     and new.email     is not distinct from old.email
     and new.tier      is not distinct from old.tier
     and new.joined_year is not distinct from old.joined_year then
    return new;
  end if;

  -- Who may change them: BC through the app, or a server-side caller. The
  -- second half matters — `service_role` and `postgres` carry no member_level,
  -- so a level check alone would block the seed, the CSV import and the future
  -- promotion job (#52), which are exactly the paths that *should* set roles.
  if public.auth_level() >= 6
     or current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  raise exception
    'Only BC (level >= 6) may change role, status, email, tier or joined_year on a profile'
    using errcode = '42501';
end;
$$;

comment on function guard_profile_privileged_columns() is
  'BEFORE UPDATE on profiles: blocks self-promotion. RLS cannot compare old vs new, and column grants cannot distinguish BC from any other authenticated member — this trigger does both (spec §4.3, Epic 3.2b).';

create trigger profiles_guard_privileged
  before update on profiles
  for each row
  execute function guard_profile_privileged_columns();

-- Why `email` sits in the guarded set rather than being self-editable:
-- profiles.email is the address the member was invited at, and the app treats
-- it as their identity — `invite-member` refuses a second invite for an address
-- that already has a profile. If members could rewrite it freely, one could
-- claim an address nobody has been invited at yet and block that invitation,
-- and every profile's contact address would stop being the one Auth actually
-- delivers to. A real "change my email" flow has to go through Supabase Auth
-- (which confirms at both the old and new address — see docs/backend/auth-config.md)
-- and then sync the profile server-side; until that exists, BC fixes typos.
