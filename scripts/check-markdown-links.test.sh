#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_dir="$(mktemp -d "$repo_root/.markdown-link-test.XXXXXX")"
trap 'rm -rf "$fixture_dir"' EXIT

printf '# Existing heading\n' > "$fixture_dir/target.md"
printf '%s\n' \
  '[Target][target]' \
  '' \
  '[target]: target.md#existing-heading' \
  '' \
  '```markdown' \
  '[Example only](missing-from-code-fence.md)' \
  '```' > "$fixture_dir/valid.md"
printf '[Missing](missing.md)\n' > "$fixture_dir/broken.md"
printf '[Missing heading](target.md#missing-heading)\n' > "$fixture_dir/broken-anchor.md"

"$repo_root/node_modules/.bin/remark" \
  --frail --quiet --use remark-validate-links "$fixture_dir/valid.md" >/dev/null

if "$repo_root/node_modules/.bin/remark" \
  --frail --quiet --use remark-validate-links \
  "$fixture_dir/broken.md" >/dev/null 2>&1; then
  echo "remark-validate-links accepted a broken local link" >&2
  exit 1
fi

if "$repo_root/node_modules/.bin/remark" \
  --frail --quiet --use remark-validate-links \
  "$fixture_dir/broken-anchor.md" >/dev/null 2>&1; then
  echo "remark-validate-links accepted a broken local heading link" >&2
  exit 1
fi

echo "markdown link regression test passed"
