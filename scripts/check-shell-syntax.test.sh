#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_dir="$(mktemp -d "$repo_root/.shell-syntax-test.XXXXXX")"
trap 'rm -rf "$fixture_dir"' EXIT

printf '#!/usr/bin/env bash\nprintf "valid\\n"\n' > "$fixture_dir/01-valid.sh"
printf '#!/usr/bin/env bash\nif true; then\n' > "$fixture_dir/02-broken.sh"

if bash "$repo_root/scripts/check-shell-syntax.sh" "$fixture_dir" \
  >/dev/null 2>&1; then
  echo "shell syntax check accepted a broken non-first script" >&2
  exit 1
fi

echo "shell syntax regression test passed"
