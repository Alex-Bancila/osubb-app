#!/usr/bin/env bash
# `supabase start` (or `supabase db reset`) already applied seed.sql to an
# empty database. Staging gets the same file applied to a LIVE one
# (docs/backend/seeding-staging.md), so it has to be re-runnable: applying
# it twice must leave the same demo data, not a duplicate of it and not an
# error. It also proves the seed does not clobber rows a human added.
#
# Run it after the local Supabase stack is up and reset (CLI `start` + `db reset`):
#   bash scripts/check-seed-rerunnable.sh
#
# This script only ever talks to the LOCAL Supabase stack. The default URL
# is derived straight from supabase/config.toml's [db] port (no CLI call —
# see below); override it with LOCAL_DB_URL if you must, but the resolved
# host is checked against 127.0.0.1/localhost/::1 and the script refuses
# to run — before attempting any connection — if it is anything else. This
# is deliberate: `DB_URL` is the name seed-staging.yml uses for the
# *staging* connection string, and a scoped, distinct variable name here
# stops that value ever being picked up by accident and pointed at a live
# database (which would insert a sentinel row and apply the demo seed —
# including the published BC/Moderator password — to it).
set -euo pipefail
cd "$(dirname "$0")/.."

# The sentinel auth user/profile/Project and the demo lead it borrows are
# CI's own fixture UUIDs, not generated data — they stay hardcoded on
# purpose (see the inserts below).

# Read the port from the [db] section specifically — config.toml has other
# `port = ` lines under [api], [db.pooler], [studio], etc. and the first
# match is not necessarily the database's.
db_port=$(awk '
  /^\[db\]/ { in_db = 1; next }
  /^\[/     { in_db = 0 }
  in_db && /^port[[:space:]]*=/ { print $3; exit }
' supabase/config.toml)

LOCAL_DB_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:${db_port}/postgres}"

# libpq lets environment variables and URL query parameters redirect a
# connection away from the host in the URL's authority (PGHOSTADDR wins over
# the URL host; ?host=, ?hostaddr= and ?service= in the query do too). The
# local stack needs none of them, so clear the environment ones and refuse
# any query string outright — otherwise the host check below could pass on
# 127.0.0.1 while psql actually connects somewhere else.
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE
if [[ "$LOCAL_DB_URL" == *"?"* ]]; then
  echo "::error::Refusing LOCAL_DB_URL with a query string: parameters such as ?host= can redirect the connection past the local-host check." >&2
  exit 2
fi

# Extract the host from LOCAL_DB_URL and refuse anything non-local, before
# any connection is attempted. Handles postgres:// and postgresql://, an
# optional user[:password]@ prefix, an optional :port, an optional
# /database suffix, and a bracketed IPv6 host such as [::1].
if [[ ! "$LOCAL_DB_URL" =~ ^postgres(ql)?://([^/?]*)(.*)$ ]]; then
  echo "::error::Could not parse LOCAL_DB_URL as a postgres:// or postgresql:// URL." >&2
  exit 2
fi
authority="${BASH_REMATCH[2]}"
hostport="${authority##*@}"   # drop user[:password]@ if present
if [[ "$hostport" =~ ^\[([^]]+)\] ]]; then
  db_host="${BASH_REMATCH[1]}"       # bracketed IPv6, e.g. [::1]:5432 -> ::1
else
  db_host="${hostport%%:*}"          # host[:port] -> host
fi
case "$db_host" in
  127.0.0.1|localhost|::1) ;;
  *)
    echo "::error::Refusing to run against non-local host '$db_host' (from LOCAL_DB_URL). This script only ever seeds the local Supabase stack." >&2
    exit 2
    ;;
esac

CONTAINER="supabase_db_$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"

# Prefer a real psql against the local stack's LOCAL_DB_URL. Fall back to
# `docker exec` into the db container supabase_start/reset already brought
# up (its name is derived from config.toml's project_id, not hardcoded).
# The docker path never reads LOCAL_DB_URL — it always reaches the local
# container by name — so on a machine without psql, a LOCAL_DB_URL port or
# host override has no effect (it cannot reach anything non-local either).
# The container has no view of the repo on disk, so when the docker path is
# used, translate a `-f FILE` argument into a stdin redirect from the host
# instead of forwarding the flag — psql running inside the container could
# never open a host-relative path.
run_sql() {
  if command -v psql >/dev/null 2>&1 && [ -n "$LOCAL_DB_URL" ]; then
    psql "$LOCAL_DB_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"
    return
  fi

  local args=() file=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -f)
        file="$2"
        shift 2
        ;;
      *)
        args+=("$1")
        shift
        ;;
    esac
  done

  if [ -n "$file" ]; then
    docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -At "${args[@]}" < "$file"
  else
    docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -At "${args[@]}"
  fi
}

# Fail loudly — not "success on empty output" — if nothing answers.
if ! probe=$(run_sql -c "select 1" 2>&1) || [ "$probe" != "1" ]; then
  echo "::error::Could not reach the local Supabase database (tried psql+LOCAL_DB_URL, then docker exec into $CONTAINER). Is the local Supabase stack running? Docker output: $probe" >&2
  exit 1
fi

# Clean up the sentinel rows on every exit path, including a failure, so a
# broken run does not poison the next one.
cleanup() {
  run_sql -q <<'SQL' >/dev/null 2>&1 || true
delete from projects
 where created_by = 'e2750000-0000-0000-0000-000000000001';
delete from auth.users
 where id = 'e2750000-0000-0000-0000-000000000001';
SQL
}
trap cleanup EXIT

demo_before=$(run_sql -c "select count(*) from auth.users where email like '%@demo.osubb'")

# A same-name Project owned by a non-demo account is a sentinel for
# the most dangerous seed regression: deleting real staging data.
# Use a complete auth/profile pair so the invariant triggers exercise
# the same foreign keys as an invited tester.
run_sql -q <<'SQL'
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data,
  raw_user_meta_data, confirmation_token, recovery_token,
  email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e2750000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'seed-preservation@test.local',
  extensions.crypt('temporary', extensions.gen_salt('bf')),
  now(), now(), now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object(), '', '', '', '', '', '', '', ''
);
insert into profiles (id, full_name, email, role, joined_year, avatar_color)
values ('e2750000-0000-0000-0000-000000000001', 'Seed Preservation',
        'seed-preservation@test.local', 'responsabil', 2026, '#000000');
insert into projects (name, status, leader_id, created_by)
values ('Cross-owned seed guard', 'active',
        'd0000000-0000-0000-0000-000000000005',
        'e2750000-0000-0000-0000-000000000001');
SQL

# Re-seeding must abort before changing anything when a real-owned
# Project still points at a demo lead. Silently deleting that Project
# would be data loss; deleting the demo user would violate its FK.
if run_sql -1 -f supabase/seed.sql; then
  echo "::error::seed.sql accepted a non-demo-owned Project with a demo lead."
  exit 1
fi

guarded=$(run_sql -c "select format('%s:%s', (select count(*) from projects where name = 'Cross-owned seed guard' and created_by = 'e2750000-0000-0000-0000-000000000001'), (select count(*) from auth.users where email like '%@demo.osubb'))")
if [ "$guarded" != "1:${demo_before}" ]; then
  echo "::error::The cross-owned Project guard did not roll back cleanly ($guarded, expected 1:${demo_before})."
  exit 1
fi

run_sql -q <<'SQL'
delete from projects
 where name = 'Cross-owned seed guard'
   and created_by = 'e2750000-0000-0000-0000-000000000001';
insert into projects (name, status, leader_id, created_by)
values ('Festivalul Studențesc 2026', 'active',
        'e2750000-0000-0000-0000-000000000001',
        'e2750000-0000-0000-0000-000000000001');
SQL

before=$(run_sql -f scripts/seed-fingerprint.sql)
run_sql -1 -f supabase/seed.sql
after=$(run_sql -f scripts/seed-fingerprint.sql)

if [ "$before" != "$after" ]; then
  echo "::error::Applying supabase/seed.sql twice changed the data. Staging applies this file to a live database; it must be safe to run again."
  echo "before: $before"
  echo "after:  $after"
  exit 1
fi

preserved=$(run_sql -c "select format('%s:%s:%s', (select count(*) from auth.users where id = 'e2750000-0000-0000-0000-000000000001'), (select count(*) from profiles where id = 'e2750000-0000-0000-0000-000000000001'), (select count(*) from projects where created_by = 'e2750000-0000-0000-0000-000000000001'))")
if [ "$preserved" != "1:1:1" ]; then
  echo "::error::Re-seeding did not preserve the non-demo auth/profile/Project sentinel ($preserved)."
  exit 1
fi

echo "seed.sql applied twice, same data: $before"
