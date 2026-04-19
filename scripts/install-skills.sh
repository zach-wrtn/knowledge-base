#!/usr/bin/env bash
# Symlink zzem-kb skills from this repo into ~/.claude/skills/zzem-kb/.
# Idempotent:
#   - same target       -> no-op
#   - different target  -> refuse unless ZZEM_KB_FORCE_LINK=1
#   - non-symlink file  -> refuse (manual cleanup required)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$REPO_ROOT/skills"
TARGET="$HOME/.claude/skills/zzem-kb"

mkdir -p "$(dirname "$TARGET")"

if [ -L "$TARGET" ]; then
  current="$(readlink "$TARGET")"
  if [ "$current" = "$SOURCE" ]; then
    echo "already linked: $TARGET -> $SOURCE"
    exit 0
  fi
  if [ "${ZZEM_KB_FORCE_LINK:-0}" = "1" ]; then
    rm "$TARGET"
    ln -s "$SOURCE" "$TARGET"
    echo "force-relinked: $TARGET -> $SOURCE (was: $current)"
    exit 0
  fi
  echo "warn: $TARGET already points to $current" >&2
  echo "      refusing to overwrite with $SOURCE" >&2
  echo "      set ZZEM_KB_FORCE_LINK=1 to override" >&2
  exit 1
elif [ -e "$TARGET" ]; then
  echo "error: $TARGET exists and is not a symlink. Remove manually and re-run." >&2
  exit 1
fi

ln -s "$SOURCE" "$TARGET"
echo "linked: $TARGET -> $SOURCE"
