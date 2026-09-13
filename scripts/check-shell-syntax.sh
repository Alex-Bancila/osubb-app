#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -gt 0 ]; then
  search_roots=("$@")
else
  search_roots=(scripts supabase/tests)
fi

while IFS= read -r -d '' script_path; do
  bash -n "$script_path"
done < <(find "${search_roots[@]}" -type f -name '*.sh' -print0 | sort -z)
