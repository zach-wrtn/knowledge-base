# products/ (Axis 2: Product Specs)

Per-product artifacts consumed by sprints. Two layers, **nested per product**:

- **Overview layer** — `products/{product}/prd.md` is the **product's current-state overview** (summary, scope, boundaries) plus an index table of active feature PRDs. Hand-authored. Manually maintained.
- **Mirror layer** — `products/{product}/{slug}/prd.md` is a **full feature-PRD body** mirrored from Notion's `상태 = 진행 중` pages. Auto-synced via `zzem-kb:sync-active-prds`; never hand-edited. Multiple feature PRDs per product supported (e.g., `ugc-platform` has 3 phases).

Notion is the SSOT for PRD **content**; the KB overview is the SSOT for how feature PRDs **relate** to a product and to each other (phases, dependencies, sprint links).

## Structure

```
products/
  ai-webtoon/
    prd.md               (overview)
    events.yaml          (product-level events)
    service-v1-2/        (feature PRD mirror)
      prd.md
  free-tab/
    prd.md
    events.yaml
    filter-diversification/
      prd.md
  ugc-platform/
    prd.md
    events.yaml
    phase-1-profile/
      prd.md
    phase-2-feed-payback/
      prd.md
    phase-3-social-notification/
      prd.md
  notion-prds.yaml       # Notion-synced PRD metadata index (flat, read-only)
```

Product directory names MUST match the `product` enum in
`schemas/products/prd.schema.json` and `schemas/products/events.schema.json`.

`notion-prds.yaml` at the top level is a **read-only snapshot** of the Notion
PRD database. Do not hand-edit. Refresh via the `zzem-kb:sync-prds-from-notion`
skill (requires Notion MCP). Schema: `schemas/products/notion-prds.schema.json`.

`products/{product}/{slug}/prd.md` holds **full body mirrors** of PRDs whose
Notion `상태` is `진행 중`. Each slug directory corresponds to exactly one
Notion page; its `prd.md` frontmatter's `notion_id` ties back to the source.
Notion is SSOT; these files are overwritten on every `zzem-kb:sync-active-prds`
run and the slug directory is deleted when the source PRD transitions out of
`진행 중`. Do NOT edit locally — edits will be clobbered on next sync. Schema:
`schemas/products/active-prd.schema.json`.

## Authoring workflow

No write skill exists for axis-2 content (intentional — concurrent writes
haven't been observed). Edit the file with the Write tool, validate locally,
commit directly.

```bash
npm run validate:products   # or the full `npm run validate`
git add products/<product>/<file>
git commit -m "products(<product>): <short description>"
git push
```

## Field rules

### prd.md frontmatter (overview layer)

| field | required | notes |
|---|---|---|
| `product` | yes | must match the containing directory name |
| `status` | yes | `draft` \| `active` \| `archived` |
| `owner` | no | free-form |
| `last_updated` | yes | ISO date (`YYYY-MM-DD`) — update on every edit |
| `related_sprints` | no | array of sprint ids (e.g. `["free-tab-diversification"]`) |
| `active_prds` | no | array of Notion page ids (UUID with dashes) — each id must have a matching file under `products/active-prds/{id-without-dashes}.md`. Keep this in sync when a feature PRD transitions in/out of `진행 중` |
| `schema_version` | yes | `1` for now |

### prd.md body conventions (overview layer)

The body is free-form markdown, but follow this section structure for consistency:

1. **현재 상태** — 1-2 paragraphs describing where the product is today
2. **Active Feature PRDs (진행 중)** — table listing feature PRDs with links to Notion + local mirror in `active-prds/`
3. **Related Sprints (완료 / 이력)** — completed sprints and optional reflection links
4. **Notion Catalogue** — pointer to `products/notion-prds.yaml` for the full PRD history
5. **제품 경계** — what's in / out of scope for this product
6. **편집 규칙** — reminds editors that feature-PRD bodies live in Notion + `active-prds/`, not here

Products with phases (e.g. `ugc-platform`) add a Phase table inside §2 showing phase order + dependencies.

### events.yaml

| field | required | notes |
|---|---|---|
| `product` | yes | must match the containing directory name |
| `last_updated` | yes | ISO date |
| `events[].name` | yes | snake_case, starts with lowercase letter |
| `events[].trigger` | yes | ≥5 chars describing when the event fires |
| `events[].properties` | yes | object; values are type/description strings |
| `events[].notes` | no | free-form |
| `schema_version` | yes | `1` for now |

Minimum one event in `events[]`.

## Adding a new product

1. Open a PR that extends the `product` enum in **both** product schemas
2. Create the matching `products/<new-product>/` directory with stub files
3. CODEOWNERS review required (schema PR gate)
