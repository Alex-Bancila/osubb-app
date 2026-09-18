-- #510: group_ids organization claim (ADR-0009 Wave 1) -- the custom access-token hook
-- gains a group_ids claim built from public.group_members' explicit rows (never
-- Automatic Membership), plus public.auth_in_group(bigint) and the
-- supabase_auth_admin read path the hook needs at token-issue time.
-- Tested by supabase/tests/auth_claims.test.sql.

-- `create or replace` preserves the existing ACL (supabase_auth_admin only) --
-- see 20260819163238_jwt_claims_hook.sql for the grants this leaves untouched.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  member record;
  claims jsonb;
  meta   jsonb;
begin
  select p.role, r.level,
         coalesce((select jsonb_agg(md.dept_id)
                     from public.member_departments md
                    where md.member_id = p.id), '[]'::jsonb) as dept_ids,
         coalesce((select jsonb_agg(tm.team_id)
                     from public.team_members tm
                    where tm.member_id = p.id), '[]'::jsonb) as team_ids,
         -- Explicit roster rows only: Automatic Membership (the Organization Group) is
         -- derived from the Role and is never a claim. Numbers, ascending, so a token is
         -- byte-stable for the same roster.
         coalesce((select jsonb_agg(gm.group_id order by gm.group_id)
                     from public.group_members gm
                    where gm.member_id = p.id), '[]'::jsonb) as group_ids
    into member
    from public.profiles p
    join public.roles r on r.id = p.role
   where p.id = (event ->> 'user_id')::uuid
     and p.status = 'activ';

  if not found then
    return event;
  end if;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  meta   := coalesce(claims -> 'app_metadata', '{}'::jsonb)
            || jsonb_build_object(
                 'member_role',  member.role,
                 'member_level', member.level,
                 'dept_ids',     member.dept_ids,
                 'team_ids',     member.team_ids,
                 'group_ids',    member.group_ids);
  return jsonb_set(event, '{claims}', jsonb_set(claims, '{app_metadata}', meta));
end;
$$;

-- The Auth server reads group_members while issuing a token. groups is granted too so a
-- later hook that filters by groups.status cannot break logins (the same dormant-policy
-- reasoning 20260819163238 used before RLS was enabled).
grant select on table public.groups, public.group_members to supabase_auth_admin;
create policy groups_read_auth_admin on public.groups
  for select to supabase_auth_admin using (true);
create policy group_members_read_auth_admin on public.group_members
  for select to supabase_auth_admin using (true);

-- ==================== RLS helper: auth_in_group() ====================
-- Numeric ids: `?` only matches string elements, so containment does the test.
-- `'[1,2]'::jsonb @> '2'::jsonb` is true by the documented array-contains-primitive
-- rule; a string-shaped `["2"]` does not contain `2`, so a forged text array fails
-- closed.
create function public.auth_in_group(g bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' -> 'group_ids' @> to_jsonb(g), false)
$$;
comment on function public.auth_in_group(bigint) is
  'True when the caller''s token lists the Group id in group_ids (explicit membership only). JWT-only; pair with a live check where authority is exercised.';

revoke execute on function public.auth_in_group(bigint) from public, anon, authenticated, service_role;
grant execute on function public.auth_in_group(bigint) to authenticated, service_role;
