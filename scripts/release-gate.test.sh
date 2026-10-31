#!/usr/bin/env bash
# Proves release-gate.sh (#1138) lets a Release through only for a commit whose
# CI is green, that is the tip of main right now and that descends from every
# release/* tag — and refuses, with ::error:: and the reason, each way a
# dispatch can be wrong: CI red, CI still running, no CI run, an older commit
# re-run from the Actions page, a Release tag the commit does not contain.
#
# It runs against a throwaway repository (a bare origin and a clone standing
# in for the runner's checkout). gh is replaced by a fake on PATH that answers
# `gh run list` from $FAKE_GH_RUNS and refuses any call that does not filter
# by the full commit SHA and by ci.yml — by commit, never --limit 1.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gate="$repo_root/scripts/release-gate.sh"
fixture_dir="$(mktemp -d "$repo_root/.release-gate-test.XXXXXX")"
trap 'rm -rf "$fixture_dir"' EXIT

# ---- the throwaway repository -------------------------------------------
origin="$fixture_dir/origin.git"
work="$fixture_dir/work"
git init -q --bare "$origin"
git clone -q "$origin" "$work" 2>/dev/null
g() {
  git -C "$work" -c user.name=test -c user.email=test@example.invalid \
    -c commit.gpgsign=false -c tag.gpgsign=false "$@"
}
g symbolic-ref HEAD refs/heads/main
g commit -q --allow-empty -m "first"
first="$(g rev-parse HEAD)"
g commit -q --allow-empty -m "second"
second="$(g rev-parse HEAD)"
g push -q -u origin main 2>/dev/null
# Annotated on purpose: the remote lists the tag object, and the gate must
# still speak of the commit the tag points at.
first_tag="release/2026-10-01-${first:0:7}"
g tag -a -m "Release" "$first_tag" "$first"
g push -q origin "refs/tags/$first_tag"

# ---- the fake gh ----------------------------------------------------------
fake_bin="$fixture_dir/bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/gh" <<'FAKE'
#!/usr/bin/env bash
# Answers `gh run list` with the runs in $FAKE_GH_RUNS (one per line:
# status|conclusion|url, as the gate's --jq formats them; a running run has
# an empty conclusion), but only when asked the way the gate must ask: by the
# full commit SHA, for ci.yml, for the push runs on main (a fork's
# pull_request run at the same commit must not count). With FAKE_GH_FAIL set
# it fails the way gh does without a token.
set -euo pipefail
if [ -n "${FAKE_GH_FAIL:-}" ]; then
  echo "fake gh: HTTP 401: Bad credentials" >&2
  exit 1
fi
if [ "${1:-}" != run ] || [ "${2:-}" != list ]; then
  echo "fake gh: unexpected command: $*" >&2
  exit 64
fi
shift 2
commit="" workflow="" event="" branch="" json="" jq=""
while [ $# -gt 0 ]; do
  case "$1" in
    --commit | -c) commit="$2"; shift 2 ;;
    --workflow | -w) workflow="$2"; shift 2 ;;
    --event | -e) event="$2"; shift 2 ;;
    --branch | -b) branch="$2"; shift 2 ;;
    --json) json="$2"; shift 2 ;;
    --jq | -q) jq="$2"; shift 2 ;;
    --limit | -L) echo "fake gh: the gate must list runs by commit, never by --limit" >&2; exit 64 ;;
    *) echo "fake gh: unexpected argument: $1" >&2; exit 64 ;;
  esac
done
if [ "$commit" != "$FAKE_GH_EXPECT_SHA" ]; then
  echo "fake gh: asked for commit '$commit'; the Release is of $FAKE_GH_EXPECT_SHA" >&2
  exit 64
fi
if [ "$workflow" != ci.yml ]; then
  echo "fake gh: asked for workflow '$workflow', not ci.yml" >&2
  exit 64
fi
if [ "$event" != push ] || [ "$branch" != main ]; then
  echo "fake gh: asked for event '$event' on branch '$branch'; only the push runs on main prove a commit" >&2
  exit 64
fi
if [ -z "$json" ] || [ -z "$jq" ]; then
  echo "fake gh: expected --json with --jq" >&2
  exit 64
fi
if [ -n "$FAKE_GH_RUNS" ]; then
  printf '%s\n' "$FAKE_GH_RUNS"
fi
FAKE
chmod +x "$fake_bin/gh"

# ---- helpers ---------------------------------------------------------------
green='completed|success|https://ci.invalid/runs/1'
red='completed|failure|https://ci.invalid/runs/2'
running='in_progress||https://ci.invalid/runs/3'

run_gate() { # run_gate <sha-argument> <expected-full-sha> <runs> [VAR=value ...]
  (
    cd "$work" &&
      FAKE_GH_EXPECT_SHA="$2" FAKE_GH_RUNS="$3" PATH="$fake_bin:$PATH" \
        env "${@:4}" bash "$gate" "$1" 2>&1
  )
}

expect_pass() { # expect_pass <label> <named-in-the-output> <sha-argument> <expected-full-sha> <runs>
  local out
  if ! out="$(run_gate "$3" "$4" "$5")"; then
    echo "release gate refused $1:" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! grep -qF -- "$2" <<< "$out"; then
    echo "release gate passed $1 without naming $2:" >&2
    echo "$out" >&2
    exit 1
  fi
}

expect_refusal() { # expect_refusal <label> <named-in-the-error> <sha-argument> <expected-full-sha> <runs> [VAR=value ...]
  local out
  if out="$(run_gate "$3" "$4" "$5" "${@:6}")"; then
    echo "release gate accepted $1:" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! grep -q '^::error::' <<< "$out"; then
    echo "release gate refused $1 without an ::error:: line:" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! grep -qF -- "$2" <<< "$out"; then
    echo "release gate refused $1 without naming $2:" >&2
    echo "$out" >&2
    exit 1
  fi
}

# ---- the cases -------------------------------------------------------------
# Green CI, the tip, the tag in its history: through. The short SHA proves the
# gate resolves what it was given to the full SHA gh's --commit needs; the
# output names the tag's commit, not its tag object.
expect_pass "a green tip" "$first_tag (${first:0:7})" "${second:0:7}" "$second" "$green"

expect_refusal "a commit whose CI failed" "https://ci.invalid/runs/2" "$second" "$second" "$red"
expect_refusal "a commit whose CI is still running" "https://ci.invalid/runs/3" "$second" "$second" "$running"
expect_refusal "a commit with no CI run" "no ci.yml run exists for $second" "$second" "$second" ""
expect_refusal "a green run beside a red one" "https://ci.invalid/runs/2" "$second" "$second" "$green"$'\n'"$red"
expect_refusal "a commit whose runs gh cannot list" "gh run list failed" "$second" "$second" "$green" FAKE_GH_FAIL=1

# An older Release re-run from the Actions page: its SHA is no longer the tip.
expect_refusal "an older commit re-run" "$second" "$first" "$first" "$green"

# A remote that cannot be read proves nothing, so the gate refuses rather than
# trusting the checkout.
expect_refusal "a tip the remote will not tell" "git ls-remote failed" "$second" "$second" "$green" RELEASE_REMOTE=nowhere

# A Release tag the commit does not descend from: production has run a commit
# this one does not contain, whatever the tip says.
g checkout -q -b side "$first"
g commit -q --allow-empty -m "released from elsewhere"
side="$(g rev-parse HEAD)"
side_tag="release/2026-10-20-${side:0:7}"
g tag "$side_tag" "$side"
g push -q origin "refs/tags/$side_tag"
g checkout -q main
expect_refusal "a commit missing a Release tag's history" "$side_tag" "$second" "$second" "$green"

# Without any Release tag (the first Release) there is nothing to descend from.
g push -q origin --delete "refs/tags/$side_tag" "refs/tags/$first_tag"
expect_pass "a green tip before the first Release" "no release/* tag" "$second" "$second" "$green"

echo "release gate regression test passed"
