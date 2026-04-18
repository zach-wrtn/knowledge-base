---
name: zzem-kb:write-reflection
description: Record a sprint-end reflection (markdown + frontmatter) and push to the KB. Use at the Phase 6 Retrospective of every sprint.
---

# zzem-kb:write-reflection

## Inputs
- `sprint_id` — required, lowercase-hyphen.
- `domain` — required (e.g. `ai-webtoon`, `ugc-platform`).
- `completed_at` — ISO 8601 with offset.
- `outcome` — one of `pass | fail | partial`.
- `related_patterns` — optional array of pattern ids.
- `body` — markdown narrative (required, non-empty).

## Preconditions
- `zzem-kb:sync` succeeded in this session.
- Working tree at `$ZZEM_KB_PATH` is clean.

## Steps

1. **Sync main**
   Bash: `cd "$ZZEM_KB_PATH" && git checkout main && git pull --ff-only`

2. **Write file**
   Write: `content/reflections/{sprint_id}.md`

   Content:
   ```
   ---
   sprint_id: {sprint_id}
   domain: {domain}
   completed_at: "{completed_at}"
   outcome: {outcome}
   related_patterns:
   {each id as "- <id>"; omit key if empty}
   schema_version: 1
   ---

   {body}
   ```

3. **Validate frontmatter**
   Bash: `cd "$ZZEM_KB_PATH" && npm run validate:content`

4. **Commit + rebase-retry push**
   Bash:
   ```
   cd "$ZZEM_KB_PATH"
   git add content/reflections/{sprint_id}.md
   git commit -m "reflection: {sprint_id} ({outcome})"
   for i in 1 2 3; do
     if git pull --rebase origin main && git push; then exit 0; fi
     sleep $((2**i))
   done
   exit 1
   ```

## Failure handling
- Duplicate reflection (file exists) → overwrite is NOT allowed by this skill; abort. Use a different sprint_id or remove the existing file via PR.

## Verification (smoke)
Create a throwaway reflection; confirm file appears and CI passes.
