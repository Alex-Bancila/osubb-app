-- R58 (Alex, 2026-10-18; spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md,
-- section A): the Universitate on the Profile, and only a student of
-- Universitatea Babeș-Bolyai may be granted Drept de Vot (the Role `vot`).
-- The column is BC's to write and every active Member's to read; a trigger
-- on `profiles` refuses a Role change into `vot` unless the Member's
-- Universitate is the canonical UBB value. Bodies restated here are main's
-- latest (guard_profile_privileged_columns from 20260929234000, profiles_directory,
-- member_card and member_card_impl from 20260930200000) with only the R58
-- lines added.

-- ==================== 1 · the column ====================
alter table public.profiles add column university text;
alter table public.profiles add constraint profiles_university_length_ck
  check (university is null or (char_length(university) between 2 and 120 and university !~ '^[[:space:]]|[[:space:]]$'));
comment on column public.profiles.university is '#R58: the university the Member studies at, chosen from the app''s list (Universitatea Babeș-Bolyai is the one that counts for Drept de Vot). Null until known. BC or the Moderator writes it (guard_profile_privileged_columns); the Member reads it.';
grant select (university) on public.profiles to authenticated;
grant update (university) on public.profiles to authenticated;

-- The one place the canonical value is written in SQL. The app holds it once
-- more (app/src/lib/universities.ts).
create function private.ubb_university() returns text language sql immutable set search_path = '' as $$ select 'Universitatea Babeș-Bolyai'::text $$;
revoke execute on function private.ubb_university() from public, anon, authenticated, service_role;
comment on function private.ubb_university() is 'R58: the canonical name of Universitatea Babeș-Bolyai, the only value of profiles.university that lets a Member hold Drept de Vot. Read by the Drept de Vot trigger and by tests; no client role executes it.';

-- ==================== 2 · the privileged guard ====================
-- Rebuilt from 20260929234000_retire_dead_surface.sql (the latest
-- definition); `university` joins the columns only BC may change. Its grants
-- and comment are carried over by `create or replace`. The two exits are
-- separate statements, not one `or` expression: planning the expression
-- resolves private.caller_level() for the current user, and service_role has
-- no usage on `private`, so a service_role write of a guarded column (a
-- university, an email) would fail with "permission denied for schema private"
-- instead of passing.
create or replace function public.guard_profile_privileged_columns() returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.full_name       is not distinct from old.full_name
     and new.role        is not distinct from old.role
     and new.status      is not distinct from old.status
     and new.email       is not distinct from old.email
     and new.joined_at   is not distinct from old.joined_at
     and new.university  is not distinct from old.university then
    return new;
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (select private.caller_level()) >= 6 then
    return new;
  end if;
  raise exception
    'Only BC (level >= 6) may change full_name, role, status, email, joined_at or university on a profile'
    using errcode = '42501';
end;
$function$;

-- ==================== 3 · the UBB rule ====================
create function private.guard_vote_university() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.university is distinct from private.ubb_university() then
    raise sqlstate 'PT409' using message = 'vote_requires_ubb_student';
  end if;
  return new;
end $$;
revoke execute on function private.guard_vote_university() from public, anon, authenticated, service_role;
comment on function private.guard_vote_university() is 'R58 (ADR-0004, amended 2026-10-18): the rule of the organization -- a Role change into vot is refused with PT409 vote_requires_ubb_student unless profiles.university is the canonical Universitatea Babeș-Bolyai (private.ubb_university); null never counts. Every writer of a Role change into Drept de Vot meets it, set_member_role included. It fires on the change of Role only: a voter whose university changes later is not unseated, and a provisioning insert of a voter is outside it until the import carries the university. Security definer because no client role may execute private.ubb_university().';
create trigger profiles_guard_vote_university before update of role on public.profiles
  for each row when (new.role = 'vot' and old.role is distinct from 'vot')
  execute function private.guard_vote_university();

-- ==================== 4 · the reads ====================
-- profiles_directory, rebuilt from 20260930200000_board_title_directory.sql
-- (the latest definition) with university appended.
create or replace view public.profiles_directory with (security_invoker = on) as
  select profiles.id,
         profiles.full_name,
         profiles.role,
         profiles.status,
         profiles.avatar_color,
         profiles.created_at,
         profiles.joined_at,
         profiles.nickname,
         private.board_title(profiles.id) as board_title,
         profiles.university
    from public.profiles;
-- Authenticated only, as before: service_role has no usage on private, so a
-- select grant to it could never answer a row (conventions section 4).
revoke all on public.profiles_directory from public, anon, authenticated, service_role;
grant select on public.profiles_directory to authenticated;

comment on column public.profiles_directory.board_title is
  '#963: the Member''s Board Title (private.board_title) -- Președinte, Coordonator IT -- or null. The app shows it wherever it names the Member''s Role; role stays the rank every filter and sort reads.';
comment on column public.profiles_directory.university is
  'R58: the Member''s Universitate as the Profile holds it, or null when unknown. The canonical Universitatea Babeș-Bolyai is what the Drept de Vot rule asks for; the column itself confers no authority.';

-- member_card gains university after memberships. The result type changes, so
-- both functions are dropped and recreated from 20260930200000 (the latest
-- bodies), grants and comments carried over; only university is new.
drop function public.member_card(p_member_id uuid);
drop function private.member_card_impl(p_member_id uuid);

create function private.member_card_impl(p_member_id uuid)
 returns table(member_id uuid, nickname text, full_name text, role public.member_role, board_title text, joined_at date, avatar_color text, primary_group_id bigint, primary_group_name text, primary_group_color text, other_memberships integer, memberships jsonb, university text)
 language sql
 stable security definer
 set search_path to ''
as $function$
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
         -- #963: the Board Title, even when the board Group itself stays unnamed.
         private.board_title(profile.id),
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
         ), '[]'::jsonb),
         -- R58: the Universitate, null when unknown.
         profile.university
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
$function$;
revoke execute on function private.member_card_impl(p_member_id uuid) from public, anon, authenticated, service_role;
grant execute on function private.member_card_impl(p_member_id uuid) to authenticated;
comment on function private.member_card_impl(p_member_id uuid) is 'Member Card projection body (R6, R17). One row for any Member when the caller carries organization claims and an activ Profile, none otherwise. The chip (primary_group_*) is the roster row with the earliest created_at on an active top-level Group that is not the Organization Group; other_memberships counts the remaining explicit rows on active, non-Organization Groups; memberships lists every such row, the chip''s included, in roster created_at order. board_title (#963) is private.board_title: a BC or BCE member''s Board Title, carried even though the Private board Group is not named to a viewer who cannot see it. university (R58) is the Member''s Universitate, null when unknown. No contact column, no points, no rank; the Group label is never read.';

create function public.member_card(p_member_id uuid)
 returns table(member_id uuid, nickname text, full_name text, role public.member_role, board_title text, joined_at date, avatar_color text, primary_group_id bigint, primary_group_name text, primary_group_color text, other_memberships integer, memberships jsonb, university text)
 language sql
 stable
 set search_path to ''
as $function$
  select * from private.member_card_impl(p_member_id);
$function$;
revoke execute on function public.member_card(p_member_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.member_card(p_member_id uuid) to authenticated;
comment on function public.member_card(p_member_id uuid) is 'Member Card (R6): a colleague''s Nickname, full name, Role, Board Title (#963: a BC or BCE member''s function, null otherwise), join date, avatar colour, first top-level Group chip, "+n" count, explicit Group memberships and Universitate (R58, null when unknown), for any active Member. Contact details stay behind profiles_contact; points and rank never appear.';
