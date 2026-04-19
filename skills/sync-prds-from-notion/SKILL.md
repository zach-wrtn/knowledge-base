---
name: zzem-kb:sync-prds-from-notion
description: Pull the Notion PRD database into `products/notion-prds.yaml` as a flat, read-only index. One-way sync (Notion → KB); overwrite-on-success. Invoke manually whenever a fresh snapshot of the PRD list is needed (e.g., before Phase 2 Spec workflow, or during cross-sprint PRD survey). Requires Notion MCP to be connected in the current session.
---

# zzem-kb:sync-prds-from-notion

Snapshots the Notion PRD database into a single flat YAML index inside the KB. Notion remains the source of truth for PRD *content*; the KB file is a queryable *catalogue* (ids, titles, status, domain, URLs, last-edited timestamps).

## Model

- **Source**: Notion database "PRD" (default id `22c0159c6b598017903ff16d077e87dd`, brand-level `도메인` field).
- **Destination**: `products/notion-prds.yaml` (repo root's `products/` axis — sibling to per-product `prd.md` files).
- **Direction**: one-way, Notion → KB. Never write back to Notion from this skill.
- **Conflict**: none by design — the destination is fully overwritten every sync. Local edits will be discarded.
- **Product classification**: NOT performed in v1. Every Notion entry lands in the flat list regardless of `도메인`. Per-product breakdown is deferred until a concrete consumer needs it.

## Inputs

- `database_id` — Notion database id (optional; default `22c0159c6b598017903ff16d077e87dd` — the ZZEM PRD DB).
- `status_include` — array of Notion `상태` values to include (optional; default: include all). Example: `["진행 중", "완료"]` to drop backlog/holds.

## Preconditions

- `zzem-kb:sync` succeeded in this session.
- Working tree at `$ZZEM_KB_PATH` is clean.
- Notion MCP is connected (this skill uses `mcp__wrtn-mcp__notion_get_database` and `mcp__wrtn-mcp__notion_query_database`). If the Notion tools are unavailable, abort with a clear message instructing the user to connect the Notion MCP.

## Steps

1. **Sync main**
   Bash: `cd "$ZZEM_KB_PATH" && git checkout main && git pull --ff-only`

2. **Fetch DB metadata**
   Call `mcp__wrtn-mcp__notion_get_database` with `database_id` to confirm accessibility and capture:
   - `title` (for the `source.title` field)
   - `url` (for `source.url`)

3. **Query all pages (paginated)**
   Loop:
   - Initial: `mcp__wrtn-mcp__notion_query_database` with `database_id`, `page_size: 100`.
   - While `has_more: true`: re-query with `start_cursor: <next_cursor>`.
   - Accumulate `results` across all pages.

4. **Transform each page → index entry**
   For each page in the accumulated results, emit:
   ```yaml
   - id:               {page.id}                    # uuid with dashes
     title:            {properties.이름.title[0].plain_text | "(untitled)"}
     domain:           {properties.도메인.select.name | null}
     status:           {properties.상태.status.name | null}
     description:      {concat(properties.설명.rich_text[*].plain_text) | omit if empty}
     kpi_contribution: {concat(properties["KPI 기여 방식"].rich_text[*].plain_text) | omit if empty}
     assignees:        {properties.사람.people[*].name | omit if empty}
     url:              https://www.notion.so/{page.id without dashes}
     created_time:     {page.created_time}
     last_edited_time: {page.last_edited_time}
   ```
   - If `status_include` is set, skip pages whose `status` is not in the list.
   - Pages with missing title: include with `title: "(untitled)"` and keep the `id` — caller may want to investigate.

5. **Sort entries**
   Sort the `prds` array by `last_edited_time` descending (most-recent first).

6. **Compose the file**
   Write: `products/notion-prds.yaml`

   ```yaml
   source:
     kind: notion-database
     database_id: {normalized-32-hex}    # lowercase, no dashes
     url: {db url}
     title: {db title}
   synced_at: {current ISO 8601 with offset}
   synced_by: {git config user.email | "unknown"}
   prds:
     - { ... entries from step 4 ... }
   schema_version: 1
   ```

   Use valid YAML; quote strings containing colons/hashes; escape newlines in multi-line values with `|` block scalars.

7. **Local validate**
   Bash: `cd "$ZZEM_KB_PATH" && npm run validate:products`

   If validation fails:
   - Schema shape mismatch → the Notion data likely contained an unexpected property value; inspect the error, adjust the transform in step 4, re-run from step 3.
   - Do NOT commit malformed content.

8. **Commit + rebase-retry push**
   Bash:
   ```
   cd "$ZZEM_KB_PATH"
   git add products/notion-prds.yaml
   git commit -m "sync(notion): PRD index ({N} entries, db={database_id-short})"
   for i in 1 2 3; do
     if git pull --rebase origin main && git push; then exit 0; fi
     sleep $((2**i))
   done
   echo "push failed after 3 retries"
   exit 1
   ```

## Failure handling

- **Notion MCP unavailable** → abort with: `Notion MCP is not connected. Install/connect the Notion MCP, then retry.` Do NOT partially write the output.
- **Notion API error (auth / network)** → abort; preserve the existing file.
- **Empty database** → still write the file with `prds: []` and a warning to stdout.
- **Pagination hangs** (e.g., cursor loops) → cap at 10 pages (1000 entries); if still has_more, abort and report.
- **Validate fails** → report the AJV error; do NOT commit.
- **Push retries exhausted** → file remains locally committed; caller resolves manually.

## Idempotency

Running the skill twice in a row with no Notion changes produces a diff only in `synced_at` (and `synced_by` if users differ). To avoid pollution of commit history, callers may diff the `prds:` section specifically and skip the commit if only `synced_at` changed.

## Verification (smoke)

1. Invoke in a scratch branch.
2. `git diff products/notion-prds.yaml` should show a plausible list of PRDs with ZZEM-domain entries sourced from Notion.
3. `npm run validate:products` passes.
4. Spot-check one entry: its `url` resolves in the browser to the expected Notion page.

## Out of scope (future work)

- **Per-product classification** — mapping `도메인: ZZEM` entries to `ai-webtoon | free-tab | ugc-platform`. Add when a consumer (e.g., `zzem-kb:read type=prd product=<x>`) needs it.
- **Body content sync** — the skill does NOT pull PRD body markdown. Readers follow the `url` to Notion for the full document.
- **Bidirectional sync / write-back** — intentionally disabled. Edit PRDs in Notion, re-sync to refresh the index.
- **Scheduled sync** — no cron; invoke manually or via a future automation layer.
