# Reflection `domain` Enum Standardization (Phase 1.2)

- **Date**: 2026-04-19
- **Status**: Draft — awaiting implementation
- **Owner**: zach-wrtn
- **Tracks**: follow-up from `content/reflections/kb-phase1-dogfood.md` (§Recommendations for Phase 2 #5, Followups #3)

## Problem

`schemas/reflection.schema.json` currently declares `domain` as an unconstrained string:

```json
"domain": { "type": "string" }
```

Current values observed across three reflections:

| file | `domain` |
|---|---|
| `ai-webtoon.md` | `ai` |
| `free-tab-diversification.md` | `free-tab` |
| `kb-phase1-dogfood.md` | `infra` |

The `write-reflection` skill's documentation lists the example `ugc-platform`, which never appears in real content. The `read` skill's `domain` filter uses exact string match, so `ai` ≠ `ai-webtoon` silently returns empty.

This makes `read type=reflection domain=<x>` unpredictable for agents: they cannot know the correct token without grepping existing files, and typo-at-write becomes permanent drift.

## Goal

Make `domain` a closed enum that:

1. Matches the team's product-axis mental model
2. Fails fast when an unknown value is written
3. Lets `read` callers use a known, stable vocabulary

Non-goals (deferred to Phase 2 full scoping):

- Observability / usage metrics
- Auto-cleanup rules for stale patterns
- Path-scoped PR enforcement
- Process for adding new domains (covered trivially by schema PR for now)

## Design

### 1. Enum definition

```json
"domain": {
  "enum": ["ai-webtoon", "free-tab", "ugc-platform", "infra"]
}
```

Rationale (confirmed with owner on 2026-04-19): ZZEM team has three products
(`ai-webtoon`, `free-tab`, `ugc-platform`) plus `infra` as a separate axis
covering tooling/platform work like this KB itself.

### 2. Content migration

One file needs the label corrected:

| file | before | after |
|---|---|---|
| `content/reflections/ai-webtoon.md` | `domain: ai` | `domain: ai-webtoon` |

The other two reflections already match the enum.

### 3. Schema versioning

Keep `schema_version: 1`. No version bump.

Justification: tightening a field's value range while migrating all existing
content in the same commit preserves the consumer contract. No reader code
changes. The KB is currently the only consumer of this schema; there is no
external deployment whose v1 files would be stranded.

### 4. Skill doc update

`skills/write-reflection/SKILL.md` — Inputs section:

```diff
-- `domain` — required (e.g. `ai-webtoon`, `ugc-platform`).
+- `domain` — required. Must be one of: `ai-webtoon`, `free-tab`, `ugc-platform`, `infra`.
+  See `schemas/reflection.schema.json` for the source of truth.
```

`skills/read/SKILL.md` is **not** updated: the schema file is the canonical
domain list, and the read skill's behavior (exact-match filter) is unchanged.

### 5. Validation path

No new validator. Existing chain already covers this:

- `scripts/validate-markdown-frontmatter.mjs` validates reflection frontmatter
  against `reflection.schema.json` using AJV — enum constraint is enforced
  automatically.
- `scripts/validate-schema-backwards-compat.mjs` runs the same check as a
  "current content still validates" guard — also automatic.

`npm run validate:content` and `npm run validate:backcompat` both exercise
the new constraint.

### 6. Commit plan (single PR)

Three logical commits for reviewability:

1. `migrate: reflection domain ai → ai-webtoon` — content only
2. `schema: constrain reflection.domain to product enum` — schema only
3. `skills(write-reflection): document domain enum` — skill doc only

Order matters: content migrates first so the schema-tightening commit's CI
run passes. If squashed on merge, the resulting state is identical.

## Risks

| risk | mitigation |
|---|---|
| External consumer has a v1 reflection with a different domain value | None known. KB is the only consumer. If one appears later, they get a clear validation error pointing to the enum. |
| Future product axis (e.g. new product line) | Enum extension requires a schema PR + CODEOWNERS review — acceptable friction for a four-value list. Deferred process formalization to Phase 2. |
| `validate-schema-backwards-compat.mjs` flagging the enum narrowing | Does not apply: this validator checks "current content ↔ current schema," not "old schema ↔ new schema." Migrated content passes. |

## Testing

- Local: `npm run validate` — all existing validators pass after migration + schema change
- CI: same aggregator runs on PR via `.github/workflows/validate.yml`
- Negative check (manual, pre-merge): temporarily set `domain: bogus` in a
  reflection; confirm `validate:content` fails with an enum error; revert.

## Out of Scope (explicitly)

- README.md change — schema file is truth; README already links to it
- `pattern.schema.json` changes — patterns use `category`, not `domain`
- Rubric schema — unaffected
- Migration tooling — one file, edited by hand
- New-domain approval process — deferred to Phase 2 scoping brainstorm
