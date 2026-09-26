#!/usr/bin/env bash
# The #591 preflight must reject pre-existing sibling collisions, without
# renaming a real Group or applying any later DDL. Only a rollback transaction.
set -euo pipefail
migration=$(printf '%s\n' supabase/migrations/*_remove_legacy_group_keys.sql)
db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
output=$(mktemp)
trap 'rm -f "$output"' EXIT
if { printf '%s\n' 'begin;' 'drop index public.groups_parent_name_uidx;' "insert into public.groups(name,category) values ('Collision #591','team'),('collision #591','project');"; cat "$migration"; } | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q >"$output" 2>&1; then
  echo 'Expected group_name_collision; migration unexpectedly succeeded' >&2
  exit 1
fi
if ! grep -q 'group_name_collision' "$output"; then cat "$output" >&2; exit 1; fi
echo 'Group sibling collision refused before destructive DDL.'
