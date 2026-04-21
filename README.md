# zzem-knowledge-base

Machine-readable team knowledge base consumed by orchestrator agents.

## Install (consumer)

```bash
# First-time setup
git clone git@github.com:zach-wrtn/knowledge-base.git ~/.zzem/kb
~/.zzem/kb/scripts/install-skills.sh
```

The orchestrator's `scripts/kb-bootstrap.sh` runs both steps idempotently on session start.

Override the clone path with `ZZEM_KB_PATH=/custom/path`.

## Skills (agent interface)

| Skill | Purpose |
|-------|---------|
| `zzem-kb:sync` | Pull latest KB state |
| `zzem-kb:read` | Query any content type (pattern/rubric/reflection/prd/events) |
| `zzem-kb:write-pattern` | Create a new defect pattern (axis 1) |
| `zzem-kb:update-pattern` | Bump frequency / last_seen of an existing pattern (axis 1) |
| `zzem-kb:write-reflection` | Record a sprint retrospective (axis 1) |
| `zzem-kb:promote-rubric` | Append a row to the active rubric's Promotion Log (axis 1) |
| `zzem-kb:sync-prds-from-notion` | Snapshot the Notion PRD database into `products/notion-prds.yaml` (axis 2, read-only index). Requires Notion MCP. |
| `zzem-kb:sync-active-prds` | Mirror full body of `상태 = 진행 중` Notion PRDs into `products/active-prds/{notion-id}.md` (axis 2, SSOT-mirrored). Requires Notion MCP. |

Axis-2 content (PRD, events) is authored with the Write tool directly — no
dedicated skill. See `products/README.md` for the workflow.

Each skill's `SKILL.md` is the authoritative protocol; agents invoke them via the Skill tool.

## Content types

Two axes: `learning/` (self-improving meta-knowledge) and `products/` (per-product specs).

### Axis 1 — `learning/`

| Type | Directory | Schema | Filename |
|------|-----------|--------|----------|
| pattern | `learning/patterns/` | `schemas/learning/pattern.schema.json` | `{category}-{NNN}.yaml` |
| rubric | `learning/rubrics/` | `schemas/learning/rubric.schema.json` | `v{N}.md` |
| reflection | `learning/reflections/` | `schemas/learning/reflection.schema.json` | `{sprint-id}.md` |

### Axis 2 — `products/`

| Type | Directory | Schema | Filename |
|------|-----------|--------|----------|
| prd (overview) | `products/{product}/` | `schemas/products/prd.schema.json` | `prd.md` |
| events (catalog) | `products/{product}/events/` | `schemas/products/events.schema.json` | `catalog.yaml` |
| events (rationale) | `products/{product}/events/` | — | `{app}-{feature}.md` |
| events (index) | `products/{product}/events/` | — | `README.md` (optional) |
| notion-prds (index) | `products/` | `schemas/products/notion-prds.schema.json` | `notion-prds.yaml` |
| active-prd (feature body mirror) | `products/{product}/{slug}/` | `schemas/products/active-prd.schema.json` | `prd.md` |

`{product}` ∈ `{ai-webtoon, free-tab, ugc-platform}`; `{slug}` is a kebab-case
PRD identifier (e.g., `filter-diversification`, `phase-1-profile`). Event
rationale filenames follow `{app}-{feature}.md` in kebab-case (e.g.,
`meme-app-home.md`, `meme-app-swipe-feed.md`). See `products/README.md` for
authoring. Legacy flat `products/{product}/events.yaml` is still accepted by
the validator with a deprecation warning; scheduled for removal in KB Phase 3.
`notion-prds.yaml` is a Notion-synced flat index (read-only; sourced via
`zzem-kb:sync-prds-from-notion`).
`products/{product}/{slug}/prd.md` files are full `상태 = 진행 중` PRD bodies
mirrored from Notion (SSOT; sourced via `zzem-kb:sync-active-prds` — do NOT
hand-edit, overwrite-on-sync policy).

## Contributing

- **Content (`content/**`):** direct push to `main` permitted (CI validates schemas).
- **Everything else:** PR required; CODEOWNERS review enforced by repository ruleset.

Breaking schema changes follow the procedure in the Phase 1 design doc `docs/superpowers/specs/2026-04-18-knowledge-base-platform-phase1-design.md` in the orchestrator repo.

## Development

```bash
npm install
npm run validate   # run all validators locally
```

## License

Public — zach-wrtn team knowledge base.
