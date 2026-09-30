-- #963: board titles readable by every Member (profiles_directory.board_title, member_card.board_title)
--
-- Decision D1 (#824) gave a BC or BCE member's Board Title a home: their
-- position_title as a Group Responsible of the Private Group "Biroul de
-- Conducere", which org_settings.board_group_id names. Only the holder could
-- read it -- group_members_read hides a Private Group's roster from everyone
-- outside it (#756) -- so every other surface named them by the rank ("BC",
-- "BCE"). This migration projects that one fact to every Member without
-- opening the roster:
--
-- 1. private.board_title(p_member), the one definition, security definer
--    because the reader cannot see the roster it reads. It answers the title
--    and nothing else: not the Group, not who else sits on it.
-- 2. public.profiles_directory gains board_title (appended, so the view is
--    replaced in place), and public.member_card gains it after role.
--
-- No new write path: a title is still set by appointing the Member a Group
-- Responsible of the board (set_group_role), exactly as D1 built it, and no
-- authority helper, policy or command reads it.

-- ---------------------------------------------------------------------------
-- 1. The helper.
-- ---------------------------------------------------------------------------
-- The setting is read the way private.can_read_evaluation_rankings reads its
-- sibling adunarea_generala_group_id: a scalar subquery that casts only a
-- well-formed value, so no plan can cast another key's value. A BC or BCE
-- member only: the Moderator is not a board position (F-7, #893), and the
-- board's Minimum Level of 5 already keeps everyone below BCE off it.
create function private.board_title(p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(membership.position_title), '')
    from public.group_members as membership
    join public.profiles as profile on profile.id = membership.member_id
   where membership.member_id = p_member
     and membership.group_role = 'responsible'
     and profile.role in ('bce', 'bc')
     and membership.group_id = (
           select case when setting.value ~ '^[1-9][0-9]{0,17}$'
                       then setting.value::bigint end
             from public.org_settings as setting
            where setting.key = 'board_group_id');
$$;

revoke execute on function private.board_title(uuid)
  from public, anon, authenticated, service_role;
-- The security_invoker profiles_directory view calls it as the reader.
grant execute on function private.board_title(uuid) to authenticated;

comment on function private.board_title(uuid) is
  '#963 (decision D1, #824): a BC or BCE member''s Board Title -- the trimmed position_title of their Group Responsible row on the Private Group org_settings.board_group_id names (Biroul de Conducere). Null when the setting is unset, the Member has no Responsible row there, the title is blank, or the Member is not BC or BCE (the Moderator is not a board position, F-7). Security definer because the Private Group''s roster is hidden from the readers (group_members_read, #756): it answers the title alone, never the Group or its other rows. Granted to authenticated for the security_invoker public.profiles_directory; public.member_card reads it from its definer body. Confers nothing: no authority reads it.';

-- ---------------------------------------------------------------------------
-- 2. profiles_directory, rebuilt from 20260929234000_retire_dead_surface.sql
-- (the latest definition) with board_title appended.
-- ---------------------------------------------------------------------------
create or replace view public.profiles_directory with (security_invoker = on) as
  select profiles.id,
         profiles.full_name,
         profiles.role,
         profiles.status,
         profiles.avatar_color,
         profiles.created_at,
         profiles.joined_at,
         profiles.nickname,
         private.board_title(profiles.id) as board_title
    from public.profiles;
-- Authenticated only: service_role has no usage on private, so a select grant
-- to it could never answer a row now that the view calls a private helper
-- (conventions section 4, the gated read-surface exception). Nothing running
-- as service_role reads this view.
revoke all on public.profiles_directory from public, anon, authenticated, service_role;
grant select on public.profiles_directory to authenticated;

comment on column public.profiles_directory.board_title is
  '#963: the Member''s Board Title (private.board_title) -- Președinte, Coordonator IT -- or null. The app shows it wherever it names the Member''s Role; role stays the rank every filter and sort reads.';

-- ---------------------------------------------------------------------------
-- 3. member_card gains board_title after role. The result type changes, so
-- both functions are dropped and recreated from
-- 20260927120000_retire_level_four.sql (the latest bodies), grants and
-- comments carried over; only board_title is new.
-- ---------------------------------------------------------------------------
drop function public.member_card(p_member_id uuid);
drop function private.member_card_impl(p_member_id uuid);

create function private.member_card_impl(p_member_id uuid)
 returns table(member_id uuid, nickname text, full_name text, role public.member_role, board_title text, joined_at date, avatar_color text, primary_group_id bigint, primary_group_name text, primary_group_color text, other_memberships integer, memberships jsonb)
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
$function$;
revoke execute on function private.member_card_impl(p_member_id uuid) from public, anon, authenticated, service_role;
grant execute on function private.member_card_impl(p_member_id uuid) to authenticated;
comment on function private.member_card_impl(p_member_id uuid) is 'Member Card projection body (R6, R17). One row for any Member when the caller carries organization claims and an activ Profile, none otherwise. The chip (primary_group_*) is the roster row with the earliest created_at on an active top-level Group that is not the Organization Group; other_memberships counts the remaining explicit rows on active, non-Organization Groups; memberships lists every such row, the chip''s included, in roster created_at order. board_title (#963) is private.board_title: a BC or BCE member''s Board Title, carried even though the Private board Group is not named to a viewer who cannot see it. No contact column, no points, no rank; the Group label is never read.';

create function public.member_card(p_member_id uuid)
 returns table(member_id uuid, nickname text, full_name text, role public.member_role, board_title text, joined_at date, avatar_color text, primary_group_id bigint, primary_group_name text, primary_group_color text, other_memberships integer, memberships jsonb)
 language sql
 stable
 set search_path to ''
as $function$
  select * from private.member_card_impl(p_member_id);
$function$;
revoke execute on function public.member_card(p_member_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.member_card(p_member_id uuid) to authenticated;
comment on function public.member_card(p_member_id uuid) is 'Member Card (R6): a colleague''s Nickname, full name, Role, Board Title (#963: a BC or BCE member''s function, null otherwise), join date, avatar colour, first top-level Group chip, "+n" count and explicit Group memberships, for any active Member. Contact details stay behind profiles_contact; points and rank never appear.';
