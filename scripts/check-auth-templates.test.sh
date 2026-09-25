#!/usr/bin/env bash
# Proves check-auth-templates.sh passes the real templates and fails each way a
# template can regress: back to .ConfirmationURL, or losing the code.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
check="$repo_root/scripts/check-auth-templates.sh"
fixture_dir="$(mktemp -d "$repo_root/.auth-templates-test.XXXXXX")"
trap 'rm -rf "$fixture_dir"' EXIT

bash "$check" "$repo_root/supabase/templates" >/dev/null

expect_failure() {
  local label="$1"
  if bash "$check" "$fixture_dir" >/dev/null 2>&1; then
    echo "auth template check accepted $label" >&2
    exit 1
  fi
}

reset_fixtures() {
  rm -f "$fixture_dir"/*.html
  cp "$repo_root"/supabase/templates/{invite,magic-link,email-change}.html "$fixture_dir/"
}

reset_fixtures
bash "$check" "$fixture_dir" >/dev/null

reset_fixtures
sed -i 's#{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&[^"]*#{{ .ConfirmationURL }}#' \
  "$fixture_dir/magic-link.html"
expect_failure "a magic link back on .ConfirmationURL"

reset_fixtures
sed -i 's#{{ .Token }}#------#' "$fixture_dir/invite.html"
expect_failure "an invitation without the six-digit code"

reset_fixtures
rm "$fixture_dir/email-change.html"
expect_failure "a missing email-change template"

echo "auth template check regression test passed"
