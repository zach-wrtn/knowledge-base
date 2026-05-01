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
  - For `events`, optional `include` — one of `catalog` (default, returns only `catalog.yaml`) or `all` (returns `catalog.yaml` + every rationale `*.md` under `events/`).

## Preconditions
- `zzem-kb:sync` was invoked in this sprint phase. If not, invoke it first.

## Steps
1. **Resolve directory/glob**
   - `pattern` → `$ZZEM_KB_PATH/learning/patterns/*.yaml`
   - `rubric`  → `$ZZEM_KB_PATH/learning/rubrics/*.md`
   - `reflection` → `$ZZEM_KB_PATH/learning/reflections/*.md`
   - `prd` → `$ZZEM_KB_PATH/products/*/prd.md` (cross-product glob; filter by `product` if set)
   - `events` → resolve per product (see step 2 below). Preferred path is
     `$ZZEM_KB_PATH/products/{product}/events/catalog.yaml`; legacy fallback is
     `$ZZEM_KB_PATH/products/{product}/events.yaml`.

2. **List candidates**
   - `pattern` / `rubric` / `reflection` / `prd`: glob as above.
   - `events`: for each relevant product (all three, or the one matching the `product` filter):
     1. If `{product}/events/catalog.yaml` exists → use it.
     2. Else if `{product}/events.yaml` exists → use it AND log a one-line deprecation
        note: `legacy events.yaml at <path> — migrate to events/catalog.yaml`.
     3. Else → product has no events catalogue; skip silently.
     4. When `include=all`, also include every `{product}/events/*.md` (rationale docs)
        sorted lexicographically. `{product}/events/README.md` is included as the index.

3. **Filter client-side**
   Read each candidate, parse YAML (`.yaml`) or frontmatter (`.md`), apply filter predicate.
   - `pattern`: keep if `category`, `severity`, `frequency >= min_frequency` match.
   - `rubric`: keep if frontmatter `status` matches; sort descending by `version`; return top 1.
   - `reflection`: keep if `domain` matches; sort by `completed_at` desc; slice `limit`.
   - `prd`: keep if `product` matches (or return all when no filter).
   - `events`: already filtered by `product` during path resolution (step 2). The catalog YAML itself has a `product` field — verify it matches the directory's product and warn on mismatch.

4. **Return paths**
   Output a list of absolute file paths. The caller uses Read on each.

## Failure handling
- No matches → return empty list. Do not treat as error.
- Parse error on one file → log the specific file and skip it; continue.
- Legacy `events.yaml` detected → still returned (backwards-compatible), but emit a deprecation note once per product per sync session. Scheduled for removal in KB Phase 3.

## Verification (smoke)
- `type=pattern, category=correctness` → expect ≥3 files
- `type=prd, product=free-tab` → expect exactly 1 file (`products/free-tab/prd.md`)
- `type=events, product=ai-webtoon` → expect exactly 1 file (`products/ai-webtoon/events/catalog.yaml`)
- `type=events, product=free-tab, include=all` → expect `catalog.yaml` + `README.md` + rationale `*.md` files under `products/free-tab/events/`
