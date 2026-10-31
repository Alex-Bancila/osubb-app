#!/usr/bin/env bash
# Migrations must be dated after the newest one already on main (#1139). CI
# builds the database in filename order, but staging and every Release push
# with `db push --include-all`, which applies a file dated before the newest
# applied one *after* it: a `create or replace` body from an older branch,
# merged second, silently wins in production while every test proved the newer
# one. Nothing refused that until now; CodeRabbit's review instruction was the
# only guard.
#
# The check lists the migrations added between the merge base of <base-ref>
# and HEAD, and compares each one's 14-digit version with the newest migration
# in <base-ref>'s tree -- the base ref's tree, not the merge base's: what will
# be out of order at merge time is what is on main now, and a branch that was
# fine when it forked is wrong once main gains a newer file. On a pull_request
# run HEAD is the merge commit, so the two coincide; locally, fetch first.
#
# Usage: check-migration-order.sh [--warn] [base-ref]      (default origin/main)
#   Pull requests: `check-migration-order.sh origin/main` -- prints ::error::
#   naming both files and exits 1 when any added migration sorts before the
#   base's newest. Renaming the file to a later timestamp is the author's job.
#   The Release report: `check-migration-order.sh --warn <last release/* tag>`
#   -- the same comparison against what the last Release carried, printed as
#   ::warning:: with exit 0, so the reviewer sees what `db push` will apply
#   out of order before approving.
# Exit codes: 0 in order (or --warn), 1 out of order, 2 the base cannot be read.
set -euo pipefail
export LC_ALL=C

mode=error
base=""
for arg in "$@"; do
  case "$arg" in
    --warn) mode=warn ;;
    -*)
      echo "check-migration-order: unknown option $arg" >&2
      exit 2
      ;;
    *) base="$arg" ;;
  esac
done
base="${base:-origin/main}"

# Pathspecs are read relative to the current directory; the paths here are the
# repository's.
cd "$(git rev-parse --show-toplevel)"

if ! base_commit="$(git rev-parse --verify --quiet "${base}^{commit}")"; then
  echo "check-migration-order: cannot resolve '$base' as a commit (fetch it first)." >&2
  exit 2
fi
if ! merge_base="$(git merge-base "$base_commit" HEAD)"; then
  echo "check-migration-order: HEAD and '$base' share no history." >&2
  exit 2
fi

version() { # version <path>: the 14-digit timestamp a migration's name begins with
  local name
  name="$(basename -- "$1")"
  printf '%s' "${name%%_*}"
}

# Added since the merge base: the migrations this branch (or this Release) brings.
added="$(git diff --name-only --diff-filter=A "$merge_base" HEAD -- 'supabase/migrations/*.sql' | sort)"
if [ -z "$added" ]; then
  echo "check-migration-order: no migration added since $base."
  exit 0
fi

# The newest migration the base already holds, by name.
newest="$(git ls-tree --name-only "$base_commit" -- supabase/migrations/ | grep '\.sql$' | sort | tail -n 1 || true)"
if [ -z "$newest" ]; then
  echo "check-migration-order: $base holds no migration; nothing to be out of order with."
  exit 0
fi
newest_version="$(version "$newest")"

late=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  if [[ "$(version "$file")" < "$newest_version" ]]; then
    late=$((late + 1))
    if [ "$mode" = warn ]; then
      echo "::warning::$file is dated before $newest, the newest migration at $base: db push --include-all will apply it after the newer one, so its body wins over whatever the newer migration proved."
    else
      echo "::error::$file is dated before $newest, the newest migration at $base: CI builds the database in filename order, but db push --include-all will apply it after the newer one on staging and in production. Rename it to a timestamp after $newest_version."
    fi
  fi
done <<< "$added"

count="$(printf '%s\n' "$added" | wc -l | tr -d ' ')"
if [ "$late" -eq 0 ]; then
  echo "check-migration-order: every migration added since $base ($count) is dated after $newest."
  exit 0
fi
if [ "$mode" = warn ]; then
  echo "check-migration-order: $late of $count migration(s) added since $base are dated before $newest."
  exit 0
fi
echo "::error::check-migration-order: $late of $count migration(s) added since $base are dated before $newest; date every new migration after the newest on main."
exit 1
