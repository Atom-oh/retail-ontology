#!/bin/bash
# scripts/install-hooks.sh
#
# Copy git hooks from scripts/git-hooks/ into .git/hooks/. Idempotent —
# safe to re-run; existing hooks of the same name are overwritten.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_SRC="$PROJECT_ROOT/scripts/git-hooks"
HOOKS_DST="$PROJECT_ROOT/.git/hooks"

if [ ! -d "$PROJECT_ROOT/.git" ]; then
  echo "error: $PROJECT_ROOT is not a git repository" >&2
  exit 1
fi
if [ ! -d "$HOOKS_SRC" ]; then
  echo "error: $HOOKS_SRC does not exist" >&2
  exit 1
fi
mkdir -p "$HOOKS_DST"

count=0
for src in "$HOOKS_SRC"/*; do
  [ -f "$src" ] || continue
  name="$(basename "$src")"
  install -m 0755 "$src" "$HOOKS_DST/$name"
  echo "  installed: .git/hooks/$name"
  count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
  echo "no hooks found in $HOOKS_SRC"
  exit 1
fi

echo ">>> $count hook(s) installed."
