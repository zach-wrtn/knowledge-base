---
name: zzem-kb:read
description: Query the KB by content type and filters. Returns file paths (caller reads content via Read tool). Use at Phase 2 Spec to load prior patterns/reflections and at Phase 4 Evaluator to load the latest rubric.
---

# zzem-kb:read

## Inputs
- `type` — one of `pattern`, `rubric`, `reflection` (required).
- Filters (optional, AND semantics):
  - For `pattern`: `category` (enum), `severity` (enum), `min_frequency` (integer).
  - For `rubric`: `status` (default `active`).
  - For `reflection`: `domain` (string), `limit` (integer, default 3, most-recent first by `completed_at`).

## Preconditions
- `zzem-kb:sync` was invoked in this sprint phase. If not, invoke it first.

## Steps
1. **Resolve directory**
   - `pattern` → `$ZZEM_KB_PATH/content/patterns/`
   - `rubric`  → `$ZZEM_KB_PATH/content/rubrics/`
   - `reflection` → `$ZZEM_KB_PATH/content/reflections/`

2. **List candidates**
   Glob: `{dir}/*.yaml` for patterns, `*.md` for rubrics/reflections.

3. **Filter client-side**
   Read each candidate, parse YAML or frontmatter, apply filter predicate.
   - `pattern`: keep if `category`, `severity`, `frequency >= min_frequency` match.
   - `rubric`: keep if frontmatter `status` matches; sort descending by `version`; return top 1.
   - `reflection`: keep if `domain` matches; sort by `completed_at` desc; slice `limit`.

4. **Return paths**
   Output a list of absolute file paths. The caller uses Read on each.

## Failure handling
- No matches → return empty list. Do not treat as error.
- Parse error on one file → log the specific file and skip it; continue.

## Verification (smoke)
Invoke with `type=pattern, category=correctness` after migration. Expect ≥3 files returned.
