# Team Q&A Wiki — Plan 1: KB-side Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `qa` content type to `zzem-knowledge-base` so the Wiki app can commit approved Q&A as schema-validated `.md` files and orchestrator agents can consume them via the existing `zzem-kb:read` skill.

**Architecture:** Mirror the existing `reflection`/`rubric` content-type pattern: JSON Schema → frontmatter validator wired into `validate:learning` → directory + README → `zzem-kb:read` skill extension. Add `learning/qa-owners.yaml` as the SSOT for scope→owner routing (consumed later by the Wiki app's Cloud Functions; this plan only validates its shape).

**Tech Stack:** Node.js (validators in `scripts/`), Ajv 2020, gray-matter, js-yaml. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-30-team-qa-wiki-design.md` §2 (Data Model — schemas/learning/qa.schema.json, qa-owners.yaml).

---

## File Structure

**Create:**
- `schemas/learning/qa.schema.json` — JSON Schema for QA frontmatter
- `schemas/learning/qa-owners.schema.json` — JSON Schema for the owners file
- `learning/qa/.gitkeep` — empty placeholder so empty dir lands in git
- `learning/qa/README.md` — content-type doc for human authors
- `learning/qa-owners.yaml` — initial owners file (zach as everything)
- `scripts/validate-qa-owners.mjs` — owners file validator
- `tests/fixtures/valid-qa.md` — passes schema
- `tests/fixtures/invalid-qa-missing-scope.md`
- `tests/fixtures/invalid-qa-bad-scope-enum.md`
- `tests/fixtures/invalid-qa-superseded-no-target.md`
- `tests/fixtures/valid-qa-owners.yaml`
- `tests/fixtures/invalid-qa-owners-missing-scopes.yaml`

**Modify:**
- `scripts/validate-markdown-frontmatter.mjs` — register `qa` target
- `scripts/validate-fixtures.mjs` — add positive/negative qa fixtures
- `package.json` — add `validate:qa-owners` to `validate` chain
- `skills/read/SKILL.md` — document `qa` type
- `README.md` — list `qa` in axis-1 table

---

### Task 1: Define QA schema (failing fixtures first)

**Files:**
- Create: `tests/fixtures/valid-qa.md`
- Create: `tests/fixtures/invalid-qa-missing-scope.md`
- Create: `tests/fixtures/invalid-qa-bad-scope-enum.md`
- Create: `tests/fixtures/invalid-qa-superseded-no-target.md`
- Create: `schemas/learning/qa.schema.json`

- [ ] **Step 1: Write valid fixture**

`tests/fixtures/valid-qa.md`:
```markdown
---
id: qa-001
question: "When does the free-tab filter diversification experiment end?"
scope: free-tab
asker: alice@wrtn.io
approver: zach@wrtn.io
approved_at: '2026-04-30T00:00:00Z'
last_verified_at: '2026-04-30T00:00:00Z'
status: active
related:
  patterns: [correctness-006]
  prds: [free-tab/filter-diversification]
  events: [meme-app-home]
  qa: []
ai:
  model: claude-sonnet-4-6
  sources_used:
    - { type: prd, id: free-tab/filter-diversification }
tags: [experiment, rollout]
schema_version: 1
---

## Question
When does the free-tab filter diversification experiment end?

## Answer
According to PRD free-tab/filter-diversification, the experiment runs through 2026-Q3.
```

- [ ] **Step 2: Write invalid fixtures**

`tests/fixtures/invalid-qa-missing-scope.md`:
```markdown
---
id: qa-002
question: "missing scope"
asker: alice@wrtn.io
approver: zach@wrtn.io
approved_at: '2026-04-30T00:00:00Z'
last_verified_at: '2026-04-30T00:00:00Z'
status: active
ai: { model: claude-sonnet-4-6, sources_used: [] }
schema_version: 1
---

## Question
x

## Answer
y
```

`tests/fixtures/invalid-qa-bad-scope-enum.md`:
```markdown
---
id: qa-003
question: "bad scope enum"
scope: invalid-scope
asker: alice@wrtn.io
approver: zach@wrtn.io
approved_at: '2026-04-30T00:00:00Z'
last_verified_at: '2026-04-30T00:00:00Z'
status: active
ai: { model: claude-sonnet-4-6, sources_used: [] }
schema_version: 1
---

## Question
x

## Answer
y
```

`tests/fixtures/invalid-qa-superseded-no-target.md`:
```markdown
---
id: qa-004
question: "superseded with no target"
scope: global
asker: alice@wrtn.io
approver: zach@wrtn.io
approved_at: '2026-04-30T00:00:00Z'
last_verified_at: '2026-04-30T00:00:00Z'
status: superseded
ai: { model: claude-sonnet-4-6, sources_used: [] }
schema_version: 1
---

## Question
x

## Answer
y
```

- [ ] **Step 3: Write QA JSON schema**

`schemas/learning/qa.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://zach-wrtn.github.io/knowledge-base/schemas/learning/qa.schema.json",
  "title": "Q&A (frontmatter only)",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id", "question", "scope", "asker", "approver",
    "approved_at", "last_verified_at", "status", "ai", "schema_version"
  ],
  "properties": {
    "id":               { "type": "string", "pattern": "^qa-[0-9]{3,}$" },
    "question":         { "type": "string", "minLength": 5, "maxLength": 200 },
    "scope":            { "enum": ["global", "ai-webtoon", "free-tab", "ugc-platform"] },
    "asker":            { "type": "string", "format": "email" },
    "approver":         { "type": "string", "format": "email" },
    "approved_at":      { "type": "string", "format": "date-time" },
    "last_verified_at": { "type": "string", "format": "date-time" },
    "status":           { "enum": ["active", "deprecated", "superseded"] },
    "superseded_by":    { "type": "string", "pattern": "^qa-[0-9]{3,}$" },
    "related": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "patterns":    { "type": "array", "items": { "type": "string", "pattern": "^(correctness|completeness|integration|edge_case|code_quality|design_proto|design_spec)-[0-9]{3}$" } },
        "prds":        { "type": "array", "items": { "type": "string" } },
        "events":      { "type": "array", "items": { "type": "string" } },
        "qa":          { "type": "array", "items": { "type": "string", "pattern": "^qa-[0-9]{3,}$" } },
        "reflections": { "type": "array", "items": { "type": "string" } },
        "rubrics":     { "type": "array", "items": { "type": "string" } }
      }
    },
    "ai": {
      "type": "object",
      "required": ["model", "sources_used"],
      "additionalProperties": false,
      "properties": {
        "model": { "type": "string", "minLength": 1 },
        "sources_used": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["type", "id"],
            "additionalProperties": false,
            "properties": {
              "type": { "enum": ["pattern", "prd", "event", "qa", "reflection", "rubric"] },
              "id":   { "type": "string", "minLength": 1 },
              "why":  { "type": "string" }
            }
          }
        }
      }
    },
    "tags": { "type": "array", "items": { "type": "string" } },
    "schema_version": { "const": 1 }
  },
  "allOf": [
    {
      "if":   { "properties": { "status": { "const": "superseded" } } },
      "then": { "required": ["superseded_by"] }
    }
  ]
}
```

- [ ] **Step 4: Verify schema parses (no validation yet)**

Run: `node -e "JSON.parse(require('fs').readFileSync('schemas/learning/qa.schema.json','utf8'))" && echo OK`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add schemas/learning/qa.schema.json tests/fixtures/valid-qa.md tests/fixtures/invalid-qa-*.md
git commit -m "schemas: add qa.schema.json + fixtures"
```

---

### Task 2: Wire QA schema into markdown frontmatter validator

**Files:**
- Modify: `scripts/validate-markdown-frontmatter.mjs`

- [ ] **Step 1: Read current validator**

Run: `cat scripts/validate-markdown-frontmatter.mjs`

- [ ] **Step 2: Add `qa` to targets list**

In `scripts/validate-markdown-frontmatter.mjs`, replace the `targets` array:

```js
const targets = [
  { dir: join(ROOT, "learning/rubrics"),      schema: loadSchema("rubric") },
  { dir: join(ROOT, "learning/reflections"),  schema: loadSchema("reflection") },
  { dir: join(ROOT, "learning/qa"),           schema: loadSchema("qa") },
];
```

- [ ] **Step 3: Run validator against fixtures (positive)**

Add a one-off invocation to confirm:
```bash
mkdir -p /tmp/kb-test/learning/qa
cp tests/fixtures/valid-qa.md /tmp/kb-test/learning/qa/qa-001.md
cp -r schemas /tmp/kb-test/
cd /tmp/kb-test && node /Users/zachryu/dev/work/zzem-knowledge-base/scripts/validate-markdown-frontmatter.mjs
```

Wait — the validator uses ROOT from its own location. Easier: temporarily place valid fixture and run the script normally.

Replace step 3 with this approach instead:

Run from repo root:
```bash
cp tests/fixtures/valid-qa.md learning/qa/qa-001.md
npm run validate:learning
```

Expected: passes (qa included in list with new target).

- [ ] **Step 4: Verify it catches a broken fixture**

```bash
cp tests/fixtures/invalid-qa-missing-scope.md learning/qa/qa-002.md
npm run validate:learning || echo "EXPECTED FAIL"
rm learning/qa/qa-002.md
```

Expected: validator prints FAIL line for `learning/qa/qa-002.md` and exits non-zero.

- [ ] **Step 5: Clean up — remove the test file**

```bash
rm learning/qa/qa-001.md
```

- [ ] **Step 6: Commit**

```bash
git add scripts/validate-markdown-frontmatter.mjs
git commit -m "validators: register qa schema in markdown frontmatter check"
```

---

### Task 3: Add `valid-qa.md` to fixture validator (positive case)

**Files:**
- Modify: `scripts/validate-fixtures.mjs`

- [ ] **Step 1: Read current validate-fixtures.mjs**

Run: `cat scripts/validate-fixtures.mjs`

- [ ] **Step 2: Locate the positive-fixture and negative-fixture lists**

Search for `valid-` and `invalid-` in the file to find where reflection/pattern fixtures are registered.

- [ ] **Step 3: Register qa fixtures**

For each list (positive `expectsValid: true`, negative `expectsValid: false`), append the qa fixtures using the existing pattern.

Positive entry (use schema=`qa` + parser=`gray-matter`):
```js
{ schema: "learning/qa", file: "tests/fixtures/valid-qa.md", parser: "frontmatter", expectsValid: true },
```

Negative entries:
```js
{ schema: "learning/qa", file: "tests/fixtures/invalid-qa-missing-scope.md",       parser: "frontmatter", expectsValid: false },
{ schema: "learning/qa", file: "tests/fixtures/invalid-qa-bad-scope-enum.md",      parser: "frontmatter", expectsValid: false },
{ schema: "learning/qa", file: "tests/fixtures/invalid-qa-superseded-no-target.md", parser: "frontmatter", expectsValid: false },
```

(If the validator uses a different shape — e.g., separate arrays — match that shape exactly. Read the file first.)

- [ ] **Step 4: Run validator**

Run: `npm run validate:schemas`

Expected: PASS (all qa fixtures behave as registered).

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-fixtures.mjs
git commit -m "fixtures: register qa positive + negative fixtures"
```

---

### Task 4: Owners file schema + seed

**Files:**
- Create: `schemas/learning/qa-owners.schema.json`
- Create: `learning/qa-owners.yaml`
- Create: `tests/fixtures/valid-qa-owners.yaml`
- Create: `tests/fixtures/invalid-qa-owners-missing-scopes.yaml`

- [ ] **Step 1: Write owners JSON schema**

`schemas/learning/qa-owners.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://zach-wrtn.github.io/knowledge-base/schemas/learning/qa-owners.schema.json",
  "title": "Q&A Owners",
  "type": "object",
  "additionalProperties": false,
  "required": ["scopes", "admins", "schema_version"],
  "properties": {
    "scopes": {
      "type": "object",
      "additionalProperties": false,
      "required": ["global", "ai-webtoon", "free-tab", "ugc-platform"],
      "properties": {
        "global":       { "type": "array", "minItems": 1, "items": { "type": "string", "format": "email" } },
        "ai-webtoon":   { "type": "array", "minItems": 1, "items": { "type": "string", "format": "email" } },
        "free-tab":     { "type": "array", "minItems": 1, "items": { "type": "string", "format": "email" } },
        "ugc-platform": { "type": "array", "minItems": 1, "items": { "type": "string", "format": "email" } }
      }
    },
    "admins":         { "type": "array", "minItems": 1, "items": { "type": "string", "format": "email" } },
    "schema_version": { "const": 1 }
  }
}
```

- [ ] **Step 2: Write seed owners file**

`learning/qa-owners.yaml`:
```yaml
schema_version: 1
scopes:
  global:       [zach@wrtn.io]
  ai-webtoon:   [zach@wrtn.io]
  free-tab:     [zach@wrtn.io]
  ugc-platform: [zach@wrtn.io]
admins:         [zach@wrtn.io]
```

(Other scope owners are added in follow-up PRs as the team grows.)

- [ ] **Step 3: Write fixtures**

`tests/fixtures/valid-qa-owners.yaml`:
```yaml
schema_version: 1
scopes:
  global:       [a@wrtn.io]
  ai-webtoon:   [a@wrtn.io, b@wrtn.io]
  free-tab:     [c@wrtn.io]
  ugc-platform: [d@wrtn.io]
admins:         [a@wrtn.io]
```

`tests/fixtures/invalid-qa-owners-missing-scopes.yaml`:
```yaml
schema_version: 1
scopes:
  global: [a@wrtn.io]
admins:   [a@wrtn.io]
```

- [ ] **Step 4: Commit**

```bash
git add schemas/learning/qa-owners.schema.json learning/qa-owners.yaml tests/fixtures/valid-qa-owners.yaml tests/fixtures/invalid-qa-owners-missing-scopes.yaml
git commit -m "schemas: add qa-owners.schema.json + seed owners file"
```

---

### Task 5: Owners validator script

**Files:**
- Create: `scripts/validate-qa-owners.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the validator**

`scripts/validate-qa-owners.mjs`:
```js
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yaml from "js-yaml";

const ROOT = new URL("..", import.meta.url).pathname;
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

const schema = JSON.parse(
  readFileSync(join(ROOT, "schemas", "learning", "qa-owners.schema.json"), "utf8")
);
const validate = ajv.compile(schema);

const file = join(ROOT, "learning", "qa-owners.yaml");
if (!existsSync(file)) {
  console.error(`FAIL  ${file}: missing`);
  process.exit(1);
}

const doc = yaml.load(readFileSync(file, "utf8"));
if (!validate(doc)) {
  for (const err of validate.errors) {
    const path = err.instancePath || "(root)";
    console.error(`FAIL  ${file}: ${path} ${err.message}`);
  }
  process.exit(1);
}
console.log("qa-owners OK");
```

- [ ] **Step 2: Run validator (must pass on seed)**

Run: `node scripts/validate-qa-owners.mjs`
Expected: `qa-owners OK`

- [ ] **Step 3: Run validator on broken fixture (must fail)**

Run:
```bash
cp tests/fixtures/invalid-qa-owners-missing-scopes.yaml learning/qa-owners.yaml.bak
cp tests/fixtures/invalid-qa-owners-missing-scopes.yaml learning/qa-owners.yaml
node scripts/validate-qa-owners.mjs || echo "EXPECTED FAIL"
mv learning/qa-owners.yaml.bak learning/qa-owners.yaml
```

Expected: prints FAIL with `must have required property 'ai-webtoon'` (or similar) and exits non-zero. Then restore via the `mv`.

- [ ] **Step 4: Wire into npm scripts**

Edit `package.json` — replace the `validate:learning` line:

```json
"validate:learning": "node scripts/validate-filename-id-match.mjs && node scripts/validate-unique-ids.mjs && node scripts/validate-pattern-schemas.mjs && node scripts/validate-markdown-frontmatter.mjs && node scripts/validate-qa-owners.mjs",
```

- [ ] **Step 5: Run full validate**

Run: `npm run validate`
Expected: PASS (all sub-validators pass).

- [ ] **Step 6: Commit**

```bash
git add scripts/validate-qa-owners.mjs package.json
git commit -m "validators: add qa-owners validator and wire into validate:learning"
```

---

### Task 6: Initialize learning/qa/ directory

**Files:**
- Create: `learning/qa/.gitkeep`
- Create: `learning/qa/README.md`

- [ ] **Step 1: Create .gitkeep so empty directory is tracked**

```bash
mkdir -p learning/qa
touch learning/qa/.gitkeep
```

- [ ] **Step 2: Write directory README**

`learning/qa/README.md`:
```markdown
# learning/qa/

Approved Q&A pairs surfaced by the Wiki app (`zzem-qa-wiki`). Filenames are
`qa-{NNN}.md` (zero-padded to at least 3 digits). Each file's frontmatter
matches `schemas/learning/qa.schema.json`.

## Author manually

Direct human edits are allowed for these reasons only:
- Mark `status: deprecated` with a reason
- Mark `status: superseded` with `superseded_by: qa-NNN`
- Bump `last_verified_at` after re-confirming accuracy
- Fix typos / clarify wording in the Answer body

For new content, use the Wiki app's approval flow — do not hand-author new
`qa-NNN.md` files.

## Schema

See `schemas/learning/qa.schema.json`. Validated by
`scripts/validate-markdown-frontmatter.mjs` as part of `npm run validate:learning`.

## Numbering

Numbers are assigned by the Wiki app's `approveAndCommit` Cloud Function
(monotonic, next-available scan). Do not pick numbers manually.
```

- [ ] **Step 3: Run validator**

Run: `npm run validate:learning`
Expected: PASS (empty `qa/` directory is fine; README.md is excluded by the validator's filename filter).

- [ ] **Step 4: Commit**

```bash
git add learning/qa/.gitkeep learning/qa/README.md
git commit -m "learning: initialize qa/ directory with README"
```

---

### Task 7: Extend zzem-kb:read skill

**Files:**
- Modify: `skills/read/SKILL.md`

- [ ] **Step 1: Read current SKILL.md**

Run: `cat skills/read/SKILL.md`

- [ ] **Step 2: Add `qa` to the inputs list**

Modify `skills/read/SKILL.md` Inputs section. Replace the line starting with `- \`type\` —`:

```markdown
- `type` — one of `pattern`, `rubric`, `reflection`, `prd`, `events`, `qa` (required).
```

Add to the Filters subsection (before the closing of that bullet block):

```markdown
  - For `qa`: `scope` (enum: `global | ai-webtoon | free-tab | ugc-platform`), `status` (default `active`; `all` to include deprecated/superseded), `limit` (integer, default 20, most-recent first by `approved_at`).
```

- [ ] **Step 3: Add Steps entry**

In Step 1 ("Resolve directory/glob"), add a bullet:

```markdown
   - `qa` → `$ZZEM_KB_PATH/learning/qa/*.md`
```

In Step 3 ("Filter client-side"), add a bullet:

```markdown
   - `qa`: keep if `scope` matches (when set) and `status` matches; sort by `approved_at` desc; slice `limit`.
```

- [ ] **Step 4: Add a verification line**

In the "Verification (smoke)" block, add:

```markdown
- `type=qa, scope=free-tab` → expect 0+ files (empty until Wiki app commits)
```

- [ ] **Step 5: Run skill frontmatter validator**

Run: `npm run validate:skills`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/read/SKILL.md
git commit -m "skill(read): support qa content type"
```

---

### Task 8: Update root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read README.md**

Run: `cat README.md`

- [ ] **Step 2: Add qa row to Axis 1 table**

In the "### Axis 1 — `learning/`" table, add a row after `reflection`:

```markdown
| qa | `learning/qa/` | `schemas/learning/qa.schema.json` | `qa-{NNN}.md` |
```

Just below the same table, add a sentence:

```markdown
Approved Q&A is committed by the `zzem-qa-wiki` app (separate repo). See
`learning/qa/README.md` for hand-edit policy. Owner routing for the wiki's
approval workflow lives in `learning/qa-owners.yaml`.
```

- [ ] **Step 3: Add qa-owners row**

If the README has a separate "config files" or similar listing, append `learning/qa-owners.yaml` there. If not, the sentence in Step 2 covers it.

- [ ] **Step 4: Add `validate:qa-owners` to dev section if explicitly listed**

If the "Development" section enumerates individual `validate:*` scripts, add:
```markdown
- `npm run validate:learning` — now also covers `qa` frontmatter and `qa-owners.yaml`
```

If not, no change needed (the existing `npm run validate` runs everything).

- [ ] **Step 5: Run full validate**

Run: `npm run validate`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document qa content type and qa-owners.yaml in README"
```

---

### Task 9: Final integration smoke test

**Files:** none

- [ ] **Step 1: Drop in the example QA from the spec**

Create `learning/qa/qa-001.md` from the valid fixture (this represents the seed example, kept for grounding orchestrator agents):

```bash
cp tests/fixtures/valid-qa.md learning/qa/qa-001.md
```

- [ ] **Step 2: Validate**

Run: `npm run validate`
Expected: PASS.

- [ ] **Step 3: Decide — keep or remove**

If the team wants a real seed Q&A in the repo for agent grounding, keep `learning/qa/qa-001.md`. Otherwise remove it:

```bash
rm learning/qa/qa-001.md
npm run validate
```

The Phase 1 launch of the Wiki app will create the first real qa-001 — the Wiki app's `approveAndCommit` allocates from the next available number, so leaving the seed in or out is purely a "do we want this example?" question.

- [ ] **Step 4: Final commit (whichever way you went)**

If kept:
```bash
git add learning/qa/qa-001.md
git commit -m "learning(qa): seed qa-001 from valid fixture"
```

If removed: no commit needed.

- [ ] **Step 5: Verify all skills + schemas + back-compat pass**

Run: `npm run validate`
Expected: every sub-validator prints OK and the final command exits 0.

---

## Self-review notes

- Spec coverage: §2 (data model — qa.schema.json ✓, qa-owners.yaml ✓), §5 Phase 1 ("zzem-kb:read skill extended for qa type" ✓, "qa.schema.json + validate:learning integration" ✓). Phases 2–4 are out of scope for this plan.
- The validator-fixture wiring in Task 3 is sensitive to the actual shape of `validate-fixtures.mjs` — read the file first; the registration shape shown is illustrative. Match the exact shape used for existing pattern/reflection fixtures.
- `learning/qa-owners.yaml` is validated by a dedicated script rather than reusing the markdown validator because it's YAML, not markdown. Same pattern as the product-schema validator.
- Backwards-compatibility script (`validate-schema-backwards-compat.mjs`) will fire on this PR; if it requires a baseline checkpoint of pre-existing schemas, confirm it doesn't false-flag the brand-new `qa.schema.json` (it shouldn't — only existing schemas are checked against their previous versions).
