#!/usr/bin/env bash
# The emailed sign-in links must open the app's click-to-confirm page, never
# Supabase's verify endpoint (ruling L7, #768): a mail scanner that fetches
# {{ .ConfirmationURL }} spends the token — and the six-digit code, which is
# the same token — before the Member sees the email. Each template must link
# to /auth/confirm with its token hash and type, and still print the code.
#
# Usage: check-auth-templates.sh [templates-dir]   (default supabase/templates)
set -euo pipefail

templates_dir="${1:-supabase/templates}"
failures=0

fail() {
  echo "check-auth-templates: $1" >&2
  failures=$((failures + 1))
}

check_template() {
  local file="$templates_dir/$1" type="$2"
  if [ ! -f "$file" ]; then
    fail "$file is missing"
    return
  fi
  grep -qF "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=$type" "$file" ||
    fail "$file does not link to /auth/confirm with token_hash={{ .TokenHash }}&type=$type"
  grep -qF '{{ .Token }}' "$file" ||
    fail "$file does not print the six-digit code {{ .Token }}"
  if grep -qF '.ConfirmationURL' "$file"; then
    fail "$file still uses .ConfirmationURL, which spends the token on a scanner's GET"
  fi
}

check_template invite.html invite
check_template magic-link.html email
check_template email-change.html email_change

if [ "$failures" -gt 0 ]; then
  exit 1
fi
echo "auth email templates link to /auth/confirm and print the code"
