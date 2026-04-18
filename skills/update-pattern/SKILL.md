---
name: zzem-kb:update-pattern
description: Increment the frequency counter and refresh last_seen on an existing pattern. Use at Phase 4 Evaluator when a recurring defect matches an existing pattern.
---

# zzem-kb:update-pattern

## Inputs
- `id` — e.g. `correctness-001` (required, must match existing pattern)
- `source_sprint` — the sprint that just observed the pattern (required)

## Preconditions
- `zzem-kb:sync` succeeded in this session.
- Working tree at `$ZZEM_KB_PATH` is clean.

## Steps

1. **Sync main**
   Bash: `cd "$ZZEM_KB_PATH" && git checkout main && git pull --ff-only`

2. **Locate and parse file**
   Read: `content/patterns/{id}.yaml`
   If missing: abort, report "pattern not found".

3. **Mutate frequency + last_seen**
   Edit the YAML:
   - `frequency: <current + 1>`
   - `last_seen: {source_sprint}`
   Leave every other field untouched (especially `discovered_at`).

4. **Validate**
   Bash: `cd "$ZZEM_KB_PATH" && npm run validate:content`

5. **Commit + rebase-retry push**
   Bash:
   ```
   cd "$ZZEM_KB_PATH"
   git add content/patterns/{id}.yaml
   git commit -m "pattern: {id} frequency +1 ({source_sprint})"
   for i in 1 2 3; do
     if git pull --rebase origin main && git push; then exit 0; fi
     sleep $((2**i))
   done
   echo "push failed after 3 retries"
   exit 1
   ```

## Failure handling
- Pattern not found → abort with "pattern not found: {id}". Do NOT create a new pattern here; use `zzem-kb:write-pattern` for that.
- Validate fails → pattern file was unexpectedly malformed; surface to caller.

## Verification (smoke)
Pick an existing pattern (say `correctness-001`), invoke with a test sprint id. Diff on `content/patterns/correctness-001.yaml` must show only `frequency` incremented and `last_seen` updated.
