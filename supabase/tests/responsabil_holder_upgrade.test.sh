#!/usr/bin/env bash
# Replay the actual #593 preflight with an old-label holder, then without it.
# The post-migration enum cannot contain that label, so reconstruct its old
# eight-value shape only inside a rollback transaction.
set -euo pipefail
migration=$(printf '%s\n' supabase/migrations/*_retire_level_four.sql)
db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
output=$(mktemp)
trap 'rm -f "$output"' EXIT
preflight() { sed '/^drop policy event_attendance_read/,$d' "$migration"; }
if {
  cat <<'SQL'
begin;
drop view public.leaderboard;
drop view public.profiles_directory;
create type pg_temp.pre593_member_role as enum ('recrut','voluntar','activ','vot','responsabil','bce','bc','moderator');
alter table public.profiles alter column role drop default;
alter table public.profiles alter column role type pg_temp.pre593_member_role using role::text::pg_temp.pre593_member_role;
update public.profiles set role='responsabil' where id='d0000000-0000-0000-0000-000000000002';
SQL
  preflight
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q >"$output" 2>&1; then
 echo 'Retired-rank holder was not refused' >&2; exit 1
fi
if ! grep -q 'responsabil_holder_remains' "$output"; then cat "$output" >&2; exit 1; fi
{ printf '%s\n' 'begin;'; preflight; printf '%s\n' 'rollback;'; } | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q
echo 'Retired-rank guard refuses a holder and passes with no holder.'
