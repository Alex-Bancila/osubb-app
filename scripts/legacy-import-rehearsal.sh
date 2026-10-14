#!/usr/bin/env bash
# scripts/legacy-import-rehearsal.sh -- #1049: the Legacy Import, end to end, on the LOCAL stack with the real file.
#
#   npx supabase db reset && bash scripts/legacy-import-rehearsal.sh ../osubb-legacy-import/import-set.json
#
# Provisions placeholder Members and Groups carrying the file's ids, then runs
# the import script three times: a dry run, the real run, and the real run
# again (every row already imported, totals still verified). Local only: the
# database container and API URL come from the local stack, never from the
# environment. Reset the database afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?usage: bash scripts/legacy-import-rehearsal.sh <import-set.json>}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 2; }

CONTAINER="supabase_db_$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"
STATUS="$(npx supabase status -o env)"
API_URL="$(printf '%s\n' "$STATUS" | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
SECRET="$(printf '%s\n' "$STATUS" | sed -n 's/^SECRET_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
[ -n "$SECRET" ] || SECRET="$(printf '%s\n' "$STATUS" | sed -n 's/^SERVICE_ROLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"

case "$API_URL" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *) echo "Refusing to rehearse against '$API_URL': the rehearsal only ever runs on the local stack." >&2; exit 2 ;;
esac
[ -n "$SECRET" ] || { echo "The local secret key could not be read from 'supabase status'." >&2; exit 2; }

echo "Provisioning placeholder Members and Groups in $CONTAINER"
node scripts/legacy-import-rehearsal-fixture.mjs "$FILE" \
  | docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q -f -

run() {
  SUPABASE_URL="$API_URL" SUPABASE_SECRET_KEY="$SECRET" \
    node scripts/import-legacy-tasks.mjs --file "$FILE" --actor rehearsal-moderator@test.local "$@"
}

echo "--- dry run ---";            run --dry-run
echo "--- the real run ---";       run --execute
echo "--- the real run, again ---"; run --execute

echo "REHEARSAL PASSED: the file imported end to end and its totals verified twice."
echo "Now look at the result in the local app, then: npx supabase db reset"
