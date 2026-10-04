#!/usr/bin/env bash
# #1009: replay the old_base_joined_at migration against profiles dated on
# launch day and prove the rule -- every non-Recrut profile whose joined_at is
# 2026-10-02 moves to 2026-02-22, a Recrut dated 2026-10-02 keeps its date, a
# profile with any other date is never touched, and a second run changes
# nothing. The update runs as postgres, as a migration does, so it also proves
# that no trigger on profiles refuses or rewrites the change. Everything runs
# in one rolled-back transaction.
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration=$(printf '%s\n' supabase/migrations/*_old_base_joined_at.sql)

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

insert into auth.users (id, email) values
  ('10090000-0000-0000-0000-000000000011', 'recrut-1009@test.local'),
  ('10090000-0000-0000-0000-000000000012', 'voluntar-1009@test.local'),
  ('10090000-0000-0000-0000-000000000013', 'dated-1009@test.local'),
  ('10090000-0000-0000-0000-000000000014', 'bc-1009@test.local');

insert into public.profiles (id, full_name, email, role, joined_at) values
  ('10090000-0000-0000-0000-000000000011', 'Recrut 1009',   'recrut-1009@test.local',   'recrut',   date '2026-10-02'),
  ('10090000-0000-0000-0000-000000000012', 'Voluntar 1009', 'voluntar-1009@test.local', 'voluntar', date '2026-10-02'),
  ('10090000-0000-0000-0000-000000000013', 'Dated 1009',    'dated-1009@test.local',    'voluntar', date '2025-05-10'),
  ('10090000-0000-0000-0000-000000000014', 'Bc 1009',       'bc-1009@test.local',       'bc',       date '2026-10-02');

-- Every other profile (the demo data) as it stood, to prove nothing else moves.
create temporary table before_1009 on commit drop as
  select id, role, status, joined_at
    from public.profiles
   where id::text not like '10090000-%';
create temporary table history_before_1009 on commit drop as
  select count(*) as n from public.role_history;
SQL

  cat "$migration"

  cat <<'SQL'
do $assert$
begin
  if (select joined_at from public.profiles
       where id = '10090000-0000-0000-0000-000000000012')
       is distinct from date '2026-02-22' then
    raise exception 'a Voluntar dated 2026-10-02 did not move to 2026-02-22';
  end if;

  if (select joined_at from public.profiles
       where id = '10090000-0000-0000-0000-000000000014')
       is distinct from date '2026-02-22' then
    raise exception 'a BC dated 2026-10-02 did not move to 2026-02-22';
  end if;

  if (select joined_at from public.profiles
       where id = '10090000-0000-0000-0000-000000000011')
       is distinct from date '2026-10-02' then
    raise exception 'a Recrut dated 2026-10-02 lost its real join date';
  end if;

  if (select joined_at from public.profiles
       where id = '10090000-0000-0000-0000-000000000013')
       is distinct from date '2025-05-10' then
    raise exception 'a profile with another join date was touched';
  end if;

  if exists (select 1
               from before_1009 as old
               join public.profiles as cur using (id)
              where (old.role, old.status, old.joined_at)
                    is distinct from (cur.role, cur.status, cur.joined_at)) then
    raise exception 'a profile outside the rule changed';
  end if;

  if (select n from history_before_1009)
       <> (select count(*) from public.role_history) then
    raise exception 'the join-date correction wrote role_history';
  end if;
end
$assert$;

create temporary table after_first_1009 on commit drop as
  select id, joined_at from public.profiles;
SQL

  cat "$migration"

  cat <<'SQL'
do $assert$
begin
  if exists (select 1
               from after_first_1009 as first
               join public.profiles as cur using (id)
              where first.joined_at is distinct from cur.joined_at) then
    raise exception 'a second run of the migration changed a join date';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "old volunteer base join date (2026-10-02 -> 2026-02-22, Recruti kept) passed."
