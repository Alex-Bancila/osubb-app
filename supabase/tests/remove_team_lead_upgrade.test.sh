#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

-- Reconstruct the pre-#277 schema. This lead deliberately lacks membership.
drop table private.legacy_team_leads;
alter table public.teams
  add column lead_id uuid references public.profiles (id);

insert into auth.users (id, email)
values ('a2770000-0000-0000-0000-000000000001', 'legacy.team.lead@test.local');

insert into public.profiles (id, full_name, email, role, status)
values (
  'a2770000-0000-0000-0000-000000000001',
  'Legacy Team Lead',
  'legacy.team.lead@test.local',
  'voluntar',
  'activ'
);

insert into public.teams (id, name, dept_id, lead_id) values
  ('legacy-team-277', 'Legacy Team #277', null,
   'a2770000-0000-0000-0000-000000000001'),
  ('real-team-with-demo-lead-277', 'Real Team with demo lead #277', 'edu',
   'd0000000-0000-0000-0000-000000000005');

insert into public.team_members (team_id, member_id)
values ('legacy-team-277', 'd0000000-0000-0000-0000-000000000002');
SQL

  cat supabase/migrations/20260910150314_remove_team_lead.sql

  cat <<'SQL'
do $assert$
begin
  if (select member_id from private.legacy_team_leads
       where team_id = 'legacy-team-277')
       is distinct from 'a2770000-0000-0000-0000-000000000001'::uuid then
    raise exception 'legacy Team lead mapping was not archived';
  end if;

  if (select member_id from private.legacy_team_leads
       where team_id = 'real-team-with-demo-lead-277')
       is distinct from 'd0000000-0000-0000-0000-000000000005'::uuid then
    raise exception 'demo-linked Team lead mapping was not archived';
  end if;

  if not exists (select 1 from public.teams where id = 'legacy-team-277') then
    raise exception 'legacy Team row was not preserved';
  end if;

  if (select array_agg(member_id order by member_id)
        from public.team_members where team_id = 'legacy-team-277')
       is distinct from array['d0000000-0000-0000-0000-000000000002'::uuid] then
    raise exception 'migration changed the existing Team roster';
  end if;
end
$assert$;
SQL

  cat supabase/seed.sql

  cat <<'SQL'
do $assert$
begin
  if not exists (
    select 1 from public.teams where id = 'real-team-with-demo-lead-277'
  ) then
    raise exception 're-seeding deleted a non-demo Team with a former demo lead';
  end if;

  if not exists (select 1 from public.teams where id = 'legacy-team-277') then
    raise exception 're-seeding deleted the migrated legacy Team';
  end if;

  if not exists (
    select 1 from private.legacy_team_leads where team_id = 'legacy-team-277'
  ) then
    raise exception 're-seeding deleted the non-demo legacy mapping';
  end if;

  if exists (
    select 1 from private.legacy_team_leads
     where team_id = 'real-team-with-demo-lead-277'
  ) then
    raise exception 'deleted demo profile left a stale legacy mapping';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "Team lead upgrade and seed preservation checks passed."
