-- Security pass, backend findings M4 (2026-09-27): every row gate that still
-- compared the JWT's member_level claim now reads the live Profile instead.
--
-- Why: auth_level() is the level stamped into the access token when it was
-- issued, and a token lives for up to an hour (jwt_expiry = 3600). A BC who is
-- demoted or deactivated keeps that claim until the token expires, so every gate
-- written as `auth_level() >= N` kept admitting them. private.caller_level()
-- reads public.profiles joined to public.roles at statement time and answers -1
-- for anyone without an `activ` Profile, so the same gate closes the moment the
-- Moderator changes the Profile.
--
-- auth_is_member() stays on every gate as the claims guard (house rule 12): a
-- session with no organisation claims is still refused before any live lookup,
-- and the claimless sweep in rls_deny_by_default keeps holding.
--
-- Also here: a BC may no longer edit the Moderator's or another BC's Profile.
-- profiles.email is read by invite-member, reinvite-member and the bounce
-- mapping, so a BC rewriting a leadership address undercut the Moderator-only
-- rule on appointments. The Moderator edits any Profile; a BC edits Profiles
-- below level 6 and their own; everyone else edits only their own.
--
-- Every body below is main's latest definition with only the level test changed:
--   profiles_update_self                 20260922120000 (rename of the 3.2b policy)
--   guard_profile_privileged_columns     20260923223833_nickname_member_card.sql
--   member_points                        20260907204817_leadership_only_global_points.sql
--   leaderboard                          20260927120000_retire_level_four.sql
--   profiles_contact                     20260822225003_profiles_read_policies.sql
--   event_attendance_read                20260927120000_retire_level_four.sql
--   points_ledger_read, _create_sanction 20260922120000_schema_naming_conventions.sql

-- ==================== profiles: live level, leadership rows ====================

alter policy profiles_update_self on public.profiles
  using (
    public.auth_is_member()
    and (
      (id = (select auth.uid()) and (select private.caller_level()) >= 0)
      or (select private.caller_level()) >= 9
      or (
        (select private.caller_level()) >= 6
        and (select role_row.level from public.roles as role_row where role_row.id = profiles.role) < 6
      )
    )
  )
  with check (
    public.auth_is_member()
    and (
      (id = (select auth.uid()) and (select private.caller_level()) >= 0)
      or (select private.caller_level()) >= 9
      or (
        (select private.caller_level()) >= 6
        and (select role_row.level from public.roles as role_row where role_row.id = profiles.role) < 6
      )
    )
  );

comment on policy profiles_update_self on public.profiles is
  'A live active Member edits their own Profile; a live BC (level 6) edits Profiles below level 6; the live Moderator (level 9) edits any Profile. Levels are read from the live Profile (private.caller_level), never from the token. Privileged columns are further limited by guard_profile_privileged_columns.';

create or replace function public.guard_profile_privileged_columns() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.full_name       is not distinct from old.full_name
     and new.role        is not distinct from old.role
     and new.status      is not distinct from old.status
     and new.email       is not distinct from old.email
     and new.tier        is not distinct from old.tier
     and new.joined_year is not distinct from old.joined_year
     and new.joined_at   is not distinct from old.joined_at then
    return new;
  end if;
  if current_user not in ('authenticated', 'anon')
     or (select private.caller_level()) >= 6 then
    return new;
  end if;
  raise exception
    'Only BC (level >= 6) may change full_name, role, status, email, tier, joined_year or joined_at on a profile'
    using errcode = '42501';
end;
$$;

-- ==================== owner-rights views ====================
-- Both stay owner-rights (conventions.md): their WHERE clause is the boundary.

create or replace view public.member_points with (security_invoker = off) as
  select p.id as member_id,
         coalesce(sum(l.delta), 0::bigint)::integer as points
    from public.profiles p
    left join public.points_ledger l on l.member_id = p.id
   where (public.auth_is_member() and (select private.caller_level()) >= 5)
      or current_user <> all (array['authenticated'::name, 'anon'::name])
   group by p.id;

comment on view public.member_points is
  'Global point totals for BCE, BC, Moderator, and trusted server roles. Owner rights are deliberate so the aggregate can cross points_ledger RLS; the leadership predicate, read from the live Profile, is the security boundary. Ordinary members use a separate own-total endpoint.';

create or replace view public.profiles_contact with (security_invoker = off) as
  select profiles.id,
         profiles.email,
         profiles.phone
    from public.profiles
   where public.auth_is_member()
     and (select private.caller_level()) >= 0
     and (profiles.id = (select auth.uid()) or (select private.caller_level()) >= 5);

comment on view public.profiles_contact is
  'Contact details for SELF or live level >= 5 (spec §4.3). Runs with owner rights on purpose — it re-exposes columns revoked from authenticated — so its WHERE clause is the security boundary, not a filter. The level is read from the live Profile, never from the token.';

create or replace view public.leaderboard with (security_invoker = on) as
  select mp.member_id,
         pr.full_name,
         pr.role,
         mp.points,
         rank() over (order by mp.points desc) as rank
    from public.member_points mp
    join public.profiles pr on pr.id = mp.member_id
   where ((public.auth_is_member() and (select private.caller_level()) >= 5)
          or current_user <> all (array['authenticated'::name, 'anon'::name]))
     and pr.status = 'activ'::public.member_status;

-- ==================== event_attendance ====================
-- The self limbs need no change: the events subquery runs private.can_read_event,
-- which already reads the live `activ` Profile. Only the colleague limb trusted
-- the token.

alter policy event_attendance_read on public.event_attendance
  using (
    public.auth_is_member()
    and exists (select 1 from public.events e where e.id = event_attendance.event_id)
    and (member_id = (select auth.uid()) or (select private.caller_level()) >= 5)
  );

-- ==================== points_ledger ====================
-- The existing live `activ` limb is what caller_level() >= 0 already checks;
-- the level limb now reads the same live Profile.

alter policy points_ledger_read on public.points_ledger
  using (
    (select public.auth_is_member())
    and (select private.caller_level()) >= 0
    and (member_id = (select auth.uid()) or (select private.caller_level()) >= 5)
  );

alter policy points_ledger_create_sanction on public.points_ledger
  with check (
    (select public.auth_is_member())
    and (select private.caller_level()) >= 6
    and reason = 'sanction'
    and awarded_by = (select auth.uid())
  );
