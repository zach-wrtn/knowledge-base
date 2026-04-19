# KB Two-Axis Architecture (Phase 2)

- **Date**: 2026-04-19
- **Status**: Draft — awaiting implementation
- **Owner**: zach-wrtn
- **Supersedes**: `docs/superpowers/specs/2026-04-19-reflection-domain-enum-design.md` (Phase 1.2 domain enum work is folded into §3 of this spec)

## Problem

`zzem-knowledge-base` currently holds only self-improving artifacts (patterns, reflections, rubrics). Sprint product deliverables — PRDs, event design docs — live in the orchestrator repo (`zzem-orchestrator/docs/prds/`, `sprint-orchestrator/sprints/{id}/PRD.md`). This creates two problems:

1. **No single source of truth for product specs.** PRDs copied per-sprint drift from the canonical latest version. Event design specs don't even have a home yet.
2. **Repo role is ambiguous.** `zzem-knowledge-base` presents itself as "team knowledge" but covers only half of what the team knows — the meta-learning half, not the product-spec half.

The fix is to make the KB explicitly two-axis:

- **Axis 1 — learning**: meta-knowledge for self-improving orchestrator performance (patterns, reflections, rubrics)
- **Axis 2 — products**: canonical product specs consumed by sprints (PRD, event design)

Both axes should be visible at the repo root.

## Goals

1. Repo root structure clearly reflects the two axes
2. Axis 2 has schema-validated PRD and event-design content types, one set per product
3. Existing axis-1 content migrates without semantic change (only path moves + the already-agreed domain enum tightening)
4. Skills and validators updated to cover both axes

### Non-goals (explicit, see §7)

- Axis-2 write skills (`write-prd`, etc.) — deferred until concurrent-write pressure materializes
- Actual PRD/events content authoring — Phase 2.0 creates skeletons only
- Observability, auto-cleanup, path-scoped PR enforcement — separate Phase 2 items
- Design system, API contracts — stay in their current repos
- Orchestrator-side path-reference updates — Phase 2.1 follow-up PR

## Design

### §1. Directory Structure

```
zzem-knowledge-base/
├── learning/                    # axis 1: self-improving
│   ├── patterns/*.yaml
│   ├── reflections/*.md
│   └── rubrics/*.md
├── products/                    # axis 2: product specs (one set per product)
│   ├── ai-webtoon/
│   │   ├── prd.md
│   │   └── events.yaml
│   ├── free-tab/
│   │   ├── prd.md
│   │   └── events.yaml
│   └── ugc-platform/
│       ├── prd.md
│       └── events.yaml
├── schemas/                     # all schemas, grouped by axis
│   ├── learning/
│   │   ├── pattern.schema.json
│   │   ├── reflection.schema.json
│   │   └── rubric.schema.json
│   └── products/
│       ├── prd.schema.json
│       └── events.schema.json
├── skills/                      # shared
├── scripts/
├── tests/
└── docs/
```

Key changes from current layout:

- `content/` wrapper removed — `learning/` directly contains the three type directories
- `schemas/` stays at root but gains `learning/` and `products/` subdirectories to mirror content
- Two new top-level directories: `learning/`, `products/`

### §2. Axis 2 Schemas

#### `schemas/products/prd.schema.json`

PRD frontmatter only; body is free-form markdown.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://zach-wrtn.github.io/knowledge-base/schemas/products/prd.schema.json",
  "title": "PRD (frontmatter only)",
  "type": "object",
  "additionalProperties": false,
  "required": ["product", "status", "last_updated", "schema_version"],
  "properties": {
    "product":        { "enum": ["ai-webtoon", "free-tab", "ugc-platform"] },
    "status":         { "enum": ["draft", "active", "archived"] },
    "owner":          { "type": "string" },
    "last_updated":   { "type": "string", "format": "date" },
    "related_sprints": {
      "type": "array",
      "items": { "type": "string", "pattern": "^[a-z0-9-]+$" }
    },
    "schema_version": { "const": 1 }
  }
}
```

#### `schemas/products/events.schema.json`

Full YAML validation (not just frontmatter).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://zach-wrtn.github.io/knowledge-base/schemas/products/events.schema.json",
  "title": "Event design",
  "type": "object",
  "additionalProperties": false,
  "required": ["product", "last_updated", "events", "schema_version"],
  "properties": {
    "product":        { "enum": ["ai-webtoon", "free-tab", "ugc-platform"] },
    "owner":          { "type": "string" },
    "last_updated":   { "type": "string", "format": "date" },
    "events": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "trigger", "properties"],
        "properties": {
          "name":       { "type": "string", "pattern": "^[a-z][a-z0-9_]+$" },
          "trigger":    { "type": "string", "minLength": 5 },
          "properties": {
            "type": "object",
            "additionalProperties": { "type": "string" }
          },
          "notes":      { "type": "string" }
        }
      }
    },
    "schema_version": { "const": 1 }
  }
}
```

#### Filename ↔ `product` consistency

A new validator enforces that the directory name matching the product (`products/ai-webtoon/`) equals the `product` field value in its files. Prevents silent mislabeling.

### §3. `domain` vs `product` enum split

Phase 1.2's `domain` enum decision (`ai-webtoon, free-tab, ugc-platform, infra`) is repositioned as **axis-1 only**. Axis 2 uses a separate `product` enum.

| Field | Used in | Enum |
|---|---|---|
| `domain` | `learning/reflections/*.md` frontmatter | `[ai-webtoon, free-tab, ugc-platform, infra]` |
| `product` | `products/**/*` frontmatter/YAML | `[ai-webtoon, free-tab, ugc-platform]` |

Rationale:

- Reflections can be about infra work (see `kb-phase1-dogfood.md`), so `domain` needs `infra`
- Products are products — `infra` is not a product
- Sharing one enum would allow an `infra` PRD to validate, which is semantically wrong

#### DRY concern

The three overlapping values are duplicated across `schemas/learning/reflection.schema.json` and both `schemas/products/*.schema.json` files. Options considered:

- Shared `$ref` to a common definitions file: possible with AJV but adds loader complexity for three values
- **Chosen**: accept duplication. Validators run on every file, so enum drift shows up immediately in CI. YAGNI.

#### Migration of existing content

The one legacy value that doesn't match: `learning/reflections/ai-webtoon.md` has `domain: ai`. Updated to `domain: ai-webtoon` in the same commit as the schema tightening.

### §4. Skills

#### `sync` — unchanged

Pulls the entire repo; directory restructure is transparent.

#### `read` — extended

Current signature accepts `type ∈ {pattern, rubric, reflection}`. Extended:

| `type` | Filters | Path resolution |
|---|---|---|
| pattern | category, severity, min_frequency | `$KB/learning/patterns/*.yaml` |
| rubric | status | `$KB/learning/rubrics/*.md` |
| reflection | domain, limit | `$KB/learning/reflections/*.md` |
| **prd** | **product (enum)** | `$KB/products/*/prd.md` (cross-product glob) |
| **events** | **product (enum)** | `$KB/products/*/events.yaml` |

For `prd` and `events` with a `product` filter set, path resolves directly to one file; without filter, returns all products' files.

#### `write-pattern`, `update-pattern`, `write-reflection` — path updates only

All `content/patterns/` → `learning/patterns/` etc. No logic changes. `write-reflection` additionally documents the `domain` enum (carried over from Phase 1.2).

#### Axis-2 write skills — **not added**

PRD/events are written manually (Write tool + commit) for now. Decision: add a `write-prd` skill only once concurrent-write pressure appears (e.g., ≥5 product-doc changes per month, or observed merge conflicts).

#### `products/README.md`

New file with:

- Template for creating a new PRD
- Template for creating a new events.yaml
- Rules for `last_updated`, `status`, `product` fields
- Reminder to run `npm run validate:content` before committing
- Note that no write skill exists — use Write tool directly

### §5. Validators

#### Path updates (existing scripts)

| Script | Change |
|---|---|
| `validate-pattern-schemas.mjs` | `content/patterns/` → `learning/patterns/`; `schemas/pattern.schema.json` → `schemas/learning/pattern.schema.json` |
| `validate-markdown-frontmatter.mjs` | rubrics + reflections: same pattern |
| `validate-schema-backwards-compat.mjs` | All three targets: new dirs + new schema paths |
| `validate-fixtures.mjs` | Schema loader paths |
| `validate-filename-id-match.mjs` | `content/patterns/` → `learning/patterns/` |
| `validate-unique-ids.mjs` | Same |

#### New scripts

1. **`scripts/validate-product-schemas.mjs`**
   - Validates `products/*/prd.md` frontmatter against `schemas/products/prd.schema.json`
   - Validates `products/*/events.yaml` (full YAML) against `schemas/products/events.schema.json`
   - Additional check: directory name must equal the `product` field value in the file

2. **`scripts/validate-product-dir-enum.mjs`**
   - Scans `products/` top-level entries
   - Directories: name must be in `[ai-webtoon, free-tab, ugc-platform]`
   - `products/schemas/` — not applicable (schemas live at `schemas/products/`, not inside `products/`)
   - `products/README.md` and other files at the top level: allowed

#### `package.json` scripts reorganization

```json
{
  "validate:schemas":   "node scripts/validate-fixtures.mjs",
  "validate:learning":  "node scripts/validate-filename-id-match.mjs && node scripts/validate-unique-ids.mjs && node scripts/validate-pattern-schemas.mjs && node scripts/validate-markdown-frontmatter.mjs",
  "validate:products":  "node scripts/validate-product-schemas.mjs && node scripts/validate-product-dir-enum.mjs",
  "validate:skills":    "node scripts/validate-skill-frontmatter.mjs",
  "validate:backcompat":"node scripts/validate-schema-backwards-compat.mjs",
  "test:install-skills":"bash tests/install-skills.test.sh",
  "validate":           "npm run validate:schemas && npm run validate:learning && npm run validate:products && npm run validate:skills && npm run validate:backcompat && npm run test:install-skills"
}
```

`validate:content` is renamed to `validate:learning` to make the axis split explicit. CI workflow (`.github/workflows/validate.yml`) updates to the new names.

#### Fixture updates

- `tests/fixtures/` gains valid + invalid cases for PRD and events
- Existing pattern/rubric/reflection fixtures: only schema-path updates

### §6. Migration Plan

Single PR, six logical commits (reviewable independently, squash on merge optional).

#### Phase 2.0 — this PR

1. **`migrate: content/ → learning/`**
   - `git mv content/patterns learning/patterns` × 3
   - `git mv schemas/{pattern,reflection,rubric}.schema.json schemas/learning/`
   - Update all validator path constants
   - Update skills' path references (`read`, `write-pattern`, `update-pattern`, `write-reflection`)
   - **Acceptance**: `npm run validate` passes standalone

2. **`schema: constrain reflection.domain to enum`** (absorbs Phase 1.2)
   - Add enum to `schemas/learning/reflection.schema.json`
   - Migrate `learning/reflections/ai-webtoon.md`: `domain: ai` → `ai-webtoon`
   - Append `> **Status**: Superseded by 2026-04-19-kb-two-axis-architecture-design.md` to the old Phase 1.2 spec

3. **`feat: add axis 2 (products) skeleton`**
   - Create `schemas/products/{prd,events}.schema.json`
   - Create `products/{ai-webtoon,free-tab,ugc-platform}/` directories
   - Each directory gets a minimal valid stub:
     - `prd.md` with `status: draft` frontmatter, body `# TODO`
     - `events.yaml` with one placeholder event (to satisfy `minItems: 1`)
   - Create `products/README.md` (axis-2 write guide)

4. **`feat: add product validators`**
   - `scripts/validate-product-schemas.mjs`
   - `scripts/validate-product-dir-enum.mjs`
   - Update `package.json` scripts (rename `validate:content` → `validate:learning`, add `validate:products`)
   - Add PRD + events fixtures (valid + invalid cases)

5. **`feat(skills): extend read for axis 2`**
   - `skills/read/SKILL.md` — add `prd`/`events` types + new path table
   - `skills/write-pattern/SKILL.md`, `update-pattern/SKILL.md`, `write-reflection/SKILL.md` — path references to `learning/`
   - `skills/write-reflection/SKILL.md` — document `domain` enum values (Phase 1.2 carryover)

6. **`docs: update README + superseded spec marker`**
   - README content-type table: update to `learning/` paths + add `products/` rows
   - README skills table: add PRD/events read support
   - Confirm Phase 1.2 spec has its superseded marker

#### Phase 2.1 — follow-up PR (separate, paired with orchestrator PR)

- Orchestrator: update `scripts/kb-bootstrap.sh` and `.claude/skills/sprint/knowledge-base.md` path references
- Seed `products/free-tab/prd.md` from `zzem-orchestrator/docs/prds/PRD-free-tab-filter-diversification.md`
- `events.yaml` actual content: authored later by product owners; skeleton is enough for Phase 2.0

### Risks

| Risk | Mitigation |
|---|---|
| `git mv` history tracking | Verify `git log --follow learning/patterns/*.yaml` works post-merge |
| Orchestrator references `content/` paths → broken bootstrap between Phase 2.0 merge and Phase 2.1 | Coordinate PR sequencing: merge Phase 2.1 orchestrator PR within minutes of Phase 2.0 KB PR |
| Schema `$id` URL change | `$id` changes to `schemas/learning/...` and `schemas/products/...`. AJV matches by `$id`; no external consumers yet, so safe |
| Enum duplication (`domain` vs `product`) drifts | CI validates all content; any mismatch fails fast |
| `products/` directory name enforcement too strict for future additions | Adding a product = one-line enum change + CODEOWNERS review. Explicit friction, not a bug |

## Testing

- Local: `npm run validate` passes after each commit in the sequence
- CI: `.github/workflows/validate.yml` runs the same aggregator
- Negative checks (manual, pre-merge):
  - Invalid domain in a reflection → fails with enum error
  - Mismatched `product` field vs directory name → fails with directory check error
  - Invalid event name (PascalCase instead of snake_case) → fails with pattern error
  - Unknown top-level dir under `products/` (e.g. `products/bogus/`) → fails

## §7. Out of Scope (explicit)

- Axis-2 write skills (`write-prd`, `update-prd`, `write-events`) — deferred; add when needed
- Actual PRD/events content authoring — Phase 2.0 is skeleton only; Phase 2.1 seeds one real PRD
- Observability (skill usage metrics, CI log aggregation, Slack webhooks) — separate spec
- Auto-cleanup rules (`frequency ≥ 5` auto-archive, stale-pattern sweep) — separate spec
- Path-scoped PR enforcement (GitHub Pro `file_path_restriction`) — separate spec
- Design system integration (`zzem-design-system-poc` stays separate)
- API contract migration (stays in sprint repo / backend repo)
- New-product-addition process — enum PR + CODEOWNERS is enough; no formal process needed
- Orchestrator-side path-reference updates — Phase 2.1 follow-up PR
