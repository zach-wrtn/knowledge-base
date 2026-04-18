---
name: zzem-kb:sync
description: Pull the latest state of the team knowledge base into the local clone. Invoke at the start of every sprint phase before reading or writing KB content.
---

# zzem-kb:sync

## Preconditions
- Environment variable `$ZZEM_KB_PATH` is set (default `~/.zzem/kb`) and is a git clone of `zach-wrtn/knowledge-base`.
- Working tree at `$ZZEM_KB_PATH` is clean (or has only tracked staged changes the caller is about to commit).

## Steps
1. **Fetch and fast-forward**
   Bash: `git -C "$ZZEM_KB_PATH" checkout main && git -C "$ZZEM_KB_PATH" pull --ff-only`

2. **Report HEAD**
   Bash: `git -C "$ZZEM_KB_PATH" rev-parse --short HEAD`

## Failure handling
- `pull --ff-only` rejected because of local changes: the caller has left uncommitted work. Do NOT stash silently; abort and report back to the user.
- Network failure: continue with the current local state and log a warning. Reads are still valid against the cached clone.

## Verification (smoke)
1. In a second clone at `/tmp/kb-probe`, make a commit on main and push.
2. Invoke this skill against the original clone.
3. Confirm `git log -1` on the original now contains the probe commit.
