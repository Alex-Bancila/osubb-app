#!/usr/bin/env bash
# Runs scripts/smoke-tracker-commands.sql against the LOCAL Supabase stack --
# the Task Tracker command set end to end, through the public wrappers only,
# inside one transaction that rolls back. Reset and seed the stack first:
#
#   npx supabase db reset && bash scripts/smoke-tracker-commands.sh
#
# Connection, same discipline as scripts/check-seed-rerunnable.sh: prefer a
# real psql against LOCAL_DB_URL, whose host is checked and refused if it is
# not local; otherwise `docker exec` into the db container the local stack
# already runs (its name comes from config.toml's project_id, never a live
# database). The variable is deliberately NOT called DB_URL -- that is the name
# seed-staging.yml uses for the STAGING connection string, and this script must
# never pick it up.
#
# The docker path has to do one extra thing: the SQL file includes
# supabase/tests/_helpers.sql with a `\ir` relative to its own location, and
# psql running inside the container cannot see this repo, so the include is
# spliced in on the way through.
set -euo pipefail
cd "$(dirname "$0")/.."

SQL=scripts/smoke-tracker-commands.sql
HELPERS=supabase/tests/_helpers.sql

db_port=$(awk '
  /^\[db\]/ { in_db = 1; next }
  /^\[/     { in_db = 0 }
  in_db && /^port[[:space:]]*=/ { print $3; exit }
' supabase/config.toml)

LOCAL_DB_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:${db_port}/postgres}"

# libpq lets PGHOST*/?host= redirect a connection past the URL's own host, so
# clear the environment ones and refuse a query string outright before the
# local-host check below can be fooled.
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE
if [[ "$LOCAL_DB_URL" == *"?"* ]]; then
  echo "::error::Refusing LOCAL_DB_URL with a query string: parameters such as ?host= can redirect the connection past the local-host check." >&2
  exit 2
fi
if [[ ! "$LOCAL_DB_URL" =~ ^postgres(ql)?://([^/?]*)(.*)$ ]]; then
  echo "::error::Could not parse LOCAL_DB_URL as a postgres:// or postgresql:// URL." >&2
  exit 2
fi
authority="${BASH_REMATCH[2]}"
hostport="${authority##*@}"
if [[ "$hostport" =~ ^\[([^]]+)\] ]]; then
  db_host="${BASH_REMATCH[1]}"
else
  db_host="${hostport%%:*}"
fi
case "$db_host" in
  127.0.0.1 | localhost | ::1) ;;
  *)
    echo "::error::Refusing to run against non-local host '$db_host' (from LOCAL_DB_URL). This smoke test only ever runs against the local Supabase stack." >&2
    exit 2
    ;;
esac

CONTAINER="supabase_db_$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"

# Splice the helpers file in place of the `\ir` line. The pattern is built with
# sprintf("%c", 92) rather than written as a backslash literal: awk on Windows
# shells goes through enough quoting layers that an escaped backslash is not
# reliably still a backslash by the time the pattern is compiled.
inlined_sql() {
  awk -v helpers="$HELPERS" '
    index($0, sprintf("%cir ", 92)) == 1 {
      printf "-- >>> inlined %s (psql in the container cannot see the repo)\n", helpers
      while ((getline line < helpers) > 0) print line
      close(helpers)
      next
    }
    { print }
  ' "$SQL"
}

status=0
if command -v psql > /dev/null 2>&1; then
  echo "Running $SQL with psql against $LOCAL_DB_URL"
  psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 -f "$SQL" || status=$?
else
  echo "psql not found; running $SQL through docker exec into $CONTAINER (the \\ir include is inlined)"
  inlined_sql | docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -f - || status=$?
fi

if [ "$status" -ne 0 ]; then
  echo "::error::The tracker smoke test FAILED (exit $status). The first failing step raised above; the transaction rolled back, so the database is unchanged." >&2
  exit "$status"
fi
echo "Tracker smoke test finished: SMOKE TEST PASSED (see the notices above, one per step)."
