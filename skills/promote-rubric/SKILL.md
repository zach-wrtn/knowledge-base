---
name: zzem-kb:promote-rubric
description: Append a Promotion Log row to the active Evaluator rubric (axis 1). Use at Phase 6 Retro §6.7a when a pattern with `frequency >= 2` and a defined `contract_clause` should promote into next-version rubric. This skill adds the log row only; creating a new v(N+1) file is a separate manual/follow-up step.
---

# zzem-kb:promote-rubric

Append a single row to the active rubric's **Promotion Log** table. Version-bump (v(N) → v(N+1)) is NOT handled by this skill — see §Follow-up below.

## Inputs

- `source_sprint` — lowercase-hyphen sprint id (required, e.g. `ai-webtoon-007`).
- `source_pattern` — pattern id (required, e.g. `correctness-001` or `pattern-digest#3`).
- `clause_id` — next clause identifier in sequence (required, e.g. `C10`). Caller is responsible for picking the next free id by reading the active rubric's Clauses section.
- `clause_title` — short title for the log entry (required, ≤80 chars, e.g. `Retry Idempotency`).

## Preconditions

- `zzem-kb:sync` succeeded in this session.
- Working tree at `$ZZEM_KB_PATH` is clean.
- At least one active rubric exists (file under `learning/rubrics/` with frontmatter `superseded_by: null`).

## Steps

1. **Sync main**
   Bash: `cd "$ZZEM_KB_PATH" && git checkout main && git pull --ff-only`

2. **Locate active rubric**
   Invoke `zzem-kb:read type=rubric status=active` to obtain the path of the current `v{N}.md`. Expect exactly one file.
   If zero or more than one: abort, report `no unique active rubric found`.

3. **Verify clause_id is free**
   Read the active rubric. Confirm that no existing heading in the `## Clauses` section uses `clause_id` (e.g. `### C10. …`). Also check the Promotion Log table column "Clause Added" for an entry starting with `clause_id`. If collision: abort, ask caller for a different id.

4. **Append Promotion Log row**
   Edit the active rubric. Locate the Promotion Log table (matches the header `| Date | Sprint | Clause Added | Source Pattern |`). Append one row immediately after the last non-placeholder row:

   ```
   | {YYYY-MM-DD} | {source_sprint} | {clause_id} {clause_title} | {source_pattern} |
   ```

   Use the current local date in `YYYY-MM-DD`. Do NOT remove the existing placeholder row (`| — | — | (베이스라인) | — |`); if it is the only row, keep it as the first row and append after it.

5. **Validate**
   Bash: `cd "$ZZEM_KB_PATH" && npm run validate:content`

6. **Commit + rebase-retry push**
   Bash:
   ```
   cd "$ZZEM_KB_PATH"
   git add learning/rubrics/v{N}.md
   git commit -m "rubric: promote {clause_id} from {source_sprint}"
   for i in 1 2 3; do
     if git pull --rebase origin main && git push; then exit 0; fi
     sleep $((2**i))
   done
   echo "push failed after 3 retries"
   exit 1
   ```

7. **Nudge**
   Count the Promotion Log rows (excluding the baseline placeholder) after the append. If the count is `>= 2`, emit a nudge to the caller:

   ```
   ⚠ Rubric {v{N}} Promotion Log now has {K} accumulated entries (threshold 2).
     Consider bumping to v{N+1} at the next Retro so the clauses get promoted
     into the main Clauses section. Version bump is currently a manual step —
     see follow-up below.
   ```

## Failure handling

- Active rubric not found → abort; user must initialize `learning/rubrics/v1.md` first (baseline rubric has no promotion flow).
- `clause_id` collision → abort; caller picks a different id.
- `npm run validate:content` fails → the edit produced malformed frontmatter or broke markdown structure; fix and re-run from step 4.
- Push retries exhausted → report; row remains locally committed, caller can resolve conflict manually.

## Verification (smoke)

Invoke with a throwaway `clause_id` and a dummy sprint in a scratch branch; verify:
- The Promotion Log table of the active rubric gains exactly one new row.
- `git log -1 --stat` shows a single-file change to `learning/rubrics/v{N}.md`.
- CI `validate` passes.

## Follow-up (not implemented by this skill)

**Version bump** (v{N} → v{N+1}): when the Promotion Log hits 2+ accumulated rows, a new rubric file should be created with:
- All existing v{N} clauses preserved,
- Full bodies of the promoted clauses added to the `## Clauses` section,
- A fresh empty Promotion Log,
- v{N} marked `status: superseded`, `superseded_by: N+1`.

This is currently a manual process because it requires the full clause body (markdown content) which is NOT stored by this skill — only the short title is logged. A future `zzem-kb:bump-rubric` skill could accept a `clauses` array (each with body) and perform the migration; design is deferred until the promotion cadence justifies the tooling.
