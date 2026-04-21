---
name: zzem-kb:sync-active-prds
description: Extract body content of Notion PRDs with `상태 = 진행 중` and mirror them into `products/active-prds/{notion-id}.md`. Notion is SSOT; the KB files are derived, read-only mirrors overwritten on every sync. Use to refresh PRD content before Phase 2 Spec, ad-hoc review, or after a material Notion change. Requires Notion MCP.
---

# zzem-kb:sync-active-prds

Pulls the full **body** of every PRD whose Notion `상태` is `진행 중` into `products/active-prds/{notion-id}.md`. Complements `zzem-kb:sync-prds-from-notion` (which syncs only the flat metadata catalogue). Notion is the Single Source of Truth; KB files are an overwrite-on-success mirror — do not hand-edit.

## Model

- **Source**: Notion database (default id `22c0159c6b598017903ff16d077e87dd`), pages where `상태 = 진행 중`.
- **Destination**: `products/active-prds/{notion-page-id-without-dashes}.md`. One file per active PRD.
- **Direction**: one-way, Notion → KB. Never write back.
- **Conflict policy**: destination is a **managed mirror**. On each sync:
  1. Fetch the current set of `진행 중` PRDs from Notion.
  2. For each PRD: write (or overwrite) its file.
  3. Delete any existing `products/active-prds/*.md` file whose filename does NOT appear in the current fetch — those PRDs have transitioned out of `진행 중` and no longer belong in this directory.
- **SSOT enforcement**: every generated file begins with a `> DO NOT EDIT` banner. The `notion_id` frontmatter field ties the file back to the source; editing locally will be clobbered on the next sync.

## Inputs

- `database_id` — Notion database id (optional; default `22c0159c6b598017903ff16d077e87dd`).
- `domain_filter` — array of Notion `도메인` values to include (optional; default: all domains). Example: `["ZZEM"]` excludes AI Native / Speaking / 여성향 크랙 entries.
- `include_ids` — explicit allow-list of Notion page ids (optional; if set, other filters are ignored and only these pages are synced). Use for curated subsets.
- `exclude_ids` — deny-list of Notion page ids (optional). Use to skip overview/index pages.
- `kb_product_map` — optional `{notion_id: kb_product}` object that adds a `kb_product` frontmatter field on the output file when the id is present. Callers maintain this mapping externally (no auto-classification).

## Preconditions

- `zzem-kb:sync` succeeded in this session.
- Working tree at `$ZZEM_KB_PATH` is clean.
- Notion MCP is connected. Abort with a clear message if `mcp__wrtn-mcp__notion_*` tools are unavailable.

## Steps

1. **Sync main**
   Bash: `cd "$ZZEM_KB_PATH" && git checkout main && git pull --ff-only`

2. **Query candidate pages**
   - If `include_ids` is provided: for each id, call `mcp__wrtn-mcp__notion_get_page` and collect metadata.
   - Otherwise: call `mcp__wrtn-mcp__notion_query_database` with
     `filter: { property: "상태", status: { equals: "진행 중" } }`, paginate until `has_more: false`.
   - Apply `domain_filter` and `exclude_ids` if set.

3. **Fetch body blocks for each page**
   For each candidate page, call `mcp__wrtn-mcp__notion_get_page_content` with the page id. Paginate child blocks until exhausted.

4. **Transform blocks → markdown**
   Convert Notion blocks to markdown per this mapping (unrecognized blocks fall back to plain text):

   | Notion block | Markdown |
   |---|---|
   | `heading_1` / `heading_2` / `heading_3` | `# ` / `## ` / `### ` |
   | `paragraph` | plain text; concat rich_text, preserve links as `[text](url)`, inline code as `` `text` `` |
   | `bulleted_list_item` | `- ` |
   | `numbered_list_item` | `1. ` (markdown renderer handles numbering) |
   | `to_do` | `- [ ] ` (unchecked) / `- [x] ` (checked) |
   | `quote` | `> ` |
   | `callout` | `> **{emoji or "Note"}:** {text}` |
   | `code` | fenced block with language (```<lang>\n...\n```) |
   | `divider` | `---` |
   | `image` / `file` / `pdf` | `![{caption}]({url})` with file links as `[{name}]({url})` |
   | `bookmark` / `embed` / `link_preview` | `[{caption or url}]({url})` |
   | `table` | GitHub-flavored markdown table |
   | `toggle` | `<details><summary>{summary}</summary>\n\n{children}\n\n</details>` |
   | `synced_block` / `column_list` / `column` | traverse children inline |
   | `equation` | `$$...$$` block |
   | `child_database` / `child_page` | reference line: `> Notion embed: {title} ({url})` |
   | rich_text with `color`/`bold`/`italic`/`strikethrough` | `**...**` / `*...*` / `~~...~~`; color dropped |
   | mentions (user/page/date) | plaintext name or ISO date |

   For nested blocks (children of a list/toggle): recurse and indent 2 spaces per level.

5. **Compose file content**
   Write: `products/active-prds/{page-id-without-dashes}.md`

   ```
   ---
   notion_id: {page-id-with-dashes}
   title: {properties.이름.title[*].plain_text | "(untitled)"}
   domain: {properties.도메인.select.name | omit if null}
   status: "진행 중"
   kb_product: {kb_product_map[id] | omit if unset}
   description: {concat of properties.설명.rich_text | omit if empty}
   kpi_contribution: {concat of properties["KPI 기여 방식"].rich_text | omit if empty}
   assignees: [{people names}]   # omit if empty
   figma: [{file.external.url or file.file.url values from properties.Figma}]  # omit if empty
   url: {page.url}
   created_time: {page.created_time}
   last_edited_time: {page.last_edited_time}
   synced_at: {current ISO 8601 with offset}
   synced_by: {git config user.email | "unknown"}
   schema_version: 1
   ---

   > ⚠ **DO NOT EDIT** — this file is a mirror of Notion. Re-run
   > `zzem-kb:sync-active-prds` to refresh. Edit the source at {page.url}.

   # {title}

   {transformed body markdown}
   ```

6. **Delete stale files**
   List `products/active-prds/*.md`. Any file whose basename (without `.md`) does NOT match a notion_id from step 2's result set is stale (PRD has transitioned out of `진행 중` — or been deleted from Notion). Delete those files.
   Special case: `products/active-prds/README.md` (if present) is never synced and never deleted.

7. **Validate**
   Bash: `cd "$ZZEM_KB_PATH" && npm run validate:products`
   If validation fails:
   - Frontmatter schema mismatch → inspect error, fix step 5 mapping, re-run.
   - Do NOT commit malformed content.

8. **Commit + rebase-retry push**
   Bash:
   ```
   cd "$ZZEM_KB_PATH"
   git add products/active-prds/
   # Include deletions explicitly in case some files were removed:
   git add -A products/active-prds/
   NCHANGED=$(git diff --cached --name-only products/active-prds/ | wc -l | tr -d ' ')
   if [ "$NCHANGED" = "0" ]; then echo "no changes"; exit 0; fi
   git commit -m "sync(notion): active PRDs ({N} entries)"
   for i in 1 2 3; do
     if git pull --rebase origin main && git push; then exit 0; fi
     sleep $((2**i))
   done
   echo "push failed after 3 retries"
   exit 1
   ```

## Failure handling

- **Notion MCP unavailable** → abort immediately with `Notion MCP is not connected. Connect it and retry.` Do NOT partial-write.
- **Page with no title** → file is still written with `title: "(untitled)"` — caller investigates.
- **Page `get_page_content` returns a child_database or child_page** → emit a reference line (no recursion into sub-databases). A full DB expansion is out of scope.
- **Validation failure on one file** → abort the whole sync. All-or-nothing to avoid mixed states in `products/active-prds/`.
- **Rebase-retry exhausted** → files remain locally committed; caller resolves manually.

## Idempotency

- If Notion state has not changed since the last sync, the only per-file diff is `synced_at` (and `synced_by` when different users run the sync). Callers who care about commit noise can diff the file body and skip the commit when only `synced_at` changed.
- Deletions are handled deterministically by step 6 — a file is present iff its id is in the current Notion result set.

## Verification (smoke)

1. Invoke on a scratch branch with `domain_filter=["ZZEM"]`.
2. Expect `products/active-prds/*.md` to contain one file per `진행 중 ∧ ZZEM` Notion page.
3. Spot-check one: the `url` resolves to the right Notion page; body content matches the source.
4. Manually edit a file, re-run the sync: the edit is gone (overwrite policy verified).
5. Change a Notion PRD's `상태` away from `진행 중`, re-run the sync: its file is deleted.

## Out of scope (future work)

- **Per-product canonical `products/{product}/prd.md` overwrite** — those remain manually authored. `kb_product` frontmatter links an active PRD to a product, but no auto-merge into the canonical file.
- **Sub-page / child-database traversal** — only the top-level page body is synced.
- **Scheduled refresh** — manual invocation only. A SessionStart hook can be added later if sprint agents need fresh state every session.
- **Bidirectional sync / write-back to Notion** — deliberately disabled.
- **Read-skill extension** (`zzem-kb:read type=active-prd`) — add when a consumer needs filtering.
