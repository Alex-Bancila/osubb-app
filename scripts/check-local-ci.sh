#!/usr/bin/env bash
# The local mirror of .github/workflows/ci.yml: every gate CI runs, in CI's
# order, except the gitleaks secret scan (needs an image pull) and the staging
# push (merge-only). Run it before pushing and you learn in one pass what CI
# would tell you in five jobs.
#
# It was written mid-wave, when GitHub Actions ran out of monthly CPU quota and
# local verification had to stand in for CI (tracker command wave, Ruling 25).
# Actions runs again; the script stays because the pre-push check is worth
# having either way. It does NOT replace CI on a pull request -- house rule 7's
# "CI must be green" still means the real thing.
#
# Usage:  bash scripts/check-local-ci.sh            # everything
#         bash scripts/check-local-ci.sh repo       # just the repo job
#         bash scripts/check-local-ci.sh db         # just the database job
#         bash scripts/check-local-ci.sh functions  # just the Edge Functions job
#         bash scripts/check-local-ci.sh frontend   # just the frontend job
#
# The db job needs the local Supabase stack up (`npx supabase start`); it runs
# `db reset`, so it destroys whatever is in the local database.
#
# Runs every gate even after one fails, then prints a PASS/FAIL summary and
# exits non-zero if any failed.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

ONLY="${1:-all}"
FAILED=()
PASSED=()

step() {  # step <label> <command...>
  local label="$1"; shift
  printf '\n=== %s ===\n' "$label"
  if "$@"; then
    PASSED+=("$label")
  else
    printf '!!! FAILED: %s\n' "$label"
    FAILED+=("$label")
  fi
}

# ---------------------------------------------------------------- repo job
if [ "$ONLY" = all ] || [ "$ONLY" = repo ]; then
  # CI checks out the repo, so it only ever sees TRACKED files. Running
  # `npm run check:root` against a working tree that carries another session's
  # untracked files reports failures CI could never hit, so the format gate is
  # scoped to tracked files here; every other sub-check is run verbatim.
  step "repo: format:check (tracked files only)" bash -c '
    mapfile -t files < <(git ls-files "*.md" "*.json" "*.yaml" "*.yml")
    npx prettier --check --ignore-path .gitignore "${files[@]}"
    deno fmt --check supabase/functions'
  step "repo: lint:links"    npm run lint:links
  step "repo: lint:shell"    npm run lint:shell
  step "repo: lint:deno"     npm run lint:deno
  step "repo: test:tooling"  npm run test:tooling
fi

# ------------------------------------------------------------------ db job
if [ "$ONLY" = all ] || [ "$ONLY" = db ]; then
  step "db: CLI pin matches root package.json" bash -c '
    pinned="$(node -p "require(\"./package.json\").devDependencies.supabase")"
    ci="$(grep -A2 "^env:" .github/workflows/ci.yml | sed -n "s/.*SUPABASE_CLI_VERSION: *//p" | tr -d "\r")"
    echo "package.json=$pinned  ci.yml=$ci"
    test "$pinned" = "$ci"'

  step "db: private schema stays out of the Data API" bash -c '
    ! grep -nE "^\s*schemas\s*=.*\bprivate\b" supabase/config.toml'

  # #617. The local gate is only worth running if it runs against the same
  # database CI does. Nothing checked that, so a stack brought up on a
  # different postgres major version would go green here and mean nothing:
  # collation (and so sort order), planner choices where a query has no
  # explicit ORDER BY, and lock and isolation behaviour all move between
  # majors, and the pg_temp.test_race suites lean on the last of those.
  # The 17.x image sits beside the pinned 15.x one in the local image store,
  # so this is one `docker images` away from happening by accident.
  step "db: running postgres major version matches config.toml" bash -c '
    set -uo pipefail
    pinned="$(sed -n "s/^major_version[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p" supabase/config.toml | head -1)"
    project="$(sed -n "s/^project_id[[:space:]]*=[[:space:]]*\"\([^\"]*\)\".*/\1/p" supabase/config.toml | head -1)"
    if [ -z "$pinned" ] || [ -z "$project" ]; then
      echo "could not read major_version / project_id from supabase/config.toml"
      exit 1
    fi
    container="supabase_db_$project"
    if ! docker inspect "$container" >/dev/null 2>&1; then
      echo "the local stack is not running: no container named $container (start it with \`npx supabase start\`)"
      exit 1
    fi
    num="$(docker exec "$container" psql -U postgres -d postgres -tAc "show server_version_num" 2>/dev/null | tr -d "\r")"
    if [ -z "$num" ]; then
      echo "could not read server_version_num from $container -- is the database up?"
      exit 1
    fi
    running="$(( num / 10000 ))"
    echo "config.toml major_version=$pinned  running=$running (server_version_num=$num, image=$(docker inspect "$container" --format "{{.Config.Image}}"))"
    if [ "$pinned" != "$running" ]; then
      echo "the running stack is postgres $running but supabase/config.toml pins $pinned --"
      echo "every gate below would prove something about the wrong engine."
      echo "rebuild it: npx supabase stop --no-backup && npx supabase start"
      exit 1
    fi'

  step "db: reset (applies every migration + seed)" npx supabase db reset

  step "db: lint" npx supabase db lint --level warning --fail-on warning

  step "db: pgTAP suites" npx supabase test db

  step "db: historical data migration harnesses" bash -c '
    set -euo pipefail
    for harness in supabase/tests/*_upgrade.test.sh; do
      echo "--- $harness"
      bash "$harness"
    done'

  step "db: seed.sql is re-runnable" bash scripts/check-seed-rerunnable.sh

  step "db: generated types match the schema" bash -c '
    npx supabase gen types typescript --local > /tmp/database.types.ts
    if ! diff -q /tmp/database.types.ts app/src/lib/database.types.ts >/dev/null; then
      echo "database.types.ts is STALE — run npm run gen:types in app/ and commit"
      diff -u app/src/lib/database.types.ts /tmp/database.types.ts | head -60
      exit 1
    fi
    echo "Generated types are current."'
fi

# ----------------------------------------------------------- functions job
if [ "$ONLY" = all ] || [ "$ONLY" = functions ]; then
  step "functions: fmt"   deno fmt --check supabase/functions
  step "functions: lint"  deno lint --config supabase/functions/deno.json supabase/functions
  step "functions: check" bash -c 'deno check --config supabase/functions/deno.json supabase/functions/**/*.ts'
  step "functions: test"  deno test --allow-env --config supabase/functions/deno.json supabase/functions/
fi

# ------------------------------------------------------------ frontend job
if [ "$ONLY" = all ] || [ "$ONLY" = frontend ]; then
  step "frontend: typecheck"    bash -c 'cd app && npm run typecheck'
  step "frontend: lint"         bash -c 'cd app && npm run lint'
  step "frontend: format:check" bash -c 'cd app && npm run format:check'
  step "frontend: test:run"     bash -c 'cd app && npm run test:run'
  step "frontend: coverage"     bash -c 'cd app && npm run test:coverage'
  step "frontend: Montserrat wiring" bash -c '
    cd app
    ! grep -Eq "fonts\.(googleapis|gstatic)\.com" index.html
    test "$(node -p "require(\"./package.json\").dependencies[\"@fontsource-variable/montserrat\"]")" = "5.3.0"
    grep -Fq "import \"@fontsource-variable/montserrat\"" src/main.tsx \
      || grep -Fq "import '\''@fontsource-variable/montserrat'\''" src/main.tsx
    grep -Fq -- "--font-family-base: \"Montserrat Variable\"" src/theme/tokens.css'
  step "frontend: build"        bash -c 'cd app && npm run build'
fi

# --------------------------------------------------------------- summary
printf '\n================ LOCAL CI SUMMARY ================\n'
for p in "${PASSED[@]:-}"; do [ -n "$p" ] && printf '  PASS  %s\n' "$p"; done
for f in "${FAILED[@]:-}"; do [ -n "$f" ] && printf '  FAIL  %s\n' "$f"; done
printf '\nNot covered here: the gitleaks secret scan (it needs an image pull) and\nthe staging push (merge-only). Everything else CI runs, ran above.\n'
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '\n%d gate(s) FAILED.\n' "${#FAILED[@]}"
  exit 1
fi
printf '\nAll local gates passed.\n'
