#!/usr/bin/env bash
# Symlink zzem-kb skills from this repo into ~/.claude/skills/zzem-kb/.
# Idempotent.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$HOME/.claude/skills/zzem-kb"

mkdir -p "$(dirname "$TARGET")"

if [ -L "$TARGET" ]; then
  rm "$TARGET"
elif [ -e "$TARGET" ]; then
  echo "error: $TARGET exists and is not a symlink. Remove manually and re-run." >&2
  exit 1
fi

ln -s "$REPO_ROOT/skills" "$TARGET"
echo "linked $TARGET -> $REPO_ROOT/skills"
