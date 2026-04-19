---
name: zzem-kb:write-pattern
description: Create a new pattern YAML, validate against schema, commit, and push with rebase retry. Use at Phase 4 Evaluator when a defect pattern does not match any existing pattern.
---

# zzem-kb:write-pattern

## Inputs (all required unless noted)
- `category` — one of `correctness | completeness | integration | edge_case | code_quality | design_proto | design_spec`
- `severity` — one of `critical | major | minor`
- `title` — ≤120 chars
- `source_sprint` — e.g. `ai-webtoon-007`
- `source_group` — e.g. `group-001`
- `description`, `detection`, `prevention`, `contract_clause` — each ≥10 chars
- `example.bad`, `example.good` — optional

## Preconditions
- `zzem-kb:sync` succeeded in this session.
- Working tree at `$ZZEM_KB_PATH` is clean.

## Steps

1. **Ensure main + fast-forward**
   Bash:
   ```
   cd "$ZZEM_KB_PATH"
   git checkout main
   git pull --ff-only
   ```

2. **Determine next id**
   Glob: `learning/patterns/{category}-*.yaml`
   Parse `NNN` suffix; take `max + 1`; zero-pad to 3 digits. Next id = `{category}-{NNN}`.

3. **Read schema for reference**
   Read: `schemas/learning/pattern.schema.json`

4. **Compose the YAML**
   Write: `learning/patterns/{id}.yaml`

   Fields to emit:
   - `id`, `title`, `category`, `severity`, `source_sprint`, `source_group`
   - `discovered_at`: current ISO 8601 with offset (e.g. `2026-04-18T12:34:56+09:00`)
   - `frequency: 1`
   - `last_seen: {source_sprint}`
   - `description`, `detection`, `prevention`, `contract_clause`
   - `example` (if provided)
   - `schema_version: 1`

5. **Local validate (best-effort)**
   Bash:
   ```
   cd "$ZZEM_KB_PATH"
   npm run validate:learning || { echo "validation failed; fix and re-run from step 4"; exit 1; }
   ```

6. **Commit + rebase-retry push**
   Bash:
   ```
   cd "$ZZEM_KB_PATH"
   git add learning/patterns/{id}.yaml
   git commit -m "pattern: {id} from {source_sprint}/{source_group}"
   for i in 1 2 3; do
     if git pull --rebase origin main && git push; then exit 0; fi
     sleep $((2**i))
   done
   echo "push failed after 3 retries; file remains committed locally"
   exit 1
   ```

## Failure handling
- Local validate fails → fix body; re-run from step 5. Do NOT commit malformed content.
- CI fails after push → read `gh run view --log-failed` on latest run; fix; commit+push again.
- 3 retries exhausted → report to caller. Sprint continues; file is locally committed and can be pushed later.

## Verification (smoke)
Invoke with a dummy pattern in a throwaway branch; verify:
- File appears at `learning/patterns/{id}.yaml`.
- CI `validate` passes on the resulting push.
- `gh pr list` is empty (direct push permitted for content).
