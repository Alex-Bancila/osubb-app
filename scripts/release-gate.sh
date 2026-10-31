#!/usr/bin/env bash
# The Release gate (#1138). A Release puts one commit of main live; this
# refuses the commit unless it is proven and current, so that a dispatch a
# minute after a merge cannot ship what CI has not finished judging, and an
# older Release run re-run from the Actions page cannot roll production's
# functions and web app back under newer migrations (`db push` never
# re-applies, so the database would stay ahead). Three checks, every one
# reported, any one refuses:
#
#   1. every ci.yml run for the commit concluded success — listed by commit
#      (`gh run list --commit`), never `--limit 1`, which once returned an
#      old run;
#   2. the commit is the tip of <remote>/<branch> at this moment, read live
#      from the remote, not from the checkout;
#   3. every release/* tag on the remote is an ancestor of the commit (the
#      newest included): the commit descends from everything production has
#      run. Before the first Release there is no tag and nothing to check.
#
# It prints `::error::` lines, which GitHub turns into annotations, and exits
# 1 on refusal. The Release workflow runs it twice: in `report`, which needs
# no Environment approval and no production secret, so a refused dispatch
# never asks anyone to approve; and again first thing in `release`, right
# before `db push`, because "Re-run failed jobs" on an old run re-runs the
# failed `release` job alone, with its original SHA, and never revisits
# `report`.
#
# Usage: release-gate.sh [sha]        (default $GITHUB_SHA, then HEAD)
# Env:   RELEASE_REMOTE=origin  RELEASE_BRANCH=main  CI_WORKFLOW=ci.yml
#        GH_TOKEN and GH_REPO for gh, as the workflow sets them.
set -euo pipefail

remote="${RELEASE_REMOTE:-origin}"
branch="${RELEASE_BRANCH:-main}"
workflow="${CI_WORKFLOW:-ci.yml}"
given="${1:-${GITHUB_SHA:-HEAD}}"

refusals=0
refuse() {
  echo "::error::Release refused: $1"
  refusals=$((refusals + 1))
}
ok() { echo "ok    $1"; }

# gh's --commit filter is the API's head_sha: a full SHA or nothing matches.
if ! sha="$(git rev-parse --verify --quiet "${given}^{commit}")"; then
  echo "::error::Release refused: '$given' is not a commit in this checkout. Nothing was touched."
  exit 1
fi

# 1. CI concluded success for this commit. Only the push runs on the branch
# count: a pull_request run at the same commit (a fork's PR opened at main's
# tip) proves nothing about main and must not be able to refuse a Release.
if ! runs="$(gh run list --commit "$sha" --workflow "$workflow" --event push --branch "$branch" \
  --json status,conclusion,url --jq '.[] | "\(.status)|\(.conclusion // "")|\(.url)"')"; then
  refuse "could not list the $workflow runs for $sha (gh run list failed; is GH_TOKEN set with actions: read?)."
elif [ -z "$runs" ]; then
  refuse "no $workflow run exists for $sha: CI has not started for this commit, or the commit is not on $branch."
else
  # `|`, not a tab: a running run has no conclusion yet, and `read` folds
  # consecutive whitespace separators into one, which would shift the URL
  # into the conclusion field.
  while IFS='|' read -r status conclusion url; do
    if [ "$status" != completed ]; then
      refuse "the $workflow run $url for $sha is still ${status:-queued}; wait for it to finish, then dispatch again."
    elif [ "$conclusion" != success ]; then
      refuse "the $workflow run $url for $sha concluded ${conclusion:-without a conclusion}, not success."
    else
      ok "$workflow run $url concluded success"
    fi
  done <<< "$runs"
fi

# 2. The tip of main, right now.
if tip="$(git ls-remote --exit-code "$remote" "refs/heads/$branch" | cut -f1)"; then
  if [ "$tip" = "$sha" ]; then
    ok "$sha is the tip of $remote/$branch"
  else
    refuse "$sha is not the tip of $remote/$branch, which is $tip. An older Release re-run from the Actions page would put its functions and web app over a newer production; dispatch a new Release from the tip instead."
  fi
else
  refuse "could not read the tip of $remote/$branch (git ls-remote failed)."
fi

# 3. Every Release tag is in this commit's history.
if tags="$(git ls-remote --tags --refs "$remote" 'refs/tags/release/*')"; then
  if [ -z "$tags" ]; then
    ok "no release/* tag on $remote yet: nothing released to descend from"
  else
    while read -r tag_sha tag_ref; do
      [ -n "$tag_ref" ] || continue
      tag="${tag_ref#refs/tags/}"
      # An annotated tag is listed by its tag object; speak of its commit.
      tag_commit="$(git rev-parse --verify --quiet "${tag_sha}^{commit}" 2>/dev/null || echo "$tag_sha")"
      rc=0
      git merge-base --is-ancestor "$tag_commit" "$sha" 2>/dev/null || rc=$?
      case "$rc" in
        0) ok "$tag (${tag_commit:0:7}) is in the history of $sha" ;;
        1) refuse "the Release tag $tag (${tag_commit:0:7}) is not an ancestor of $sha: production has run a commit this one does not contain, so releasing it would roll production back." ;;
        *) refuse "could not tell whether $tag (${tag_commit:0:7}) is an ancestor of $sha (git merge-base exited $rc; are the tags fetched?)." ;;
      esac
    done <<< "$tags"
  fi
else
  refuse "could not list the release/* tags on $remote (git ls-remote failed)."
fi

if [ "$refusals" -gt 0 ]; then
  echo "::error::Release refused for $sha: $refusals reason(s) above. Nothing was touched."
  exit 1
fi
echo "release-gate: $sha may be released — CI is green, it is the tip of $remote/$branch, and it descends from every Release tag."
