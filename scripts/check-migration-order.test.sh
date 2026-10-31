#!/usr/bin/env bash
# Proves check-migration-order.sh (#1139) refuses a migration dated before the
# newest one the base already holds, naming both files, and passes a correctly
# dated one, a branch that adds none, a base that has none, and a file sharing
# the newest version. It reads the base ref's tree (main as fetched), not the
# merge base, so a branch that was fine when it forked is refused once main
# gains a newer migration. With --warn (the Release report, against the last
# release/* tag) it warns and exits 0. An unknown base is an error, never a
# pass.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
check="$repo_root/scripts/check-migration-order.sh"
fixture_dir="$(mktemp -d "$repo_root/.migration-order-test.XXXXXX")"
trap 'rm -rf "$fixture_dir"' EXIT

# ---- the throwaway repository -------------------------------------------
origin="$fixture_dir/origin.git"
work="$fixture_dir/work"
git init -q --bare "$origin"
git clone -q "$origin" "$work" 2>/dev/null
g() {
  git -C "$work" -c user.name=test -c user.email=test@example.invalid \
    -c commit.gpgsign=false -c tag.gpgsign=false -c core.autocrlf=false "$@"
}
add_file() { # add_file <path>: commits a file of that name
  mkdir -p "$work/$(dirname "$1")"
  printf -- '-- %s\n' "$1" > "$work/$1"
  g add -- "$1"
  g commit -q -m "$1"
}

# ---- helpers ---------------------------------------------------------------
run_check() { # run_check [args...]  (in $CHECK_CWD, default the clone's root)
  (
    cd "${CHECK_CWD:-$work}" && bash "$check" "$@" 2>&1
  )
}

expect_pass() { # expect_pass <label> [args...]: exit 0 and no annotation at all
  local label="$1" out
  shift
  if ! out="$(run_check "$@")"; then
    echo "migration order check refused $label:" >&2
    echo "$out" >&2
    exit 1
  fi
  if grep -qE '^::(warning|error)::' <<< "$out"; then
    echo "migration order check passed $label but printed an annotation:" >&2
    echo "$out" >&2
    exit 1
  fi
}

expect_outcome() { # expect_outcome <label> <exit-code> <line-prefix> <late-file> <newest-file> [args...]
  local label="$1" want_rc="$2" prefix="$3" late="$4" newest="$5" out rc=0
  shift 5
  out="$(run_check "$@")" || rc=$?
  if [ "$rc" != "$want_rc" ]; then
    echo "migration order check exited $rc, not $want_rc, for $label:" >&2
    echo "$out" >&2
    exit 1
  fi
  local line
  line="$(grep "^$prefix" <<< "$out" || true)"
  if [ -z "$line" ]; then
    echo "migration order check gave no $prefix line for $label:" >&2
    echo "$out" >&2
    exit 1
  fi
  for name in "$late" "$newest"; do
    if ! grep -qF -- "$name" <<< "$line"; then
      echo "migration order check did not name $name for $label:" >&2
      echo "$out" >&2
      exit 1
    fi
  done
}

# ---- the cases -------------------------------------------------------------
g symbolic-ref HEAD refs/heads/main
add_file README.md
g push -q -u origin main 2>/dev/null

# A base with no migration has nothing to compare against.
g checkout -q -b first-migration
add_file supabase/migrations/20260101000000_a.sql
expect_pass "the first migration on a base that has none" origin/main

# main gains two migrations; the second one is "released".
g checkout -q main
add_file supabase/migrations/20260101000000_a.sql
add_file supabase/migrations/20260201000000_b.sql
g push -q origin main
released="release/2026-02-01-$(g rev-parse --short=7 HEAD)"
g tag "$released"

g checkout -q -b docs-only
add_file docs/note.md
expect_pass "a branch adding no migration" origin/main

g checkout -q -b well-dated main
add_file supabase/migrations/20260301000000_c.sql
expect_pass "a migration dated after the newest" origin/main

g checkout -q -b mis-dated main
add_file supabase/migrations/20260115000000_late.sql
expect_outcome "a migration dated before the newest" 1 "::error::" \
  20260115000000_late.sql 20260201000000_b.sql origin/main
# The same from inside a subdirectory: paths are the repository's, not the cwd's.
CHECK_CWD="$work/supabase" expect_outcome "a migration dated before the newest, checked from a subdirectory" 1 "::error::" \
  20260115000000_late.sql 20260201000000_b.sql origin/main

# A base migration moved back in time is an added file too, however similar
# git finds it to the one it replaces: rename detection must not hide it.
g checkout -q -b renamed main
g mv supabase/migrations/20260201000000_b.sql supabase/migrations/20260115000000_b_moved.sql
g commit -q -m "move b back in time"
expect_outcome "a migration renamed to an earlier date" 1 "::error::" \
  20260115000000_b_moved.sql 20260201000000_b.sql origin/main

# The same version as the newest is not before it, whatever the name says.
g checkout -q -b same-version main
add_file supabase/migrations/20260201000000_a_twin.sql
expect_pass "a migration sharing the newest version" origin/main

# The base ref's tree, not the merge base: once main gains a newer migration,
# the branch that was fine when it forked must be refused.
g checkout -q main
add_file supabase/migrations/20260401000000_d.sql
g push -q origin main
g checkout -q well-dated
expect_outcome "a migration dated before main's newest after main moved on" 1 "::error::" \
  20260301000000_c.sql 20260401000000_d.sql origin/main

# The Release report: against the last release/* tag, a late file is a
# warning, named both ways, and the report goes on.
g checkout -q main
add_file supabase/migrations/20260115000000_late.sql
expect_outcome "a late migration since the last Release" 0 "::warning::" \
  20260115000000_late.sql 20260201000000_b.sql --warn "$released"
# well-dated adds c (dated after b) since the tag: a Release with nothing late.
g checkout -q well-dated
expect_pass "the Release report with nothing late" --warn "$released"

# A base that cannot be read, or an option the script does not know, is an
# error, never a pass.
expect_usage_error() { # expect_usage_error <label> [args...]
  local label="$1" rc=0
  shift
  run_check "$@" > /dev/null || rc=$?
  if [ "$rc" != 2 ]; then
    echo "migration order check exited $rc, not 2, for $label" >&2
    exit 1
  fi
}
expect_usage_error "an unknown base" nowhere/main
expect_usage_error "an unknown option" --bogus origin/main

echo "migration order regression test passed"
