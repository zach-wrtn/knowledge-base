---
name: zzem-kb:read
description: Query the KB by content type and filters. Returns file paths (caller reads content via Read tool). Use at Phase 2 Spec to load prior patterns/reflections, Phase 4 Evaluator to load the latest rubric, and anywhere you need a product's current PRD or event design.
---

# zzem-kb:read

## Inputs
- `type` — one of `pattern`, `rubric`, `reflection`, `prd`, `events` (required).
- Filters (optional, AND semantics):
  - For `pattern`: `category` (enum), `severity` (enum), `min_frequency` (integer).
  - For `rubric`: `status` (default `active`).
  - For `reflection`: `domain` (enum: `ai-webtoon | free-tab | ugc-platform | infra`), `limit` (integer, default 3, most-recent first by `completed_at`).
  - For `prd`: `product` (enum: `ai-webtoon | free-tab | ugc-platform`).
  - For `events`: `product` (enum: `ai-webtoon | free-tab | ugc-platform`).

## Preconditions
- `zzem-kb:sync` was invoked in this sprint phase. If not, invoke it first.

## Steps
1. **Resolve directory/glob**
   - `pattern` → `$ZZEM_KB_PATH/learning/patterns/*.yaml`
   - `rubric`  → `$ZZEM_KB_PATH/learning/rubrics/*.md`
   - `reflection` → `$ZZEM_KB_PATH/learning/reflections/*.md`
   - `prd` → `$ZZEM_KB_PATH/products/*/prd.md` (cross-product glob; filter by `product` if set)
   - `events` → `$ZZEM_KB_PATH/products/*/events.yaml` (cross-product glob; filter by `product` if set)

2. **List candidates**
   Glob as above.

3. **Filter client-side**
   Read each candidate, parse YAML (`.yaml`) or frontmatter (`.md`), apply filter predicate.
   - `pattern`: keep if `category`, `severity`, `frequency >= min_frequency` match.
   - `rubric`: keep if frontmatter `status` matches; sort descending by `version`; return top 1.
   - `reflection`: keep if `domain` matches; sort by `completed_at` desc; slice `limit`.
   - `prd`: keep if `product` matches (or return all when no filter).
   - `events`: keep if `product` matches (or return all when no filter).

4. **Return paths**
   Output a list of absolute file paths. The caller uses Read on each.

## Failure handling
- No matches → return empty list. Do not treat as error.
- Parse error on one file → log the specific file and skip it; continue.

## Verification (smoke)
- `type=pattern, category=correctness` → expect ≥3 files
- `type=prd, product=free-tab` → expect exactly 1 file (`products/free-tab/prd.md`)
- `type=events, product=ai-webtoon` → expect exactly 1 file
