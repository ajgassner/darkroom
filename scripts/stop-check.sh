#!/usr/bin/env bash
# Claude Code Stop hook: Biome, TypeScript, the tests affected by the changes, and fallow (dead code, duplicates,
# complexity, boundaries). The full test suite runs in CI on every pull request.
# Exit 2 with the findings on stderr sends them back to Claude so it fixes them before finishing.
#
# Runs only when the working tree changed since the last check, and never blocks twice in a row on the same
# state (if Claude stops again without changing anything, the user gets a warning instead of a loop).
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0
export PATH="$HOME/.local/share/mise/shims:$PWD/node_modules/.bin:$PATH"
[ -d node_modules ] || exit 0

git_dir=$(git rev-parse --absolute-git-dir 2>/dev/null) || exit 0
state_file="$git_dir/darkroom-stop-check"

# Fingerprint of the working tree: tracked changes + untracked files (respecting .gitignore)
fingerprint=$(
  {
    git diff HEAD --binary
    git ls-files -o --exclude-standard -z | xargs -0 shasum 2>/dev/null
  } | shasum | cut -d' ' -f1
)
last=$(cat "$state_file" 2>/dev/null || true)
[ "$last" = "ok:$fingerprint" ] && exit 0
if [ "$last" = "fail:$fingerprint" ]; then
  echo '{"systemMessage":"darkroom checks still failing (unchanged since last report): run pnpm check"}'
  exit 0
fi

report=""
run() {
  local name=$1
  shift
  local out
  if ! out=$("$@" 2>&1); then
    report+=$'\n'"### $name failed: $*"$'\n'"$(printf '%s\n' "$out" | tail -n 60)"$'\n'
  fi
}

run "Biome" biome check --error-on-warnings .
run "TypeScript (node)" tsc -p tsconfig.json --noEmit
run "TypeScript (web)" tsc -p apps/web/tsconfig.json --noEmit
# Only the tests that import a changed TypeScript file (vitest follows the import graph); none for docs-only changes
changed=()
while IFS= read -r file; do changed+=("$file"); done < <(
  {
    git diff HEAD --name-only --diff-filter=d
    git ls-files -o --exclude-standard
  } | grep -E '\.tsx?$' | sort -u
)
if [ ${#changed[@]} -gt 0 ]; then
  run "Vitest (related to ${#changed[@]} changed files)" vitest related --run --passWithNoTests "${changed[@]}"
fi
run "fallow" fallow

if [ -n "$report" ]; then
  echo "fail:$fingerprint" >"$state_file"
  {
    echo "Code checks failed. Fix these before finishing (biome check --write . fixes formatting and imports)."
    printf '%s\n' "$report"
  } >&2
  exit 2
fi

echo "ok:$fingerprint" >"$state_file"
exit 0
