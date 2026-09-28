#!/usr/bin/env bash
# #826 (ruling R28): replay the migration's preflight with an open Evaluation
# Period, then with only closed ones. evaluation_periods no longer exists after
# the migration, so a minimal stand-in is created inside a rollback
# transaction; the guard reads nothing else.
set -euo pipefail
migration=$(printf '%s\n' supabase/migrations/*_role_evaluations.sql)
db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
output=$(mktemp)
trap 'rm -f "$output"' EXIT
# The guard is the migration's first DO block.
preflight() { sed -n '/^do \$\$$/,/^end \$\$;$/p' "$migration" | sed -n '1,/^end \$\$;$/p'; }
if {
  cat <<'SQL'
begin;
create table public.evaluation_periods (id bigint primary key, closed_at timestamptz);
insert into public.evaluation_periods values (1, now() - interval '1 day'), (2, null);
SQL
  preflight
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q >"$output" 2>&1; then
  echo 'An open Evaluation Period was not refused' >&2; exit 1
fi
if ! grep -q 'open_evaluation_period_remains' "$output"; then cat "$output" >&2; exit 1; fi
{
  cat <<'SQL'
begin;
create table public.evaluation_periods (id bigint primary key, closed_at timestamptz);
insert into public.evaluation_periods values (1, now() - interval '1 day');
SQL
  preflight
  printf '%s\n' 'rollback;'
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q
echo 'Open-Period guard refuses an open Period and passes with only closed ones.'
